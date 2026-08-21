import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import { company, partner, user, verifyPassword } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, user]

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
      scope: { company: 'acme', branch: 'root:acme', branches: ['root:acme'] },
    }).then((result) => result.value as T)
  return { adapter, manifest, call }
}

test('user-auth: normalized login and role edges remain unique and idempotent', async () => {
  const runtime = await boot()
  try {
    const first = await runtime.call<{ ok: boolean }>('user.createUser', {
      id: 'u1',
      login: '  Admin@Example.COM  ',
      password: 'correct horse',
      name: 'Admin',
    })
    const duplicate = await runtime.call<{ ok: boolean; errors: unknown }>('user.createUser', {
      id: 'u2',
      login: 'admin@example.com',
      password: 'correct horse',
      name: 'Other',
    })
    assert.equal(first.ok, true)
    assert.equal(duplicate.ok, false)

    await runtime.call('user.createUser', {
      id: 'portal',
      login: 'portal',
      password: 'correct horse',
      name: 'Portal',
      accessKind: 'portal',
    })
    assert.equal(
      (
        await runtime.call<{ ok: boolean }>('user.authenticate', {
          login: 'portal',
          password: 'correct horse',
          networkFingerprint: 'portal-network',
        })
      ).ok,
      false,
      'backend login accepts only internal identities',
    )

    await runtime.call('user.saveRole', { id: 'manager', name: 'Manager' })
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runtime.call('user.assignRole', {
          id: `assignment:${index}`,
          userId: 'u1',
          roleId: 'manager',
        }),
      ),
    )
    assert.equal((await runtime.adapter.all('SELECT * FROM user_assignment', [])).length, 1)
  } finally {
    await runtime.adapter.close()
  }
})

test('user-auth: password change is actor-bound and the final superuser is protected', async () => {
  const runtime = await boot()
  try {
    await runtime.call('user.createUser', {
      id: 'root',
      login: 'root',
      password: 'correct horse',
      name: 'Root',
      superuser: true,
    })
    const foreign = await runtime.call<{ ok: boolean }>(
      'user.setPassword',
      { id: 'root', currentPassword: 'correct horse', newPassword: 'battery staple' },
      'someone-else',
    )
    assert.equal(foreign.ok, false)
    await runtime.call('user.createUser', {
      id: 'operator',
      login: 'operator',
      password: 'correct horse',
      name: 'Operator',
    })
    assert.equal(
      (
        await runtime.call<{ ok: boolean }>(
          'user.createUser',
          {
            id: 'admin-created-password',
            login: 'admin-created-password',
            password: 'known by admin',
            name: 'Admin-created password',
          },
          'root',
        )
      ).ok,
      false,
      "an administrator must not choose another user's password",
    )
    assert.equal(
      (
        await runtime.call<{ ok: boolean }>(
          'user.createUser',
          { id: 'pending-invitation', login: 'pending-invitation', name: 'Pending invitation' },
          'root',
        )
      ).ok,
      true,
    )
    assert.equal(
      (
        await runtime.call<{ ok: boolean }>(
          'user.createUser',
          {
            id: 'illegal-root',
            login: 'illegal-root',
            password: 'correct horse',
            name: 'Illegal root',
            superuser: true,
          },
          'operator',
        )
      ).ok,
      false,
    )
    const archived = await runtime.call<{ ok: boolean }>(
      'user.archiveUser',
      { id: 'root', active: false },
      'root',
    )
    assert.equal(archived.ok, false)

    await runtime.call('user.createUser', {
      id: 'backup',
      login: 'backup',
      password: 'correct horse',
      name: 'Backup',
      superuser: true,
    })
    assert.equal(
      (await runtime.call<{ ok: boolean }>('user.archiveUser', { id: 'root', active: false }, 'root')).ok,
      true,
    )
  } finally {
    await runtime.adapter.close()
  }
})

test('user-auth: invitation consumption is single-use under concurrency', async () => {
  const runtime = await boot()
  try {
    await runtime.call('user.createUser', {
      id: 'root',
      login: 'root',
      password: 'correct horse',
      name: 'Root',
      superuser: true,
    })
    await runtime.call('user.createUser', { id: 'invited', login: 'invited', name: 'Invited' })
    const issued = await runtime.call<{ ok: boolean; token: string }>(
      'user.issueAuthToken',
      { userId: 'invited', kind: 'invitation', realm: 'backend' },
      'root',
    )
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        runtime.call<{ ok: boolean }>('user.consumeAuthToken', {
          token: issued.token,
          kind: 'invitation',
          realm: 'backend',
          password: 'accepted password',
        }),
      ),
    )
    assert.equal(results.filter((result) => result.ok).length, 1)
    const userRow = (
      await runtime.adapter.all('SELECT "passwordHash" FROM user_user WHERE id = ?', ['invited'])
    )[0]!
    assert.equal(await verifyPassword('accepted password', String(userRow.passwordHash)), true)
  } finally {
    await runtime.adapter.close()
  }
})

