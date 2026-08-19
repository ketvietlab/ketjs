// The design entry point.
//
//   node apps/admin/serve.ts
//   http://127.0.0.1:4000/catalogue     every screen, every state
//   http://127.0.0.1:4000/admin/apps    the real screen, on real data
//
// The database is in memory and seeded on boot, so this is disposable: install
// things, break things, restart. Nothing here talks to a real deployment.

import { createKetServer, compose, sqliteAdapter, migrateOne, registerFunctions, createAppRegistry, restrictManifest, callFn, translator, PSEUDO_LOCALE, page, document } from 'ketjs'
import { html, each } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import { website, websiteMenu, websiteSeo, websiteSearch, paperTheme } from 'ketsuite'
import backend, { appsScreen, pagesScreen, settingsScreen, cataloguePage } from 'ketsuite/backend'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DESIGN = join(HERE, '../../packages/ketsuite/src/modules/backend/design')

/**
 * The design harness is single-company by construction: it exists to show screens,
 * not to prove isolation. Naming the company in one place is what keeps the seed
 * and the requests looking at the same rows.
 */
const DEMO_SCOPE = { company: 'design', branches: null }

const mods = [website, websiteMenu, websiteSeo, websiteSearch, paperTheme, backend]
const manifest = compose(mods)

const db = sqliteAdapter()
await db.open()
await migrateOne(db, manifest)
registerFunctions(mods)

const apps = await createAppRegistry(manifest, db)
await apps.install('website')
await apps.install('theme_paper')
await apps.install('backend')

for (const [id, path, title, published] of [
  ['home', '/', 'Trang chủ', true],
  ['about', '/gioi-thieu', 'Giới thiệu', false],
  ['contact', '/lien-he', 'Liên hệ', true],
] as const) {
  await callFn('website.savePage', { id, path, title, layout: [{ type: 'website.rich_text', settings: { body: title } }] },
    { adapter: db, manifest, scope: DEMO_SCOPE })
  if (published) await callFn('website.publishPage', { id, published: true }, { adapter: db, manifest, scope: DEMO_SCOPE })
}

/**
 * ?lang= switches language on any screen. Beyond checking the translation, this is
 * how a layout gets tested against text expansion: PSEUDO_LOCALE returns every
 * string longer and bracketed, so a box tuned to short Vietnamese shows its seams
 * before a real English translation ever arrives.
 */
const localeOf = (url: URL) => url.searchParams.get('lang') ?? 'vi'
const LOCALES = ['vi', 'en', PSEUDO_LOCALE]

/** One wrapper for every page, so the stylesheets are loaded exactly once. */
const STYLES = html`<link rel="stylesheet" href="/design/tokens.css"><link rel="stylesheet" href="/design/admin.css">`

const route = (build: (t: ReturnType<typeof translator>, url: URL) => Promise<TemplateResult> | TemplateResult) =>
  async (url: URL) => {
    const locale = localeOf(url)
    const t = translator(manifest, locale, { fallback: 'vi' })
    return page({ body: document({ lang: locale, title: 'KetSuite', head: STYLES, body: await build(t, url) }) })
  }

const app = await createKetServer({
  resolveScope: () => DEMO_SCOPE,
  manifest, adapter: db,
  assets: { prefix: '/design/', dir: DESIGN },
  routes: {
    // The index is markup like every other screen: the locale list is data going
    // through holes, not a join() producing a string nobody escapes.
    '/': async () => page({ body: document({ lang: 'en', title: 'KetSuite design', body: html`
      <ul>
        <li><a href="/catalogue">State catalogue — every screen, every state</a></li>
        <li><a href="/admin/apps">Apps (real data)</a></li>
        <li><a href="/admin/pages">Pages (real data)</a></li>
        <li><a href="/admin/settings">Settings (real data)</a></li>
      </ul>
      <p>Switch language with <code>?lang=</code>:
        ${each(LOCALES, l => l, l => html` <a href=${`/catalogue?lang=${l}`}>${l}</a>`)}
        <br><code>${PSEUDO_LOCALE}</code> returns every string longer and bracketed — use it to test text overflow.
      </p>` }) }),

    '/catalogue': route(t => cataloguePage(t)),

    '/admin/apps': route(async t => appsScreen(t, await apps.list())),

    '/admin/pages': route(async t => {
      const restricted = restrictManifest(manifest, await apps.enabled())
      const rows = (await callFn('website.listPages', { includeDrafts: true }, { adapter: db, manifest: restricted, scope: DEMO_SCOPE })).value
      return pagesScreen(t, (rows as Array<{ id: string; path: string; title: string; published: number }>)
        .map(r => ({ ...r, published: !!r.published })))
    }),

    '/admin/settings': route(t => settingsScreen(t, manifest.tokens)),
  },
})

const port = await app.listen(Number(process.env.PORT ?? 4000))
console.log(`
  KetSuite backend — the design entry point

    state catalogue     http://127.0.0.1:${port}/catalogue
    real screens        http://127.0.0.1:${port}/admin/apps
    in English          http://127.0.0.1:${port}/catalogue?lang=en
    text overflow       http://127.0.0.1:${port}/catalogue?lang=${PSEUDO_LOCALE}

  Edit these directly; a refresh is enough:
    ${DESIGN}/tokens.css
    ${DESIGN}/admin.css
`)
