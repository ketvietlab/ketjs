// The backend's own routes.
//
// One factory per path: the path is data, so composition can settle ownership and
// refuse two modules claiming the same one, while the handler is built at boot
// because it needs the running server. Dispatch checks the live manifest, so these
// stop answering the moment the module is switched off.

import { page } from 'ketjs'
import type { ServeContext, Route } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { appsScreen, pagesScreen, settingsScreen } from './screens.ts'

type Build = (
  _: ReturnType<ServeContext['translate']>,
  req: { url: URL; raw: Parameters<Route>[1] },
) => Promise<TemplateResult> | TemplateResult

/**
 * The shell every backend screen sits in. The stylesheets come from ctx.styles(),
 * which is every installed module's, in dependency order — this module no longer
 * names even its own.
 */
const screen = (ctx: ServeContext, build: Build): Route => async (url, req) => {
  const lang = ctx.localeOf(url, req)
  return page({
    body: ctx.document({
      lang,
      title: 'KetSuite',
      head: await ctx.styles(),
      body: await build(ctx.translate(lang), { url, raw: req }),
    }),
  })
}

export const routes: Record<string, (ctx: ServeContext) => Route> = {
  '/admin': (ctx) => screen(ctx, async (_) => appsScreen(_, await ctx.apps.list())),
  '/admin/apps': (ctx) => screen(ctx, async (_) => appsScreen(_, await ctx.apps.list())),
  '/admin/pages': (ctx) => screen(ctx, async (_, { url, raw }) => {
    // The same call path as the API: this request's live manifest and company.
    const rows = await ctx.call('website.listPages', { includeDrafts: true }, url, raw) as
      Array<{ id: string; path: string; title: string; published: number }>
    return pagesScreen(_, rows.map(r => ({ ...r, published: !!r.published })))
  }),
  '/admin/settings': (ctx) => screen(ctx, _ => settingsScreen(_, ctx.manifest.tokens)),
}
