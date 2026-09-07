import { defineModule } from '@ketvietlab/ketjs'
import { routes } from './routes.ts'

export default defineModule({
  name: 'account_partner_backend',
  version: '0.1.0',
  depends: ['account_partner', 'account', 'partner_backend', 'backend'],
  title: 'Kế toán đối tác trong quản trị',
  summary: 'Nối điều khoản và tài khoản công nợ vào hồ sơ đối tác.',
  category: 'Kế toán',
  assets: new URL('./client/', import.meta.url),
  routes,
  browser: {
    widgets: {
      partnerBalance: {
        props: { value: 'decimal', currency: 'text' },
        ssrBuiltin: 'money',
        client: 'partner-balance-widget.mjs',
        export: 'partnerBalanceWidget',
      },
    },
    resources: {
      partnerBalances: {
        source: 'account.partnerBalances',
        needs: 'account.partnerBalances',
        phase: 'essential',
        key: 'id',
        fields: { id: 'id', balance: 'decimal', currency: 'text' },
        batch: { input: 'ids', max: 500 },
        cache: { scope: 'context', ttlMs: 15_000 },
      },
    },
    fills: {
      'partner_backend.partners:columns': {
        compatible: '^1.0.0',
        columns: [
          {
            id: 'balance',
            label: 'field.balance',
            resource: 'partnerBalances',
            widget: 'partnerBalance',
            bind: { value: 'balance', currency: 'currency' },
            priority: 'secondary',
            operations: ['display'],
          },
        ],
      },
    },
  },
  fills: {
    'partner_backend:record.actions': `<a data-ui="action" data-variant="secondary" href="/admin/partner/partners/{{ partnerId }}/accounting{{ locale }}"><span data-ui="action-label">{{ 'account_partner_backend.action.open' | _ }}</span></a>`,
  },
  messages: {
    vi: {
      'app.title': 'Kế toán đối tác trong quản trị',
      'app.summary': 'Nối điều khoản và tài khoản công nợ vào hồ sơ đối tác.',
      'app.category': 'Kế toán',
      'action.open': 'Thiết lập kế toán',
      'action.save': 'Lưu thiết lập',
      'action.back': 'Quay lại đối tác',
      'screen.title': 'Kế toán · {name}',
      'section.title': 'Điều khoản và tài khoản công nợ',
      'section.hint': 'Các lựa chọn chỉ áp dụng cho công ty đang hoạt động.',
      'field.paymentTerm': 'Điều khoản thanh toán',
      'field.receivable': 'Tài khoản phải thu',
      'field.payable': 'Tài khoản phải trả',
      'field.balance': 'Số dư công nợ',
      'error.notFound': 'Không tìm thấy đối tác.',
    },
    en: {
      'app.title': 'Partner accounting in admin',
      'app.summary': 'Connect payment terms and control accounts to partner records.',
      'app.category': 'Accounting',
      'action.open': 'Accounting setup',
      'action.save': 'Save setup',
      'action.back': 'Back to partner',
      'screen.title': 'Accounting · {name}',
      'section.title': 'Terms and control accounts',
      'section.hint': 'These choices apply only to the active company.',
      'field.paymentTerm': 'Payment term',
      'field.receivable': 'Receivable account',
      'field.payable': 'Payable account',
      'field.balance': 'Open balance',
      'error.notFound': 'Partner not found.',
    },
  },
})

export {
  type AccountingTerms,
  type AccountingTermsOptions,
  type AccountingTermsPartner,
  accountingTermsScreen,
} from './screens/index.ts'
