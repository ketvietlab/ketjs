import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineApp, defineModule, from, json, text, withHeaders } from 'ketjs'
import type { Ctx, JobContext } from 'ketjs'
import { CookieJar, createTestApp, TestHttpError } from 'ketjs/testing'

const headless = defineModule({
  name: 'headless_test',
  app: true,
  models: {
    Note: { scope: 'shared', fields: { id: 'id', text: 'text' } },
    Entry: { scope: 'company', fields: { id: 'id', memo: 'text' } },
  },
  functions: {
    addNote: {
      input: { id: 'id', text: 'text' },
      output: { id: 'id' },
      effects: ['write:headless_test.Note'],
      dryRun: true,
      handler: async (ctx: Ctx, args) => {
        await ctx.db.insert('headless_test.Note', args)
        return { id: args.id }
      },
    },
    listNotes: {
      output: { id: 'id', text: 'text' },
      effects: ['read:headless_test.Note'],
      handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('headless_test.Note'))),
    },
    addEntry: {
      input: { id: 'id', memo: 'text' },
      effects: ['write:headless_test.Entry'],
      handler: (ctx: Ctx, args) => ctx.db.insert('headless_test.Entry', args),
    },
    listEntries: {
      output: { id: 'id', memo: 'text' },
      effects: ['read:headless_test.Entry'],
      handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('headless_test.Entry'))),
    },
    schedule: {
      input: { id: 'id', text: 'text' },
      effects: ['enqueue:headless_test.writeNote'],
      handler: (ctx: Ctx, args) => ctx.jobs.enqueue('headless_test.writeNote', args),
    },
  },
  jobs: {
    writeNote: {
      queue: 'default',
      input: { id: 'id', text: 'text' },
      effects: ['write:headless_test.Note'],
      idempotent: true,
      handler: async (ctx: JobContext, args) => {
        await ctx.db.insert('headless_test.Note', args)
      },
    },
  },
})

const app = defineApp({
  name: 'headless_e2e',
  modules: [headless],
  headless: true,
  worker: { queues: { default: 1 } },
  serve: {
    bootstrap: ['headless_test'],
    routes: () => ({
      '/cookie/start': () =>
        withHeaders(text('', { status: 303 }), {
          location: '/cookie/show',
          'set-cookie': 'e2e_session=remembered; Path=/; HttpOnly; SameSite=Lax',
        }),
      '/cookie/show': (_url, req) => json({ cookie: req.headers.cookie ?? '' }),
      '/cookie/clear': () =>
        withHeaders(json({ ok: true }), {
          'set-cookie': 'e2e_session=; Path=/; Max-Age=0',
        }),
      '/cookie/external': () =>
        withHeaders(text('', { status: 303 }), {
          location: 'https://identity.example.test/login',
        }),
    }),
  },
})

const runCli = async (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
  const cli = fileURLToPath(new URL('../packages/ketjs/src/cli.js', import.meta.url))
  const env = { ...process.env }
  // A plain CLI subprocess must not inherit Node's test-runner protocol. Node 24
  // otherwise forwards the experimental SQLite warning into the captured protocol.
  delete env.NODE_TEST_CONTEXT
  const child = spawn(process.execPath, ['--no-warnings', cli, ...args], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (status) => resolve(status ?? 1))
  })
  return { code, stdout, stderr }
}

test('testing: a headless app crosses real HTTP with isolated runtime state', async () => {
  const e2e = await createTestApp(app, { worker: false })
  const artifacts = e2e.artifactsDir
  const database = e2e.databasePath
  assert.equal(existsSync(artifacts), true)
  assert.ok(database)
  assert.equal(existsSync(database), true)
  try {
    const added = await e2e.client.call<{ id: string }>('headless_test.addNote', {
      id: 'n1',
      text: 'through HTTP',
    })
    assert.equal(added.value.id, 'n1')
    const listed = await e2e.client.call<Array<{ id: string; text: string }>>('headless_test.listNotes')
    assert.deepEqual(listed.value, [{ id: 'n1', text: 'through HTTP' }])
  } finally {
    await e2e.close()
  }
  assert.equal(existsSync(artifacts), false, 'an owned database and storage directory are cleaned')
  await e2e.close() // cleanup is idempotent
})

test('testing: dry-run and structured HTTP failures stay observable', async () => {
  const e2e = await createTestApp(app, { worker: false })
  try {
    const dry = await e2e.client.call(
      'headless_test.addNote',
      { id: 'dry', text: 'not stored' },
      { dryRun: true },
    )
    assert.equal(dry.dryRun, true)
    assert.equal(dry.writes.length, 1)
    assert.deepEqual((await e2e.client.call<unknown[]>('headless_test.listNotes')).value, [])

    await assert.rejects(
      () => e2e.client.call('headless_test.missing'),
      (error: unknown) => {
        assert.ok(error instanceof TestHttpError)
        assert.equal(error.status, 400)
        assert.equal((error.body as { code: string }).code, 'E_UNKNOWN_FUNCTION')
        return true
      },
    )
  } finally {
    await e2e.close()
  }
})

