import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { test, type TestContext } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Row } from 'ketjs'
import { createTestApp } from 'ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'
import { pkceChallenge } from '../packages/ketsuite/src/modules/oauth/protocol.ts'

const fakeProvider = async (t: TestContext) => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicJwk = {
    ...pair.publicKey.export({ format: 'jwk' }),
    kid: 'fake-key-1',
    use: 'sig',
    alg: 'RS256',
  }
  const codes = new Map<string, { clientId: string; redirectUri: string; nonce: string; challenge: string }>()
  let issuer = ''
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer)
    if (url.pathname === '/.well-known/openid-configuration') {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/keys`,
        }),
      )
      return
    }
    if (url.pathname === '/keys') {
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'max-age=60')
      res.end(JSON.stringify({ keys: [publicJwk] }))
      return
    }
    if (url.pathname === '/authorize') {
      assert.equal(url.searchParams.get('response_type'), 'code')
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
      const code = randomBytes(18).toString('base64url')
      codes.set(code, {
        clientId: url.searchParams.get('client_id') ?? '',
        redirectUri: url.searchParams.get('redirect_uri') ?? '',
        nonce: url.searchParams.get('nonce') ?? '',
        challenge: url.searchParams.get('code_challenge') ?? '',
      })
      const callback = new URL(url.searchParams.get('redirect_uri') ?? '')
      callback.searchParams.set('code', code)
      callback.searchParams.set('state', url.searchParams.get('state') ?? '')
      res.statusCode = 302
      res.setHeader('location', callback.toString())
      res.end()
      return
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
      const code = form.get('code') ?? ''
      const held = codes.get(code)
      if (!held || pkceChallenge(form.get('code_verifier') ?? '') !== held.challenge) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'invalid_grant' }))
        return
      }
      codes.delete(code)
      const now = Math.floor(Date.now() / 1000)
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fake-key-1', typ: 'JWT' })).toString(
        'base64url',
      )
      const payload = Buffer.from(
        JSON.stringify({
          iss: issuer,
          sub: 'fake-subject-42',
          aud: held.clientId,
          nonce: held.nonce,
          iat: now,
          exp: now + 300,
          email: 'oidc.operator@example.test',
          email_verified: true,
          name: 'OIDC Operator',
          preferred_username: 'oidc.operator',
        }),
      ).toString('base64url')
      const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), pair.privateKey).toString(
        'base64url',
      )
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ token_type: 'Bearer', id_token: `${header}.${payload}.${signature}` }))
      return
    }
    res.statusCode = 404
    res.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  t.after(
    () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  )
  return { issuer }
}

const bootOauth = async (t: TestContext) => {
  const provider = await fakeProvider(t)
  const e2e = await createTestApp(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = <T = Row>(name: string, input: Record<string, unknown>, actor?: string) =>
    e2e.fixture.call<T>(name, input, { scope, actor }).then((result) => result.value)
  await fixture('partner.savePartner', { id: 'acme:partner', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'KET',
    partnerId: 'acme:partner',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Admin',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await fixture(
    'oauth.saveProvider',
    {
      id: 'fake-provider',
      code: 'fake',
      name: 'Fake Identity',
      protocol: 'oidc',
      issuer: provider.issuer,
      clientId: 'ket-e2e-client',
      clientAuthMethod: 'none',
      scopes: 'openid profile email',
      redirectUri: `${e2e.baseUrl}/auth/oauth/fake/callback`,
      allowedAlgorithms: 'RS256',
      allowLinking: true,
      autoProvision: true,
      requireVerifiedEmail: true,
      defaultCompanyId: 'acme',
      active: true,
    },
    'admin',
  )
  return { e2e, fixture }
}

test('oauth HTTP E2E: login page, cross-origin provider, PKCE callback and live session', async (t) => {
  const { e2e } = await bootOauth(t)
  const browser = e2e.client.anonymous()
  const login = await browser.get('/login?lang=en', { headers: { accept: 'text/html' } })
  assert.equal(login.status, 200)
  assert.match(await login.text(), /Continue with Fake Identity/)
  const hostileLogin = await browser.get('/login?next=%2F%5Cattacker.example&lang=en', {
    headers: { accept: 'text/html' },
  })
  const hostileBody = await hostileLogin.text()
  assert.doesNotMatch(hostileBody, /attacker\.example/)
  assert.match(hostileBody, /next=%2Fadmin/)
  const controlCharacterLogin = await browser.get('/login?next=%2Fwhoami%0ASet-Cookie&lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.match(await controlCharacterLogin.text(), /next=%2Fadmin/)

  const hostileStart = await browser.get('/auth/oauth/fake/start?next=%2F%5Cattacker.example', {
    headers: { accept: 'text/html' },
  })
  assert.equal(hostileStart.status, 303)
  const controlCharacterStart = await browser.get('/auth/oauth/fake/start?next=%2Fwhoami%0ASet-Cookie', {
    headers: { accept: 'text/html' },
  })
  assert.equal(controlCharacterStart.status, 303)
  assert.equal(
    (await e2e.adapter!.all('SELECT "returnTo" FROM oauth_transaction', [])).every(
      (row) => row.returnTo === '/admin',
    ),
    true,
  )

  const started = await browser.get('/auth/oauth/fake/start?next=/whoami&lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(started.status, 303)
  const authorizeUrl = started.headers.get('location')
  assert.ok(authorizeUrl)
  assert.notEqual(new URL(authorizeUrl).origin, new URL(e2e.baseUrl).origin)
  assert.equal(new URL(authorizeUrl).searchParams.get('code_challenge_method'), 'S256')

  const authorized = await fetch(authorizeUrl, { redirect: 'manual' })
  assert.equal(authorized.status, 302)
  const callback = authorized.headers.get('location')
  assert.ok(callback)

  const unbound = await e2e.client.anonymous().get(callback, {
    headers: { accept: 'text/html' },
    redirect: 'manual',
  })
  assert.equal(unbound.status, 303)
  assert.match(unbound.headers.get('location') ?? '', /oauth_error=oauth\.error\.transactionInvalid/)

  const completed = await browser.get(callback, { headers: { accept: 'text/html' } })
  const completedBody = await completed.text()
  assert.equal(completed.status, 200, completedBody)
  assert.match(completedBody, /"ok": true/)
  const who = await browser.get('/whoami')
  assert.equal(who.status, 200)
  const identity = (await who.json()) as { userId: string; company: string }
  assert.match(identity.userId, /^oauth:fake:/)
  assert.equal(identity.company, 'acme')

  const rows = await e2e.adapter!.all('SELECT * FROM oauth_external_identity', [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.subject, 'fake-subject-42')
  assert.equal((await e2e.adapter!.all('SELECT * FROM oauth_transaction', [])).length, 2)

  const replay = await browser.get(callback, {
    headers: { accept: 'text/html' },
    redirect: 'manual',
  })
  assert.equal(replay.status, 303)
  assert.match(replay.headers.get('location') ?? '', /oauth_error=oauth\.error\.transactionInvalid/)
})

test('oauth HTTP E2E: sensitive transaction functions stay off generic HTTP', async (t) => {
  const { e2e } = await bootOauth(t)
  for (const name of [
    'oauth.providerForLogin',
    'oauth.beginTransaction',
    'oauth.claimTransaction',
    'oauth.resolveLogin',
  ]) {
    const response = await e2e.client.request(`/_ket/fn/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(response.status, 400, name)
    assert.equal(((await response.json()) as { code: string }).code, 'E_FUNCTION_INTERNAL')
  }
})

