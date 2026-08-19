import { randomUUID } from 'node:crypto'
import { defineModule, page, text } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import type { FormField, Frame } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import { INVOICE_POLICIES } from '../sale/functions.ts'
import { dashboard, labelOf, orderDetail, ordersScreen, policyScreen } from './screens.ts'

type AnyRow = Record<string, unknown>
type Translator = ReturnType<ServeContext['translate']>
const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]): Promise<Frame> => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})
const document = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  title: string,
  body: (_: Translator, frame: Frame) => TemplateResult | Promise<TemplateResult>,
) => {
  const lang = ctx.localeOf(url, req),
    _ = ctx.translate(lang)
  return page({
    body: ctx.document({
      lang,
      title: _(title),
      head: await ctx.styles(req),
      body: await body(_, await frame(ctx, url, req)),
    }),
  })
}
const redirect = (result: unknown, ok: string) =>
  (result as AnyRow).ok ? seeOther(ok) : seeOther(`${ok}${ok.includes('?') ? '&' : '?'}invalid=1`)
const optional = (form: Record<string, string>, name: string) => (form[name] ? { [name]: form[name] } : {})
const choices = (rows: AnyRow[], empty = false) => [
  ...(empty ? [{ value: '', label: '—' }] : []),
  ...rows.map((r) => ({
    value: String(r.id),
    label: `${String(r.code ?? '')}${r.code ? ' · ' : ''}${String(r.name)}`,
  })),
]
const common = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const [partners, companies, templates, units, warehouses, pricelists, taxes, journals, accounts, terms] =
    await Promise.all([
      ctx.call('partner.listPartners', {}, url, req) as Promise<AnyRow[]>,
      ctx.call('company.listCompanies', {}, url, req) as Promise<AnyRow[]>,
      ctx.call('product.listTemplates', { withVariants: true }, url, req) as Promise<AnyRow[]>,
      ctx.call('uom.listUnits', {}, url, req) as Promise<AnyRow[]>,
      ctx.call('stock.listWarehouses', {}, url, req) as Promise<AnyRow[]>,
      ctx.call('pricing.listPricelists', {}, url, req) as Promise<AnyRow[]>,
      ctx.call('account.listTaxes', { typeTaxUse: 'sale' }, url, req) as Promise<AnyRow[]>,
      ctx.call('account.listJournals', { type: 'sale' }, url, req) as Promise<AnyRow[]>,
      ctx.call('account.listAccounts', {}, url, req) as Promise<AnyRow[]>,
      ctx.call('account.listPaymentTerms', {}, url, req) as Promise<AnyRow[]>,
    ])
  const own = new Set(companies.map((r) => r.partnerId)),
    sellable = templates.filter((r) => r.saleOk),
    variants: AnyRow[] = sellable.flatMap((t) =>
      ((t.variants as AnyRow[] | undefined) ?? []).map((v): AnyRow => ({ ...v, templateName: t.name })),
    )
  return {
    partners: partners.filter((r) => !own.has(r.id)),
    templates: sellable,
    variants,
    units,
    warehouses,
    pricelists,
    taxes,
    journals,
    accounts,
    terms,
  }
}
const orderFields = (_: Translator, d: Awaited<ReturnType<typeof common>>): FormField[] => [
  {
    name: 'partnerId',
    label: _('sale_backend.field.customer'),
    type: 'select',
    options: choices(d.partners),
    required: true,
  },
  { name: 'clientOrderRef', label: _('sale_backend.field.clientOrderRef') },
  {
    name: 'warehouseId',
    label: _('sale_backend.field.warehouse'),
    type: 'select',
    options: choices(d.warehouses),
    required: true,
  },
  {
    name: 'pricelistId',
    label: _('sale_backend.field.pricelist'),
    type: 'select',
    options: choices(d.pricelists, true),
  },
  {
    name: 'paymentTermId',
    label: _('sale_backend.field.paymentTerm'),
    type: 'select',
    options: choices(d.terms, true),
  },
  { name: 'validityDate', label: _('sale_backend.field.validityDate'), type: 'date' },
  { name: 'notes', label: _('sale_backend.field.notes'), type: 'textarea', span: 'full' },
]
const detail =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    const path = `${url.pathname}${url.search}`
    if (req.method === 'POST') {
      const form = await readForm(req)
      let result: unknown
      if (form.action === 'add-line')
        result = await ctx.call(
          'sale.addLine',
          {
            id: randomUUID(),
            orderId: params.id,
            productId: form.productId ?? '',
            productUomQty: form.productUomQty || '1',
            productUomId: form.productUomId ?? '',
            ...optional(form, 'priceUnit'),
            ...optional(form, 'discount'),
            ...optional(form, 'taxId'),
          },
          url,
          req,
        )
      else if (form.action === 'send')
        result = await ctx.call('sale.sendQuotation', { id: params.id }, url, req)
      else if (form.action === 'confirm')
        result = await ctx.call('sale.confirmOrder', { id: params.id }, url, req)
      else if (form.action === 'sync')
        result = await ctx.call('sale.syncDeliveries', { id: params.id }, url, req)
      else if (form.action === 'lock' || form.action === 'unlock')
        result = await ctx.call('sale.lockOrder', { id: params.id, locked: form.action === 'lock' }, url, req)
      else if (form.action === 'cancel')
        result = await ctx.call('sale.cancelOrder', { id: params.id }, url, req)
      else if (form.action === 'invoice')
        result = await ctx.call(
          'sale.createInvoice',
          {
            id: randomUUID(),
            orderId: params.id,
            journalId: form.journalId ?? '',
            revenueAccountId: form.revenueAccountId ?? '',
            receivableAccountId: form.receivableAccountId ?? '',
            ...optional(form, 'taxAccountId'),
            ...optional(form, 'invoiceDate'),
          },
          url,
          req,
        )
      else return text('unknown action', { status: 400 })
      if ((result as AnyRow).ok && (result as AnyRow).state === 'sale')
        return seeOther(`/admin/sales/orders/${params.id}${url.search}`)
      return redirect(result, path)
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    const _ = ctx.translate(ctx.localeOf(url, req)),
      [order, d] = await Promise.all([
        ctx.call('sale.getOrder', { id: params.id }, url, req) as Promise<AnyRow | null>,
        common(ctx, url, req),
      ])
    if (!order) return text('not found', { status: 404 })
    const customer = d.partners.find((r) => r.id === order.partnerId),
      variants = d.variants.map((r) => ({
        value: String(r.id),
        label: `${String(r.templateName)}${r.defaultCode ? ` · ${String(r.defaultCode)}` : ''}`,
      }))
    const lineFields: FormField[] = [
      {
        name: 'productId',
        label: _('sale_backend.field.product'),
        type: 'select',
        options: variants,
        required: true,
      },
      {
        name: 'productUomQty',
        label: _('sale_backend.field.quantity'),
        type: 'decimal',
        value: 1,
        required: true,
      },
      {
        name: 'productUomId',
        label: _('sale_backend.field.uom'),
        type: 'select',
        options: choices(d.units),
        required: true,
      },
      {
        name: 'priceUnit',
        label: _('sale_backend.field.priceUnit'),
        type: 'decimal',
        help: _('sale_backend.help.pricelist'),
      },
      { name: 'discount', label: _('sale_backend.field.discount'), type: 'decimal' },
      { name: 'taxId', label: _('sale_backend.field.tax'), type: 'select', options: choices(d.taxes, true) },
    ]
    const invoiceFields: FormField[] = [
      {
        name: 'journalId',
        label: _('sale_backend.field.journal'),
        type: 'select',
        options: choices(d.journals),
        required: true,
      },
      {
        name: 'revenueAccountId',
        label: _('sale_backend.field.revenueAccount'),
        type: 'select',
        options: choices(d.accounts.filter((r) => String(r.accountType).startsWith('income'))),
        required: true,
      },
      {
        name: 'receivableAccountId',
        label: _('sale_backend.field.receivableAccount'),
        type: 'select',
        options: choices(d.accounts.filter((r) => r.accountType === 'asset_receivable')),
        required: true,
      },
      {
        name: 'taxAccountId',
        label: _('sale_backend.field.taxAccount'),
        type: 'select',
        options: choices(d.accounts, true),
      },
      { name: 'invoiceDate', label: _('sale_backend.field.invoiceDate'), type: 'date' },
    ]
    return document(ctx, url, req, 'sale_backend.detail.title', (_, shell) =>
      orderDetail(_, {
        frame: shell,
        order: { ...order, partnerName: customer?.name },
        actionPath: path,
        lineFields,
        invoiceFields,
      }),
    )
  }
