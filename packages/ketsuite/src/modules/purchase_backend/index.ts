import { randomUUID } from 'node:crypto'
import { defineModule, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { FormField, Frame } from '../../ui/index.ts'
import { actionGroup, backendPage, linkButton } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import { partnerRelationControl } from '../partner_backend/relation-control.ts'
import { PURCHASE_METHODS } from '../purchase/functions.ts'
import { dashboard, labelOf, orderDetail, ordersScreen, supplierInfoScreen } from './screens.tsx'

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
  (result as { ok?: boolean }).ok ? seeOther(ok) : seeOther(`${ok}${ok.includes('?') ? '&' : '?'}invalid=1`)
const optional = (form: Record<string, string>, name: string) => (form[name] ? { [name]: form[name] } : {})
const localeSuffix = (url: URL) => {
  const lang = url.searchParams.get('lang')
  return lang ? `?lang=${encodeURIComponent(lang)}` : ''
}
const choices = (rows: AnyRow[], empty = false) => [
  ...(empty ? [{ value: '', label: '—' }] : []),
  ...rows.map((row) => ({
    value: String(row.id),
    label: `${String(row.code ?? '')}${row.code ? ' · ' : ''}${String(row.name)}`,
  })),
]

const common = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const [partners, companies, templates, units, pickingTypes, taxes, journals, accounts] = await Promise.all([
    ctx.call('partner.listPartners', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('company.listCompanies', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('product.listTemplates', { withVariants: true }, url, req) as Promise<AnyRow[]>,
    ctx.call('uom.listUnits', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('stock.listPickingTypes', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('account.listTaxes', { typeTaxUse: 'purchase' }, url, req) as Promise<AnyRow[]>,
    ctx.call('account.listJournals', { type: 'purchase' }, url, req) as Promise<AnyRow[]>,
    ctx.call('account.listAccounts', {}, url, req) as Promise<AnyRow[]>,
  ])
  const own = new Set(companies.map((row) => row.partnerId))
  const purchasable = templates.filter((row) => row.purchaseOk)
  const variants: AnyRow[] = purchasable.flatMap((template) =>
    ((template.variants as AnyRow[] | undefined) ?? []).map(
      (variant): AnyRow => ({ ...variant, templateName: template.name, templateId: template.id }),
    ),
  )
  return {
    companies,
    partners: partners.filter((row) => !own.has(row.id)),
    excludedPartnerIds: [...own].map(String),
    templates: purchasable,
    variants,
    units,
    pickingTypes: pickingTypes.filter((row) => row.code === 'incoming'),
    taxes,
    journals,
    accounts,
  }
}

const orderFields = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  _: Translator,
  data: Awaited<ReturnType<typeof common>>,
): Promise<FormField[]> => [
  {
    name: 'partnerId',
    label: _('purchase_backend.field.vendor'),
    type: 'select',
    control: await partnerRelationControl(ctx, url, req, _, {
      id: 'purchase-vendor',
      partners: data.partners as Array<{ id: string; name: string; ref?: string | null }>,
      fieldLabel: _('purchase_backend.field.vendor'),
      title: _('purchase_backend.relation.vendors'),
      required: true,
      excludeIds: data.excludedPartnerIds,
    }),
    options: choices(data.partners),
    required: true,
  },
  { name: 'partnerRef', label: _('purchase_backend.field.partnerRef'), required: true },
  {
    name: 'pickingTypeId',
    label: _('purchase_backend.field.pickingType'),
    type: 'select',
    options: choices(data.pickingTypes),
    required: true,
  },
  { name: 'dateOrder', label: _('purchase_backend.field.dateOrder'), type: 'date' },
  { name: 'datePlanned', label: _('purchase_backend.field.datePlanned'), type: 'date' },
  { name: 'notes', label: _('purchase_backend.field.notes'), type: 'textarea', span: 'full' },
]

const detailHandler =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    const path = `${url.pathname}${url.search}`
    if (req.method === 'POST') {
      const form = await readForm(req)
      let result: unknown
      if (form.action === 'add-line')
        result = await ctx.call(
          'purchase.addLine',
          {
            id: randomUUID(),
            orderId: params.id,
            productId: form.productId ?? '',
            productQty: form.productQty || '1',
            productUomId: form.productUomId ?? '',
            ...optional(form, 'priceUnit'),
            ...optional(form, 'discount'),
            ...optional(form, 'taxId'),
            ...optional(form, 'datePlanned'),
          },
          url,
          req,
        )
      else if (form.action === 'send')
        result = await ctx.call('purchase.sendRfq', { id: params.id }, url, req)
      else if (form.action === 'confirm')
        result = await ctx.call('purchase.confirmOrder', { id: params.id }, url, req)
      else if (form.action === 'request-approval')
        result = await ctx.call('purchase.confirmOrder', { id: params.id, requiresApproval: true }, url, req)
      else if (form.action === 'approve')
        result = await ctx.call('purchase.approveOrder', { id: params.id }, url, req)
      else if (form.action === 'sync')
        result = await ctx.call('purchase.syncReceipts', { id: params.id }, url, req)
      else if (form.action === 'lock' || form.action === 'unlock')
        result = await ctx.call(
          'purchase.lockOrder',
          { id: params.id, locked: form.action === 'lock' },
          url,
          req,
        )
      else if (form.action === 'cancel')
        result = await ctx.call('purchase.cancelOrder', { id: params.id }, url, req)
      else if (form.action === 'bill')
        result = await ctx.call(
          'purchase.createVendorBill',
          {
            id: randomUUID(),
            orderId: params.id,
            journalId: form.journalId ?? '',
            expenseAccountId: form.expenseAccountId ?? '',
            payableAccountId: form.payableAccountId ?? '',
            ...optional(form, 'taxAccountId'),
            ...optional(form, 'invoiceDate'),
          },
          url,
          req,
        )
      else return text('unknown action', { status: 400 })
      if ((result as AnyRow).ok && (result as AnyRow).state === 'purchase')
        return seeOther(`/admin/purchase/orders/${params.id}${url.search}`)
      return redirect(result, path)
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    const _ = ctx.translate(ctx.localeOf(url, req))
    const [order, data] = await Promise.all([
      ctx.call('purchase.getOrder', { id: params.id }, url, req) as Promise<AnyRow | null>,
      common(ctx, url, req),
    ])
    if (!order) return text('not found', { status: 404 })
    const vendor = data.partners.find((row) => row.id === order.partnerId)
    const variants = data.variants.map((row) => ({
      value: String(row.id),
      label: `${String(row.templateName)}${row.defaultCode ? ` · ${String(row.defaultCode)}` : ''}`,
    }))
    const lineFields: FormField[] = [
      {
        name: 'productId',
        label: _('purchase_backend.field.product'),
        type: 'select',
        options: variants,
        required: true,
      },
      {
        name: 'productQty',
        label: _('purchase_backend.field.productQty'),
        type: 'decimal',
        value: 1,
        required: true,
      },
      {
        name: 'productUomId',
        label: _('purchase_backend.field.uom'),
        type: 'select',
        options: choices(data.units),
        required: true,
      },
      {
        name: 'priceUnit',
        label: _('purchase_backend.field.priceUnit'),
        type: 'decimal',
        help: _('purchase_backend.help.vendorPrice'),
      },
      { name: 'discount', label: _('purchase_backend.field.discount'), type: 'decimal' },
      {
        name: 'taxId',
        label: _('purchase_backend.field.tax'),
        type: 'select',
        options: choices(data.taxes, true),
      },
      { name: 'datePlanned', label: _('purchase_backend.field.datePlanned'), type: 'date' },
    ]
    const expenses = data.accounts.filter((row) => String(row.accountType).startsWith('expense'))
    const payable = data.accounts.filter((row) => row.accountType === 'liability_payable')
    const billFields: FormField[] = [
      {
        name: 'journalId',
        label: _('purchase_backend.field.journal'),
        type: 'select',
        options: choices(data.journals),
        required: true,
      },
      {
        name: 'expenseAccountId',
        label: _('purchase_backend.field.expenseAccount'),
        type: 'select',
        options: choices(expenses),
        required: true,
      },
      {
        name: 'payableAccountId',
        label: _('purchase_backend.field.payableAccount'),
        type: 'select',
        options: choices(payable),
        required: true,
      },
      {
        name: 'taxAccountId',
        label: _('purchase_backend.field.taxAccount'),
        type: 'select',
        options: choices(data.accounts, true),
      },
      { name: 'invoiceDate', label: _('purchase_backend.field.invoiceDate'), type: 'date' },
    ]
    const reportId = ['draft', 'sent', 'to approve'].includes(String(order.state))
      ? 'purchase.rfq'
      : ['purchase', 'done'].includes(String(order.state))
        ? 'purchase.purchaseOrder'
        : null
    const printable = (await ctx.reportsOf(url, req, 'purchase.Order')).filter(
      (report) => report.id === reportId,
    )
    return document(ctx, url, req, 'purchase_backend.detail.title', (_, shell) =>
      orderDetail(_, {
        frame: shell,
        order: { ...order, partnerName: vendor?.name },
        actionPath: path,
        lineFields,
        billFields,
        printActions: printable.length
          ? actionGroup({
              label: 'Print',
              actions: printable.map((report) =>
                linkButton({
                  label: _(report.title),
                  href: `/reports/${encodeURIComponent(report.id)}/${encodeURIComponent(String(order.id))}${url.search}`,
                }),
              ),
            })
          : undefined,
      }),
    )
  }

const vi = {
  'app.title': 'Mua hàng trong quản trị',
  'app.summary': 'RFQ, đơn mua, nhập hàng và hoá đơn nhà cung cấp.',
  'app.category': 'Hệ thống',
  'menu.app': 'Mua hàng',
  'menu.ordersGroup': 'Đơn hàng',
  'menu.dashboard': 'Tổng quan',
  'menu.rfqs': 'Yêu cầu báo giá',
  'menu.orders': 'Đơn mua hàng',
  'menu.products': 'Sản phẩm',
  'menu.vendorPricelists': 'Bảng giá nhà cung cấp',
  'dashboard.title': 'Tổng quan mua hàng',
  'dashboard.toSend': 'Cần gửi',
  'dashboard.waiting': 'Đang chờ',
  'dashboard.toApprove': 'Chờ duyệt',
  'dashboard.toBill': 'Chờ lập hoá đơn',
  'dashboard.records': 'Bản ghi',
  'rfqs.title': 'Yêu cầu báo giá',
  'orders.title': 'Đơn mua hàng',
  'detail.title': 'Chi tiết đơn mua',
  'pricelists.title': 'Bảng giá nhà cung cấp',
  'method.title': 'Chính sách lập hoá đơn sản phẩm',
  'lines.title': 'Dòng sản phẩm',
  'lines.add': 'Thêm sản phẩm',
  'bill.title': 'Tạo hoá đơn nhà cung cấp',
  'receipts.title': 'Phiếu nhập',
  'bills.title': 'Hoá đơn nhà cung cấp',
  empty: 'Chưa có dữ liệu.',
  emptyHint: 'Tạo bản ghi đầu tiên để bắt đầu.',
  'action.createRfq': 'Tạo yêu cầu báo giá',
  'action.addLine': 'Thêm dòng',
  'action.send': 'Đánh dấu đã gửi',
  'action.confirm': 'Xác nhận đơn',
  'action.requestApproval': 'Gửi duyệt',
  'action.approve': 'Phê duyệt',
  'action.syncReceipts': 'Đồng bộ nhập hàng',
  'action.lock': 'Khoá đơn',
  'action.unlock': 'Mở khoá',
  'action.cancel': 'Huỷ',
  'action.createBill': 'Tạo hoá đơn',
  'action.addVendorPrice': 'Thêm giá nhà cung cấp',
  'action.saveMethod': 'Lưu chính sách',
  'field.name': 'Số đơn',
  'field.vendor': 'Nhà cung cấp',
  'relation.vendors': 'Quản lý nhà cung cấp',
  'field.partnerRef': 'Tham chiếu nhà cung cấp',
  'field.state': 'Trạng thái',
  'field.dateOrder': 'Ngày đặt hàng',
  'field.datePlanned': 'Ngày dự kiến nhận',
  'field.pickingType': 'Nhập vào',
  'field.invoiceStatus': 'Trạng thái lập hoá đơn',
  'field.amountTotal': 'Tổng tiền',
  'field.notes': 'Điều khoản và ghi chú',
  'field.product': 'Sản phẩm',
  'field.productQty': 'Số lượng đặt',
  'field.qtyReceived': 'Đã nhận',
  'field.qtyInvoiced': 'Đã lập hoá đơn',
  'field.uom': 'Đơn vị tính',
  'field.priceUnit': 'Đơn giá',
  'field.discount': 'Chiết khấu',
  'field.tax': 'Thuế mua hàng',
  'field.subtotal': 'Thành tiền',
  'field.minQty': 'Số lượng tối thiểu',
  'field.delay': 'Thời gian giao (ngày)',
  'field.template': 'Mẫu sản phẩm',
  'field.variant': 'Biến thể',
  'field.purchaseMethod': 'Cơ sở lập hoá đơn',
  'field.journal': 'Sổ nhật ký mua hàng',
  'field.expenseAccount': 'Tài khoản chi phí',
  'field.payableAccount': 'Tài khoản phải trả',
  'field.taxAccount': 'Tài khoản thuế',
  'field.invoiceDate': 'Ngày hoá đơn',
  'field.productCode': 'Mã sản phẩm của nhà cung cấp',
  'field.productName': 'Tên sản phẩm của nhà cung cấp',
  'field.sequence': 'Thứ tự ưu tiên',
  'field.dateStart': 'Ngày bắt đầu',
  'field.dateEnd': 'Ngày kết thúc',
  'help.vendorPrice': 'Để trống để dùng bảng giá nhà cung cấp.',
  'state.draft': 'RFQ',
  'state.sent': 'RFQ đã gửi',
  'state.to approve': 'Chờ duyệt',
  'state.purchase': 'Đơn mua hàng',
  'state.cancel': 'Đã huỷ',
  'invoiceStatus.no': 'Chưa cần lập hoá đơn',
  'invoiceStatus.to invoice': 'Chờ lập hoá đơn',
  'invoiceStatus.invoiced': 'Đã lập đủ',
  'purchaseMethod.purchase': 'Theo số lượng đặt',
  'purchaseMethod.receive': 'Theo số lượng nhận',
}
const en = {
  'app.title': 'Purchase administration',
  'app.summary': 'RFQs, purchase orders, receipts, and vendor bills.',
  'app.category': 'System',
  'menu.app': 'Purchase',
  'menu.ordersGroup': 'Orders',
  'menu.dashboard': 'Overview',
  'menu.rfqs': 'Requests for Quotation',
  'menu.orders': 'Purchase Orders',
  'menu.products': 'Products',
  'menu.vendorPricelists': 'Vendor Pricelists',
  'dashboard.title': 'Purchase Overview',
  'dashboard.toSend': 'To Send',
  'dashboard.waiting': 'Waiting',
  'dashboard.toApprove': 'To Approve',
  'dashboard.toBill': 'Waiting Bills',
  'dashboard.records': 'Records',
  'rfqs.title': 'Requests for Quotation',
  'orders.title': 'Purchase Orders',
  'detail.title': 'Purchase Order Detail',
  'pricelists.title': 'Vendor Pricelists',
  'method.title': 'Product billing policy',
  'lines.title': 'Products',
  'lines.add': 'Add a product',
  'bill.title': 'Create Vendor Bill',
  'receipts.title': 'Receipts',
  'bills.title': 'Vendor Bills',
  empty: 'No data yet.',
  emptyHint: 'Create the first record to get started.',
  'action.createRfq': 'Create RFQ',
  'action.addLine': 'Add line',
  'action.send': 'Mark as Sent',
  'action.confirm': 'Confirm Order',
  'action.requestApproval': 'Request Approval',
  'action.approve': 'Approve',
  'action.syncReceipts': 'Sync Receipts',
  'action.lock': 'Lock',
  'action.unlock': 'Unlock',
  'action.cancel': 'Cancel',
  'action.createBill': 'Create Bill',
  'action.addVendorPrice': 'Add Vendor Price',
  'action.saveMethod': 'Save Policy',
  'field.name': 'Order Reference',
  'field.vendor': 'Vendor',
  'relation.vendors': 'Manage vendors',
  'field.partnerRef': 'Vendor Reference',
  'field.state': 'Status',
  'field.dateOrder': 'Order Deadline',
  'field.datePlanned': 'Expected Arrival',
  'field.pickingType': 'Deliver to',
  'field.invoiceStatus': 'Billing Status',
  'field.amountTotal': 'Total',
  'field.notes': 'Terms and Conditions',
  'field.product': 'Product',
  'field.productQty': 'Ordered',
  'field.qtyReceived': 'Received',
  'field.qtyInvoiced': 'Billed',
  'field.uom': 'Unit',
  'field.priceUnit': 'Unit Price',
  'field.discount': 'Discount',
  'field.tax': 'Purchase Tax',
  'field.subtotal': 'Subtotal',
  'field.minQty': 'Minimum Quantity',
  'field.delay': 'Delivery Lead Time',
  'field.template': 'Product Template',
  'field.variant': 'Variant',
  'field.purchaseMethod': 'Control Policy',
  'field.journal': 'Purchase Journal',
  'field.expenseAccount': 'Expense Account',
  'field.payableAccount': 'Payable Account',
  'field.taxAccount': 'Tax Account',
  'field.invoiceDate': 'Bill Date',
  'field.productCode': 'Vendor Product Code',
  'field.productName': 'Vendor Product Name',
  'field.sequence': 'Priority',
  'field.dateStart': 'Start Date',
  'field.dateEnd': 'End Date',
  'help.vendorPrice': 'Leave blank to use the vendor pricelist.',
  'state.draft': 'RFQ',
  'state.sent': 'RFQ Sent',
  'state.to approve': 'To Approve',
  'state.purchase': 'Purchase Order',
  'state.cancel': 'Cancelled',
  'invoiceStatus.no': 'Nothing to Bill',
  'invoiceStatus.to invoice': 'Waiting Bills',
  'invoiceStatus.invoiced': 'Fully Billed',
  'purchaseMethod.purchase': 'On ordered quantities',
  'purchaseMethod.receive': 'On received quantities',
}

export default defineModule({
  name: 'purchase_backend',
  version: '0.1.0',
  depends: ['purchase', 'backend', 'partner_backend'],
  install: 'auto',
  app: true,
  title: 'Mua hàng trong quản trị',
  summary: 'RFQ, đơn mua, nhập hàng và hoá đơn nhà cung cấp.',
  category: 'Hệ thống',
  menus: {
    purchase: { label: 'menu.app', icon: 'shopping-cart', sequence: 25 },
    'purchase.dashboard': {
      parent: 'purchase',
      label: 'menu.dashboard',
      path: '/admin/purchase',
      sequence: 1,
      needs: 'purchase.listOrders',
    },
    'purchase.ordersGroup': { parent: 'purchase', label: 'menu.ordersGroup', sequence: 10 },
    'purchase.rfqs': {
      parent: 'purchase.ordersGroup',
      label: 'menu.rfqs',
      path: '/admin/purchase/rfqs',
      needs: 'purchase.listOrders',
    },
    'purchase.orders': {
      parent: 'purchase.ordersGroup',
      label: 'menu.orders',
      path: '/admin/purchase/orders',
      needs: 'purchase.listOrders',
    },
    'purchase.products': { parent: 'purchase', label: 'menu.products', sequence: 20 },
    'purchase.vendorPricelists': {
      parent: 'purchase.products',
      label: 'menu.vendorPricelists',
      path: '/admin/purchase/vendor-pricelists',
      needs: 'purchase.listSupplierInfo',
    },
  },
  routes: {
    '/admin/purchase':
      (ctx): Route =>
      async (url, req) =>
        req.method === 'GET'
          ? document(ctx, url, req, 'purchase_backend.dashboard.title', async (_, shell) =>
              dashboard(
                _,
                (await ctx.call('purchase.listOrders', {}, url, req)) as AnyRow[],
                shell,
                localeSuffix(url),
              ),
            )
          : text('GET', { status: 405 }),
    '/admin/purchase/rfqs':
      (ctx): Route =>
      async (url, req) => {
        const rfqPath = `/admin/purchase/rfqs${localeSuffix(url)}`
        if (req.method === 'POST') {
          const form = await readForm(req)
          const result = await ctx.call(
            'purchase.createOrder',
            {
              id: randomUUID(),
              partnerId: form.partnerId ?? '',
              partnerRef: form.partnerRef ?? '',
              pickingTypeId: form.pickingTypeId ?? '',
              ...optional(form, 'dateOrder'),
              ...optional(form, 'datePlanned'),
              ...optional(form, 'notes'),
            },
            url,
            req,
          )
          return redirect(result, rfqPath)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const [orders, data] = await Promise.all([
          ctx.call('purchase.listOrders', {}, url, req) as Promise<AnyRow[]>,
          common(ctx, url, req),
        ])
        const state = url.searchParams.get('state')
        const vendors = new Map(data.partners.map((row) => [String(row.id), row.name]))
        const rows = orders
          .filter(
            (row) =>
              ['draft', 'sent', 'to approve'].includes(String(row.state)) && (!state || row.state === state),
          )
          .map((row) => ({ ...row, partnerName: vendors.get(String(row.partnerId)) }))
        return document(ctx, url, req, 'purchase_backend.rfqs.title', async (_, shell) =>
          ordersScreen(_, {
            title: _('purchase_backend.rfqs.title'),
            frame: shell,
            rows,
            createFields: await orderFields(ctx, url, req, _, data),
            createAction: rfqPath,
          }),
        )
      },
    '/admin/purchase/orders':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const [orders, data] = await Promise.all([
          ctx.call('purchase.listOrders', { state: 'purchase' }, url, req) as Promise<AnyRow[]>,
          common(ctx, url, req),
        ])
        const vendors = new Map(data.partners.map((row) => [String(row.id), row.name]))
        return document(ctx, url, req, 'purchase_backend.orders.title', (_, shell) =>
          ordersScreen(_, {
            title: _('purchase_backend.orders.title'),
            frame: shell,
            rows: orders.map((row) => ({ ...row, partnerName: vendors.get(String(row.partnerId)) })),
          }),
        )
      },
    '/admin/purchase/rfqs/{id}': detailHandler,
    '/admin/purchase/orders/{id}': detailHandler,
    '/admin/purchase/vendor-pricelists':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          const form = await readForm(req)
          const result =
            form.action === 'method'
              ? await ctx.call(
                  'purchase.setPurchaseMethod',
                  { templateId: form.templateId ?? '', purchaseMethod: form.purchaseMethod ?? '' },
                  url,
                  req,
                )
              : await ctx.call(
                  'purchase.saveSupplierInfo',
                  {
                    id: randomUUID(),
                    partnerId: form.partnerId ?? '',
                    productTemplateId: form.productTemplateId ?? '',
                    ...optional(form, 'productId'),
                    productUomId: form.productUomId ?? '',
                    minQty: form.minQty || '0',
                    price: form.price || '0',
                    discount: form.discount || '0',
                    delay: Number(form.delay || 1),
                    sequence: Number(form.sequence || 1),
                    ...optional(form, 'productName'),
                    ...optional(form, 'productCode'),
                    ...optional(form, 'dateStart'),
                    ...optional(form, 'dateEnd'),
                  },
                  url,
                  req,
                )
          return redirect(result, '/admin/purchase/vendor-pricelists')
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const _ = ctx.translate(ctx.localeOf(url, req))
        const [rows, data] = await Promise.all([
          ctx.call('purchase.listSupplierInfo', {}, url, req) as Promise<AnyRow[]>,
          common(ctx, url, req),
        ])
        const vendors = new Map(data.partners.map((row) => [String(row.id), row.name]))
        const templates = new Map(data.templates.map((row) => [String(row.id), row.name]))
        const fields: FormField[] = [
          {
            name: 'partnerId',
            label: _('purchase_backend.field.vendor'),
            type: 'select',
            options: choices(data.partners),
            required: true,
          },
          {
            name: 'productTemplateId',
            label: _('purchase_backend.field.template'),
            type: 'select',
            options: choices(data.templates),
            required: true,
          },
          {
            name: 'productId',
            label: _('purchase_backend.field.variant'),
            type: 'select',
            options: [
              { value: '', label: '—' },
              ...data.variants.map((row) => ({
                value: String(row.id),
                label: `${String(row.templateName)}${row.defaultCode ? ` · ${String(row.defaultCode)}` : ''}`,
              })),
            ],
          },
          {
            name: 'productUomId',
            label: _('purchase_backend.field.uom'),
            type: 'select',
            options: choices(data.units),
            required: true,
          },
          { name: 'minQty', label: _('purchase_backend.field.minQty'), type: 'decimal', value: 0 },
          {
            name: 'price',
            label: _('purchase_backend.field.priceUnit'),
            type: 'decimal',
            value: 0,
            required: true,
          },
          { name: 'discount', label: _('purchase_backend.field.discount'), type: 'decimal', value: 0 },
          { name: 'delay', label: _('purchase_backend.field.delay'), type: 'number', value: 1 },
          { name: 'productCode', label: _('purchase_backend.field.productCode') },
          { name: 'productName', label: _('purchase_backend.field.productName') },
          { name: 'sequence', label: _('purchase_backend.field.sequence'), type: 'number', value: 1 },
          { name: 'dateStart', label: _('purchase_backend.field.dateStart'), type: 'date' },
          { name: 'dateEnd', label: _('purchase_backend.field.dateEnd'), type: 'date' },
        ]
        const methodFields: FormField[] = [
          {
            name: 'templateId',
            label: _('purchase_backend.field.template'),
            type: 'select',
            options: choices(data.templates),
            required: true,
          },
          {
            name: 'purchaseMethod',
            label: _('purchase_backend.field.purchaseMethod'),
            type: 'select',
            options: PURCHASE_METHODS.map((value) => ({ value, label: labelOf(_, 'purchaseMethod', value) })),
          },
        ]
        return document(ctx, url, req, 'purchase_backend.pricelists.title', (_, shell) =>
          supplierInfoScreen(_, {
            frame: shell,
            currency: data.companies.find((company) => company.id === shell.viewer?.company)?.currency,
            fields,
            methodFields,
            rows: rows.map((row) => ({
              ...row,
              partnerName: vendors.get(String(row.partnerId)),
              productNameDisplay: templates.get(String(row.productTemplateId)),
            })),
          }),
        )
      },
  },
  messages: { vi, en },
})
