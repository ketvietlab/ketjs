import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, before, test } from 'node:test'
import { bootDeployment, callFn } from '@ketvietlab/ketjs'
import type { BootedDeployment, DeploymentSpec } from '@ketvietlab/ketjs'
import { scaffold } from '../packages/ketjs/src/scaffold/index.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const password = 'Local candidate credential only'
let dir: string
let deployment: DeploymentSpec

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ket-auth-scaffold-'))
  scaffold('starter', dir, { auth: 'session' })
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir')
  const built = spawnSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(dir, 'tsconfig.json')], {
    encoding: 'utf8',
  })
  assert.equal(built.status, 0, built.stdout + built.stderr)
  const previous = process.env.KET_AUTH_TRUSTED_PROXIES
  try {
    delete process.env.KET_AUTH_TRUSTED_PROXIES
    deployment = (await import(pathToFileURL(join(dir, 'dist/ket.workspace.js')).href))
      .deployment as DeploymentSpec
  } finally {
    if (previous !== undefined) process.env.KET_AUTH_TRUSTED_PROXIES = previous
  }
})

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

const start = () =>
  bootDeployment(deployment, {
    port: 0,
    env: { KET_SQLITE: ':memory:', KET_LOG: 'null', KET_SECRET: 'auth scaffold test secret' },
  })
const at = (app: BootedDeployment, path: string) => `http://127.0.0.1:${app.port}${path}`
const proxyPost = (app: BootedDeployment, path: string, origin: string, cookie?: string, body?: string) =>
  new Promise<{ status: number; cookie?: string }>((resolve, reject) => {
    const req = httpRequest(
      at(app, path),
      {
        method: 'POST',
        headers: {
          host: 'app.example.com',
          origin,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
      },
      (response) => {
        response.resume()
        response.on('error', reject)
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, cookie: response.headers['set-cookie']?.[0] }),
        )
      },
    )
    req.on('error', reject)
    req.end(body)
  })
const provision = (app: BootedDeployment, login: string) =>
  callFn('auth.addUser', { login, password }, { adapter: app.adapter!, manifest: app.manifest })
