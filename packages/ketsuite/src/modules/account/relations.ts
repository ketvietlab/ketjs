import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'account.Account': { lines: { hasMany: 'account.MoveLine', by: 'accountId' } },
  'account.Defaults': {
    incomeAccount: { belongsTo: 'account.Account', by: 'incomeAccountId' },
    expenseAccount: { belongsTo: 'account.Account', by: 'expenseAccountId' },
    receivableAccount: { belongsTo: 'account.Account', by: 'receivableAccountId' },
    payableAccount: { belongsTo: 'account.Account', by: 'payableAccountId' },
  },
  'account.CategoryAccount': {
    category: { belongsTo: 'product.Category', by: 'categoryId' },
    incomeAccount: { belongsTo: 'account.Account', by: 'incomeAccountId' },
    expenseAccount: { belongsTo: 'account.Account', by: 'expenseAccountId' },
  },
  'account.Tax': { account: { belongsTo: 'account.Account', by: 'accountId' } },
  'account.ProductTax': {
    template: { belongsTo: 'product.Template', by: 'templateId' },
    tax: { belongsTo: 'account.Tax', by: 'taxId' },
  },
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
  'account.AssetCategory': {
    acquisitionAccount: { belongsTo: 'account.Account', by: 'acquisitionAccountId' },
    accumulatedAccount: { belongsTo: 'account.Account', by: 'accumulatedAccountId' },
    expenseAccount: { belongsTo: 'account.Account', by: 'expenseAccountId' },
    journal: { belongsTo: 'account.Journal', by: 'journalId' },
    assets: { hasMany: 'account.Asset', by: 'categoryId' },
  },
  'account.Asset': {
    category: { belongsTo: 'account.AssetCategory', by: 'categoryId' },
    events: { hasMany: 'account.AssetEvent', by: 'assetId' },
    changes: { hasMany: 'account.AssetChange', by: 'assetId' },
    schedule: { hasMany: 'account.AssetScheduleLine', by: 'assetId' },
  },
  'account.AssetChange': {
    asset: { belongsTo: 'account.Asset', by: 'assetId' },
    move: { belongsTo: 'account.Move', by: 'moveId' },
  },
  'account.AssetScheduleLine': {
    asset: { belongsTo: 'account.Asset', by: 'assetId' },
    move: { belongsTo: 'account.Move', by: 'moveId' },
  },
  'account.CostRun': {
    policy: { belongsTo: 'account.CostPolicy', by: 'policyId' },
    inputs: { hasMany: 'account.CostInput', by: 'runId' },
    variances: { hasMany: 'account.CostVariance', by: 'runId' },
  },
  'account.CostAdjustmentProposal': {
    run: { belongsTo: 'account.CostRun', by: 'runId' },
    variance: { belongsTo: 'account.CostVariance', by: 'varianceId' },
    move: { belongsTo: 'account.Move', by: 'moveId' },
  },
}
