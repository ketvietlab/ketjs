type Fixture = (name: string, input: Record<string, unknown>) => Promise<unknown>

/**
 * A deliberately jurisdiction-neutral chart used by public HTTP tests.
 * Production deployments install their own localization instead.
 */
export async function seedAccountingTestFixture(fixture: Fixture): Promise<void> {
  for (const [id, code, name, accountType] of [
    ['core-cash', 'CASH', 'Cash', 'asset_cash'],
    ['core-bank', 'BANK', 'Bank', 'asset_cash'],
    ['core-receivable', 'AR', 'Trade receivables', 'asset_receivable'],
    ['core-payable', 'AP', 'Trade payables', 'liability_payable'],
    ['core-revenue', 'REV', 'Revenue', 'income'],
    ['core-other-revenue', 'REV.OTHER', 'Other revenue', 'income_other'],
    ['core-expense', 'EXP', 'Expense', 'expense'],
    ['core-output-tax', 'TAX.OUT', 'Output tax', 'liability_current'],
    ['core-input-tax', 'TAX.IN', 'Input tax', 'asset_current'],
  ])
    await fixture('account.saveAccount', { id, code, name, accountType })

  for (const [id, name, code, type, defaultAccountId] of [
    ['core-general', 'General', 'GEN', 'general', null],
    ['core-sales', 'Sales', 'SAL', 'sale', null],
    ['core-purchases', 'Purchases', 'PUR', 'purchase', null],
    ['core-bank-journal', 'Bank', 'BNK', 'bank', 'core-bank'],
    ['core-cash-journal', 'Cash', 'CSH', 'cash', 'core-cash'],
  ])
    await fixture('account.saveJournal', {
      id,
      name,
      code,
      type,
      ...(defaultAccountId ? { defaultAccountId } : {}),
    })

  await fixture('account.saveTax', {
    id: 'core-sale-tax',
    name: 'Sales tax 10%',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
    accountId: 'core-output-tax',
  })
  await fixture('account.saveTax', {
    id: 'core-purchase-tax',
    name: 'Purchase tax 10%',
    typeTaxUse: 'purchase',
    amountType: 'percent',
    amount: '10',
    accountId: 'core-input-tax',
  })
  await fixture('account.savePaymentTerm', { id: 'core-immediate', name: 'Immediate' })
  await fixture('account.savePaymentTermLine', {
    id: 'core-immediate-line',
    paymentId: 'core-immediate',
    value: 'percent',
    valueAmount: '100',
    delayType: 'days_after',
    nbDays: 0,
  })
  await fixture('account.savePaymentTerm', { id: 'core-net30', name: 'Net 30' })
  await fixture('account.savePaymentTermLine', {
    id: 'core-net30-line',
    paymentId: 'core-net30',
    value: 'percent',
    valueAmount: '100',
    delayType: 'days_after',
    nbDays: 30,
  })
  await fixture('account.saveDefaults', {
    incomeAccountId: 'core-revenue',
    expenseAccountId: 'core-expense',
    receivableAccountId: 'core-receivable',
    payableAccountId: 'core-payable',
  })
}
