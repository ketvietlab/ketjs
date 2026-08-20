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
import type { Extras, Frame, Viewer } from '../../ui/index.ts'
import { colsHref, colsOf, pageOf, PAGE_SIZE, pager, searchOf } from './paging.ts'

type Build = (
  _: ReturnType<ServeContext['translate']>,
  req: { url: URL; raw: Parameters<Route>[1]; frame: Frame },
) => Promise<TemplateResult> | TemplateResult

/**
 * Who is looking. The screens show it in the topbar, which is the difference
 * between a page that happens to be behind a login and one that says so.
 */
export const viewerOf = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
): Promise<Viewer | null> => {
  const sessions = await ctx.sessionsOf(url, req)
  const record = await sessions?.of(req)
  if (!record) return null
  const user = (await ctx.callUnchecked('user.getUser', { id: record.userId }, url, req)) as {
    name?: string
  } | null
  const live = await ctx.live(req)
  const labels = live.functions['company.contextLabels']
    ? ((await ctx.callUnchecked(
        'company.contextLabels',
        { companyId: record.company, branchId: record.branch },
        url,
        req,
      )) as {
        companyName?: string | null
        branchName?: string | null
        branchCode?: string | null
        branchIsRoot?: boolean | null
      })
    : {}
  const lang = url.searchParams.get('lang')
  return {
    name: user?.name ?? record.userId,
    company: record.company,
    companies: record.companies,
    companyName: labels.companyName ?? record.company,
    branch: record.branch,
    branches: record.branches,
    branchName: labels.branchIsRoot
      ? `${ctx.translate(ctx.localeOf(url, req))('backend.context.rootBranch')} · ${labels.branchCode}`
      : (labels.branchName ?? record.branch),
    contextPath: live.routes['/admin/context']
      ? `/admin/context${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`
      : null,
  }
}

/**
 * The shell every backend screen sits in. The stylesheets come from ctx.styles(),
 * which is every installed module's, in dependency order — this module no longer
 * names even its own.
 */
const screen =
  (ctx: ServeContext, build: Build): Route =>
  async (url, req) => {
    const lang = ctx.localeOf(url, req)
    const viewer = await viewerOf(ctx, url, req)
    // Installed, and permitted: the sidebar never offers what the click would refuse.
    const menu = await ctx.menu(url, req)
    const menuFilter = url.searchParams.get('menu')?.trim() || null
    // Rendered once per request, so a screen stays a pure function of its data and
    // the catalogue can render the same screens with no server at all.
    const extras: Extras = {
      'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
      'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
      'apps.footer': await ctx.joint(url, req, 'backend:apps.footer'),
    }
    return page({
      body: ctx.document({
        lang,
        title: 'KetSuite',
        head: await ctx.styles(req),
        body: await build(ctx.translate(lang), {
          url,
          raw: req,
          frame: { viewer, extras, menu, menuFilter },
        }),
      }),
    })
  }

/**
 * The card joint takes the app as a prop, so it is rendered once per card here
 * rather than by the screen. Handing the screen a function instead would have been
 * shorter and would have made it depend on a runtime — and the catalogue renders
 * these same screens with no server at all.
 */
const appsWith =
  (ctx: ServeContext): Build =>
  async (_, r) => {
    const apps = await ctx.appsOf(r.raw)
    const perApp = Object.fromEntries(
      await Promise.all(
        apps.map(
          async (app) =>
            [app.name, await ctx.joint(r.url, r.raw, 'backend:app-card.actions', { app })] as const,
        ),
      ),
    )
    return appsScreen(_, apps, { ...r.frame, extras: { ...r.frame.extras, 'app-card.actions': perApp } })
  }

export const routes: Record<string, (ctx: ServeContext) => Route> = {
  '/admin': (ctx) => screen(ctx, appsWith(ctx)),
  '/admin/apps': (ctx) => screen(ctx, appsWith(ctx)),
  '/admin/pages': (ctx) =>
    screen(ctx, async (_, { url, raw, frame }) => {
      // Paging and searching are in the URL, so page four is a link you can send
      // someone and the back button needs no help from us.
      const search = searchOf(url)
      const page = pageOf(url)
      const filter = { includeDrafts: true, search }
      // The same call path as the API: this request's live manifest and company.
      const rows = (await ctx.call(
        'website.listPages',
        { ...filter, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
        url,
        raw,
      )) as Array<{ id: string; path: string; title: string; published: number }>
      const { count } = (await ctx.call('website.countPages', filter, url, raw)) as { count: number }
      return pagesScreen(
        _,
        rows.map((r) => ({ ...r, published: !!r.published })),
        {
          ...frame,
          chrome: {
            search: {
              name: 'q',
              value: search ?? '',
              placeholder: _('backend.chrome.searchPages'),
              facets: search
                ? [{ label: `${_('backend.chrome.searchFacet')}: ${search}`, without: url.pathname }]
                : [],
            },
            pager: pager(url, page, rows.length, count),
          },
        },
        { shown: colsOf(url), colsHref: colsHref(url) },
      )
    }),
  '/admin/settings': (ctx) => screen(ctx, (_, { frame }) => settingsScreen(_, ctx.manifest.tokens, frame)),
}
