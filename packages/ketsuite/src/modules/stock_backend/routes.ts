import { page } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import { viewerOf } from '../backend/routes.ts'
import { stockScreen } from './screens.ts'
import type { StockRow } from './screens.ts'

const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})

const screen =
  (
    titleKey: string,
    load: (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => Promise<StockRow[]>,
  ): ((ctx: ServeContext) => Route) =>
  (ctx) =>
  async (url, req) => {
    const lang = ctx.localeOf(url, req)
    const _ = ctx.translate(lang)
    return page({
      body: ctx.document({
        lang,
        title: _(titleKey),
        head: await ctx.styles(req),
        body: stockScreen(_, _(titleKey), await load(ctx, url, req), await frame(ctx, url, req)),
      }),
    })
  }

export const routes: Record<string, RouteEntry> = {
  '/admin/inventory': screen('stock_backend.inventory', async (ctx, url, req) =>
    ((await ctx.call('stock.listQuants', {}, url, req)) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.productId),
      kind: 'quant',
      detail: `${String(row.quantity)} / ${String(row.reservedQuantity)}`,
    })),
  ),
  '/admin/transfers': screen('stock_backend.transfers', async (ctx, url, req) =>
    ((await ctx.call('stock.listPickings', {}, url, req)) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      kind: 'transfer',
      state: String(row.state),
      detail: String(row.scheduledDate),
    })),
  ),
  '/admin/warehouses': screen('stock_backend.warehouses', async (ctx, url, req) =>
    ((await ctx.call('stock.listWarehouses', {}, url, req)) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      kind: 'warehouse',
      detail: String(row.code),
    })),
  ),
  '/admin/stock-routes': screen('stock_backend.routes', async (ctx, url, req) =>
    ((await ctx.call('stock.listRoutes', {}, url, req)) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      kind: 'route',
      detail: String(row.sequence),
    })),
  ),
}
