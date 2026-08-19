import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import { account, company, MOVE_TYPES, partner, product, uom } from 'ketsuite'

const modules = [partner, company, uom, product, account]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }

const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  for (const [id, code, name, accountType] of [
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['payable', '331', 'Payable', 'liability_payable'],
    ['bank', '1121', 'Bank', 'asset_cash'],
    ['revenue', '5111', 'Sales', 'income'],
    ['expense', '6421', 'Expense', 'expense'],
    ['tax', '3331', 'VAT Payable', 'liability_current'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' }, adapter)
  await call('account.saveJournal', { id: 'purchase', name: 'Purchases', code: 'PUR', type: 'purchase' }, adapter)
  await call('account.saveJournal', { id: 'bank-journal', name: 'Bank', code: 'BNK', type: 'bank', defaultAccountId: 'bank' }, adapter)
  await call('account.saveTax', { id: 'vat10', name: 'VAT 10%', typeTaxUse: 'sale', amountType: 'percent', amount: '10' }, adapter)
  await call('account.savePaymentTerm', { id: 'net30', name: '30 Days' }, adapter)
  await call('account.savePaymentTermLine', { id: 'net30:line', paymentId: 'net30', value: 'percent', valueAmount: '100', delayType: 'days_after', nbDays: 30 }, adapter)
  return adapter
}

test('account 19: customer invoice computes tax, due date, and balanced posting', async () => {
  const adapter = await boot()
  try {
    const created = await call('account.createInvoice', {
      id: 'invoice-1', journalId: 'sales', moveType: 'out_invoice', partnerId: 'customer',
      invoiceDate: '2026-08-20T00:00:00.000Z', paymentTermId: 'net30', description: 'Consulting',
      quantity: '2', priceUnit: '100', lineAccountId: 'revenue', counterpartAccountId: 'receivable',
      taxId: 'vat10', taxAccountId: 'tax',
    }, adapter)
    assert.deepEqual(created.value, { ok: true, id: 'invoice-1', amountTotal: '220' })
    const invoice = (await call('account.getMove', { id: 'invoice-1' }, adapter)).value as Row & { lines: Row[] }
    assert.equal(Number(invoice.amountUntaxed), 200)
    assert.equal(Number(invoice.amountTax), 20)
    assert.equal(String(invoice.invoiceDateDue).slice(0, 10), '2026-09-19')
    assert.equal(invoice.lines.reduce((sum, line) => sum + Number(line.debit), 0), 220)
    assert.equal(invoice.lines.reduce((sum, line) => sum + Number(line.credit), 0), 220)
    assert.deepEqual(
      Object.fromEntries(invoice.lines.map((line) => [line.id, Number(line.amountResidual)])),
      { 'invoice-1:base': 0, 'invoice-1:tax': 0, 'invoice-1:counterpart': 220 },
    )
    const posted = await call('account.postMove', { id: 'invoice-1' }, adapter)
    assert.deepEqual(posted.value, { ok: true, id: 'invoice-1', name: 'SAL/2026/00001' })
  } finally {
    await adapter.close()
  }
})

test('account 19: draft entries refuse imbalance and journal sequences advance without gaps', async () => {
  const adapter = await boot()
  try {
    await call('account.createMove', { id: 'bad', journalId: 'sales', moveType: 'entry', date: '2026-08-20T00:00:00.000Z' }, adapter)
    await call('account.addMoveLine', { id: 'bad:1', moveId: 'bad', name: 'One-sided', accountId: 'bank', debit: '10' }, adapter)
    await call('account.addMoveLine', { id: 'bad:2', moveId: 'bad', name: 'Wrong', accountId: 'revenue', credit: '9' }, adapter)
    const rejected = (await call('account.postMove', { id: 'bad' }, adapter)).value as Row
    assert.equal(rejected.ok, false)

    for (const id of ['a', 'b']) {
      await call('account.createMove', { id, journalId: 'sales', moveType: 'entry', date: '2026-08-20T00:00:00.000Z' }, adapter)
      await call('account.addMoveLine', { id: `${id}:d`, moveId: id, name: 'Debit', accountId: 'bank', debit: '10' }, adapter)
      await call('account.addMoveLine', { id: `${id}:c`, moveId: id, name: 'Credit', accountId: 'revenue', credit: '10' }, adapter)
    }
    const results = []
    for (const id of ['a', 'b']) results.push(await call('account.postMove', { id }, adapter))
    const names = results.map((result) => String((result.value as Row).name)).sort()
    assert.deepEqual(names, ['SAL/2026/00001', 'SAL/2026/00002'])
  } finally {
    await adapter.close()
  }
})

test('account 19: partial payments reconcile residuals and update invoice payment state', async () => {
  const adapter = await boot()
  try {
    await call('account.createInvoice', {
      id: 'invoice-1', journalId: 'sales', moveType: 'out_invoice', partnerId: 'customer',
      description: 'Subscription', quantity: '1', priceUnit: '220', lineAccountId: 'revenue', counterpartAccountId: 'receivable',
    }, adapter)
    await call('account.postMove', { id: 'invoice-1' }, adapter)
    const invoice = (await call('account.getMove', { id: 'invoice-1' }, adapter)).value as Row & { lines: Row[] }
    const receivable = invoice.lines.find((line) => line.accountId === 'receivable')!

    for (const [id, amount, state] of [
      ['payment-1', '100', 'partial'],
      ['payment-2', '120', 'paid'],
    ] as const) {
      const payment = {
        id, name: id, paymentType: 'inbound', partnerType: 'customer', partnerId: 'customer',
        journalId: 'bank-journal', destinationAccountId: 'receivable', amount,
        reconcileLineId: receivable.id,
      }
      await call('account.registerPayment', payment, adapter)
      assert.equal(((await call('account.registerPayment', payment, adapter)).value as Row).ok, true)
      assert.equal(((await call('account.getMove', { id: 'invoice-1' }, adapter)).value as Row).paymentState, state)
    }
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_partial_reconcile'))[0]!.n, 2)
  } finally {
    await adapter.close()
  }
})

test('account 19: reports read posted lines only and preserve Odoo selection codes', async () => {
  const adapter = await boot()
  try {
    await call('account.createInvoice', {
      id: 'invoice-1', journalId: 'sales', moveType: 'out_invoice', partnerId: 'customer',
      description: 'Service', quantity: '1', priceUnit: '100', lineAccountId: 'revenue', counterpartAccountId: 'receivable',
    }, adapter)
    assert.deepEqual((await call('account.trialBalance', {}, adapter)).value, [])
    await call('account.postMove', { id: 'invoice-1' }, adapter)
    const trial = (await call('account.trialBalance', {}, adapter)).value as Row[]
    assert.equal(trial.reduce((sum, row) => sum + Number(row.debit), 0), 100)
    assert.equal(trial.reduce((sum, row) => sum + Number(row.credit), 0), 100)
    assert.deepEqual(MOVE_TYPES, [
      'entry', 'out_invoice', 'out_refund', 'in_invoice', 'in_refund', 'out_receipt', 'in_receipt',
    ])
  } finally {
    await adapter.close()
  }
})
