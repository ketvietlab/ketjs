import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import { company, oauth, partner, user } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, user, oauth]

const boot = async () => {
  const manifest = compose(modules)
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  const call = <T = Record<string, unknown>>(name: string, input: Record<string, unknown>, actor?: string) =>
    callFn(name, input, {
      adapter,
      manifest,
      actor,
      scope: { company: 'acme', companies: ['acme'], branch: 'root:acme', branches: ['root:acme'] },
    }).then((result) => result.value as T)
  await call('partner.savePartner', { id: 'acme:partner', kind: 'company', name: 'ACME' })
  await call('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme:partner',
    currency: 'VND',
  })
  await call('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Admin',
    superuser: true,
  })
  await call('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  return { adapter, manifest, call }
}

const providerInput = {
  id: 'provider-main',
  code: 'main',
  name: 'Identity Cloud',
  protocol: 'oidc',
  issuer: 'https://identity.example.test',
  clientId: 'ket-client',
  clientAuthMethod: 'none',
  scopes: 'openid profile email',
  redirectUri: 'https://suite.example.test/auth/oauth/main/callback',
  allowedAlgorithms: 'RS256',
  allowLinking: true,
  autoProvision: false,
  requireVerifiedEmail: true,
  active: true,
}

const discovery = {
  issuer: 'https://identity.example.test',
  authorizationEndpoint: 'https://identity.example.test/oauth/v2/authorize',
  tokenEndpoint: 'https://identity.example.test/oauth/v2/token',
  jwksUri: 'https://identity.example.test/oauth/v2/keys',
}

test('oauth domain: provider configuration is unique, normalized and never stores a client secret', async () => {
  const runtime = await boot()
  try {
    assert.equal((await runtime.call<{ ok: boolean }>('oauth.saveProvider', providerInput, 'admin')).ok, true)
    const duplicate = await runtime.call<{ ok: boolean; errors: unknown }>(
      'oauth.saveProvider',
      { ...providerInput, id: 'provider-other', code: 'other' },
      'admin',
    )
    assert.equal(duplicate.ok, false)
    assert.match(JSON.stringify(duplicate.errors), /oauth\.error\.issuerClientUnique/)
    const row = (await runtime.adapter.all('SELECT * FROM oauth_provider', []))[0]!
    assert.equal(row.code, 'main')
    assert.equal(Object.hasOwn(row, 'clientSecret'), false)
  } finally {
    await runtime.adapter.close()
  }
})

test('oauth domain: state is digest-only and transaction claim is single-use under concurrency', async () => {
  const runtime = await boot()
  try {
    await runtime.call('oauth.saveProvider', providerInput, 'admin')
    const started = await runtime.call<{ ok: boolean; state: string; nonce: string; codeVerifier: string }>(
      'oauth.beginTransaction',
      { providerId: 'provider-main', mode: 'login', returnTo: '/admin/product/templates', discovery },
    )
    assert.equal(started.ok, true)
    const row = (await runtime.adapter.all('SELECT * FROM oauth_transaction', []))[0]!
    assert.notEqual(row.stateDigest, started.state)
    assert.notEqual(row.nonceDigest, started.nonce)
    assert.equal(row.codeVerifier, started.codeVerifier)
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        runtime.call<{ ok: boolean }>('oauth.claimTransaction', {
          providerId: 'provider-main',
          state: started.state,
        }),
      ),
    )
    assert.equal(results.filter((result) => result.ok).length, 1)
  } finally {
    await runtime.adapter.close()
  }
})

