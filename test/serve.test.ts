import { test } from 'node:test'
import { createDevelopmentCloser } from '../packages/ketjs/src/server/development.ts'
import assert from 'node:assert/strict'
import { bootDeployment, defineDeployment, defineModule, readConfig, from, eq, json } from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'
import { scaffold } from '../packages/ketjs/src/scaffold/index.ts'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('dev restart closes HTTP once before waiting for the worker', async () => {
  const events: string[] = []
  let releaseHttp = () => {}
  const httpClosed = new Promise<void>((resolve) => {
    releaseHttp = resolve
  })
  const close = createDevelopmentCloser(
    {
      close: async () => {
        events.push('http')
        await httpClosed
      },
    },
    {
      close: async () => {
        events.push('worker')
      },
    },
  )

  const first = close()
  const repeated = close()
  assert.equal(first, repeated)
  assert.deepEqual(events, ['http'])

  releaseHttp()
  await first
  assert.deepEqual(events, ['http', 'worker'])
})

/**
 * Configuration is read once into a value rather than looked up from process.env
 * wherever it is needed, so a misspelt variable shows up as a visible default
 * instead of an undefined that surfaces three layers down as something else.
 */
test('config: sensible defaults, so a bare `ket serve` works with nothing set', () => {
  const c = readConfig({})
  assert.equal(c.port, 3000)
  assert.equal(c.databaseUrl, null, 'SQLite unless told otherwise')
  assert.equal(c.migrateOnBoot, true)
  assert.equal(c.queueNotify, true)
  assert.equal(c.webhookSecret, null)
})

test('config: every knob is settable, and DATABASE_URL is what switches the engine', () => {
  const c = readConfig({
    PORT: '8080',
    DATABASE_URL: 'postgres://x/y',
    KET_MIGRATE: '0',
    KET_LOCALE: 'en',
    KET_COMPANY: 'acme',
    KET_QUEUE_NOTIFY: '0',
    KET_WEBHOOK_SECRET: 'provider-only-secret',
  })
  assert.equal(c.port, 8080)
  assert.equal(c.databaseUrl, 'postgres://x/y')
  assert.equal(c.migrateOnBoot, false, 'a production deploy migrates separately')
  assert.equal(c.defaultCompany, 'acme')
  assert.equal(c.queueNotify, false, 'polling remains available when notification is disabled')
  assert.equal(c.webhookSecret, 'provider-only-secret')
})

test("config: a deployment's defaults lose to the environment, and win over the framework's", () => {
  const c = readConfig({ KET_LOCALE: 'fr' }, { defaultLocale: 'vi', port: 4100, migrateOnBoot: false })
  assert.equal(c.defaultLocale, 'fr', 'the operator has the last word')
  assert.equal(c.port, 4100, 'but a deployment may move its own default')
  assert.equal(c.migrateOnBoot, false, 'a deployment may disable migrate-on-boot by default')

  assert.equal(
    readConfig({ KET_MIGRATE: '1' }, { migrateOnBoot: false }).migrateOnBoot,
    true,
    'an explicit environment value still overrides the deployment default',
  )
})

// ── the boot sequence itself ─────────────────────────────────────────────────

const notes = defineModule({
  name: 'notes',
  title: 'Notes',
  models: { Note: { scope: 'company', fields: { id: 'id', title: 'text' } } },
  functions: {
    list: {
      agent: true,
      effects: ['read:notes.Note'],
      handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('notes.Note'))),
    },
    byPath: {
      input: { path: 'text' },
      effects: ['read:notes.Note'],
      handler: async (ctx: Ctx, i) => {
        const N = ctx.table('notes.Note')
        const row = await ctx.db.one(from(N).where(eq(N.id, (i.path as string).slice(1))))
        return row ? { ...row, layout: [] } : null
      },
    },
  },
  messages: { en: { 'page.notFound': 'Nothing here' } },
})

const memory = { KET_SQLITE: ':memory:', KET_COMPANY: 'acme' }

test('boot: one declaration produces a running server, framework routes included', async () => {
  const app = defineDeployment({
    name: 'notesapp',
    modules: [notes],
    headless: true,
    serve: {
      routes: (ctx) => ({ '/notes': async (url, req) => json(await ctx.call('notes.list', {}, url, req)) }),
    },
  })
  const booted = await bootDeployment(app, { env: memory, port: 0 })
  const at = `http://127.0.0.1:${booted.port}`

  const health = (await fetch(`${at}/_ket/health`).then((r) => r.json())) as {
    ok: boolean
    deployment: string
    modules: string[]
  }
  assert.equal(health.ok, true)
  assert.equal(health.deployment, 'notesapp')
  assert.deepEqual(health.modules, ['notes'])

  const agent = (await fetch(`${at}/_ket/agent`).then((r) => r.json())) as { tools: Array<{ name: string }> }
  assert.ok(
    agent.tools.some((t) => t.name.startsWith('notes__')),
    'the agent surface is mounted without the deployment asking',
  )

  assert.deepEqual(
    await fetch(`${at}/notes`).then((r) => r.json()),
    [],
    "the deployment's own route is served alongside",
  )

  const banner = await booted.banner()
  assert.match(banner, /notesapp is running/)
  assert.match(banner, /health/)
  await booted.close()
})