const vi = {
  'app.title': 'Bán hàng trong quản trị',
  'app.summary': 'Báo giá, đơn bán, giao hàng và hoá đơn khách hàng.',
  'app.category': 'Hệ thống',
  'menu.app': 'Bán hàng',
  'menu.dashboard': 'Tổng quan',
  'menu.ordersGroup': 'Đơn hàng',
  'menu.quotations': 'Báo giá',
  'menu.orders': 'Đơn bán hàng',
  'menu.products': 'Sản phẩm',
  'menu.policies': 'Chính sách lập hoá đơn',
  'dashboard.title': 'Tổng quan bán hàng',
  'dashboard.draft': 'Báo giá',
  'dashboard.sent': 'Báo giá đã gửi',
  'dashboard.toInvoice': 'Chờ lập hoá đơn',
  'dashboard.records': 'Bản ghi',
  'quotations.title': 'Báo giá',
  'orders.title': 'Đơn bán hàng',
  'detail.title': 'Chi tiết đơn bán',
  'policies.title': 'Chính sách lập hoá đơn',
  'lines.title': 'Dòng sản phẩm',
  'lines.add': 'Thêm sản phẩm',
  'invoice.title': 'Tạo hoá đơn khách hàng',
  'deliveries.title': 'Phiếu giao hàng',
  'invoices.title': 'Hoá đơn khách hàng',
  empty: 'Chưa có dữ liệu.',
  emptyHint: 'Tạo bản ghi đầu tiên để bắt đầu.',
  'action.create': 'Tạo báo giá',
  'action.addLine': 'Thêm dòng',
  'action.send': 'Đánh dấu đã gửi',
  'action.confirm': 'Xác nhận',
  'action.sync': 'Đồng bộ giao hàng',
  'action.lock': 'Khoá đơn',
  'action.unlock': 'Mở khoá',
  'action.cancel': 'Huỷ',
  'action.createInvoice': 'Tạo hoá đơn',
  'action.savePolicy': 'Lưu chính sách',
  'field.name': 'Số đơn',
  'field.customer': 'Khách hàng',
  'field.clientOrderRef': 'Tham chiếu khách hàng',
  'field.state': 'Trạng thái',
  'field.dateOrder': 'Ngày đặt hàng',
  'field.validityDate': 'Hạn báo giá',
  'field.warehouse': 'Kho hàng',
  'field.pricelist': 'Bảng giá',
  'field.paymentTerm': 'Điều khoản thanh toán',
  'field.invoiceStatus': 'Trạng thái lập hoá đơn',
  'field.amountTotal': 'Tổng tiền',
  'field.notes': 'Điều khoản và ghi chú',
  'field.product': 'Sản phẩm',
  'field.quantity': 'Số lượng đặt',
  'field.delivered': 'Đã giao',
  'field.invoiced': 'Đã lập hoá đơn',
  'field.uom': 'Đơn vị tính',
  'field.priceUnit': 'Đơn giá',
  'field.discount': 'Chiết khấu',
  'field.tax': 'Thuế bán hàng',
  'field.subtotal': 'Thành tiền',
  'field.invoicePolicy': 'Cơ sở lập hoá đơn',
  'field.journal': 'Sổ nhật ký bán hàng',
  'field.revenueAccount': 'Tài khoản doanh thu',
  'field.receivableAccount': 'Tài khoản phải thu',
  'field.taxAccount': 'Tài khoản thuế',
  'field.invoiceDate': 'Ngày hoá đơn',
  'help.pricelist': 'Để trống để dùng bảng giá hoặc giá niêm yết.',
  'state.draft': 'Báo giá',
  'state.sent': 'Báo giá đã gửi',
  'state.sale': 'Đơn bán hàng',
  'state.cancel': 'Đã huỷ',
  'invoiceStatus.upselling': 'Cơ hội bán thêm',
  'invoiceStatus.invoiced': 'Đã lập đủ',
  'invoiceStatus.to invoice': 'Chờ lập hoá đơn',
  'invoiceStatus.no': 'Chưa cần lập hoá đơn',
  'invoicePolicy.order': 'Theo số lượng đặt',
  'invoicePolicy.delivery': 'Theo số lượng giao',
}
const en = {
  'app.title': 'Sales administration',
  'app.summary': 'Quotations, sales orders, deliveries, and customer invoices.',
  'app.category': 'System',
  'menu.app': 'Sales',
  'menu.dashboard': 'Overview',
  'menu.ordersGroup': 'Orders',
  'menu.quotations': 'Quotations',
  'menu.orders': 'Sales Orders',
  'menu.products': 'Products',
  'menu.policies': 'Invoicing Policies',
  'dashboard.title': 'Sales Overview',
  'dashboard.draft': 'Quotations',
  'dashboard.sent': 'Quotation Sent',
  'dashboard.toInvoice': 'To Invoice',
  'dashboard.records': 'Records',
  'quotations.title': 'Quotations',
  'orders.title': 'Sales Orders',
  'detail.title': 'Sales Order Detail',
  'policies.title': 'Invoicing Policies',
  'lines.title': 'Order Lines',
  'lines.add': 'Add a product',
  'invoice.title': 'Create Customer Invoice',
  'deliveries.title': 'Deliveries',
  'invoices.title': 'Customer Invoices',
  empty: 'No data yet.',
  emptyHint: 'Create the first record to get started.',
  'action.create': 'Create Quotation',
  'action.addLine': 'Add line',
  'action.send': 'Mark as Sent',
  'action.confirm': 'Confirm',
  'action.sync': 'Sync Deliveries',
  'action.lock': 'Lock',
  'action.unlock': 'Unlock',
  'action.cancel': 'Cancel',
  'action.createInvoice': 'Create Invoice',
  'action.savePolicy': 'Save Policy',
  'field.name': 'Order Reference',
  'field.customer': 'Customer',
  'field.clientOrderRef': 'Customer Reference',
  'field.state': 'Status',
  'field.dateOrder': 'Order Date',
  'field.validityDate': 'Expiration',
  'field.warehouse': 'Warehouse',
  'field.pricelist': 'Pricelist',
  'field.paymentTerm': 'Payment Terms',
  'field.invoiceStatus': 'Invoice Status',
  'field.amountTotal': 'Total',
  'field.notes': 'Terms and Conditions',
  'field.product': 'Product',
  'field.quantity': 'Ordered',
  'field.delivered': 'Delivered',
  'field.invoiced': 'Invoiced',
  'field.uom': 'Unit',
  'field.priceUnit': 'Unit Price',
  'field.discount': 'Discount',
  'field.tax': 'Sales Tax',
  'field.subtotal': 'Subtotal',
  'field.invoicePolicy': 'Invoicing Policy',
  'field.journal': 'Sales Journal',
  'field.revenueAccount': 'Revenue Account',
  'field.receivableAccount': 'Receivable Account',
  'field.taxAccount': 'Tax Account',
  'field.invoiceDate': 'Invoice Date',
  'help.pricelist': 'Leave blank to use the pricelist or list price.',
  'state.draft': 'Quotation',
  'state.sent': 'Quotation Sent',
  'state.sale': 'Sales Order',
  'state.cancel': 'Cancelled',
  'invoiceStatus.upselling': 'Upselling Opportunity',
  'invoiceStatus.invoiced': 'Fully Invoiced',
  'invoiceStatus.to invoice': 'To Invoice',
  'invoiceStatus.no': 'Nothing to Invoice',
  'invoicePolicy.order': 'Ordered quantities',
  'invoicePolicy.delivery': 'Delivered quantities',
}
export default defineModule({
  name: 'sale_backend',
  version: '0.1.0',
  depends: ['sale', 'backend'],
  install: 'auto',
  app: true,
  title: 'Bán hàng trong quản trị',
  summary: 'Báo giá, đơn bán, giao hàng và hoá đơn khách hàng.',
  category: 'Hệ thống',
  menus: {
    sale: { label: 'menu.app', icon: 'cart', sequence: 20 },
    'sale.dashboard': {
      parent: 'sale',
      label: 'menu.dashboard',
      path: '/admin/sales',
      sequence: 1,
      needs: 'sale.listOrders',
    },
    'sale.ordersGroup': { parent: 'sale', label: 'menu.ordersGroup', sequence: 10 },
    'sale.quotations': {
      parent: 'sale.ordersGroup',
      label: 'menu.quotations',
      path: '/admin/sales/quotations',
      needs: 'sale.listOrders',
    },
    'sale.orders': {
      parent: 'sale.ordersGroup',
      label: 'menu.orders',
      path: '/admin/sales/orders',
      needs: 'sale.listOrders',
    },
    'sale.products': { parent: 'sale', label: 'menu.products', sequence: 20 },
    'sale.policies': {
      parent: 'sale.products',
      label: 'menu.policies',
      path: '/admin/sales/invoicing-policies',
      needs: 'sale.setInvoicePolicy',
    },
  },
  routes: {
    '/admin/sales':
      (ctx): Route =>
      async (url, req) =>
        req.method === 'GET'
          ? document(ctx, url, req, 'sale_backend.dashboard.title', async (_, shell) =>
              dashboard(_, (await ctx.call('sale.listOrders', {}, url, req)) as AnyRow[], shell),
            )
          : text('GET', { status: 405 }),
    '/admin/sales/quotations':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          const form = await readForm(req),
            result = await ctx.call(
              'sale.createOrder',
              {
                id: randomUUID(),
                partnerId: form.partnerId ?? '',
                warehouseId: form.warehouseId ?? '',
                ...optional(form, 'clientOrderRef'),
                ...optional(form, 'pricelistId'),
                ...optional(form, 'paymentTermId'),
                ...optional(form, 'validityDate'),
                ...optional(form, 'notes'),
              },
              url,
              req,
            )
          return redirect(result, '/admin/sales/quotations')
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const [rows, d] = await Promise.all([
            ctx.call('sale.listOrders', {}, url, req) as Promise<AnyRow[]>,
            common(ctx, url, req),
          ]),
          state = url.searchParams.get('state'),
          names = new Map(d.partners.map((r) => [String(r.id), r.name]))
        return document(ctx, url, req, 'sale_backend.quotations.title', (_, shell) =>
          ordersScreen(_, {
            title: _('sale_backend.quotations.title'),
            frame: shell,
            fields: orderFields(_, d),
            rows: rows
              .filter((r) => ['draft', 'sent'].includes(String(r.state)) && (!state || r.state === state))
              .map((r) => ({ ...r, partnerName: names.get(String(r.partnerId)) })),
          }),
        )
      },
    '/admin/sales/orders':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const [rows, d] = await Promise.all([
            ctx.call('sale.listOrders', { state: 'sale' }, url, req) as Promise<AnyRow[]>,
            common(ctx, url, req),
          ]),
          names = new Map(d.partners.map((r) => [String(r.id), r.name]))
        return document(ctx, url, req, 'sale_backend.orders.title', (_, shell) =>
          ordersScreen(_, {
            title: _('sale_backend.orders.title'),
            frame: shell,
            rows: rows.map((r) => ({ ...r, partnerName: names.get(String(r.partnerId)) })),
          }),
        )
      },
    '/admin/sales/quotations/{id}': detail,
    '/admin/sales/orders/{id}': detail,
    '/admin/sales/invoicing-policies':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          const form = await readForm(req)
          return redirect(
            await ctx.call(
              'sale.setInvoicePolicy',
              { templateId: form.templateId ?? '', invoicePolicy: form.invoicePolicy ?? '' },
              url,
              req,
            ),
            '/admin/sales/invoicing-policies',
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const d = await common(ctx, url, req),
          _ = ctx.translate(ctx.localeOf(url, req))
        return document(ctx, url, req, 'sale_backend.policies.title', (_, shell) =>
          policyScreen(
            _,
            shell,
            [
              {
                name: 'templateId',
                label: _('sale_backend.field.product'),
                type: 'select',
                options: choices(d.templates),
                required: true,
              },
              {
                name: 'invoicePolicy',
                label: _('sale_backend.field.invoicePolicy'),
                type: 'select',
                options: INVOICE_POLICIES.map((v) => ({ value: v, label: labelOf(_, 'invoicePolicy', v) })),
              },
            ],
            d.templates,
          ),
        )
      },
  },
  messages: { vi, en },
})