test('oauth domain: verified subject links to a local user and cannot be stolen concurrently', async () => {
  const runtime = await boot()
  try {
    await runtime.call('oauth.saveProvider', providerInput, 'admin')
    await runtime.call('user.createUser', {
      id: 'operator',
      login: 'operator',
      password: 'operator password',
      name: 'Operator',
    })
    await runtime.call('user.grantCompany', { id: 'operator:acme', userId: 'operator', companyId: 'acme' })
    const linked = await runtime.call<{ ok: boolean }>(
      'oauth.linkIdentity',
      {
        id: 'identity-main-42',
        providerId: 'provider-main',
        userId: 'operator',
        subject: 'subject-42',
        email: 'operator@example.test',
      },
      'admin',
    )
    assert.equal(linked.ok, true)
    const provider = await runtime.call<Record<string, unknown>>(
      'oauth.getProvider',
      { id: 'provider-main' },
      'admin',
    )
    const session = await runtime.call<{ ok: boolean; userId: string; companies: string[] }>(
      'oauth.resolveLogin',
      {
        providerId: 'provider-main',
        providerUpdatedAt: provider.updatedAt,
        mode: 'login',
        issuer: provider.issuer,
        subject: 'subject-42',
        email: 'operator@example.test',
        emailVerified: true,
      },
    )
    assert.equal(session.ok, true)
    assert.equal(session.userId, 'operator')
    assert.deepEqual(session.companies, ['acme'])
    const mine = await runtime.call<unknown[]>('oauth.myIdentities', {}, 'operator')
    assert.equal(mine.length, 1)
    assert.doesNotMatch(JSON.stringify(mine), /passwordHash|operator password/)
    const auditRows = await runtime.adapter.all(
      `SELECT metadata FROM user_security_audit WHERE event LIKE 'oauth.%'`,
      [],
    )
    assert.doesNotMatch(JSON.stringify(auditRows), /subject-42|operator password/)

    const stolen = await runtime.call<{ ok: boolean; errors: unknown }>(
      'oauth.linkIdentity',
      {
        id: 'identity-stolen',
        providerId: 'provider-main',
        userId: 'admin',
        subject: 'subject-42',
      },
      'admin',
    )
    assert.equal(stolen.ok, false)
    assert.match(JSON.stringify(stolen.errors), /oauth\.error\.identityConflict/)
  } finally {
    await runtime.adapter.close()
  }
})

test('oauth domain: auto-provision creates a scoped non-superuser only from verified email', async () => {
  const runtime = await boot()
  try {
    await runtime.call(
      'oauth.saveProvider',
      { ...providerInput, autoProvision: true, defaultCompanyId: 'acme' },
      'admin',
    )
    const provider = await runtime.call<Record<string, unknown>>(
      'oauth.getProvider',
      { id: 'provider-main' },
      'admin',
    )
    const rejected = await runtime.call<{ ok: boolean; errors: unknown }>('oauth.resolveLogin', {
      providerId: 'provider-main',
      providerUpdatedAt: provider.updatedAt,
      mode: 'login',
      issuer: provider.issuer,
      subject: 'unverified',
      email: 'unverified@example.test',
      emailVerified: false,
    })
    assert.equal(rejected.ok, false)
    assert.match(JSON.stringify(rejected.errors), /oauth\.error\.verifiedEmailRequired/)

    const created = await runtime.call<{ ok: boolean; userId: string; defaultCompanyId: string }>(
      'oauth.resolveLogin',
      {
        providerId: 'provider-main',
        providerUpdatedAt: provider.updatedAt,
        mode: 'login',
        issuer: provider.issuer,
        subject: 'new-subject',
        email: 'new.operator@example.test',
        emailVerified: true,
        displayName: 'New Operator',
        preferredUsername: 'new.operator',
      },
    )
    assert.equal(created.ok, true)
    assert.equal(created.defaultCompanyId, 'acme')
    const userRow = (await runtime.adapter.all('SELECT * FROM user_user WHERE id = ?', [created.userId]))[0]!
    assert.equal(Boolean(userRow.superuser), false)
    assert.equal(userRow.passwordHash, null)
    assert.equal(userRow.accessKind, 'internal')

    await runtime.call(
      'oauth.linkIdentity',
      {
        id: 'identity-second',
        providerId: 'provider-main',
        userId: created.userId,
        subject: 'second-subject',
      },
      'admin',
    )
    const firstUnlink = await runtime.call<{ ok: boolean }>(
      'oauth.unlinkIdentity',
      { id: 'identity-second' },
      'admin',
    )
    assert.equal(firstUnlink.ok, true)
    const identityId = `oauth:main:${createHash('sha256')
      .update(`${provider.issuer}\nnew-subject`)
      .digest('hex')}`
    const finalUnlink = await runtime.call<{ ok: boolean; errors: unknown }>(
      'oauth.unlinkIdentity',
      { id: identityId },
      'admin',
    )
    assert.equal(finalUnlink.ok, false)
    assert.match(JSON.stringify(finalUnlink.errors), /oauth\.error\.lastLoginMethod/)
  } finally {
    await runtime.adapter.close()
  }
})