test('oauth HTTP E2E: every administration screen renders in Vietnamese and English', async (t) => {
  const { e2e, fixture } = await bootOauth(t)
  await fixture('oauth.linkIdentity', {
    id: 'admin-fake-subject',
    providerId: 'fake-provider',
    userId: 'admin',
    subject: 'admin-subject',
    email: 'admin@example.test',
    displayName: 'Admin identity',
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  for (const [path, expected] of [
    ['/admin/oauth/providers?lang=vi', /Nhà cung cấp đăng nhập/],
    ['/admin/oauth/providers/fake-provider?lang=en', /OpenID Connect configuration/],
    ['/admin/oauth/providers/new?lang=vi', /Cấu hình OpenID Connect/],
    ['/admin/oauth/identities?lang=vi', /Danh tính ngoài/],
    ['/admin/oauth/identities/new?lang=en', /Verified issuer and subject/],
    ['/admin/oauth/link?lang=en', /Choose a provider/],
    ['/admin/users/admin?lang=en', /Provider identities/],
    ['/admin/profile?lang=en', /Link external identity/],
  ] as const) {
    const response = await e2e.client.get(path, { headers: { accept: 'text/html' } })
    const body = await response.text()
    assert.equal(response.status, 200, `${path}: ${body}`)
    assert.match(body, expected, path)
    assert.doesNotMatch(body, /(?:oauth|oauth_backend)\.[A-Za-z]/, path)
  }

  const anonymous = await e2e.client.anonymous().get('/admin/oauth/providers', {
    headers: { accept: 'text/html' },
    redirect: 'manual',
  })
  assert.equal(anonymous.status, 303)
  assert.match(anonymous.headers.get('location') ?? '', /^\/login/)

  const crossSite = await e2e.client.request('/admin/oauth/providers/fake-provider/archive', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://attacker.example',
    },
    body: 'action=archive',
  })
  assert.equal(crossSite.status, 403)
})

test('oauth HTTP E2E: a signed-in user links a verified subject without replacing the session', async (t) => {
  const { e2e } = await bootOauth(t)
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  const started = await e2e.client.get('/auth/oauth/fake/start?mode=link&next=/admin/profile', {
    headers: { accept: 'text/html' },
  })
  assert.equal(started.status, 303)
  const authorizeUrl = started.headers.get('location')
  assert.ok(authorizeUrl)
  const authorized = await fetch(authorizeUrl, { redirect: 'manual' })
  const callback = authorized.headers.get('location')
  assert.ok(callback)
  const completed = await e2e.client.get(callback, { headers: { accept: 'text/html' } })
  assert.equal(completed.status, 200)
  assert.match(await completed.text(), /Hồ sơ của tôi|My profile/)
  const who = (await (await e2e.client.get('/whoami')).json()) as { userId: string }
  assert.equal(who.userId, 'admin')
  const identity = (await e2e.adapter!.all('SELECT * FROM oauth_external_identity', []))[0]!
  assert.equal(identity.userId, 'admin')
  assert.equal(identity.subject, 'fake-subject-42')
})