test('boot: an absent development branch header keeps branch reads unrestricted', async () => {
  const branchNotes = defineModule({
    name: 'branch_notes',
    models: { Note: { scope: 'company+branch', fields: { id: 'id', title: 'text' } } },
    functions: {
      list: {
        effects: ['read:branch_notes.Note'],
        handler: (ctx: Ctx) => ctx.db.all(from(ctx.table('branch_notes.Note'))),
      },
    },
  })
  const app = defineDeployment({ name: 'branches', modules: [branchNotes], headless: true })
  const booted = await bootDeployment(app, { env: memory, port: 0 })
  try {
    await booted.adapter!.run(
      'INSERT INTO branch_notes_note (id, title, "companyId", "branchId") VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      ['hanoi', 'Hà Nội', 'acme', 'hanoi', 'saigon', 'Sài Gòn', 'acme', 'saigon'],
    )
    const response = await fetch(`http://127.0.0.1:${booted.port}/_ket/fn/branch_notes.list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ket-company': 'acme' },
      body: '{}',
    })
    assert.equal(response.status, 200)
    const result = (await response.json()) as { value: Array<{ id: string }> }
    assert.deepEqual(result.value.map((row) => row.id).sort(), ['hanoi', 'saigon'])
  } finally {
    await booted.close()
  }
})

test('boot: a page resolver naming a function nobody declares is refused at boot, not at the first request', async () => {
  const app = defineDeployment({
    name: 'broken',
    modules: [notes],
    theme: undefined,
    serve: { pages: { resolve: 'website.getPageByPath' } },
  })
  await assert.rejects(
    () => bootDeployment(app, { env: memory, port: 0 }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_PAGE_RESOLVER_MISSING')
      return true
    },
  )
})

test('boot: a headless deployment cannot claim to resolve pages', () => {
  assert.throws(
    () =>
      defineDeployment({
        name: 'contradiction',
        modules: [notes],
        headless: true,
        serve: { pages: { resolve: 'notes.byPath' } },
      }),
    /headless but resolves pages/,
  )
})

test('boot: a deployment route cannot silently shadow a module route', async () => {
  const routed = defineModule({
    name: 'routed',
    routes: { '/things/{slug}': () => async () => json({ owner: 'module' }) },
  })
  const app = defineDeployment({
    name: 'route_clash',
    modules: [routed],
    headless: true,
    serve: { routes: () => ({ '/things/{slug}': async () => json({ owner: 'deployment' }) }) },
  })
  await assert.rejects(
    () => bootDeployment(app, { env: memory, port: 0 }),
    /module "routed" and deployment "route_clash" both serve "\/things\/\{slug\}"/,
  )
})

// ── the scaffold ─────────────────────────────────────────────────────────────

test('ket new: writes a deployment whose workspace composes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-new-'))
  scaffold('shop', dir)
  assert.ok(existsSync(join(dir, 'ket.workspace.ts')))
  assert.ok(existsSync(join(dir, 'modules/shop.ts')))
  assert.ok(existsSync(join(dir, 'tsconfig.json')))
  assert.ok(existsSync(join(dir, 'biome.json')))
  assert.ok(existsSync(join(dir, 'tools/dev.mjs')))
  assert.ok(existsSync(join(dir, 'test/deployment.test.ts')))
  assert.match(
    readFileSync(join(dir, 'tools/dev.mjs'), 'utf8'),
    /node_modules\/@ketvietlab\/ketjs\/dist\/cli\.js/,
  )
  assert.match(
    readFileSync(join(dir, 'package.json'), 'utf8'),
    /ket serve --workspace dist\/ket\.workspace\.js/,
  )
  assert.match(readFileSync(join(dir, 'package.json'), 'utf8'), /ket test dist\/test/)
})

test('ket new: refuses to overwrite rather than eat work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-new-'))
  scaffold('shop', dir)
  assert.throws(() => scaffold('shop', dir), /refusing to overwrite/)
})

test('ket new: rejects a name that is not a module name', () => {
  assert.throws(() => scaffold('My Shop', '/tmp/x'), /invalid deployment name/)
})
