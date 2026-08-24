import { randomUUID } from 'node:crypto'
import { defineModule, text } from '@ketvietlab/ketjs'
import type { Route } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { pricelistDetailScreen, pricelistsScreen } from './screens.tsx'
import { adminPage, inLocale, localeQuery } from '../backend/screen.ts'

export default defineModule({
  name: 'pricing_backend',
  group: 'commerce',
  version: '0.1.0',
  depends: ['pricing', 'backend'],
  install: 'auto',
  app: true,
  title: 'Bảng giá trong quản trị',
  summary: 'Danh sách bảng giá theo company.',
  category: 'Hệ thống',
  menus: {
    pricing: { label: 'menu.app', icon: 'tag', sequence: 21 },
    'pricing.lists': {
      parent: 'pricing',
      label: 'menu.lists',
      path: '/admin/pricing/pricelists',
      needs: 'pricing.listPricelists',
      sequence: 10,
    },
  },
  routes: {
    '/admin/pricing/pricelists':
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
            ? seeOther(inLocale(url, '/admin/pricing/pricelists'))
            : seeOther(inLocale(url, '/admin/pricing/pricelists?invalid=1'))
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
        return adminPage(ctx, url, req, {
          title: 'pricing_backend.title',
          body: (_, frame) => pricelistsScreen(_, rows, { ...frame }, localeQuery(url)),
        })
      },
    '/admin/pricing/pricelists/{id}':
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
              ? seeOther(inLocale(url, `/admin/pricing/pricelists/${params.id}`))
              : seeOther(inLocale(url, `/admin/pricing/pricelists/${params.id}?invalid=1`))
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
            ? seeOther(inLocale(url, `/admin/pricing/pricelists/${params.id}`))
            : seeOther(inLocale(url, `/admin/pricing/pricelists/${params.id}?invalid=1`))
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const items = (await ctx.call(
          'pricing.listPricelistItems',
          { pricelistId: params.id },
          url,
          req,
        )) as Array<Record<string, unknown>>
        return adminPage(ctx, url, req, {
          title: String(row.name),
          translate: false,
          body: (_, frame) => pricelistDetailScreen(_, row, items, frame, localeQuery(url)),
        })
      },
  },
  messages: {
    vi: {
      'app.title': 'Bảng giá trong quản trị',
      'app.summary': 'Quản lý bảng giá theo công ty.',
      'app.category': 'Hệ thống',
      'menu.app': 'Bảng giá',
      'menu.lists': 'Bảng giá',
      title: 'Bảng giá',
      'col.name': 'Tên',
      'col.state': 'Trạng thái',
      'col.sequence': 'Thứ tự',
      'col.currency': 'Tiền tệ',
      'col.active': 'Đang hoạt động',
      'state.active': 'Đang hoạt động',
      'state.archived': 'Đã lưu trữ',
      'action.create': 'Tạo bảng giá',
      'action.save': 'Lưu',
      'action.add': 'Thêm quy tắc',
      'detail.settings': 'Thiết lập bảng giá',
      'items.title': 'Quy tắc giá',
      'items.empty': 'Chưa có quy tắc giá.',
      'items.hint': 'Thêm quy tắc để xác định giá theo sản phẩm, số lượng hoặc ngày.',
      'items.add': 'Thêm quy tắc',
      'items.formulaHint': 'Mã lựa chọn và công thức ổn định theo hợp đồng Pricing.',
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
      'appliedOn.3_global': 'Tất cả sản phẩm',
      'appliedOn.2_product_category': 'Danh mục sản phẩm',
      'appliedOn.1_product': 'Mẫu sản phẩm',
      'appliedOn.0_product_variant': 'Biến thể sản phẩm',
      'base.list_price': 'Giá bán',
      'base.standard_price': 'Giá vốn',
      'base.pricelist': 'Bảng giá khác',
      'compute.fixed': 'Giá cố định',
      'compute.percentage': 'Phần trăm',
      'compute.formula': 'Công thức',
      empty: 'Chưa có bảng giá.',
      emptyHint: 'Tạo bảng giá đầu tiên để bắt đầu.',
    },
    en: {
      'app.title': 'Pricing in admin',
      'app.summary': 'Manage company pricelists.',
      'app.category': 'System',
      'menu.app': 'Pricing',
      'menu.lists': 'Pricelists',
      title: 'Pricelists',
      'col.name': 'Name',
      'col.state': 'State',
      'col.sequence': 'Sequence',
      'col.currency': 'Currency',
      'col.active': 'Active',
      'state.active': 'Active',
      'state.archived': 'Archived',
      'action.create': 'Create pricelist',
      'action.save': 'Save',
      'action.add': 'Add rule',
      'detail.settings': 'Pricelist settings',
      'items.title': 'Price rules',
      'items.empty': 'No price rules yet.',
      'items.hint': 'Add rules by product, quantity, or date.',
      'items.add': 'Add rule',
      'items.formulaHint': 'Selection codes and formulas follow the stable Pricing contract.',
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
      'appliedOn.3_global': 'All products',
      'appliedOn.2_product_category': 'Product category',
      'appliedOn.1_product': 'Product template',
      'appliedOn.0_product_variant': 'Product variant',
      'base.list_price': 'Sales price',
      'base.standard_price': 'Cost',
      'base.pricelist': 'Other pricelist',
      'compute.fixed': 'Fixed price',
      'compute.percentage': 'Percentage',
      'compute.formula': 'Formula',
      empty: 'No pricelists yet.',
      emptyHint: 'Create the first pricelist to begin.',
    },
  },
})