test('testing: client identities preserve company isolation', async () => {
  const e2e = await createTestApp(app, { worker: false })
  try {
    const acme = e2e.client.as({ company: 'acme' })
    const globex = e2e.client.as({ company: 'globex' })
    await acme.call('headless_test.addEntry', { id: 'a', memo: 'acme only' })
    await globex.call('headless_test.addEntry', { id: 'g', memo: 'globex only' })
    assert.deepEqual(
      (await acme.call<Array<{ id: string }>>('headless_test.listEntries')).value.map((row) => row.id),
      ['a'],
    )
    assert.deepEqual(
      (await globex.call<Array<{ id: string }>>('headless_test.listEntries')).value.map((row) => row.id),
      ['g'],
    )
  } finally {
    await e2e.close()
  }
})

test('testing: fixture calls seed state while assertions still cross HTTP', async () => {
  const e2e = await createTestApp(app, { worker: false })
  try {
    await e2e.fixture.call('headless_test.addNote', { id: 'seed', text: 'fixture' })
    const notes = await e2e.client.call<Array<{ id: string; text: string }>>('headless_test.listNotes')
    assert.deepEqual(notes.value, [{ id: 'seed', text: 'fixture' }])
    assert.equal(await e2e.fixture.withTenant('', async (tenant) => tenant.adapter.name), 'sqlite')
  } finally {
    await e2e.close()
  }
})

test('testing: cookies survive redirects, can be cleared and persist with mode-safe files', async () => {
  const e2e = await createTestApp(app, { worker: false })
  try {
    const shown = (await e2e.client.get('/cookie/start')).json() as Promise<{ cookie: string }>
    assert.match((await shown).cookie, /e2e_session=remembered/)
    assert.equal(e2e.client.jar.get('e2e_session'), 'remembered')

    const path = join(e2e.artifactsDir, 'cookies.json')
    await e2e.client.jar.save(path)
    const restored = await CookieJar.load(path)
    assert.deepEqual(restored.toJSON(), { e2e_session: 'remembered' })

    await e2e.client.get('/cookie/clear')
    assert.equal(e2e.client.jar.size, 0)
    assert.equal(e2e.client.anonymous().jar.size, 0)

    const external = await e2e.client.get('/cookie/external')
    assert.equal(external.status, 303, 'cross-origin identity redirects are handed to the test')
    await assert.rejects(
      () => e2e.client.get('https://identity.example.test/login'),
      /refuses a cross-origin request/,
    )
    await assert.rejects(
      () => e2e.client.anonymous().get('/cookie/start', { redirect: 'error' }),
      /redirect refused/,
    )
  } finally {
    await e2e.close()
  }
})

test('testing: the optional worker drains jobs from the same isolated datastore', async () => {
  const e2e = await createTestApp(app)
  try {
    await e2e.client.call('headless_test.schedule', { id: 'job-note', text: 'from worker' })
    assert.equal(await e2e.drainJobs(), 1)
    const notes = await e2e.client.call<Array<{ id: string; text: string }>>('headless_test.listNotes')
    assert.deepEqual(notes.value, [{ id: 'job-note', text: 'from worker' }])
  } finally {
    await e2e.close()
  }
})

test('testing CLI: ket call smoke-tests a running server with files and structured failures', async () => {
  const e2e = await createTestApp(app, { worker: false })
  try {
    const input = join(e2e.artifactsDir, 'note.json')
    await writeFile(input, JSON.stringify({ id: 'cli', text: 'command line' }))
    const added = await runCli([
      'call',
      'headless_test.addNote',
      '--against',
      e2e.baseUrl,
      '--input',
      `@${input}`,
      '--compact',
    ])
    assert.equal(added.code, 0, added.stderr)
    assert.doesNotMatch(added.stdout, /^\(node:/, JSON.stringify(added))
    assert.equal((JSON.parse(added.stdout) as { value: { id: string } }).value.id, 'cli')

    const listed = await runCli([
      'call',
      'headless_test.listNotes',
      '--against',
      e2e.baseUrl,
      '--value',
      '--compact',
    ])
    assert.equal(listed.code, 0, listed.stderr)
    assert.deepEqual(JSON.parse(listed.stdout), [{ id: 'cli', text: 'command line' }])

    const missing = await runCli(['call', 'headless_test.missing', '--against', e2e.baseUrl])
    assert.equal(missing.code, 1)
    assert.equal((JSON.parse(missing.stderr) as { code: string }).code, 'E_UNKNOWN_FUNCTION')
  } finally {
    await e2e.close()
  }
})
