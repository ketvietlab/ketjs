import { page } from 'ketjs'
import type { RouteEntry, Route, ServeContext } from 'ketjs'
import { productsScreen } from './screens.ts'
import { viewerOf } from '../backend/routes.ts'
import type { TemplateRow } from './screens.ts'
import type { Extras } from '../backend/screens.ts'

/**
 * The catalogue screen.
 *
 * A route of this module, not of backend — the bridge owns the page it links to,
 * so installing the admin without the catalogue leaves neither the button nor the
 * page behind. Closed by default, like every module route: a stranger gets the
 * sign-in page.
 */
export const routes: Record<string, RouteEntry> = {
  '/admin/products': (ctx: ServeContext): Route => async (url, req) => {
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    const rows = (await ctx.call('product.listTemplates', { withVariants: true }, url, req)) as Array<{
      id: string; name: string; type: string; categoryId: string | null; uomId: string | null; variants?: unknown[]
    }>
    const viewer = await viewerOf(ctx, url, req)
    const extras: Extras = {
      'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
      'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
    }
    return page({
      body: ctx.document({
        lang,
        title: 'KetSuite',
        head: await ctx.styles(req),
        body: productsScreen(_, rows.map((r): TemplateRow => ({
          id: r.id, name: r.name, type: r.type, categoryId: r.categoryId, uomId: r.uomId,
          variants: Array.isArray(r.variants) ? r.variants.length : 0,
        })), viewer, extras),
      }),
    })
  },
}
