import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bootApp,
  defineApp,
  defineModule,
  readConfig,
  sqliteAdapter,
  createAppRegistry,
  compose,
  from,
  eq,
  json,
} from 'ketjs'
import type { Ctx } from 'ketjs'
import backend from 'ketsuite/backend'
import { scaffold } from '../packages/ketjs/src/scaffold/index.ts'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  assert.equal(c.autoInstall, true)
  assert.equal(c.bootstrapApps, null, 'the framework installs nothing an app did not ask for')
  assert.equal(c.queueNotify, true)
  assert.equal(c.webhookSecret, null)
})

test('config: every knob is settable, and DATABASE_URL is what switches the engine', () => {
  const c = readConfig({
    PORT: '8080',
    DATABASE_URL: 'postgres://x/y',
    KET_MIGRATE: '0',
    KET_AUTO_INSTALL: '0',
    KET_APPS: 'website, product',
    KET_LOCALE: 'en',
    KET_COMPANY: 'acme',
    KET_QUEUE_NOTIFY: '0',
    KET_WEBHOOK_SECRET: 'provider-only-secret',
  })
  assert.equal(c.port, 8080)
  assert.equal(c.databaseUrl, 'postgres://x/y')
  assert.equal(c.migrateOnBoot, false, 'a production deploy migrates separately')
  assert.equal(c.autoInstall, false)
  assert.deepEqual(c.bootstrapApps, ['website', 'product'], 'whitespace is not a module name')
  assert.equal(c.defaultCompany, 'acme')
  assert.equal(c.queueNotify, false, 'polling remains available when notification is disabled')
  assert.equal(c.webhookSecret, 'provider-only-secret')
})

test("config: an app's defaults lose to the environment, and win over the framework's", () => {
  const c = readConfig({ KET_LOCALE: 'fr' }, { defaultLocale: 'vi', port: 4100 })
  assert.equal(c.defaultLocale, 'fr', 'the operator has the last word')
  assert.equal(c.port, 4100, 'but an app may move its own default')
})

// ── the boot sequence itself ─────────────────────────────────────────────────

const notes = defineModule({
  name: 'notes',
  app: true,
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
  const app = defineApp({
    name: 'notesapp',
    modules: [notes],
    headless: true,
    serve: {
      bootstrap: ['notes'],
      routes: (ctx) => ({ '/notes': async (url, req) => json(await ctx.call('notes.list', {}, url, req)) }),
    },
  })
  const booted = await bootApp(app, { env: memory, port: 0 })
  const at = `http://127.0.0.1:${booted.port}`

  const health = (await fetch(`${at}/_ket/health`).then((r) => r.json())) as {
    ok: boolean
    app: string
    apps: string[]
  }
  assert.equal(health.ok, true)
  assert.equal(health.app, 'notesapp')
  assert.deepEqual(health.apps, ['notes'], 'the bootstrap set was installed on an empty database')

  const agent = (await fetch(`${at}/_ket/agent`).then((r) => r.json())) as { tools: Array<{ name: string }> }
  assert.ok(
    agent.tools.some((t) => t.name.startsWith('notes__')),
    'the agent surface is mounted without the app asking',
  )

  assert.deepEqual(
    await fetch(`${at}/notes`).then((r) => r.json()),
    [],
    "the app's own route is served alongside",
  )

  const banner = await booted.banner()
  assert.match(banner, /notesapp is running/)
  assert.match(banner, /health/)
  await booted.close()
})

test('boot: the banner says when auto-install was held back, rather than looking broken', async () => {
  const app = defineApp({ name: 'quiet', modules: [notes], headless: true, serve: { bootstrap: ['notes'] } })
  const booted = await bootApp(app, { env: { ...memory, KET_AUTO_INSTALL: '0' }, port: 0 })
  assert.match(await booted.banner(), /auto-install\s+off/)
  await booted.close()
})

test('boot: a page resolver naming a function nobody declares is refused at boot, not at the first request', async () => {
  const app = defineApp({
    name: 'broken',
    modules: [notes],
    theme: undefined,
    serve: { pages: { resolve: 'website.getPageByPath' } },
  })
  await assert.rejects(
    () => bootApp(app, { env: memory, port: 0 }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_PAGE_RESOLVER_MISSING')
      return true
    },
  )
})

test('boot: a headless app cannot claim to resolve pages', () => {
  assert.throws(
    () =>
      defineApp({
        name: 'contradiction',
        modules: [notes],
        headless: true,
        serve: { pages: { resolve: 'notes.byPath' } },
      }),
    /headless but resolves pages/,
  )
})

