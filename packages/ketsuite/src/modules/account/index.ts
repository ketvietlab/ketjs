import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'account',
  version: '0.1.0',
  depends: ['company', 'partner', 'product', 'uom'],
  app: true,
  title: 'Kế toán',
  summary: 'Sổ cái, hoá đơn, thanh toán và đối soát theo subset Odoo 19.',
  category: 'Tài chính',
  models,
  relations,
  functions,
  messages: {
    vi: {
      'app.title': 'Kế toán',
      'app.summary': 'Sổ cái, hoá đơn, thanh toán và đối soát theo subset Odoo 19.',
      'app.category': 'Tài chính',
    },
    en: {
      'app.title': 'Accounting',
      'app.summary': 'Ledger, invoices, payments, and reconciliation from the Odoo 19 subset.',
      'app.category': 'Finance',
    },
  },
})

export {
  ACCOUNT_TYPES,
  JOURNAL_TYPES,
  MOVE_TYPES,
  MOVE_STATES,
  PAYMENT_STATES,
  PAYMENT_TYPES,
  PARTNER_TYPES,
  PAYMENT_TERM_VALUES,
  PAYMENT_TERM_DELAY_TYPES,
  TAX_USES,
  TAX_AMOUNT_TYPES,
} from './functions.ts'
