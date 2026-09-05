import { randomUUID } from 'node:crypto'
import { defineModule, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { FormField } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import {
  configsScreen,
  dashboard,
  methodsScreen,
  orderDetail,
  ordersScreen,
  registerScreen,
  sessionDetail,
  sessionsScreen,
} from './screens.tsx'
import { adminPage, choices, optional } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'

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
const common = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const [
    configs,
    methods,
    partners,
    users,
    warehouses,
    pricelists,
    templates,
    units,
    taxes,
    journals,
    accounts,
    companies,
  ] = await Promise.all([
    ctx.call('pos.listConfigs', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('pos.listPaymentMethods', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('partner.listPartners', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('user.listUsers', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('stock.listWarehouses', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('pricing.listPricelists', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('product.listTemplates', { withVariants: true }, url, req) as Promise<AnyRow[]>,
    ctx.call('uom.listUnits', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('account.listTaxes', { typeTaxUse: 'sale' }, url, req) as Promise<AnyRow[]>,
    ctx.call('account.listJournals', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('account.listAccounts', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('company.listCompanies', {}, url, req) as Promise<AnyRow[]>,
  ])
  const variants: AnyRow[] = templates
    .filter((template) => template.saleOk)
    .flatMap((template) =>
      ((template.variants as AnyRow[] | undefined) ?? []).map((variant) => ({
        ...variant,
        templateName: template.name,
      })),
    )
  return {
    configs,
    methods,
    partners,
    users,
    warehouses,
    pricelists,
    templates,
    variants,
    units,
    taxes,
    journals,
    accounts,
    companies,
  }
}
const configFields = (_: Translator, d: Awaited<ReturnType<typeof common>>): FormField[] => [
  { name: 'name', label: _('pos_backend.field.name'), required: true },
  {
    name: 'warehouseId',
    label: _('pos_backend.field.warehouse'),
    type: 'select',
    options: choices(d.warehouses),
    required: true,
  },
  {
    name: 'pricelistId',
    label: _('pos_backend.field.pricelist'),
    type: 'select',
    options: choices(d.pricelists, true),
  },
  {
    name: 'salesJournalId',
    label: _('pos_backend.field.salesJournal'),
    type: 'select',
    options: choices(d.journals.filter((row) => row.type === 'sale')),
    required: true,
  },
  {
    name: 'revenueAccountId',
    label: _('pos_backend.field.revenueAccount'),
    type: 'select',
    options: choices(d.accounts.filter((row) => String(row.accountType).startsWith('income'))),
    required: true,
  },
  {
    name: 'receivableAccountId',
    label: _('pos_backend.field.receivableAccount'),
    type: 'select',
    options: choices(d.accounts.filter((row) => row.accountType === 'asset_receivable')),
    required: true,
  },
  {
    name: 'taxAccountId',
    label: _('pos_backend.field.taxAccount'),
    type: 'select',
    options: choices(d.accounts, true),
  },
  { name: 'maximumDifference', label: _('pos_backend.field.maximumDifference'), type: 'decimal', value: 0 },
]

const vi = {
  'app.title': 'Điểm bán hàng trong quản trị',
  'app.summary': 'Ca bán hàng, thanh toán, tồn kho và kế toán bán lẻ.',
  'app.category': 'Hệ thống',
  'menu.app': 'Điểm bán hàng',
  'menu.dashboard': 'Tổng quan',
  'menu.ordersGroup': 'Đơn hàng',
  'menu.orders': 'Đơn POS',
  'menu.sessions': 'Ca bán hàng',
  'menu.configGroup': 'Cấu hình',
  'menu.configs': 'Điểm bán hàng',
  'menu.methods': 'Phương thức thanh toán',
  'dashboard.title': 'Tổng quan điểm bán hàng',
  'dashboard.openSessions': 'Ca đang hoạt động',
  'dashboard.draftOrders': 'Đơn chưa thanh toán',
  'dashboard.paidOrders': 'Đơn đã thanh toán',
  'dashboard.sales': 'Doanh số',
  'configs.title': 'Cấu hình điểm bán hàng',
  'methods.title': 'Phương thức thanh toán',
  'sessions.title': 'Ca bán hàng',
  'orders.title': 'Đơn điểm bán hàng',
  'register.title': 'Máy tính tiền',
  'close.title': 'Kiểm soát đóng ca',
  'lines.title': 'Sản phẩm',
  'lines.add': 'Thêm sản phẩm',
  'payments.title': 'Thanh toán',
  empty: 'Chưa có dữ liệu.',
  emptyHint: 'Tạo bản ghi đầu tiên để bắt đầu.',
  yes: 'Có',
  no: 'Không',
  'action.saveConfig': 'Lưu điểm bán',
  'action.saveMethod': 'Lưu phương thức',
  'action.linkMethod': 'Gắn vào điểm bán',
  'action.createSession': 'Tạo ca',
  'action.openSession': 'Mở ca',
  'action.startClosing': 'Bắt đầu đóng ca',
  'action.closeSession': 'Đóng và ghi sổ',
  'action.openRegister': 'Mở máy tính tiền',
  'action.newOrder': 'Đơn hàng mới',
  'action.addProduct': 'Thêm sản phẩm',
  'action.addPayment': 'Thêm thanh toán',
  'action.validate': 'Xác nhận thanh toán',
  'action.cancel': 'Huỷ đơn',
  'action.refund': 'Hoàn hàng',
  'field.name': 'Tên',
  'field.config': 'Điểm bán hàng',
  'field.warehouse': 'Kho',
  'field.pricelist': 'Bảng giá',
  'field.salesJournal': 'Sổ bán hàng',
  'field.revenueAccount': 'Tài khoản doanh thu',
  'field.receivableAccount': 'Tài khoản phải thu',
  'field.taxAccount': 'Tài khoản thuế',
  'field.maximumDifference': 'Chênh lệch tiền mặt tối đa',
  'field.journal': 'Sổ thanh toán',
  'field.isCash': 'Tiền mặt',
  'field.paymentMethod': 'Phương thức thanh toán',
  'field.user': 'Nhân viên mở ca',
  'field.openingCash': 'Tiền mặt đầu ca',
  'field.openingNotes': 'Ghi chú mở ca',
  'field.session': 'Mã ca',
  'field.state': 'Trạng thái',
  'field.startAt': 'Thời gian mở',
  'field.orders': 'Số đơn',
  'field.expectedCash': 'Tiền mặt lý thuyết',
  'field.closingCash': 'Tiền mặt thực đếm',
  'field.closingNotes': 'Ghi chú đóng ca',
  'field.receipt': 'Số biên lai',
  'field.customer': 'Khách hàng',
  'field.invoice': 'Xuất hoá đơn',
  'field.total': 'Tổng tiền',
  'field.paid': 'Đã thanh toán',
  'field.product': 'Sản phẩm',
  'field.qty': 'Số lượng',
  'field.uom': 'Đơn vị tính',
  'field.priceUnit': 'Đơn giá',
  'field.discount': 'Chiết khấu',
  'field.tax': 'Thuế bán hàng',
  'field.subtotal': 'Thành tiền',
  'field.amount': 'Số tiền',
  'sessionState.opening_control': 'Kiểm soát mở ca',
  'sessionState.opened': 'Đang hoạt động',
  'sessionState.closing_control': 'Kiểm soát đóng ca',
  'sessionState.closed': 'Đã đóng và ghi sổ',
  'orderState.draft': 'Mới',
  'orderState.cancel': 'Đã huỷ',
  'orderState.paid': 'Đã thanh toán',
  'orderState.done': 'Đã ghi sổ',
}
const en = {
  'app.title': 'Point of Sale administration',
  'app.summary': 'Retail sessions, payments, inventory, and accounting.',
  'app.category': 'System',
  'menu.app': 'Point of Sale',
  'menu.dashboard': 'Overview',
  'menu.ordersGroup': 'Orders',
  'menu.orders': 'POS Orders',
  'menu.sessions': 'Sessions',
  'menu.configGroup': 'Configuration',
  'menu.configs': 'Point of Sales',
  'menu.methods': 'Payment Methods',
  'dashboard.title': 'Point of Sale Overview',
  'dashboard.openSessions': 'Active Sessions',
  'dashboard.draftOrders': 'Unpaid Orders',
  'dashboard.paidOrders': 'Paid Orders',
  'dashboard.sales': 'Sales',
  'configs.title': 'Point of Sale Configuration',
  'methods.title': 'Payment Methods',
  'sessions.title': 'Sessions',
  'orders.title': 'Point of Sale Orders',
  'register.title': 'Register',
  'close.title': 'Closing Control',
  'lines.title': 'Products',
  'lines.add': 'Add a Product',
  'payments.title': 'Payments',
  empty: 'No data yet.',
  emptyHint: 'Create the first record to get started.',
  yes: 'Yes',
  no: 'No',
  'action.saveConfig': 'Save Point of Sale',
  'action.saveMethod': 'Save Method',
  'action.linkMethod': 'Add to Point of Sale',
  'action.createSession': 'Create Session',
  'action.openSession': 'Open Session',
  'action.startClosing': 'Start Closing',
  'action.closeSession': 'Close and Post',
  'action.openRegister': 'Open Register',
  'action.newOrder': 'New Order',
  'action.addProduct': 'Add Product',
  'action.addPayment': 'Add Payment',
  'action.validate': 'Validate Payment',
  'action.cancel': 'Cancel Order',
  'action.refund': 'Refund',
  'field.name': 'Name',
  'field.config': 'Point of Sale',
  'field.warehouse': 'Warehouse',
  'field.pricelist': 'Pricelist',
  'field.salesJournal': 'Sales Journal',
  'field.revenueAccount': 'Revenue Account',
  'field.receivableAccount': 'Receivable Account',
  'field.taxAccount': 'Tax Account',
  'field.maximumDifference': 'Maximum Cash Difference',
  'field.journal': 'Payment Journal',
  'field.isCash': 'Cash',
  'field.paymentMethod': 'Payment Method',
  'field.user': 'Opened By',
  'field.openingCash': 'Opening Cash',
  'field.openingNotes': 'Opening Notes',
  'field.session': 'Session ID',
  'field.state': 'Status',
  'field.startAt': 'Opening Date',
  'field.orders': 'Orders',
  'field.expectedCash': 'Theoretical Cash',
  'field.closingCash': 'Counted Cash',
  'field.closingNotes': 'Closing Notes',
  'field.receipt': 'Receipt Number',
  'field.customer': 'Customer',
  'field.invoice': 'Invoice',
  'field.total': 'Total',
  'field.paid': 'Paid',
  'field.product': 'Product',
  'field.qty': 'Quantity',
  'field.uom': 'Unit',
  'field.priceUnit': 'Unit Price',
  'field.discount': 'Discount',
  'field.tax': 'Sales Tax',
  'field.subtotal': 'Subtotal',
  'field.amount': 'Amount',
  'sessionState.opening_control': 'Opening Control',
  'sessionState.opened': 'In Progress',
  'sessionState.closing_control': 'Closing Control',
  'sessionState.closed': 'Closed & Posted',
  'orderState.draft': 'New',
  'orderState.cancel': 'Cancelled',
  'orderState.paid': 'Paid',
  'orderState.done': 'Posted',
}

export default defineModule({
  name: 'pos_backend',
  version: '0.1.0',
  depends: ['pos', 'backend'],
  joints: { 'order.loyalty': { props: { orderId: 'id', locale: 'text?' } } },
  title: 'Điểm bán hàng trong quản trị',
  summary: 'Ca bán hàng, thanh toán, tồn kho và kế toán bán lẻ.',
  category: 'Hệ thống',
  menus: {
    pos: { label: 'menu.app', icon: 'store', sequence: 23 },
    'pos.dashboard': {
      parent: 'pos',
      label: 'menu.dashboard',
      path: '/admin/pos',
      sequence: 1,
      needs: 'pos.listOrders',
    },
    'pos.ordersGroup': { parent: 'pos', label: 'menu.ordersGroup', sequence: 10 },
    'pos.orders': {
      parent: 'pos.ordersGroup',
      label: 'menu.orders',
      path: '/admin/pos/orders',
      needs: 'pos.listOrders',
      sequence: 10,
    },
    'pos.sessions': {
      parent: 'pos.ordersGroup',
      label: 'menu.sessions',
      path: '/admin/pos/sessions',
      needs: 'pos.listSessions',
      sequence: 20,
    },
    'pos.configGroup': { parent: 'pos', label: 'menu.configGroup', sequence: 20 },
    'pos.configs': {
      parent: 'pos.configGroup',
      label: 'menu.configs',
      path: '/admin/pos/configurations',
      needs: 'pos.listConfigs',
      sequence: 10,
    },
    'pos.methods': {
      parent: 'pos.configGroup',
      label: 'menu.methods',
      path: '/admin/pos/payment-methods',
      needs: 'pos.listPaymentMethods',
      sequence: 20,
    },
  },
  routes: {
    '/admin/pos':
      (ctx): Route =>
      async (url, req) =>
        req.method === 'GET'
          ? adminPage(ctx, url, req, {
              title: 'pos_backend.dashboard.title',
              body: async (_, shell) =>
                dashboard(
                  _,
                  (await ctx.call('pos.listSessions', {}, url, req)) as AnyRow[],
                  (await ctx.call('pos.listOrders', {}, url, req)) as AnyRow[],
                  shell,
                ),
            })
          : text('GET', { status: 405 }),
    '/admin/pos/configurations':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          return redirect(
            await ctx.call(
              'pos.saveConfig',
              {
                id: randomUUID(),
                name: form.name ?? '',
                warehouseId: form.warehouseId ?? '',
                ...optional(form, 'pricelistId'),
                salesJournalId: form.salesJournalId ?? '',
                revenueAccountId: form.revenueAccountId ?? '',
                receivableAccountId: form.receivableAccountId ?? '',
                ...optional(form, 'taxAccountId'),
                maximumDifference: form.maximumDifference || '0',
              },
              url,
              req,
            ),
            '/admin/pos/configurations',
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const d = await common(ctx, url, req),
          names = new Map(d.warehouses.map((row) => [String(row.id), row.name])),
          currencies = new Map(d.pricelists.map((row) => [String(row.id), row.currency]))
        return adminPage(ctx, url, req, {
          title: 'pos_backend.configs.title',
          body: (_, shell) =>
            configsScreen(
              _,
              shell,
              d.configs.map((row) => ({
                ...row,
                warehouseName: names.get(String(row.warehouseId)),
                currency:
                  currencies.get(String(row.pricelistId)) ??
                  d.companies.find((company) => company.id === shell.viewer?.company)?.currency,
              })),
              configFields(_, d),
            ),
        })
      },
    '/admin/pos/payment-methods':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req),
            result =
              form.action === 'link'
                ? await ctx.call(
                    'pos.linkPaymentMethod',
                    {
                      id: `${form.configId}:${form.paymentMethodId}`,
                      configId: form.configId ?? '',
                      paymentMethodId: form.paymentMethodId ?? '',
                    },
                    url,
                    req,
                  )
                : await ctx.call(
                    'pos.savePaymentMethod',
                    {
                      id: randomUUID(),
                      name: form.name ?? '',
                      journalId: form.journalId ?? '',
                      isCash: form.isCash === '1',
                    },
                    url,
                    req,
                  )
          return redirect(result, '/admin/pos/payment-methods')
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const d = await common(ctx, url, req),
          names = new Map(d.journals.map((row) => [String(row.id), row.name]))
        return adminPage(ctx, url, req, {
          title: 'pos_backend.methods.title',
          body: (_, shell) =>
            methodsScreen(
              _,
              shell,
              d.methods.map((row) => ({ ...row, journalName: names.get(String(row.journalId)) })),
              [
                { name: 'name', label: _('pos_backend.field.name'), required: true },
                {
                  name: 'journalId',
                  label: _('pos_backend.field.journal'),
                  type: 'select',
                  options: choices(d.journals.filter((row) => ['cash', 'bank'].includes(String(row.type)))),
                  required: true,
                },
                { name: 'isCash', label: _('pos_backend.field.isCash'), type: 'checkbox' },
              ],
              [
                {
                  name: 'configId',
                  label: _('pos_backend.field.config'),
                  type: 'select',
                  options: choices(d.configs),
                  required: true,
                },
                {
                  name: 'paymentMethodId',
                  label: _('pos_backend.field.paymentMethod'),
                  type: 'select',
                  options: choices(d.methods),
                  required: true,
                },
              ],
            ),
        })
      },
    '/admin/pos/sessions':
      (ctx): Route =>
      async (url, req) => {
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          return redirect(
            await ctx.call(
              'pos.createSession',
              {
                id: randomUUID(),
                configId: form.configId ?? '',
                userId: form.userId ?? '',
                openingCash: form.openingCash || '0',
                ...optional(form, 'openingNotes'),
              },
              url,
              req,
            ),
            '/admin/pos/sessions',
          )
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const [rows, d] = await Promise.all([
            ctx.call('pos.listSessions', {}, url, req) as Promise<AnyRow[]>,
            common(ctx, url, req),
          ]),
          names = new Map(d.configs.map((row) => [String(row.id), row.name]))
        return adminPage(ctx, url, req, {
          title: 'pos_backend.sessions.title',
          body: (_, shell) =>
            sessionsScreen(
              _,
              shell,
              rows.map((row) => ({ ...row, configName: names.get(String(row.configId)) })),
              [
                {
                  name: 'configId',
                  label: _('pos_backend.field.config'),
                  type: 'select',
                  options: choices(d.configs),
                  required: true,
                },
                {
                  name: 'userId',
                  label: _('pos_backend.field.user'),
                  type: 'select',
                  options: choices(d.users),
                  required: true,
                },
                { name: 'openingCash', label: _('pos_backend.field.openingCash'), type: 'decimal', value: 0 },
                {
                  name: 'openingNotes',
                  label: _('pos_backend.field.openingNotes'),
                  type: 'textarea',
                  span: 'full',
                },
              ],
            ),
        })
      },
    '/admin/pos/sessions/{id}':
      (ctx): Route =>
      async (url, req, params) => {
        const path = `${url.pathname}${url.search}`
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          const result =
            form.action === 'open'
              ? await ctx.call('pos.openSession', { id: params.id }, url, req)
              : form.action === 'closing'
                ? await ctx.call('pos.startClosing', { id: params.id }, url, req)
                : form.action === 'close'
                  ? await ctx.call(
                      'pos.closeSession',
                      {
                        id: params.id,
                        closingCash: form.closingCash || '0',
                        ...optional(form, 'closingNotes'),
                      },
                      url,
                      req,
                    )
                  : { ok: false }
          return redirect(result, path)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const [session, partners, companies] = await Promise.all([
          ctx.call('pos.getSession', { id: params.id }, url, req) as Promise<AnyRow | null>,
          ctx.call('partner.listPartners', {}, url, req) as Promise<AnyRow[]>,
          ctx.call('company.listCompanies', {}, url, req) as Promise<AnyRow[]>,
        ])
        if (!session) return text('not found', { status: 404 })
        const names = new Map(partners.map((row) => [String(row.id), row.name]))
        session.orders = ((session.orders as AnyRow[]) ?? []).map((row) => ({
          ...row,
          partnerName: names.get(String(row.partnerId)),
        }))
        return adminPage(ctx, url, req, {
          title: 'pos_backend.sessions.title',
          body: (_, shell) =>
            sessionDetail(
              _,
              shell,
              session,
              [
                {
                  name: 'closingCash',
                  label: _('pos_backend.field.closingCash'),
                  type: 'decimal',
                  required: true,
                },
                {
                  name: 'closingNotes',
                  label: _('pos_backend.field.closingNotes'),
                  type: 'textarea',
                  span: 'full',
                },
              ],
              path,
              companies.find((company) => company.id === shell.viewer?.company)?.currency,
            ),
        })
      },
    '/admin/pos/register/{id}':
      (ctx): Route =>
      async (url, req, params) => {
        const path = `${url.pathname}${url.search}`
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req),
            result = (await ctx.call(
              'pos.createOrder',
              {
                id: randomUUID(),
                sessionId: params.id,
                ...optional(form, 'partnerId'),
                toInvoice: form.toInvoice === '1',
              },
              url,
              req,
            )) as AnyRow
          return result.ok
            ? seeOther(`/admin/pos/orders/${String(result.id)}${url.search}`)
            : seeOther(`${url.pathname}${url.search ? `${url.search}&` : '?'}invalid=1`)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const [session, orders, d] = await Promise.all([
          ctx.call('pos.getSession', { id: params.id }, url, req) as Promise<AnyRow | null>,
          ctx.call('pos.listOrders', { sessionId: params.id }, url, req) as Promise<AnyRow[]>,
          common(ctx, url, req),
        ])
        if (!session) return text('not found', { status: 404 })
        const names = new Map(d.partners.map((row) => [String(row.id), row.name]))
        return adminPage(ctx, url, req, {
          title: 'pos_backend.register.title',
          body: (_, shell) =>
            registerScreen(
              _,
              shell,
              session,
              orders.map((row) => ({ ...row, partnerName: names.get(String(row.partnerId)) })),
              [
                {
                  name: 'partnerId',
                  label: _('pos_backend.field.customer'),
                  type: 'select',
                  options: choices(d.partners, true),
                },
                { name: 'toInvoice', label: _('pos_backend.field.invoice'), type: 'checkbox' },
              ],
              path,
            ),
        })
      },
    '/admin/pos/orders':
      (ctx): Route =>
      async (url, req) => {
        if (req.method !== 'GET') return text('GET', { status: 405 })
        const [rows, partners] = await Promise.all([
            ctx.call(
              'pos.listOrders',
              { ...(url.searchParams.get('state') ? { state: url.searchParams.get('state') } : {}) },
              url,
              req,
            ) as Promise<AnyRow[]>,
            ctx.call('partner.listPartners', {}, url, req) as Promise<AnyRow[]>,
          ]),
          names = new Map(partners.map((row) => [String(row.id), row.name]))
        return adminPage(ctx, url, req, {
          title: 'pos_backend.orders.title',
          body: (_, shell) =>
            ordersScreen(
              _,
              shell,
              rows.map((row) => ({ ...row, partnerName: names.get(String(row.partnerId)) })),
            ),
        })
      },
    '/admin/pos/orders/{id}':
      (ctx): Route =>
      async (url, req, params) => {
        const path = `${url.pathname}${url.search}`
        if (req.method === 'POST') {
          if (crossSite(req)) return text('Forbidden', { status: 403 })
          const form = await readForm(req)
          let result: unknown
          if (form.action === 'line')
            result = await ctx.call(
              'pos.addLine',
              {
                id: randomUUID(),
                orderId: params.id,
                productId: form.productId ?? '',
                productUomId: form.productUomId ?? '',
                qty: form.qty || '1',
                ...optional(form, 'priceUnit'),
                discount: form.discount || '0',
                ...optional(form, 'taxId'),
              },
              url,
              req,
            )
          else if (form.action === 'payment')
            result = await ctx.call(
              'pos.addPayment',
              {
                id: randomUUID(),
                orderId: params.id,
                paymentMethodId: form.paymentMethodId ?? '',
                amount: form.amount || '0',
              },
              url,
              req,
            )
          else if (form.action === 'validate')
            result = await callIfInstalled(ctx, url, req, 'loyalty_pos.validateOrder', 'pos.validateOrder', {
              id: params.id,
            })
          else if (form.action === 'cancel')
            result = await callIfInstalled(ctx, url, req, 'loyalty_pos.cancelOrder', 'pos.cancelOrder', {
              id: params.id,
            })
          else if (form.action === 'refund') {
            const [order, sessions] = await Promise.all([
                ctx.call('pos.getOrder', { id: params.id }, url, req) as Promise<AnyRow | null>,
                ctx.call('pos.listSessions', { state: 'opened' }, url, req) as Promise<AnyRow[]>,
              ]),
              session = sessions.find((candidate) => candidate.configId === order?.configId)
            result =
              order && session
                ? await callIfInstalled(ctx, url, req, 'loyalty_pos.refundOrder', 'pos.refundOrder', {
                    id: randomUUID(),
                    originalOrderId: params.id,
                    sessionId: session.id,
                    expectedRevision: order.revision,
                  })
                : { ok: false }
          } else return text('unknown action', { status: 400 })
          return redirect(result, path)
        }
        if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        const [order, d] = await Promise.all([
          ctx.call('pos.getOrder', { id: params.id }, url, req) as Promise<AnyRow | null>,
          common(ctx, url, req),
        ])
        if (!order) return text('not found', { status: 404 })
        const customer = d.partners.find((row) => row.id === order.partnerId),
          linked = await Promise.all(
            d.methods.map(async (method) => ({
              method,
              linked: await ctx
                .call(
                  'pos.paymentMethodAvailable',
                  { configId: order.configId, paymentMethodId: method.id },
                  url,
                  req,
                )
                .catch(() => false),
            })),
          ),
          methods = linked
            .filter((item) => item.linked === true || (item.linked as AnyRow)?.ok)
            .map((item) => item.method)
        const methodNames = new Map(d.methods.map((row) => [String(row.id), row.name]))
        order.payments = ((order.payments as AnyRow[]) ?? []).map((row) => ({
          ...row,
          methodName: methodNames.get(String(row.paymentMethodId)),
        }))
        const integration = await ctx.joint(url, req, 'pos_backend:order.loyalty', {
          orderId: params.id,
          locale: url.searchParams.get('lang')
            ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}`
            : '',
        })
        return adminPage(ctx, url, req, {
          title: 'pos_backend.orders.title',
          body: (_, shell) =>
            orderDetail(
              _,
              shell,
              { ...order, partnerName: customer?.name },
              [
                {
                  name: 'productId',
                  label: _('pos_backend.field.product'),
                  type: 'select',
                  options: d.variants.map((row) => ({
                    value: String(row.id),
                    label: `${String(row.templateName)}${row.defaultCode ? ` · ${String(row.defaultCode)}` : ''}`,
                  })),
                  required: true,
                },
                { name: 'qty', label: _('pos_backend.field.qty'), type: 'decimal', value: 1, required: true },
                {
                  name: 'productUomId',
                  label: _('pos_backend.field.uom'),
                  type: 'select',
                  options: choices(d.units),
                  required: true,
                },
                { name: 'priceUnit', label: _('pos_backend.field.priceUnit'), type: 'decimal' },
                { name: 'discount', label: _('pos_backend.field.discount'), type: 'decimal', value: 0 },
                {
                  name: 'taxId',
                  label: _('pos_backend.field.tax'),
                  type: 'select',
                  options: choices(d.taxes, true),
                },
              ],
              [
                {
                  name: 'paymentMethodId',
                  label: _('pos_backend.field.paymentMethod'),
                  type: 'select',
                  options: choices(methods),
                  required: true,
                },
                { name: 'amount', label: _('pos_backend.field.amount'), type: 'decimal', required: true },
              ],
              path,
              integration,
            ),
        })
      },
  },
  messages: { vi, en },
})
