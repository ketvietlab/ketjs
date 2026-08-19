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
import type { Extras, Viewer } from './screens.ts'

type Build = (
  _: ReturnType<ServeContext['translate']>,
  req: { url: URL; raw: Parameters<Route>[1]; viewer: Viewer | null; extras: Extras },
) => Promise<TemplateResult> | TemplateResult

/**
 * Who is looking. The screens show it in the topbar, which is the difference
 * between a page that happens to be behind a login and one that says so.
 */
const viewerOf = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]): Promise<Viewer | null> => {
  const sessions = await ctx.sessionsOf(url, req)
  const record = await sessions?.of(req)
  if (!record) return null
  const user = await ctx.callUnchecked('user.getUser', { id: record.userId }, url, req) as { name?: string } | null
  return { name: user?.name ?? record.userId, company: record.company, companies: record.companies }
}

/**
 * The shell every backend screen sits in. The stylesheets come from ctx.styles(),
 * which is every installed module's, in dependency order — this module no longer
 * names even its own.
 */
const screen = (ctx: ServeContext, build: Build): Route => async (url, req) => {
  const lang = ctx.localeOf(url, req)
  const viewer = await viewerOf(ctx, url, req)
  // Rendered once per request, so a screen stays a pure function of its data and
  // the catalogue can render the same screens with no server at all.
  const extras: Extras = {
    'topbar.end': await ctx.joint(req, 'backend:topbar.end'),
    'apps.footer': await ctx.joint(req, 'backend:apps.footer'),
  }
  return page({
    body: ctx.document({
      lang,
      title: 'KetSuite',
      head: await ctx.styles(req),
      body: await build(ctx.translate(lang), { url, raw: req, viewer, extras }),
    }),
  })
}

/**
 * The card joint takes the app as a prop, so it is rendered once per card here
 * rather than by the screen. Handing the screen a function instead would have been
 * shorter and would have made it depend on a runtime — and the catalogue renders
 * these same screens with no server at all.
 */
const appsWith = (ctx: ServeContext): Build => async (_, r) => {
  const apps = await ctx.appsOf(r.raw)
  const perApp = Object.fromEntries(await Promise.all(
    apps.map(async (app) => [app.name, await ctx.joint(r.raw, 'backend:app-card.actions', { app })] as const),
  ))
  return appsScreen(_, apps, r.viewer, { ...r.extras, 'app-card.actions': perApp })
}

export const routes: Record<string, (ctx: ServeContext) => Route> = {
  '/admin': (ctx) => screen(ctx, appsWith(ctx)),
  '/admin/apps': (ctx) => screen(ctx, appsWith(ctx)),
  '/admin/pages': (ctx) => screen(ctx, async (_, { url, raw, viewer, extras }) => {
    // The same call path as the API: this request's live manifest and company.
    const rows = await ctx.call('website.listPages', { includeDrafts: true }, url, raw) as
      Array<{ id: string; path: string; title: string; published: number }>
    return pagesScreen(_, rows.map(r => ({ ...r, published: !!r.published })), viewer, extras)
  }),
  '/admin/settings': (ctx) => screen(ctx, (_, { viewer, extras }) => settingsScreen(_, ctx.manifest.tokens, viewer, extras)),
}
