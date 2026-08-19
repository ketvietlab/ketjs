import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bootApp, compose, defineApp, defineModule, defineTheme, restrictManifest, page } from 'ketjs'
import type { ServeContext, Route } from 'ketjs'
import { html } from 'ketjs-view'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The served surface — routes, assets, stylesheets — is composed from modules for
 * the same reason models are. An app that assembles it by hand has to know another
 * module's file layout, and goes on serving it after that module is switched off.
 */

const assetDir = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'assets-'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

const base = assetDir({ 'base.css': ':root { --x: 1 }' })
const extra = assetDir({ 'extra.css': '.x { color: red }', 'logo.svg': '<svg/>' })

const core = defineModule({ name: 'core', app: true, assets: base, styles: ['base.css'] })
const skin = defineModule({
  name: 'skin',
  app: true,
  depends: ['core'],
  assets: extra,
  styles: ['extra.css'],
  routes: {
    '/skin':
      (ctx: ServeContext): Route =>
      async (url, req) =>
        page({
          body: ctx.document({
            lang: ctx.localeOf(url, req),
            head: await ctx.styles(req),
            body: html`<h1>skin</h1>`,
          }),
        }),
    '/catalog/new': () => async () => page({ body: html`<h1>new product</h1>` }),
    '/catalog/{slug}': () => async (_url, _req, params) => page({ body: html`<h1>${params.slug}</h1>` }),
  },
})

// ── composition ──────────────────────────────────────────────────────────────

test('compose: stylesheets come out in dependency order, so an extension can override', () => {
  const m = compose([core, skin])
  assert.deepEqual(
    m.styles.map((s) => s.by),
    ['core', 'skin'],
    'core is a dependency of skin, so its stylesheet loads first',
  )
  assert.deepEqual(
    m.styles.map((s) => s.href),
    ['/_ket/asset/core/base.css', '/_ket/asset/skin/extra.css'],
  )
})

test('compose: assets are namespaced by module, so two may ship the same file name', () => {
  const a = defineModule({ name: 'a', assets: base, styles: ['base.css'] })
  const b = defineModule({ name: 'b', assets: base, styles: ['base.css'] })
  const m = compose([a, b])
  assert.deepEqual(
    m.styles.map((s) => s.href),
    ['/_ket/asset/a/base.css', '/_ket/asset/b/base.css'],
  )
})

test('compose: two modules claiming one path is a build error, not a race at boot', () => {
  const r = (path: string) => ({ [path]: () => (async () => page({ body: html`<p>x</p>` })) as Route })
  assert.throws(
    () =>
      compose([
        defineModule({ name: 'one', routes: r('/clash') }),
        defineModule({ name: 'two', routes: r('/clash') }),
      ]),
    /both "one" and "two" serve "\/clash"/,
  )
})

test('compose: equally specific dynamic routes that overlap are refused', () => {
  const route = (path: string) => ({
    [path]: () => (async () => page({ body: html`<p>x</p>` })) as Route,
  })
  assert.throws(
    () =>
      compose([
        defineModule({ name: 'one', routes: route('/shop/{slug}') }),
        defineModule({ name: 'two', routes: route('/{section}/new') }),
      ]),
    /can match the same path with equal priority/,
  )
})

test('compose: route parameters are whole, named segments', () => {
  const route = (path: string) => ({
    [path]: () => (async () => page({ body: html`<p>x</p>` })) as Route,
  })
  assert.throws(
    () => compose([defineModule({ name: 'bad', routes: route('/shop/product-{slug}') })]),
    /invalid dynamic segment/,
  )
  assert.throws(
    () => compose([defineModule({ name: 'bad', routes: route('/{slug}/{slug}') })]),
    /declares parameter "slug" more than once/,
  )
})

test("compose: /_ket/ is the framework's, and a module claiming it is told so", () => {
  assert.throws(
    () =>
      compose([
        defineModule({
          name: 'greedy',
          routes: { '/_ket/health': () => (async () => page({ body: html`<p>x</p>` })) as Route },
        }),
      ]),
    /which is reserved/,
  )
})

test('compose: a style with no assets directory to resolve against is refused', () => {
  assert.throws(() => compose([defineModule({ name: 'lost', styles: ['x.css'] })]), /but no assets directory/)
})