test('user-auth: invitation and reset TTLs expire predictably and old tokens are invalidated', async () => {
  const runtime = await boot()
  try {
    await runtime.call('user.createUser', {
      id: 'root',
      login: 'root',
      password: 'correct horse',
      name: 'Root',
      superuser: true,
    })
    await runtime.call('user.createUser', { id: 'target', login: 'target', name: 'Target' })
    const before = Date.now()
    const invitation = await runtime.call<{ token: string; expiresAt: string }>(
      'user.issueAuthToken',
      { userId: 'target', kind: 'invitation', realm: 'backend' },
      'root',
    )
    const reset = await runtime.call<{ token: string; expiresAt: string }>(
      'user.issueAuthToken',
      { userId: 'target', kind: 'reset', realm: 'backend' },
      'root',
    )
    assert.ok(Math.abs(Date.parse(invitation.expiresAt) - before - 144 * 60 * 60_000) < 2000)
    assert.ok(Math.abs(Date.parse(reset.expiresAt) - before - 4 * 60 * 60_000) < 2000)

    const replacement = await runtime.call<{ token: string }>(
      'user.issueAuthToken',
      { userId: 'target', kind: 'invitation', realm: 'backend' },
      'root',
    )
    assert.notEqual(replacement.token, invitation.token)
    assert.equal(
      (
        await runtime.call<{ ok: boolean }>('user.consumeAuthToken', {
          token: invitation.token,
          kind: 'invitation',
          realm: 'backend',
          password: 'accepted password',
        })
      ).ok,
      false,
    )
  } finally {
    await runtime.adapter.close()
  }
})

test('user-auth: rate limit is PostgreSQL-shaped and audit contains no secrets', async () => {
  const runtime = await boot()
  try {
    await runtime.call('user.createUser', {
      id: 'u1',
      login: 'operator',
      password: 'correct horse',
      name: 'Operator',
    })
    await runtime.call('user.createUser', {
      id: 'u2',
      login: 'operator-two',
      password: 'correct horse',
      name: 'Operator two',
    })
    for (let index = 0; index < 3; index++)
      assert.equal(
        (
          await runtime.call<{ ok: boolean }>('user.authenticate', {
            login: 'operator',
            password: 'wrong password',
            networkFingerprint: 'network-a',
          })
        ).ok,
        false,
      )
    assert.equal(
      (
        await runtime.call<{ ok: boolean }>('user.authenticate', {
          login: 'operator-two',
          password: 'correct horse',
          networkFingerprint: 'network-a',
        })
      ).ok,
      false,
      'the third failure starts cooldown before another KDF attempt',
    )
    for (const login of ['missing-one', 'missing-two'])
      assert.equal(
        (
          await runtime.call<{ ok: boolean }>('user.authenticate', {
            login,
            password: 'wrong password',
            networkFingerprint: 'network-b',
          })
        ).ok,
        false,
      )
    assert.equal(
      (
        await runtime.call<{ ok: boolean }>('user.authenticate', {
          login: 'operator-two',
          password: 'correct horse',
          networkFingerprint: 'network-b',
        })
      ).ok,
      true,
      'a valid account may sign in before the shared network reaches cooldown',
    )
    assert.equal(
      (
        await runtime.call<{ ok: boolean }>('user.authenticate', {
          login: 'missing-three',
          password: 'wrong password',
          networkFingerprint: 'network-b',
        })
      ).ok,
      false,
    )
    assert.equal(
      (
        await runtime.call<{ ok: boolean }>('user.authenticate', {
          login: 'operator-two',
          password: 'correct horse',
          networkFingerprint: 'network-b',
        })
      ).ok,
      false,
      'a successful account login must not erase the shared network bucket',
    )
    const audit = JSON.stringify(await runtime.adapter.all('SELECT * FROM user_security_audit', []))
    assert.ok(!audit.includes('wrong password'))
    assert.ok(!audit.includes('correct horse'))
  } finally {
    await runtime.adapter.close()
  }
})

test('password: hostile scrypt parameters are refused before allocating work', async () => {
  const started = performance.now()
  assert.equal(
    await verifyPassword('anything', `scrypt$1073741824$64$64$AAAAAAAAAAAAAAAAAAAAAA$${'A'.repeat(86)}`),
    false,
  )
  assert.ok(performance.now() - started < 50)
})
