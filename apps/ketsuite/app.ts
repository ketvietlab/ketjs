// KetSuite — the application, as a declaration.
//
// What is left here is only what the framework cannot know: which modules ship,
// which function turns a path into a page, which screens the backend serves, and
// how to open a datastore that is not SQLite. Everything else — migrating,
// installing, resolving who the request is, mounting /_ket, the banner, shutting
// down cleanly — is `ket serve`.

import { defineApp } from 'ketjs'
import * as suite from 'ketsuite'
import backend, { appsScreen, pagesScreen, settingsScreen } from 'ketsuite/backend'
import { renderToString } from 'ketjs-view'
import type { ServeContext, Route } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { openStore } from './config.ts'

const DESIGN = new URL('../../packages/ketsuite/src/modules/backend/design/', import.meta.url).pathname

/** The backend's shell: the framework's bare page, plus this app's stylesheets. */
type Build = (
  _: ReturnType<ServeContext['translate']>,
  req: { url: URL; raw: Parameters<Route>[1] },
) => Promise<TemplateResult> | TemplateResult

const screen = (ctx: ServeContext, build: Build): Route => async (url, raw) => ({
  body: ctx.html({
    lang: ctx.localeOf(url, raw),
    title: 'KetSuite',
    head: '<link rel="stylesheet" href="/design/tokens.css"><link rel="stylesheet" href="/design/admin.css">',
    body: renderToString(await build(ctx.translate(ctx.localeOf(url, raw)), { url, raw })),
  }),
})

export const ketsuite = defineApp({
  name: 'ketsuite',
  /** Every module KetSuite ships. Adding one here is what makes it installable. */
  modules: [
    suite.website, suite.websiteMenu, suite.websiteSeo, suite.websiteSearch,
    suite.uom, suite.product, backend,
  ],
  theme: suite.paperTheme,
  datastore: 'main',
  serve: {
    openStore,
    defaults: { sqliteFile: '.ket/ketsuite.db', defaultLocale: 'vi', fallbackLocale: 'vi' },
    bootstrap: ['website', 'theme_paper', 'backend', 'product'],
    pages: { resolve: 'website.getPageByPath', notFound: 'website.page.notFound', siteTitle: 'KetSuite' },
    assets: { prefix: '/design/', dir: DESIGN },
    routes: (ctx) => ({
      '/admin': screen(ctx, async (_) => appsScreen(_, await ctx.apps.list())),
      '/admin/apps': screen(ctx, async (_) => appsScreen(_, await ctx.apps.list())),
      '/admin/pages': screen(ctx, async (_, { url, raw }) => {
        // The same call path as the API: this request's live manifest and company.
        const rows = await ctx.call('website.listPages', { includeDrafts: true }, url, raw) as
          Array<{ id: string; path: string; title: string; published: number }>
        return pagesScreen(_, rows.map(r => ({ ...r, published: !!r.published })))
      }),
      '/admin/settings': screen(ctx, _ => settingsScreen(_, ctx.manifest.tokens)),
    }),
  },
})

export const apps = [ketsuite]
