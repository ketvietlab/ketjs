import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'account.Account': { lines: { hasMany: 'account.MoveLine', by: 'accountId' } },
  'account.Tax': { account: { belongsTo: 'account.Account', by: 'accountId' } },
  'account.Journal': {
    defaultAccount: { belongsTo: 'account.Account', by: 'defaultAccountId' },
    moves: { hasMany: 'account.Move', by: 'journalId' },
  },
  'account.PaymentTerm': { lines: { hasMany: 'account.PaymentTermLine', by: 'paymentId' } },
  'account.PaymentTermLine': { payment: { belongsTo: 'account.PaymentTerm', by: 'paymentId' } },
  'account.Move': {
    journal: { belongsTo: 'account.Journal', by: 'journalId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    paymentTerm: { belongsTo: 'account.PaymentTerm', by: 'paymentTermId' },
    lines: { hasMany: 'account.MoveLine', by: 'moveId' },
  },
  'account.MoveLine': {
    move: { belongsTo: 'account.Move', by: 'moveId' },
    account: { belongsTo: 'account.Account', by: 'accountId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    product: { belongsTo: 'product.Product', by: 'productId' },
    productUom: { belongsTo: 'uom.Unit', by: 'productUomId' },
    tax: { belongsTo: 'account.Tax', by: 'taxId' },
  },
  'account.PartialReconcile': {
    debitMove: { belongsTo: 'account.MoveLine', by: 'debitMoveId' },
    creditMove: { belongsTo: 'account.MoveLine', by: 'creditMoveId' },
  },
  'account.Payment': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    journal: { belongsTo: 'account.Journal', by: 'journalId' },
    destinationAccount: { belongsTo: 'account.Account', by: 'destinationAccountId' },
    move: { belongsTo: 'account.Move', by: 'moveId' },
  },
}
