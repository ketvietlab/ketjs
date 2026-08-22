import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { reportFunctions, reports } from './reports.ts'

export default defineModule({
  name: 'account',
  // 0.3.0: currency-scaled amounts, several taxes per line, reverseMove, and
  // `group` removed from TAX_AMOUNT_TYPES.
  version: '0.3.0',
  depends: ['company', 'partner', 'product', 'uom'],
  app: true,
  title: 'Kế toán',
  summary: 'Sổ cái, hoá đơn, thanh toán và hệ thống tài khoản Việt Nam theo TT99.',
  category: 'Tài chính',
  models,
  relations,
  functions: { ...functions, ...reportFunctions },
  reports,
  messages: {
    vi: {
      'app.title': 'Kế toán',
      'app.summary': 'Sổ cái, hoá đơn, thanh toán và hệ thống tài khoản Việt Nam theo TT99.',
      'app.category': 'Tài chính',
      'report.customerInvoice': 'HÓA ĐƠN KHÁCH HÀNG',
      'report.vendorBill': 'HÓA ĐƠN NHÀ CUNG CẤP',
      'report.number': 'Số',
      'report.date': 'Ngày',
      'report.partner': 'Đối tác',
      'report.description': 'Mô tả',
      'report.quantity': 'Số lượng',
      'report.unitPrice': 'Đơn giá',
      'report.balance': 'Giá trị',
      'report.untaxed': 'Trước thuế',
      'report.tax': 'Thuế',
      'report.total': 'Tổng cộng',
    },
    en: {
      'app.title': 'Accounting',
      'app.summary': 'Ledger, invoices, payments, and Vietnam accounting defaults under Circular 99.',
      'app.category': 'Finance',
      'report.customerInvoice': 'CUSTOMER INVOICE',
      'report.vendorBill': 'VENDOR BILL',
      'report.number': 'Number',
      'report.date': 'Date',
      'report.partner': 'Partner',
      'report.description': 'Description',
      'report.quantity': 'Quantity',
      'report.unitPrice': 'Unit price',
      'report.balance': 'Amount',
      'report.untaxed': 'Untaxed',
      'report.tax': 'Tax',
      'report.total': 'Total',
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
export {
  TT99_ACCOUNTS,
  TT99_ACCOUNT_CHECKSUM,
  TT99_CATALOG_CHECKSUM,
  TT99_CODE,
  VIETNAM_TAXES,
} from './tt99.ts'
