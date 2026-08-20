import { defineModule } from 'ketjs'
import { functions } from './functions.ts'

export default defineModule({
  name: 'account_partner',
  version: '0.1.0',
  depends: ['account', 'partner'],
  install: 'auto',
  app: true,
  title: 'Kế toán đối tác',
  summary: 'Điều khoản thanh toán và tài khoản công nợ theo pháp nhân.',
  category: 'Kế toán',
  extend: {
    'partner.CompanyTerms': {
      paymentTermId: 'ref:account.PaymentTerm?',
      receivableAccountId: 'ref:account.Account?',
      payableAccountId: 'ref:account.Account?',
    },
  },
  relations: {
    'partner.CompanyTerms': {
      paymentTerm: { belongsTo: 'account.PaymentTerm', by: 'paymentTermId' },
      receivableAccount: { belongsTo: 'account.Account', by: 'receivableAccountId' },
      payableAccount: { belongsTo: 'account.Account', by: 'payableAccountId' },
    },
  },
  functions,
  messages: {
    vi: {
      'app.title': 'Kế toán đối tác',
      'app.summary': 'Điều khoản thanh toán và tài khoản công nợ theo pháp nhân.',
      'app.category': 'Kế toán',
      'error.partnerMissing': 'Đối tác không tồn tại.',
      'error.paymentTermMissing': 'Điều khoản thanh toán không tồn tại trong công ty hiện tại.',
      'error.accountMissing': 'Tài khoản kế toán không tồn tại trong công ty hiện tại.',
      'error.accountType': 'Loại tài khoản không phù hợp với mục đích công nợ.',
    },
    en: {
      'app.title': 'Partner accounting',
      'app.summary': 'Company payment terms and receivable/payable accounts.',
      'app.category': 'Accounting',
      'error.partnerMissing': 'The partner does not exist.',
      'error.paymentTermMissing': 'The payment term does not exist in the active company.',
      'error.accountMissing': 'The account does not exist in the active company.',
      'error.accountType': 'The account type does not match this control-account purpose.',
    },
  },
})
