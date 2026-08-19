// The design entry point.
//
//   node apps/admin/serve.ts
//   http://127.0.0.1:4000/catalogue     every screen, every state
//   http://127.0.0.1:4000/admin/apps    the real screen, on real data
//
// The database is in memory and seeded on boot, so this is disposable: install
// things, break things, restart. Nothing here talks to a real deployment.

import { createKetServer, compose, sqliteAdapter, migrateOne, registerFunctions, createAppRegistry, restrictManifest, callFn } from 'ketjs'
import { renderToString } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import { website, websiteMenu, websiteSeo, websiteSearch, paperTheme } from 'ketsuite'
import backend, { appsScreen, pagesScreen, settingsScreen, cataloguePage } from 'ketsuite/backend'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DESIGN = join(HERE, '../../packages/ketsuite/src/modules/backend/design')

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
    { adapter: db, manifest })
  if (published) await callFn('website.publishPage', { id, published: true }, { adapter: db, manifest })
}

/** One wrapper for every page, so the stylesheets are loaded exactly once. */
const page = (title: string, body: TemplateResult): string => `<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · KetSuite</title>
<link rel="stylesheet" href="/design/tokens.css">
<link rel="stylesheet" href="/design/admin.css">
</head><body>${renderToString(body)}</body></html>`

const route = (title: string, build: () => Promise<TemplateResult> | TemplateResult) =>
  async () => ({ body: page(title, await build()) })

const app = await createKetServer({
  manifest, adapter: db,
  assets: { prefix: '/design/', dir: DESIGN },
  routes: {
    '/': async () => ({ body: `<!doctype html><meta charset="utf-8"><ul>
      <li><a href="/catalogue">Danh mục trạng thái — mọi màn hình, mọi trạng thái</a></li>
      <li><a href="/admin/apps">Ứng dụng (dữ liệu thật)</a></li>
      <li><a href="/admin/pages">Trang (dữ liệu thật)</a></li>
      <li><a href="/admin/settings">Cài đặt (dữ liệu thật)</a></li></ul>` }),

    '/catalogue': route('Danh mục trạng thái', () => cataloguePage()),

    '/admin/apps': route('Ứng dụng', async () => appsScreen(await apps.list())),

    '/admin/pages': route('Trang', async () => {
      const restricted = restrictManifest(manifest, await apps.enabled())
      const rows = (await callFn('website.listPages', { includeDrafts: true }, { adapter: db, manifest: restricted })).value
      return pagesScreen((rows as Array<{ id: string; path: string; title: string; published: number }>)
        .map(r => ({ ...r, published: !!r.published })))
    }),

    '/admin/settings': route('Cài đặt', () => settingsScreen(manifest.tokens)),
  },
})

const port = await app.listen(Number(process.env.PORT ?? 4000))
console.log(`
  KetSuite backend — điểm vào cho đội design

    danh mục trạng thái   http://127.0.0.1:${port}/catalogue
    màn hình thật         http://127.0.0.1:${port}/admin/apps

  CSS đang sửa trực tiếp, F5 là thấy:
    ${DESIGN}/tokens.css
    ${DESIGN}/admin.css
`)
