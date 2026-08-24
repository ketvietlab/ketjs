import { defineModule } from '@ketvietlab/ketjs'
import { routes } from './routes.ts'

export default defineModule({
  name: 'account_partner_backend',
  group: 'accounting',
  version: '0.1.0',
  depends: ['account_partner', 'partner_backend', 'backend'],
  install: 'auto',
  title: 'Kế toán đối tác trong quản trị',
  summary: 'Nối điều khoản và tài khoản công nợ vào hồ sơ đối tác.',
  category: 'Kế toán',
  routes,
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
      'error.notFound': 'Partner not found.',
    },
  },
})

export { accountingTermsScreen } from './screens.tsx'