const login = async (app: BootedDeployment, user: string): Promise<string> => {
  const response = await fetch(at(app, '/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: user, password }),
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie')!, /HttpOnly/)
  assert.match(response.headers.get('set-cookie')!, /SameSite=Lax/)
  assert.ok(!(await response.text()).includes('passwordHash'))
  return response.headers.get('set-cookie')!.split(';')[0]!
}

test('auth scaffold: compiles and keeps two accounts data-isolated through real HTTP', async () => {
  const app = await start()
  try {
    const anonymous = await fetch(at(app, '/api/v1/notes'), {
      headers: { 'x-ket-company': 'forged', 'x-ket-user': 'alice' },
    })
    assert.equal(anonymous.status, 401)
    const alice = await provision(app, 'Alice')
    await provision(app, 'bob')
    assert.ok(!JSON.stringify(alice).includes(password))
    const aliceCookie = await login(app, 'alice'),
      bobCookie = await login(app, 'bob')
    const created = await fetch(at(app, '/api/v1/notes/create'), {
      method: 'POST',
      headers: { cookie: aliceCookie, 'content-type': 'application/json', origin: at(app, '') },
      body: JSON.stringify({ title: 'Private note' }),
    })
    assert.equal(created.status, 200)
    const own = (await fetch(at(app, '/api/v1/notes'), { headers: { cookie: aliceCookie } }).then(
      (response) => response.json(),
    )) as { data: Array<{ title: string }> }
    assert.equal(own.data[0]?.title, 'Private note')
    assert.deepEqual(
      await fetch(at(app, '/api/v1/notes'), { headers: { cookie: bobCookie } }).then((response) =>
        response.json(),
      ),
      { data: [] },
    )
    assert.equal(
      (await fetch(at(app, '/auth/logout'), { method: 'POST', headers: { cookie: aliceCookie } })).status,
      200,
    )
    assert.equal((await fetch(at(app, '/auth/me'), { headers: { cookie: aliceCookie } })).status, 401)
  } finally {
    await app.close()
  }
})

test('auth scaffold: live grants and credential versions revoke existing cookies', async () => {
  const app = await start()
  try {
    const user = await provision(app, 'alice')
    const cookie = await login(app, 'alice')
    await app.adapter!.run('DELETE FROM "auth_grant" WHERE "fnKey" = ?', ['starter.list'])
    assert.equal((await fetch(at(app, '/api/v1/notes'), { headers: { cookie } })).status, 403)
    await provision(app, 'bob')
    assert.equal(
      (await fetch(at(app, '/api/v1/notes'), { headers: { cookie } })).status,
      403,
      'adding an account does not restore a revoked role grant',
    )
    await app.adapter!.run('UPDATE "auth_user" SET "securityVersion" = 1 WHERE "id" = ?', [
      (user.value as { id: string }).id,
    ])
    assert.equal((await fetch(at(app, '/auth/me'), { headers: { cookie } })).status, 401)
  } finally {
    await app.close()
  }
})

test('auth scaffold: unknown, wrong and disabled credentials share a refusal and disabled users lose their cookie', async () => {
  const app = await start()
  try {
    const user = await provision(app, 'alice')
    const cookie = await login(app, 'alice')
    const attempt = async (name: string, value: string) => {
      const response = await fetch(at(app, '/auth/login'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login: name, password: value }),
      })
      assert.equal(response.status, 401)
      return response.json()
    }
    const unknown = await attempt('missing', password)
    assert.deepEqual(await attempt('alice', 'Another wrong credential'), unknown)
    await app.adapter!.run('UPDATE "auth_user" SET "active" = 0 WHERE "id" = ?', [
      (user.value as { id: string }).id,
    ])
    assert.equal((await fetch(at(app, '/auth/me'), { headers: { cookie } })).status, 401)
    assert.deepEqual(await attempt('alice', password), unknown)
  } finally {
    await app.close()
  }
})

