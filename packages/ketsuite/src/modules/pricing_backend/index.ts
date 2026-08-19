import { defineModule, page } from 'ketjs'
import type { Route } from 'ketjs'
import { viewerOf } from '../backend/routes.ts'
import { pricelistsScreen } from './screens.ts'

export default defineModule({
  name: 'pricing_backend',
  version: '0.1.0',
  depends: ['pricing', 'backend'],
  install: 'auto',
  app: true,
  title: 'Bảng giá trong quản trị',
  summary: 'Danh sách bảng giá theo company.',
  category: 'Hệ thống',
  menus: {
    pricing: { label: 'menu.app', icon: 'tag', sequence: 25 },
    'pricing.lists': {
      parent: 'pricing',
      label: 'menu.lists',
      path: '/admin/pricelists',
      needs: 'pricing.listPricelists',
    },
  },
  routes: {
    '/admin/pricelists':
      (ctx): Route =>
      async (url, req) => {
        const lang = ctx.localeOf(url, req)
        const _ = ctx.translate(lang)
        const rows = (
          (await ctx.call('pricing.listPricelists', {}, url, req)) as Array<Record<string, unknown>>
        ).map((row) => ({
          id: String(row.id),
          name: String(row.name),
          state: row.active ? 'active' : 'archived',
          sequence: String(row.sequence),
        }))
        return page({
          body: ctx.document({
            lang,
            title: _('pricing_backend.title'),
            head: await ctx.styles(req),
            body: pricelistsScreen(_, rows, {
              viewer: await viewerOf(ctx, url, req),
              menu: await ctx.menu(url, req),
              extras: {
                'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
                'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
              },
            }),
          }),
        })
      },
  },
  messages: {
    vi: {
      'menu.app': 'Bảng giá',
      'menu.lists': 'Bảng giá',
      title: 'Bảng giá',
      'col.name': 'Tên',
      'col.state': 'Trạng thái',
      'col.sequence': 'Thứ tự',
      empty: 'Chưa có bảng giá.',
      emptyHint: 'Tạo bảng giá đầu tiên để bắt đầu.',
    },
    en: {
      'menu.app': 'Pricing',
      'menu.lists': 'Pricelists',
      title: 'Pricelists',
      'col.name': 'Name',
      'col.state': 'State',
      'col.sequence': 'Sequence',
      empty: 'No pricelists yet.',
      emptyHint: 'Create the first pricelist to begin.',
    },
  },
})
