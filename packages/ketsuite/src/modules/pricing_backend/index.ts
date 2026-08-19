import { randomUUID } from 'node:crypto'
import { defineModule, page, text } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import { pricelistDetailScreen, pricelistsScreen } from './screens.ts'

const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})

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
        if (req.method === 'POST') {
          const form = await readForm(req)
          const result = await ctx.call(
            'pricing.savePricelist',
            { id: randomUUID(), name: form.name ?? '', sequence: Number(form.sequence || 16), active: true },
            url,
            req,
          )
          return (result as { ok?: boolean }).ok
            ? seeOther('/admin/pricelists')
            : seeOther('/admin/pricelists?invalid=1')
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (
          (await ctx.call('pricing.listPricelists', {}, url, req)) as Array<Record<string, unknown>>
        ).map((row) => ({
          id: String(row.id),
          name: String(row.name),
          currency: String(row.currency),
          state: row.active ? 'active' : 'archived',
          sequence: String(row.sequence),
        }))
        return page({
          body: ctx.document({
            lang,
            title: _('pricing_backend.title'),
            head: await ctx.styles(req),
            body: pricelistsScreen(_, rows, {
              ...(await frame(ctx, url, req)),
            }),
          }),
        })
      },
    '/admin/pricelists/{id}':
      (ctx): Route =>
      async (url, req, params) => {
        const lang = ctx.localeOf(url, req)
        const _ = ctx.translate(lang)
        const lists = (await ctx.call('pricing.listPricelists', {}, url, req)) as Array<
          Record<string, unknown>
        >
        const row = lists.find((list) => list.id === params.id)
        if (!row) return text('Pricelist not found', { status: 404 })
        if (req.method === 'POST') {
          const form = await readForm(req)
          if (form.action === 'save-pricelist') {
            const result = await ctx.call(
              'pricing.savePricelist',
              {
                id: params.id,
                name: form.name ?? '',
                sequence: Number(form.sequence || 16),
                active: form.active === '1',
              },
              url,
              req,
            )
            return (result as { ok?: boolean }).ok
              ? seeOther(`/admin/pricelists/${params.id}`)
              : seeOther(`/admin/pricelists/${params.id}?invalid=1`)
          }
          const optional = (name: string) => (form[name] ? { [name]: form[name] } : {})
          const result = await ctx.call(
            'pricing.savePricelistItem',
            {
              id: randomUUID(),
              pricelistId: params.id,
              appliedOn: form.appliedOn || '3_global',
              ...optional('categoryId'),
              ...optional('templateId'),
              ...optional('productId'),
              minQuantity: form.minQuantity || '0',
              ...optional('dateStart'),
              ...optional('dateEnd'),
              base: form.base || 'list_price',
              ...optional('basePricelistId'),
              computePrice: form.computePrice || 'fixed',
              fixedPrice: form.fixedPrice || '0',
              percentPrice: form.percentPrice || '0',
              priceDiscount: form.priceDiscount || '0',
              priceRound: form.priceRound || '0',
              priceSurcharge: form.priceSurcharge || '0',
              priceMinMargin: form.priceMinMargin || '0',
              priceMaxMargin: form.priceMaxMargin || '0',
            },
            url,
            req,
          )
          return (result as { ok?: boolean }).ok
            ? seeOther(`/admin/pricelists/${params.id}`)
            : seeOther(`/admin/pricelists/${params.id}?invalid=1`)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const items = (await ctx.call(
          'pricing.listPricelistItems',
          { pricelistId: params.id },
          url,
          req,
        )) as Array<Record<string, unknown>>
        return page({
          body: ctx.document({
            lang,
            title: String(row.name),
            head: await ctx.styles(req),
            body: pricelistDetailScreen(_, row, items, await frame(ctx, url, req)),
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
      'col.currency': 'Tiền tệ',
      'col.active': 'Đang hoạt động',
      'action.create': 'Tạo bảng giá',
      'action.save': 'Lưu',
      'action.add': 'Thêm quy tắc',
      'detail.settings': 'Thiết lập bảng giá',
      'items.title': 'Quy tắc giá',
      'items.empty': 'Chưa có quy tắc giá.',
      'items.hint': 'Thêm quy tắc để xác định giá theo sản phẩm, số lượng hoặc ngày.',
      'items.add': 'Thêm quy tắc',
      'items.formulaHint': 'Selection code và công thức giữ nguyên theo Odoo 19.',
      'field.appliedOn': 'Áp dụng cho',
      'field.categoryId': 'ID danh mục',
      'field.templateId': 'ID mẫu sản phẩm',
      'field.productId': 'ID biến thể',
      'field.minQuantity': 'Số lượng tối thiểu',
      'field.dateStart': 'Bắt đầu',
      'field.dateEnd': 'Kết thúc',
      'field.base': 'Giá cơ sở',
      'field.basePricelistId': 'Bảng giá cơ sở',
      'field.computePrice': 'Cách tính',
      'field.fixedPrice': 'Giá cố định',
      'field.percentPrice': 'Giảm giá %',
      'field.priceDiscount': 'Chiết khấu công thức %',
      'field.priceRound': 'Làm tròn',
      'field.priceSurcharge': 'Phụ phí',
      'field.priceMinMargin': 'Biên tối thiểu',
      'field.priceMaxMargin': 'Biên tối đa',
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
      'col.currency': 'Currency',
      'col.active': 'Active',
      'action.create': 'Create pricelist',
      'action.save': 'Save',
      'action.add': 'Add rule',
      'detail.settings': 'Pricelist settings',
      'items.title': 'Price rules',
      'items.empty': 'No price rules yet.',
      'items.hint': 'Add rules by product, quantity, or date.',
      'items.add': 'Add rule',
      'items.formulaHint': 'Selection codes and formulas follow Odoo 19.',
      'field.appliedOn': 'Apply on',
      'field.categoryId': 'Category ID',
      'field.templateId': 'Product template ID',
      'field.productId': 'Variant ID',
      'field.minQuantity': 'Minimum quantity',
      'field.dateStart': 'Start date',
      'field.dateEnd': 'End date',
      'field.base': 'Based on',
      'field.basePricelistId': 'Base pricelist',
      'field.computePrice': 'Computation',
      'field.fixedPrice': 'Fixed price',
      'field.percentPrice': 'Discount %',
      'field.priceDiscount': 'Formula discount %',
      'field.priceRound': 'Rounding',
      'field.priceSurcharge': 'Surcharge',
      'field.priceMinMargin': 'Minimum margin',
      'field.priceMaxMargin': 'Maximum margin',
      empty: 'No pricelists yet.',
      emptyHint: 'Create the first pricelist to begin.',
    },
  },
})