test('auth scaffold: credential and provision functions have no generic HTTP surface', async () => {
  const app = await start()
  try {
    for (const fn of ['authenticate', 'addUser', 'session', 'permitted']) {
      const response = await fetch(at(app, `/_ket/fn/auth.${fn}`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      assert.equal(((await response.json()) as { code: string }).code, 'E_FUNCTION_INTERNAL')
    }
    assert.equal((await fetch(at(app, '/auth/login'))).status, 405)
  } finally {
    await app.close()
  }
})

test('auth scaffold: login checks origin, bounds input, and rate-limits before hashing', async () => {
  const app = await start()
  try {
    const post = (body: string, headers: Record<string, string> = {}) =>
      fetch(at(app, '/auth/login'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      })
    assert.equal((await post('{}', { origin: 'https://untrusted.example' })).status, 403)
    assert.equal((await post('{}', { 'content-type': 'text/plain' })).status, 415)
    assert.equal((await post('x'.repeat(5000))).status, 413)
    assert.equal((await post('not json')).status, 400)
    assert.equal((await post('[]')).status, 400)
    const limited = await post('{}')
    assert.equal(limited.status, 429)
    assert.ok(limited.headers.get('retry-after'))
  } finally {
    await app.close()
  }
})

test('auth scaffold: rejects invalid modes before writing and refuses all overwrites', async () => {
  assert.throws(() => scaffold('starter', dir, { auth: 'invalid' as 'session' }), /auth must/)
  const source = await readFile(join(dir, 'modules/auth.ts'), 'utf8')
  assert.throws(() => scaffold('starter', dir, { auth: 'session' }), /refusing to overwrite/)
  assert.equal(await readFile(join(dir, 'modules/auth.ts'), 'utf8'), source)
})

test('auth scaffold: its runnable OpenAPI command documents cookie security', async () => {
  const exported = spawnSync(process.execPath, ['dist/tools/openapi.js'], { cwd: dir, encoding: 'utf8' })
  assert.equal(exported.status, 0, exported.stderr)
  const spec = JSON.parse(await readFile(join(dir, 'openapi/starter.json'), 'utf8'))
  assert.deepEqual(spec.components.securitySchemes.sessionAuth, {
    type: 'apiKey',
    in: 'cookie',
    name: 'ket_session',
  })
  assert.deepEqual(spec.paths['/api/v1/notes'].get.security, [{ sessionAuth: [] }])
  assert.deepEqual(spec.paths['/api/v1/notes/create'].post.security, [{ sessionAuth: [] }])
})

test('auth scaffold: HTTPS origins work through a TLS-terminating proxy for login and logout', async () => {
  const app = await start()
  try {
    await provision(app, 'alice')
    const response = await proxyPost(
      app,
      '/auth/login',
      'https://app.example.com',
      undefined,
      JSON.stringify({ login: 'alice', password }),
    )
    assert.equal(response.status, 200)
    const cookie = response.cookie?.split(';')[0]
    assert.ok(cookie)
    const created = await proxyPost(
      app,
      '/api/v1/notes/create',
      'https://app.example.com',
      cookie,
      JSON.stringify({ title: 'TLS proxy note' }),
    )
    assert.equal(created.status, 200, 'cookie-bound writes use the same proxy-compatible origin policy')
    for (const origin of ['https://other.example.com', 'null', 'https://app.example.com:8443']) {
      const refused = await proxyPost(app, '/auth/logout', origin, cookie)
      assert.equal(refused.status, 403)
    }
    const loggedOut = await proxyPost(app, '/auth/logout', 'https://app.example.com', cookie)
    assert.equal(loggedOut.status, 200)
    assert.equal((await fetch(at(app, '/auth/me'), { headers: { cookie } })).status, 401)
  } finally {
    await app.close()
  }
})

test('auth scaffold: initial concurrent reads do not reconcile or revise a freshly issued session', async () => {
  const app = await start()
  try {
    await provision(app, 'alice')
    const cookie = await login(app, 'alice')
    assert.ok(app.adapter)
    const writes: string[] = []
    const original = app.adapter.run.bind(app.adapter)
    app.adapter.run = async (sql, params) => {
      if (/UPDATE ket_session SET\s+companies/.test(sql)) writes.push(sql)
      return original(sql, params)
    }
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => fetch(at(app, '/auth/me'), { headers: { cookie } })),
    )
    assert.ok(responses.every((response) => response.status === 200))
    const rows = await app.adapter.all('SELECT revision, branches FROM ket_session')
    assert.equal(rows[0]?.revision, 0)
    assert.equal(rows[0]?.branches, '[]')
    assert.equal(writes.length, 0, 'no context-update queries on initial reads')
    app.adapter.run = original
  } finally {
    await app.close()
  }
})

test('auth scaffold: multiple roles use one grants query and return only finite public permissions', async () => {
  const app = await start()
  try {
    const user = (await provision(app, 'alice')).value as { id: string }
    assert.ok(app.adapter)
    for (const roleId of ['extra-one', 'extra-two']) {
      await app.adapter.run('INSERT INTO auth_role (id, name) VALUES (?, ?)', [roleId, roleId])
      await app.adapter.run('INSERT INTO auth_assignment (id, userId, roleId) VALUES (?, ?, ?)', [
        roleId,
        user.id,
        roleId,
      ])
      for (const fn of ['starter.list', 'auth.me', 'auth.authenticate', 'missing.function']) {
        await app.adapter.run('INSERT INTO auth_grant (id, roleId, fnKey) VALUES (?, ?, ?)', [
          `${roleId}:${fn}`,
          roleId,
          fn,
        ])
      }
    }
    let queries = 0
    const original = app.adapter.all.bind(app.adapter)
    app.adapter.all = async (sql, params) => {
      if (/auth_grant/.test(sql)) queries++
      return original(sql, params)
    }
    const result = await callFn(
      'auth.permitted',
      { userId: user.id },
      {
        adapter: app.adapter,
        manifest: app.manifest,
      },
    )
    app.adapter.all = original
    assert.deepEqual((result.value as { functions: string[] }).functions.sort(), [
      'auth.me',
      'starter.create',
      'starter.list',
    ])
    assert.equal(queries, 1)
  } finally {
    await app.close()
  }
})

