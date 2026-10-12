import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
  deployment = (await import(pathToFileURL(join(dir, 'dist/ket.workspace.js')).href))
    .deployment as DeploymentSpec
})

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

const start = () => bootDeployment(deployment, { port: 0, env: { KET_SQLITE: ':memory:', KET_LOG: 'null' } })
const at = (app: BootedDeployment, path: string) => `http://127.0.0.1:${app.port}${path}`
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