test('boot: an app route cannot silently shadow a module route', async () => {
  const routed = defineModule({
    name: 'routed',
    routes: { '/things/{slug}': () => async () => json({ owner: 'module' }) },
  })
  const app = defineApp({
    name: 'route_clash',
    modules: [routed],
    headless: true,
    serve: { routes: () => ({ '/things/{slug}': async () => json({ owner: 'app' }) }) },
  })
  await assert.rejects(
    () => bootApp(app, { env: memory, port: 0 }),
    /module "routed" and app "route_clash" both serve "\/things\/\{slug\}"/,
  )
})

// ── the install boundary ─────────────────────────────────────────────────────

const machinery = defineModule({ name: 'machinery', app: true, install: 'never' })
const eager = defineModule({ name: 'eager', app: true, install: 'auto', depends: ['notes'] })
const legacy = defineModule({ name: 'legacy', app: true, autoInstall: true, depends: ['notes'] })

const registry = async (mods: Parameters<typeof compose>[0], o: { autoInstall?: boolean } = {}) => {
  const db = sqliteAdapter()
  await db.open()
  return { db, apps: await createAppRegistry(compose(mods), db, o) }
}

test("install: 'never' is a boundary the module drew — it cannot be installed on its own", async () => {
  const { db, apps } = await registry([notes, machinery])
  await assert.rejects(
    () => apps.install('machinery'),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_APP_NOT_INSTALLABLE')
      assert.match((e as Error).message, /install: 'never'/)
      return true
    },
  )
  await db.close()
})

test("install: 'never' still arrives when something that needs it is installed", async () => {
  const needs = defineModule({ name: 'needs', app: true, depends: ['machinery'] })
  const { db, apps } = await registry([machinery, needs])
  assert.deepEqual((await apps.install('needs')).sort(), ['machinery', 'needs'])
  await db.close()
})

test("install: 'auto' arrives once its dependencies are there", async () => {
  const { db, apps } = await registry([notes, eager])
  await apps.install('notes')
  assert.deepEqual([...(await apps.enabled())].sort(), ['eager', 'notes'])
  await db.close()
})

test("install: the deployment can hold 'auto' back, which is what a developer wants mid-change", async () => {
  const { db, apps } = await registry([notes, eager], { autoInstall: false })
  await apps.install('notes')
  assert.deepEqual([...(await apps.enabled())], ['notes'], 'eager declared auto; this deployment declined')
  // Held back, not forbidden: asking by name still works.
  await apps.install('eager')
  assert.deepEqual([...(await apps.enabled())].sort(), ['eager', 'notes'])
  await db.close()
})

test('install: autoInstall: true is the old spelling and still means auto', async () => {
  const { db, apps } = await registry([notes, legacy])
  const m = compose([notes, legacy])
  assert.equal(m.modules['legacy']!.install, 'auto')
  await apps.install('notes')
  assert.ok((await apps.enabled()).has('legacy'))
  await db.close()
})

test('install: a module says nothing, so it is manual — nothing arrives by surprise', () => {
  assert.equal(compose([notes]).modules['notes']!.install, 'manual')
})

// ── the scaffold ─────────────────────────────────────────────────────────────

test('ket new: writes an app whose workspace composes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-new-'))
  scaffold('shop', dir)
  assert.ok(existsSync(join(dir, 'ket.workspace.ts')))
  assert.ok(existsSync(join(dir, 'modules/shop.ts')))
  assert.ok(existsSync(join(dir, 'tsconfig.json')))
  assert.ok(existsSync(join(dir, 'biome.json')))
  assert.ok(existsSync(join(dir, 'tools/dev.mjs')))
  assert.ok(existsSync(join(dir, 'test/app.test.ts')))
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
  assert.throws(() => scaffold('My Shop', '/tmp/x'), /invalid app name/)
})

// ── the removal boundary ─────────────────────────────────────────────────────

const core = defineModule({ name: 'core', app: true, removable: false })

test('uninstall: a module that declares removable: false is refused, not merely discouraged', async () => {
  const { db, apps } = await registry([core])
  await apps.install('core')
  await assert.rejects(
    () => apps.uninstall('core'),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_APP_NOT_REMOVABLE')
      return true
    },
  )
  assert.ok((await apps.enabled()).has('core'))
  await db.close()
})

test('uninstall: removable defaults to true, so refusing has to be argued for', async () => {
  const { db, apps } = await registry([notes])
  await apps.install('notes')
  assert.deepEqual(await apps.uninstall('notes'), ['notes'])
  await db.close()
})

test('uninstall: the backend is the screen you would use to put something back, so it stays', async () => {
  const { db, apps } = await registry([backend])
  await apps.install('backend')
  await assert.rejects(() => apps.uninstall('backend'), /removable: false/)
  await db.close()
})
