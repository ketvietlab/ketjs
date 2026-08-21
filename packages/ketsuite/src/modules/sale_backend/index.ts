import { randomUUID } from 'node:crypto'
import { NAVIGATION_TYPE, defineModule, fragment, json, text, withHeaders } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import type { FormField, Frame } from '../../ui/index.ts'
import { backendPage } from '../../ui/index.ts'
import { errorsOf, readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import { INVOICE_POLICIES } from '../sale/functions.ts'
import { islands } from './islands.ts'
import { invoicingPoliciesScreen } from './invoicing-policies-screen.tsx'
import { orderDetailScreen } from './order-detail-screen.tsx'
import { quotationsScreen } from './quotations-screen.tsx'
import { salesOrdersScreen } from './sales-orders-screen.tsx'
import { dashboard, labelOf } from './screens.ts'

type AnyRow = Record<string, unknown>
type Translator = ReturnType<ServeContext['translate']>
const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]): Promise<Frame> => ({
  navigation: req.headers['x-ket-navigation'] === 'fragment-v1',
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
  return backendPage(ctx, req, {
    lang,
    title: _(title),
    body: await body(_, await frame(ctx, url, req)),
  })
}
const redirect = (result: unknown, ok: string) =>
  (result as AnyRow).ok ? seeOther(ok) : seeOther(`${ok}${ok.includes('?') ? '&' : '?'}invalid=1`)
const callIfInstalled = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  preferred: string,
  fallback: string,
  input: Record<string, unknown>,
) => ctx.call((await ctx.live(req)).functions[preferred] ? preferred : fallback, input, url, req)
const optional = (form: Record<string, string>, name: string) => (form[name] ? { [name]: form[name] } : {})
const localeSuffix = (url: URL) => {
  const lang = url.searchParams.get('lang')
  return lang ? `?lang=${encodeURIComponent(lang)}` : ''
}
const orderPath = (order: AnyRow, url: URL) =>
  `${['draft', 'sent'].includes(String(order.state)) ? '/admin/sales/quotations' : '/admin/sales/orders'}/${String(order.id)}${localeSuffix(url)}`
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
    options: choices(d.partners, true),
    required: true,
  },
  { name: 'clientOrderRef', label: _('sale_backend.field.clientOrderRef') },
  {
    name: 'warehouseId',
    label: _('sale_backend.field.warehouse'),
    type: 'select',
    options: choices(d.warehouses, true),
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
    const partial = req.headers['x-ket-partial'] === 'sale-order'
    let savedPartial = false
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
        result = await callIfInstalled(ctx, url, req, 'loyalty_sale.confirmOrder', 'sale.confirmOrder', {
          id: params.id,
        })
      else if (form.action === 'sync')
        result = await ctx.call('sale.syncDeliveries', { id: params.id }, url, req)
      else if (form.action === 'lock' || form.action === 'unlock')
        result = await ctx.call('sale.lockOrder', { id: params.id, locked: form.action === 'lock' }, url, req)
      else if (form.action === 'cancel')
        result = await callIfInstalled(ctx, url, req, 'loyalty_sale.cancelOrder', 'sale.cancelOrder', {
          id: params.id,
        })
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
      if (!(result as AnyRow).ok) {
        if (partial)
          return json(
            {
              ok: false,
              message: ctx.translate(ctx.localeOf(url, req))('sale_backend.error.invalid'),
              errors: errorsOf(result),
            },
            { status: 422 },
          )
        return redirect(result, `${url.pathname}${url.search}`)
      }
      if (!partial) {
        const current = (await ctx.call('sale.getOrder', { id: params.id }, url, req)) as AnyRow | null
        return current ? seeOther(orderPath(current, url)) : text('not found', { status: 404 })
      }
      savedPartial = true
    }
    if (req.method !== 'GET' && !savedPartial) return text('GET or POST', { status: 405 })
    const lang = ctx.localeOf(url, req),
      _ = ctx.translate(lang),
      [order, d] = await Promise.all([
        ctx.call('sale.getOrder', { id: params.id }, url, req) as Promise<AnyRow | null>,
        common(ctx, url, req),
      ])
    if (!order) return text('not found', { status: 404 })
    const customer = d.partners.find((r) => r.id === order.partnerId),
      warehouse = d.warehouses.find((r) => r.id === order.warehouseId),
      pricelist = d.pricelists.find((r) => r.id === order.pricelistId),
      paymentTerm = d.terms.find((r) => r.id === order.paymentTermId),
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
    const integration = await ctx.joint(url, req, 'sale_backend:order.loyalty', {
      orderId: params.id,
      locale: localeSuffix(url),
    })
    const canonical = orderPath(order, url)
    const body = orderDetailScreen(
      _,
      {
        order: {
          ...order,
          partnerName: customer?.name,
          warehouseName: warehouse?.name,
          pricelistName: pricelist?.name,
          paymentTermName: paymentTerm?.name,
        },
        action: canonical,
        lineFields,
        invoiceFields,
        integration,
        locale: localeSuffix(url),
        collaboration: savedPartial
          ? ''
          : await ctx.joint(url, req, 'sale_backend:order.collaboration', {
              resModel: 'sale.Order',
              resId: String(order.id),
              lang,
            }),
        editor: savedPartial
          ? ''
          : await ctx.joint(url, req, 'sale_backend:order.editor', {
              identity: `order:${String(order.id)}`,
              orderId: String(order.id),
              lang,
            }),
        errors: url.searchParams.get('invalid') === '1' ? [_('sale_backend.error.invalid')] : undefined,
      },
      savedPartial ? {} : await frame(ctx, url, req),
      savedPartial,
    )
    if (savedPartial)
      return withHeaders(fragment(body, { type: NAVIGATION_TYPE }), {
        vary: 'X-Ket-Partial',
        'x-ket-location': canonical,
      })
    return backendPage(ctx, req, { lang, title: String(order.name), body })
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
  'quotation.kicker': 'Báo giá khách hàng',
  'quotation.title': 'Báo giá',
  'quotation.subtitle': 'Soạn, gửi và theo dõi báo giá trước khi xác nhận thành đơn bán hàng.',
  'quotation.summary.total': 'Tổng báo giá',
  'quotation.summary.draft': 'Bản nháp',
  'quotation.summary.sent': 'Đã gửi',
  'quotation.create.title': 'Tạo báo giá',
  'quotation.create.hint': 'Chọn khách hàng, kho giao hàng và các điều kiện thương mại.',
  'quotation.list.title': 'Báo giá hiện có',
  'quotation.list.hint': 'Mở một báo giá để thêm sản phẩm, gửi hoặc xác nhận đơn hàng.',
  'quotation.empty': 'Chưa có báo giá',
  'quotation.emptyHint': 'Tạo báo giá đầu tiên để bắt đầu quy trình bán hàng.',
  'error.invalid': 'Dữ liệu chưa hợp lệ. Kiểm tra các trường bắt buộc và thử lại.',
  'orders.title': 'Đơn bán hàng',
  'orderList.kicker': 'Vận hành bán hàng',
  'orderList.title': 'Đơn bán hàng',
  'orderList.subtitle': 'Theo dõi đơn đã xác nhận, trạng thái lập hoá đơn và tổng giá trị.',
  'orderList.summary.total': 'Tổng đơn bán',
  'orderList.summary.toInvoice': 'Chờ lập hoá đơn',
  'orderList.summary.invoiced': 'Đã lập đủ',
  'orderList.summary.locked': 'Đã khoá',
  'orderList.records.title': 'Đơn bán đã xác nhận',
  'orderList.records.hint': 'Mở một đơn để đồng bộ giao hàng, khoá đơn hoặc tạo hoá đơn.',
  'orderList.empty': 'Chưa có đơn bán hàng',
  'orderList.emptyHint': 'Xác nhận một báo giá để tạo đơn bán hàng đầu tiên.',
  'detail.title': 'Chi tiết đơn bán',
  'order.kicker': 'Đơn bán hàng',
  'order.locked': 'Đã khoá',
  'order.unlocked': 'Đang mở',
  'order.actions.label': 'Hành động trên báo giá hoặc đơn bán',
  'order.information.title': 'Thông tin đơn hàng',
  'order.information.hint': 'Khách hàng, thời hạn và điều kiện thương mại của đơn.',
  'order.collaboration.label': 'Trao đổi và hoạt động của đơn bán',
  'policies.title': 'Chính sách lập hoá đơn',
  'policy.kicker': 'Cấu hình bán hàng',
  'policy.subtitle': 'Chọn thời điểm số lượng sản phẩm đủ điều kiện để lập hoá đơn.',
  'policy.summary.total': 'Sản phẩm có thể bán',
  'policy.summary.order': 'Theo số lượng đặt',
  'policy.summary.delivery': 'Theo số lượng giao',
  'policy.edit.title': 'Cập nhật chính sách',
  'policy.edit.hint': 'Theo Odoo 19, chính sách được lưu trên từng mẫu sản phẩm.',
  'policy.products.title': 'Chính sách theo sản phẩm',
  'policy.products.hint':
    'Số lượng đặt cho phép lập hoá đơn ngay; số lượng giao chỉ cho phép sau khi giao hàng.',
  'policy.empty': 'Chưa có sản phẩm có thể bán',
  'policy.emptyHint': 'Bật Có thể bán trên một sản phẩm để cấu hình chính sách lập hoá đơn.',
  'lines.title': 'Dòng sản phẩm',
  'lines.hint': 'Số lượng, giao hàng, lập hoá đơn và thành tiền theo từng sản phẩm.',
  'lines.add': 'Thêm sản phẩm',
  'lines.addHint': 'Chọn biến thể, đơn vị tính, số lượng và điều kiện giá bán.',
  'lines.empty': 'Chưa có dòng sản phẩm',
  'lines.emptyHint': 'Thêm sản phẩm đầu tiên trước khi xác nhận báo giá.',
  'invoice.title': 'Tạo hoá đơn khách hàng',
  'invoice.hint': 'Tạo hoá đơn cho số lượng hiện đang đủ điều kiện lập hoá đơn.',
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
  'field.locked': 'Khoá đơn',
  'field.amountUntaxed': 'Chưa thuế',
  'field.amountTax': 'Thuế',
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
  'quotation.kicker': 'Customer quotations',
  'quotation.title': 'Quotations',
  'quotation.subtitle': 'Draft, send and track quotations before confirming a sales order.',
  'quotation.summary.total': 'Total quotations',
  'quotation.summary.draft': 'Draft',
  'quotation.summary.sent': 'Sent',
  'quotation.create.title': 'Create quotation',
  'quotation.create.hint': 'Choose the customer, delivery warehouse and commercial terms.',
  'quotation.list.title': 'Current quotations',
  'quotation.list.hint': 'Open a quotation to add products, send it or confirm the sales order.',
  'quotation.empty': 'No quotations yet',
  'quotation.emptyHint': 'Create the first quotation to start the sales flow.',
  'error.invalid': 'The form is invalid. Check the required fields and try again.',
  'orders.title': 'Sales Orders',
  'orderList.kicker': 'Sales operations',
  'orderList.title': 'Sales Orders',
  'orderList.subtitle': 'Track confirmed orders, invoicing status and total value.',
  'orderList.summary.total': 'Total sales orders',
  'orderList.summary.toInvoice': 'To invoice',
  'orderList.summary.invoiced': 'Fully invoiced',
  'orderList.summary.locked': 'Locked',
  'orderList.records.title': 'Confirmed sales orders',
  'orderList.records.hint': 'Open an order to sync deliveries, lock it or create an invoice.',
  'orderList.empty': 'No sales orders yet',
  'orderList.emptyHint': 'Confirm a quotation to create the first sales order.',
  'detail.title': 'Sales Order Detail',
  'order.kicker': 'Sales order',
  'order.locked': 'Locked',
  'order.unlocked': 'Open',
  'order.actions.label': 'Quotation or sales order actions',
  'order.information.title': 'Order information',
  'order.information.hint': 'Customer, deadline and commercial terms for this order.',
  'order.collaboration.label': 'Sales order conversation and activities',
  'policies.title': 'Invoicing Policies',
  'policy.kicker': 'Sales configuration',
  'policy.subtitle': 'Choose when product quantities become eligible for invoicing.',
  'policy.summary.total': 'Sellable products',
  'policy.summary.order': 'Ordered quantities',
  'policy.summary.delivery': 'Delivered quantities',
  'policy.edit.title': 'Update a policy',
  'policy.edit.hint': 'As in Odoo 19, the policy is stored on each product template.',
  'policy.products.title': 'Policies by product',
  'policy.products.hint':
    'Ordered quantities invoice immediately; delivered quantities invoice only after delivery.',
  'policy.empty': 'No sellable products yet',
  'policy.emptyHint': 'Enable Can be sold on a product before configuring its invoicing policy.',
  'lines.title': 'Order Lines',
  'lines.hint': 'Ordered, delivered and invoiced quantities with each product subtotal.',
  'lines.add': 'Add a product',
  'lines.addHint': 'Choose a variant, unit, quantity and selling terms.',
  'lines.empty': 'No order lines yet',
  'lines.emptyHint': 'Add the first product before confirming the quotation.',
  'invoice.title': 'Create Customer Invoice',
  'invoice.hint': 'Create an invoice for the quantities currently eligible for invoicing.',
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
  'field.locked': 'Locked',
  'field.amountUntaxed': 'Untaxed Amount',
  'field.amountTax': 'Taxes',
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
  assets: new URL('./client/', import.meta.url),
  islands,
  joints: {
    'order.loyalty': { props: { orderId: 'id', locale: 'text?' } },
    'order.collaboration': {
      props: { resModel: 'text', resId: 'id', lang: 'text' },
      multiple: true,
    },
    'order.editor': { props: { identity: 'text', orderId: 'id', lang: 'text?' } },
  },
  title: 'Bán hàng trong quản trị',
  summary: 'Báo giá, đơn bán, giao hàng và hoá đơn khách hàng.',
  category: 'Hệ thống',
  menus: {
    sale: { label: 'menu.app', icon: 'shopping-bag', sequence: 20 },
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
              dashboard(
                _,
                (await ctx.call('sale.listOrders', {}, url, req)) as AnyRow[],
                shell,
                localeSuffix(url),
              ),
            )
          : text('GET', { status: 405 }),
    '/admin/sales/quotations':
      (ctx): Route =>
      async (url, req) => {
        const detailSuffix = url.searchParams.get('lang')
          ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}`
          : ''
        const quotationPath = `/admin/sales/quotations${detailSuffix}`
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
          return redirect(result, quotationPath)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const [rows, d] = await Promise.all([
            ctx.call('sale.listOrders', {}, url, req) as Promise<AnyRow[]>,
            common(ctx, url, req),
          ]),
          state = url.searchParams.get('state'),
          names = new Map(d.partners.map((r) => [String(r.id), r.name]))
        return document(ctx, url, req, 'sale_backend.quotations.title', (_, shell) =>
          quotationsScreen(_, {
            frame: shell,
            fields: orderFields(_, d),
            rows: rows
              .filter((r) => ['draft', 'sent'].includes(String(r.state)) && (!state || r.state === state))
              .map((r) => ({ ...r, partnerName: names.get(String(r.partnerId)) })),
            action: quotationPath,
            detailSuffix,
            errors: url.searchParams.get('invalid') === '1' ? [_('sale_backend.error.invalid')] : undefined,
          }),
        )
      },
    '/admin/sales/orders':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const detailSuffix = localeSuffix(url)
        const [rows, d] = await Promise.all([
            ctx.call('sale.listOrders', { state: 'sale' }, url, req) as Promise<AnyRow[]>,
            common(ctx, url, req),
          ]),
          names = new Map(d.partners.map((r) => [String(r.id), r.name]))
        return document(ctx, url, req, 'sale_backend.orders.title', (_, shell) =>
          salesOrdersScreen(_, {
            frame: shell,
            rows: rows.map((r) => ({ ...r, partnerName: names.get(String(r.partnerId)) })),
            detailSuffix,
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
          const target = `/admin/sales/invoicing-policies${localeSuffix(url)}`
          return redirect(
            await ctx.call(
              'sale.setInvoicePolicy',
              { templateId: form.templateId ?? '', invoicePolicy: form.invoicePolicy ?? '' },
              url,
              req,
            ),
            target,
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const rows = (await ctx.call('sale.listInvoicePolicies', {}, url, req)) as AnyRow[],
          _ = ctx.translate(ctx.localeOf(url, req))
        return document(ctx, url, req, 'sale_backend.policies.title', (_, shell) =>
          invoicingPoliciesScreen(_, {
            frame: shell,
            action: `/admin/sales/invoicing-policies${localeSuffix(url)}`,
            errors: url.searchParams.get('invalid') === '1' ? [_('sale_backend.error.invalid')] : undefined,
            fields: [
              {
                name: 'templateId',
                label: _('sale_backend.field.product'),
                type: 'select',
                options: choices(rows),
                required: true,
              },
              {
                name: 'invoicePolicy',
                label: _('sale_backend.field.invoicePolicy'),
                type: 'radio',
                options: INVOICE_POLICIES.map((v) => ({ value: v, label: labelOf(_, 'invoicePolicy', v) })),
                required: true,
              },
            ],
            rows,
          }),
        )
      },
  },
  messages: { vi, en },
  fills: {
    'sale_backend:order.editor': `{% island "sale.editor" %}`,
  },
})