test('auth scaffold: logout without a session manager omits Set-Cookie', async () => {
  const app = await bootDeployment(
    {
      ...deployment,
      serve: {
        ...deployment.serve,
        sessions: undefined,
        resolveSession: undefined,
        resolveIdentity: async () => null,
      },
    },
    { port: 0, env: { KET_SQLITE: ':memory:', KET_LOG: 'null', KET_SECRET: 'auth scaffold test secret' } },
  )
  try {
    const response = await fetch(at(app, '/auth/logout'), { method: 'POST' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('set-cookie'), null)
  } finally {
    await app.close()
  }
})

test('auth scaffold: provisioning preserves a UTF-8 password split between stdin chunks', async () => {
  const database = join(dir, 'split-password.sqlite')
  const credential = 'Mật khẩu tiếng Việt nhiều byte 🔑'
  const input = Buffer.from(JSON.stringify({ login: 'unicode', password: credential }))
  const split = input.indexOf(Buffer.from('ậ')) + 1
  assert.ok(split > 0)
  const child = spawn(process.execPath, ['tools/provision.mjs'], {
    cwd: dir,
    env: { ...process.env, DATABASE_URL: undefined, KET_SQLITE: database, KET_LOG: 'null' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk
  })
  const finished = new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
  child.stdin.write(input.subarray(0, split))
  await new Promise((resolve) => setTimeout(resolve, 100))
  child.stdin.end(input.subarray(split))
  assert.equal(await finished, 0, output)
  assert.ok(!output.includes(credential))
  assert.ok(!output.includes('scrypt$'))
  const app = await bootDeployment(deployment, {
    port: 0,
    env: { KET_SQLITE: database, KET_LOG: 'null', KET_SECRET: 'auth scaffold test secret' },
  })
  try {
    const response = await fetch(at(app, '/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'unicode', password: credential }),
    })
    assert.equal(response.status, 200)
  } finally {
    await app.close()
  }
})

test('auth scaffold: forged forwarding headers cannot bypass the default peer rate limit', async () => {
  const app = await start()
  try {
    for (let index = 0; index < 6; index++) {
      const response = await fetch(at(app, '/auth/login'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${index + 1}` },
        body: '{}',
      })
      assert.equal(response.status, index < 5 ? 400 : 429)
    }
  } finally {
    await app.close()
  }
})

test('auth scaffold: configured trusted proxies keep client rate windows separate and ignore injected leftmost hops', async () => {
  const previous = process.env.KET_AUTH_TRUSTED_PROXIES
  let trusted: DeploymentSpec
  try {
    process.env.KET_AUTH_TRUSTED_PROXIES = '127.0.0.1, ::1'
    trusted = (await import(`${pathToFileURL(join(dir, 'dist/ket.workspace.js')).href}?trusted-proxy`))
      .deployment
  } finally {
    if (previous === undefined) delete process.env.KET_AUTH_TRUSTED_PROXIES
    else process.env.KET_AUTH_TRUSTED_PROXIES = previous
  }
  const app = await bootDeployment(trusted, {
    port: 0,
    env: { KET_SQLITE: ':memory:', KET_LOG: 'null', KET_SECRET: 'auth scaffold test secret' },
  })
  try {
    const post = (forwarded: string) =>
      fetch(at(app, '/auth/login'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': forwarded },
        body: '{}',
      })
    for (let index = 0; index < 5; index++) assert.equal((await post('198.51.100.1')).status, 400)
    assert.equal((await post('198.51.100.1')).status, 429)
    assert.equal((await post('198.51.100.2')).status, 400, 'another client still has its own rate window')
    assert.equal(
      (await post('203.0.113.9, 198.51.100.1')).status,
      429,
      'untrusted clients cannot replace their own address',
    )
  } finally {
    await app.close()
  }
})