test('compose: a theme may ship assets and styles — that is most of what a theme is', () => {
  const t = defineTheme({ name: 'theme_x', assets: base, styles: ['base.css'] })
  assert.deepEqual(
    compose([t]).styles.map((s) => s.href),
    ['/_ket/asset/theme_x/base.css'],
  )
})

test('compose: but a theme may not serve routes, because a route is server code', () => {
  assert.throws(
    () =>
      defineTheme({
        name: 'theme_y',
        routes: { '/x': () => (async () => page({ body: html`<p>x</p>` })) as Route },
      }),
    /theme "theme_y" declares routes/,
  )
})

// ── restriction ──────────────────────────────────────────────────────────────

test('restrict: a switched-off module contributes no route, no asset, no stylesheet', () => {
  const m = compose([core, skin])
  const live = restrictManifest(m, new Set(['core']))
  assert.deepEqual(Object.keys(live.routes), [], "skin's route is gone")
  assert.deepEqual(
    live.styles.map((s) => s.by),
    ['core'],
  )
  assert.deepEqual(Object.keys(live.assets), ['core'])
})

// ── the whole thing, running ─────────────────────────────────────────────────

const app = defineApp({
  name: 'surfaceapp',
  modules: [core, skin],
  headless: true,
  serve: { bootstrap: ['skin'] },
})

test('serving: a module route answers, its asset is served, its stylesheet is linked', async () => {
  const b = await bootApp(app, { env: { KET_SQLITE: ':memory:' }, port: 0 })
  const at = `http://127.0.0.1:${b.port}`
  assert.equal((await fetch(`${at}/skin`)).status, 200)
  assert.equal((await fetch(`${at}/_ket/asset/skin/extra.css`)).status, 200)
  const body = await (await fetch(`${at}/skin`)).text()
  assert.match(body, /\/_ket\/asset\/core\/base\.css/)
  assert.match(body, /\/_ket\/asset\/skin\/extra\.css/)
  assert.ok(body.indexOf('core/base.css') < body.indexOf('skin/extra.css'), 'and in dependency order')
  await b.close()
})

test('serving: dynamic segments are decoded and a static route wins over a parameter', async () => {
  const b = await bootApp(app, { env: { KET_SQLITE: ':memory:' }, port: 0 })
  const at = `http://127.0.0.1:${b.port}`
  assert.match(await fetch(`${at}/catalog/%C3%A1o-thun`).then((r) => r.text()), /áo-thun/)
  assert.match(await fetch(`${at}/catalog/new`).then((r) => r.text()), /new product/)
  await b.close()
})

test('serving: uninstalling stops the route answering and the asset being served', async () => {
  const b = await bootApp(app, { env: { KET_SQLITE: ':memory:' }, port: 0 })
  const at = `http://127.0.0.1:${b.port}`
  await b.apps!.uninstall('skin')
  assert.equal((await fetch(`${at}/skin`)).status, 404, 'enable-at-run has to reach what people can see')
  assert.equal((await fetch(`${at}/_ket/asset/skin/extra.css`)).status, 404)
  // core is still on, so it is unaffected
  assert.equal((await fetch(`${at}/_ket/asset/core/base.css`)).status, 200)
  await b.apps!.install('skin')
  assert.equal((await fetch(`${at}/skin`)).status, 200, 'and putting it back needs no restart')
  await b.close()
})

test('serving: a static handler must not be talked out of its own directory', async () => {
  const b = await bootApp(app, { env: { KET_SQLITE: ':memory:' }, port: 0 })
  const at = `http://127.0.0.1:${b.port}`
  for (const attack of [
    '/_ket/asset/skin/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/_ket/asset/skin/..%2f..%2f..%2fetc%2fpasswd',
    '/_ket/asset/skin/%2Fetc%2Fpasswd',
    '/_ket/asset/nosuch/x.css',
    '/_ket/asset/skin',
    '/_ket/asset/',
  ]) {
    assert.equal((await fetch(at + attack)).status, 404, attack)
  }
  await b.close()
})

test('serving: binary assets survive the trip, which a string-typed body would not', async () => {
  const b = await bootApp(app, { env: { KET_SQLITE: ':memory:' }, port: 0 })
  const r = await fetch(`http://127.0.0.1:${b.port}/_ket/asset/skin/logo.svg`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type') ?? '', /image\/svg\+xml/)
  await b.close()
})
