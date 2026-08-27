import { randomUUID } from 'node:crypto'
import { defineModule, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { FormField } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { partnerRelationControl } from '../partner_backend/relation-control.ts'
import { accountOptions, accountRelationControl } from '../account_backend/relation-control.ts'
import { templateRelationControl, variantRelationControl } from '../product_backend/relation-control.ts'
import { PURCHASE_METHODS } from '../purchase/functions.ts'
import {
  labelOf,
  purchaseOrderDetailScreen,
  purchaseOrdersListScreen,
  purchaseOverviewScreen,
  rfqCreateScreen,
  rfqsListScreen,
  vendorPricelistCreateScreen,
  vendorPricelistsListScreen,
} from './screens/index.ts'
import { adminPage, choices, inLocale, localeQuery, optional, printGroup } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import { PAGE_SIZE, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'

const crossSite = (req: Parameters<Route>[1]): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

/**
 * A cross-origin POST carries the signed-in user's session cookie without their
 * intent, and every write behind these routes acts on money, stock or customer
 * records. Refused the way user_backend, company_backend, oauth_backend,
 * product_backend and stock_backend already refuse it.
 */

type Translator = ReturnType<ServeContext['translate']>

/**
 * Carry the first rejected field back to the screen. The old redirect set
 * `invalid=1`, which nothing read, so every refused action — a missing vendor, a
 * unit that does not fit the product, a bill with nothing left to bill — landed
 * on an unchanged page with no message at all.
 */
const redirect = (result: unknown, ok: string, rejected = ok) => {
  const held = result as { ok?: boolean; errors?: Array<{ field?: string }> }
  if (held.ok) return seeOther(ok)
  const field = held.errors?.[0]?.field
  const query = `invalid=${encodeURIComponent(field ?? '1')}`
  return seeOther(`${rejected}${rejected.includes('?') ? '&' : '?'}${query}`)
}

const createPurchaseOrder = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  form: Awaited<ReturnType<typeof readForm>>,
) =>
  ctx.call(
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

const safeRfqReturnTo = (url: URL): string => {
  const fallback = inLocale(url, '/admin/purchase/rfqs')
  const raw = url.searchParams.get('returnTo')
  if (!raw) return fallback
  const candidate = new URL(raw, 'http://ket.local')
  return candidate.origin === 'http://ket.local' && candidate.pathname === '/admin/purchase/rfqs'
    ? `${candidate.pathname}${candidate.search}`
    : fallback
}

const rfqCreatePath = (url: URL, returnTo: string): string => {
  const target = new URL(inLocale(url, '/admin/purchase/rfqs/new'), 'http://ket.local')
  target.searchParams.set('returnTo', returnTo)
  return `${target.pathname}${target.search}`
}

const listKeep = (url: URL, omitted: string[] = []): Record<string, string> => {
  const keep: Record<string, string> = {}
  for (const [key, value] of url.searchParams) if (!['q', 'page', ...omitted].includes(key)) keep[key] = value
  return keep
}

const listGroups = (_: Translator, url: URL, rows: AnyRow[], group: string | null) => {
  if (group !== 'state' && group !== 'vendor') return undefined
  const grouped = new Map<string, AnyRow[]>()
  for (const row of rows) {
    const key = group === 'state' ? String(row.state) : String(row.partnerName ?? row.partnerId)
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  return [...grouped.entries()].map(([key, groupedRows]) => ({
    id: `${group}:${key}`,
    label: group === 'state' ? labelOf(_, 'state', key) : key,
    count: groupedRows.length,
    depth: 0,
    open: true,
    href: withParam(url, 'group', null),
    rows: groupedRows,
  }))
}

const saveSupplierInfo = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  form: Awaited<ReturnType<typeof readForm>>,
) =>
  ctx.call(
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
  {
    name: 'partnerRef',
    label: _('purchase_backend.field.partnerRef'),
    help: _('purchase_backend.field.partnerRefHint'),
  },
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
      if (crossSite(req)) return text('Forbidden', { status: 403 })
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
      else if (form.action === 'update-line')
        result = await ctx.call(
          'purchase.updateLine',
          {
            id: form.lineId ?? '',
            productQty: form.productQty || '0',
            ...optional(form, 'priceUnit'),
            ...optional(form, 'discount'),
            ...optional(form, 'taxId'),
          },
          url,
          req,
        )
      else if (form.action === 'remove-line')
        result = await ctx.call('purchase.removeLine', { id: form.lineId ?? '' }, url, req)
      else if (form.action === 'send')
        result = await ctx.call('purchase.sendRfq', { id: params.id }, url, req)
      else if (form.action === 'confirm')
        result = await ctx.call('purchase.confirmOrder', { id: params.id }, url, req)
      else if (form.action === 'request-approval')
        result = await ctx.call('purchase.confirmOrder', { id: params.id, requiresApproval: true }, url, req)
      else if (form.action === 'approve')
        result = await ctx.call('purchase.approveOrder', { id: params.id }, url, req)
      else if (form.action === 'reset')
        result = await ctx.call('purchase.resetToDraft', { id: params.id }, url, req)
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
        control: await variantRelationControl(ctx, url, req, _, {
          id: 'purchase-line-product',
          name: 'productId',
          label: _('purchase_backend.field.product'),
          variants,
          required: true,
        }),
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
        control: await accountRelationControl(ctx, url, req, _, {
          id: 'purchase-expense-account',
          name: 'expenseAccountId',
          label: _('purchase_backend.field.expenseAccount'),
          accounts: accountOptions(expenses),
          accountTypes: ['expense*'],
          required: true,
        }),
      },
      {
        name: 'payableAccountId',
        label: _('purchase_backend.field.payableAccount'),
        type: 'select',
        options: choices(payable),
        required: true,
        control: await accountRelationControl(ctx, url, req, _, {
          id: 'purchase-payable-account',
          name: 'payableAccountId',
          label: _('purchase_backend.field.payableAccount'),
          accounts: accountOptions(payable),
          accountTypes: ['liability_payable'],
          required: true,
        }),
      },
      {
        name: 'taxAccountId',
        label: _('purchase_backend.field.taxAccount'),
        type: 'select',
        options: choices(data.accounts, true),
        control: await accountRelationControl(ctx, url, req, _, {
          id: 'purchase-tax-account',
          name: 'taxAccountId',
          label: _('purchase_backend.field.taxAccount'),
          accounts: accountOptions(data.accounts),
          allowEmpty: true,
        }),
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
    return adminPage(ctx, url, req, {
      title: 'purchase_backend.detail.title',
      body: (_, shell) =>
        purchaseOrderDetailScreen(_, {
          frame: shell,
          order: { ...order, partnerName: vendor?.name },
          actionPath: path,
          lineFields,
          billFields,
          printActions: printGroup(_, printable, String(order.id), url.search),
          invalid: url.searchParams.get('invalid'),
        }),
    })
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
  'field.partnerRefHint': 'Số báo giá của nhà cung cấp; điền khi họ phản hồi.',
  'feedback.rejected': 'Chưa lưu được',
  'feedback.rejectedHint': 'Kiểm tra lại các trường bắt buộc rồi gửi lại.',
  'feedback.rejectedField': 'Trường "{field}" chưa hợp lệ.',
  'setup.title': 'Cần cấu hình trước khi mua hàng',
  'setup.hint': 'Chưa có: {missing}. Tạo xong mới lập được yêu cầu báo giá.',
  'setup.vendors': 'nhà cung cấp',
  'setup.pickingTypes': 'loại phiếu nhập kho',
  'setup.openInventory': 'Mở cấu hình kho',
  'setup.openPartners': 'Mở danh bạ đối tác',
  'action.updateLine': 'Lưu dòng',
  'action.removeLine': 'Xoá dòng',
  'lines.edit': 'Sửa',
  'lines.empty': 'Yêu cầu chưa có dòng nào.',
  'lines.emptyHint': 'Thêm ít nhất một sản phẩm bên dưới trước khi xác nhận.',
  'orders.empty': 'Chưa có đơn mua nào.',
  'orders.emptyHint': 'Đơn mua sinh ra khi một yêu cầu báo giá được xác nhận.',
  'orders.openRequests': 'Mở yêu cầu báo giá',
  'action.resetToDraft': 'Trả về nháp',
  'moveState.draft': 'Nháp',
  'moveState.waiting': 'Chờ',
  'moveState.confirmed': 'Đã xác nhận',
  'moveState.partially_available': 'Có một phần',
  'moveState.assigned': 'Sẵn sàng',
  'moveState.done': 'Hoàn tất',
  'moveState.cancel': 'Đã hủy',
  'billState.draft': 'Nháp',
  'billState.posted': 'Đã ghi sổ',
  'billState.cancel': 'Đã hủy',
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
  'field.partnerRefHint': "The vendor's own quotation number; fill it in when they reply.",
  'feedback.rejected': 'Not saved',
  'feedback.rejectedHint': 'Check the required fields and submit again.',
  'feedback.rejectedField': 'The "{field}" field is not valid.',
  'setup.title': 'Purchasing needs configuring first',
  'setup.hint': 'Still missing: {missing}. A request for quotation needs these to exist.',
  'setup.vendors': 'vendors',
  'setup.pickingTypes': 'receipt operation types',
  'setup.openInventory': 'Open inventory setup',
  'setup.openPartners': 'Open partner directory',
  'action.updateLine': 'Save line',
  'action.removeLine': 'Remove line',
  'lines.edit': 'Edit',
  'lines.empty': 'This request has no lines yet.',
  'lines.emptyHint': 'Add at least one product below before confirming it.',
  'orders.empty': 'No purchase orders yet.',
  'orders.emptyHint': 'A purchase order appears once a request for quotation is confirmed.',
  'orders.openRequests': 'Open requests for quotation',
  'action.resetToDraft': 'Reset to draft',
  'moveState.draft': 'Draft',
  'moveState.waiting': 'Waiting',
  'moveState.confirmed': 'Confirmed',
  'moveState.partially_available': 'Partially available',
  'moveState.assigned': 'Ready',
  'moveState.done': 'Done',
  'moveState.cancel': 'Cancelled',
  'billState.draft': 'Draft',
  'billState.posted': 'Posted',
  'billState.cancel': 'Cancelled',
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
  title: 'Mua hàng trong quản trị',
  summary: 'RFQ, đơn mua, nhập hàng và hoá đơn nhà cung cấp.',
  category: 'Hệ thống',
  menus: {
    purchase: { label: 'menu.app', icon: 'shopping-cart', sequence: 24 },
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
      sequence: 10,
    },
    'purchase.orders': {
      parent: 'purchase.ordersGroup',
      label: 'menu.orders',
      path: '/admin/purchase/orders',
      needs: 'purchase.listOrders',
      sequence: 20,
    },
    'purchase.products': { parent: 'purchase', label: 'menu.products', sequence: 20 },
    'purchase.vendorPricelists': {
      parent: 'purchase.products',
      label: 'menu.vendorPricelists',
      path: '/admin/purchase/vendor-pricelists',
      needs: 'purchase.listSupplierInfo',
      sequence: 10,
    },
  },
  routes: {
    '/admin/purchase':
      (ctx): Route =>
      async (url, req) =>
        req.method === 'GET'
          ? adminPage(ctx, url, req, {
              title: 'purchase_backend.dashboard.title',
              body: async (_, shell) => {
                const [orders, data] = await Promise.all([
                  ctx.call('purchase.listOrders', {}, url, req) as Promise<AnyRow[]>,
                  common(ctx, url, req),
                ])
                return purchaseOverviewScreen(_, orders, shell, localeQuery(url), {
                  pickingTypes: data.pickingTypes.length,
                  vendors: data.partners.length,
                })
              },
            })
          : text('GET', { status: 405 }),
    '/admin/purchase/rfqs':
      (ctx): Route =>
      async (url, req) => {
        const returnTo = `${url.pathname}${url.search}`
        const createPath = rfqCreatePath(url, returnTo)
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          return redirect(await createPurchaseOrder(ctx, url, req, form), returnTo, createPath)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const page = pageOf(url)
        const search = searchOf(url)
        const requestedState = url.searchParams.get('state')
        const state = ['draft', 'sent', 'to approve'].includes(String(requestedState)) ? requestedState : null
        const requestedGroup = url.searchParams.get('group')
        const group = requestedGroup === 'state' || requestedGroup === 'vendor' ? requestedGroup : null
        const [orders, data] = await Promise.all([
          ctx.call(
            'purchase.listOrders',
            {
              states: ['draft', 'sent', 'to approve'],
              ...(search ? { search } : {}),
              limit: 2_000,
            },
            url,
            req,
          ) as Promise<AnyRow[]>,
          common(ctx, url, req),
        ])
        const vendors = new Map(data.partners.map((row) => [String(row.id), row.name]))
        const matching = orders
          .filter(
            (row) =>
              ['draft', 'sent', 'to approve'].includes(String(row.state)) && (!state || row.state === state),
          )
          .map((row) => ({ ...row, partnerName: vendors.get(String(row.partnerId)) }))
        const rows = group ? matching : matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
        return adminPage(ctx, url, req, {
          title: 'purchase_backend.rfqs.title',
          body: (_, shell) =>
            rfqsListScreen(_, {
              frame: {
                ...shell,
                chrome: {
                  search: {
                    name: 'q',
                    value: search ?? '',
                    placeholder: _('purchase_backend.rfqs.title'),
                    keep: listKeep(url),
                    facets: [
                      ...(state
                        ? [
                            {
                              label: labelOf(_, 'state', state),
                              without: withParam(url, 'state', null),
                            },
                          ]
                        : []),
                      ...(group
                        ? [
                            {
                              label: `${_('backend.chrome.groupBy')}: ${group === 'state' ? _('purchase_backend.field.state') : _('purchase_backend.field.vendor')}`,
                              without: withParam(url, 'group', null),
                            },
                          ]
                        : []),
                    ],
                    menus: [
                      {
                        id: 'filters',
                        label: _('backend.chrome.filters'),
                        items: ['draft', 'sent', 'to approve'].map((value) => ({
                          id: `state:${value}`,
                          label: labelOf(_, 'state', value),
                          path: withParam(url, 'state', state === value ? null : value),
                          active: state === value,
                        })),
                      },
                      {
                        id: 'group',
                        label: _('backend.chrome.groupBy'),
                        items: [
                          {
                            id: 'group:state',
                            label: _('purchase_backend.field.state'),
                            path: withParam(url, 'group', group === 'state' ? null : 'state'),
                            active: group === 'state',
                          },
                          {
                            id: 'group:vendor',
                            label: _('purchase_backend.field.vendor'),
                            path: withParam(url, 'group', group === 'vendor' ? null : 'vendor'),
                            active: group === 'vendor',
                          },
                        ],
                      },
                    ],
                  },
                  pager: group ? null : pager(url, page, rows.length, matching.length),
                },
              },
              rows,
              total: matching.length,
              createHref: createPath,
              detailSuffix: localeQuery(url),
              setup: { pickingTypes: data.pickingTypes.length, vendors: data.partners.length },
              table: { groups: listGroups(_, url, matching, group) },
            }),
        })
      },
    '/admin/purchase/rfqs/new':
      (ctx): Route =>
      async (url, req) => {
        const returnTo = safeRfqReturnTo(url)
        const createPath = rfqCreatePath(url, returnTo)
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          return redirect(await createPurchaseOrder(ctx, url, req, form), returnTo, createPath)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const data = await common(ctx, url, req)
        return adminPage(ctx, url, req, {
          title: 'purchase_backend.action.createRfq',
          body: async (_, shell) =>
            rfqCreateScreen(_, {
              frame: shell,
              action: createPath,
              cancelHref: returnTo,
              fields: await orderFields(ctx, url, req, _, data),
              invalid: url.searchParams.get('invalid'),
              setup: { pickingTypes: data.pickingTypes.length, vendors: data.partners.length },
            }),
        })
      },
    '/admin/purchase/orders':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const page = pageOf(url)
        const search = searchOf(url)
        const invoice = url.searchParams.get('invoice')
        const group = url.searchParams.get('group') === 'vendor' ? 'vendor' : null
        const [orders, data] = await Promise.all([
          ctx.call(
            'purchase.listOrders',
            { state: 'purchase', ...(search ? { search } : {}), limit: 2_000 },
            url,
            req,
          ) as Promise<AnyRow[]>,
          common(ctx, url, req),
        ])
        const vendors = new Map(data.partners.map((row) => [String(row.id), row.name]))
        const matching = orders
          .filter((row) => !invoice || row.invoiceStatus === invoice)
          .map((row) => ({ ...row, partnerName: vendors.get(String(row.partnerId)) }))
        const rows = group ? matching : matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
        return adminPage(ctx, url, req, {
          title: 'purchase_backend.orders.title',
          body: (_, shell) =>
            purchaseOrdersListScreen(_, {
              frame: {
                ...shell,
                chrome: {
                  search: {
                    name: 'q',
                    value: search ?? '',
                    placeholder: _('purchase_backend.orders.title'),
                    keep: listKeep(url),
                    facets: [
                      ...(invoice
                        ? [
                            {
                              label: labelOf(_, 'invoiceStatus', invoice),
                              without: withParam(url, 'invoice', null),
                            },
                          ]
                        : []),
                      ...(group
                        ? [
                            {
                              label: `${_('backend.chrome.groupBy')}: ${_('purchase_backend.field.vendor')}`,
                              without: withParam(url, 'group', null),
                            },
                          ]
                        : []),
                    ],
                    menus: [
                      {
                        id: 'filters',
                        label: _('backend.chrome.filters'),
                        items: ['no', 'to invoice', 'invoiced'].map((value) => ({
                          id: `invoice:${value}`,
                          label: labelOf(_, 'invoiceStatus', value),
                          path: withParam(url, 'invoice', invoice === value ? null : value),
                          active: invoice === value,
                        })),
                      },
                      {
                        id: 'group',
                        label: _('backend.chrome.groupBy'),
                        items: [
                          {
                            id: 'group:vendor',
                            label: _('purchase_backend.field.vendor'),
                            path: withParam(url, 'group', group === 'vendor' ? null : 'vendor'),
                            active: group === 'vendor',
                          },
                        ],
                      },
                    ],
                  },
                  pager: group ? null : pager(url, page, rows.length, matching.length),
                },
              },
              rows,
              total: matching.length,
              detailSuffix: localeQuery(url),
              originHref: inLocale(url, '/admin/purchase/rfqs'),
              table: { groups: listGroups(_, url, matching, group) },
            }),
        })
      },
    '/admin/purchase/rfqs/{id}': detailHandler,
    '/admin/purchase/orders/{id}': detailHandler,
    '/admin/purchase/vendor-pricelists':
      (ctx): Route =>
      async (url, req) => {
        const listPath = inLocale(url, '/admin/purchase/vendor-pricelists')
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const result =
            form.action === 'method'
              ? await ctx.call(
                  'purchase.setPurchaseMethod',
                  { templateId: form.templateId ?? '', purchaseMethod: form.purchaseMethod ?? '' },
                  url,
                  req,
                )
              : await saveSupplierInfo(ctx, url, req, form)
          return redirect(result, listPath)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const _ = ctx.translate(ctx.localeOf(url, req))
        const [rows, data] = await Promise.all([
          ctx.call('purchase.listSupplierInfo', {}, url, req) as Promise<AnyRow[]>,
          common(ctx, url, req),
        ])
        const vendors = new Map(data.partners.map((row) => [String(row.id), row.name]))
        const templates = new Map(data.templates.map((row) => [String(row.id), row.name]))
        const methodFields: FormField[] = [
          {
            name: 'templateId',
            label: _('purchase_backend.field.template'),
            type: 'select',
            options: choices(data.templates),
            required: true,
            control: await templateRelationControl(ctx, url, req, _, {
              id: 'purchase-policy-template',
              name: 'templateId',
              label: _('purchase_backend.field.template'),
              templates: choices(data.templates),
              required: true,
            }),
          },
          {
            name: 'purchaseMethod',
            label: _('purchase_backend.field.purchaseMethod'),
            type: 'select',
            options: PURCHASE_METHODS.map((value) => ({ value, label: labelOf(_, 'purchaseMethod', value) })),
          },
        ]
        return adminPage(ctx, url, req, {
          title: 'purchase_backend.pricelists.title',
          body: (_, shell) =>
            vendorPricelistsListScreen(_, {
              frame: shell,
              action: listPath,
              createHref: inLocale(url, '/admin/purchase/vendor-pricelists/new'),
              currency: data.companies.find((company) => company.id === shell.viewer?.company)?.currency,
              methodFields,
              invalid: url.searchParams.get('invalid'),
              setup: { pickingTypes: data.pickingTypes.length, vendors: data.partners.length },
              rows: rows.map((row) => ({
                ...row,
                id: String(row.id),
                partnerId: String(row.partnerId),
                productTemplateId: String(row.productTemplateId),
                minQty: String(row.minQty),
                price: String(row.price),
                discount: String(row.discount),
                delay: String(row.delay),
                partnerName: vendors.has(String(row.partnerId))
                  ? String(vendors.get(String(row.partnerId)))
                  : undefined,
                productNameDisplay: templates.has(String(row.productTemplateId))
                  ? String(templates.get(String(row.productTemplateId)))
                  : undefined,
              })),
            }),
        })
      },
    '/admin/purchase/vendor-pricelists/new':
      (ctx): Route =>
      async (url, req) => {
        const listPath = inLocale(url, '/admin/purchase/vendor-pricelists')
        const createPath = inLocale(url, '/admin/purchase/vendor-pricelists/new')
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          return redirect(await saveSupplierInfo(ctx, url, req, await readForm(req)), listPath, createPath)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const _ = ctx.translate(ctx.localeOf(url, req))
        const data = await common(ctx, url, req)
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
            control: await templateRelationControl(ctx, url, req, _, {
              id: 'purchase-vendor-price-template',
              name: 'productTemplateId',
              label: _('purchase_backend.field.template'),
              templates: choices(data.templates),
              required: true,
            }),
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
        return adminPage(ctx, url, req, {
          title: 'purchase_backend.action.addVendorPrice',
          body: (_, shell) => {
            const company = data.companies.find((entry) => entry.id === shell.viewer?.company)
            return vendorPricelistCreateScreen(_, {
              frame: shell,
              fields,
              action: createPath,
              cancelHref: listPath,
              companyLabel: company
                ? String(company.name ?? company.code ?? company.id)
                : shell.viewer?.company,
              currency: company?.currency,
              invalid: url.searchParams.get('invalid'),
              setup: { pickingTypes: data.pickingTypes.length, vendors: data.partners.length },
            })
          },
        })
      },
  },
  messages: { vi, en },
})
