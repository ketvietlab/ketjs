import { page } from 'ketjs'
import type { RouteEntry, Route, ServeContext } from 'ketjs'
import { productsScreen, VIEWS } from './screens.ts'
import type { TemplateRow, View } from './screens.ts'
import { viewerOf } from '../backend/routes.ts'
import { PAGE_SIZE, colsHref, colsOf, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'
import type { Extras } from '../../ui/index.ts'

/**
 * The catalogue screen.
 *
 * A route of this module, not of backend — the bridge owns the page it links to,
 * so installing the admin without the catalogue leaves neither the entry nor the
 * page behind. Closed by default, like every module route: a stranger gets the
 * sign-in page.
 *
 * Everything the list is doing — which page, which search, which view — is in the
 * URL. Nothing here holds state between requests.
 */
export const routes: Record<string, RouteEntry> = {
  '/admin/products':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const asked = url.searchParams.get('view')
      const view: View = (VIEWS as readonly string[]).includes(asked ?? '') ? (asked as View) : 'list'
      const search = searchOf(url)
      const current = pageOf(url)

      const filter = { search }
      const rows = (await ctx.call(
        'product.listTemplates',
        {
          ...filter,
          withVariants: true,
          limit: PAGE_SIZE,
          offset: (current - 1) * PAGE_SIZE,
        },
        url,
        req,
      )) as Array<{
        id: string
        name: string
        type: string
        categoryId: string | null
        uomId: string | null
        variants?: unknown[]
      }>
      const { count } = (await ctx.call('product.countTemplates', filter, url, req)) as { count: number }

      const extras: Extras = {
        'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
        'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
      }
      return page({
        body: ctx.document({
          lang,
          title: 'KetSuite',
          head: await ctx.styles(req),
          body: productsScreen(
            _,
            rows.map(
              (r): TemplateRow => ({
                id: r.id,
                name: r.name,
                type: r.type,
                categoryId: r.categoryId,
                uomId: r.uomId,
                variants: Array.isArray(r.variants) ? r.variants.length : 0,
              }),
            ),
            view,
            {
              viewer: await viewerOf(ctx, url, req),
              extras,
              menu: await ctx.menu(url, req),
              menuFilter: url.searchParams.get('menu')?.trim() || null,
              chrome: {
                search: {
                  name: 'q',
                  value: search ?? '',
                  placeholder: _('product_backend.chrome.search'),
                  // Searching must not silently switch you back to the list view.
                  keep: view === 'list' ? {} : { view },
                  facets: search
                    ? [
                        {
                          label: `${_('backend.chrome.searchFacet')}: ${search}`,
                          without: withParam(url, 'q', null),
                        },
                      ]
                    : [],
                },
                pager: pager(url, current, rows.length, count),
                views: VIEWS.map((v) => ({
                  id: v,
                  label: _(`backend.chrome.view.${v}`),
                  icon: v === 'kanban' ? 'layout-grid' : 'list',
                  path: withParam(url, 'view', v),
                  active: v === view,
                })),
              },
            },
            { shown: colsOf(url), colsHref: colsHref(url) },
          ),
        }),
      })
    },
}
