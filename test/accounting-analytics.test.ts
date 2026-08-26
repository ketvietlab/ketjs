/**
 * The aggregates behind the accounting overview.
 *
 * One ledger is built once and every assertion reads it, because the point of
 * these functions is that they agree with each other: total assets must equal
 * liabilities plus equity plus the result, the open items must add up to the
 * receivable balance, and a period figure must not move when the balance-sheet
 * date does. Separate fixtures per test would let each of those drift apart
 * while every test still passed.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { account, address, company, partner, product, uom } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, uom, product, account]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }

const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

/**
 * A function declaring no `output` shape hands its return value back under
 * `value`; one that declares a shape returns the shape itself. Every analytics
 * function is the first kind, so reading through `value` once here keeps the
 * assertions about the numbers rather than about the envelope.
 */
const read = async (name: string, args: Record<string, unknown>, adapter: Adapter): Promise<Row> =>
  (await call(name, args, adapter)).value as Row
const readAll = async (name: string, args: Record<string, unknown>, adapter: Adapter): Promise<Row[]> =>
  (await call(name, args, adapter)).value as Row[]

const JUNE = { dateFrom: '2026-06-01T00:00:00.000Z', dateTo: '2026-06-30T23:59:59.999Z' }
const MAY = { dateFrom: '2026-05-01T00:00:00.000Z', dateTo: '2026-05-31T23:59:59.999Z' }

/**
 * A ledger with two months in it, so a window means something.
 *
 * May: opening stock, one sale, one vendor bill that falls due inside June.
 * June: two sales to two customers, the cost of the goods behind one of them, a
 * second vendor bill, and a part payment against the May invoice.
 */
async function boot(): Promise<Adapter> {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  for (const [id, name] of [
    ['acme-party', 'ACME'],
    ['customer', 'Công ty TNHH ABC'],
    ['customer-two', 'Công ty CP XYZ'],
    ['supplier', 'Công ty VLXD An Phát'],
    ['supplier-two', 'Công ty Điện Máy Tín Thành'],
  ])
    await call('partner.savePartner', { id, kind: 'company', name }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
  for (const [id, code, name, accountType] of [
    ['receivable', '131', 'Phải thu khách hàng', 'asset_receivable'],
    ['payable', '331', 'Phải trả người bán', 'liability_payable'],
    ['bank', '1121', 'Tiền gửi ngân hàng', 'asset_cash'],
    ['inventory', '156', 'Hàng hoá', 'asset_current'],
    ['capital', '4111', 'Vốn góp', 'equity'],
    ['goods', '5111', 'Doanh thu bán hàng hoá', 'income'],
    ['services', '5113', 'Doanh thu dịch vụ', 'income'],
    ['cogs', '632', 'Giá vốn hàng bán', 'expense_direct_cost'],
    ['admin', '6422', 'Chi phí quản lý', 'expense'],
    ['offbook', '002', 'Vật tư giữ hộ', 'off_balance'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  for (const [id, name, code, type, defaultAccountId] of [
    ['sales', 'Sales', 'SAL', 'sale', ''],
    ['purchases', 'Purchases', 'PUR', 'purchase', ''],
    ['bank-journal', 'Bank', 'BNK', 'bank', 'bank'],
    ['general', 'General', 'GEN', 'general', ''],
  ])
    await call(
      'account.saveJournal',
      { id, name, code, type, ...(defaultAccountId ? { defaultAccountId } : {}) },
      adapter,
    )
  await call('account.savePaymentTerm', { id: 'net30', name: '30 Days' }, adapter)
  await call(
    'account.savePaymentTermLine',
    {
      id: 'net30:line',
      paymentId: 'net30',
      value: 'percent',
      valueAmount: '100',
      delayType: 'days_after',
      nbDays: 30,
    },
    adapter,
  )

  const entry = async (
    id: string,
    date: string,
    lines: Array<[string, string, number, number]>,
  ): Promise<void> => {
    await call('account.createMove', { id, journalId: 'general', date }, adapter)
    for (const [lineId, accountId, debit, credit] of lines)
      await call(
        'account.addMoveLine',
        { id: lineId, moveId: id, name: lineId, accountId, debit: String(debit), credit: String(credit) },
        adapter,
      )
    await call('account.postMove', { id }, adapter)
  }

  const invoice = async (
    id: string,
    moveType: string,
    journalId: string,
    partnerId: string,
    invoiceDate: string,
    lineAccountId: string,
    counterpartAccountId: string,
    priceUnit: number,
  ): Promise<void> => {
    const created = (await call(
      'account.createInvoice',
      {
        id,
        journalId,
        moveType,
        partnerId,
        invoiceDate,
        paymentTermId: 'net30',
        description: id,
        quantity: '1',
        priceUnit: String(priceUnit),
        lineAccountId,
        counterpartAccountId,
      },
      adapter,
    )) as Row
    assert.equal(created.ok, true, `invoice ${id} was refused: ${JSON.stringify(created.errors)}`)
    await call('account.postMove', { id }, adapter)
  }

  // Opening balance, and a holding account that must stay out of every total.
  await entry('opening', '2026-05-01T00:00:00.000Z', [
    ['opening:stock', 'inventory', 3000, 0],
    ['opening:capital', 'capital', 0, 3000],
  ])
  await entry('held', '2026-05-02T00:00:00.000Z', [
    ['held:in', 'offbook', 9999, 0],
    ['held:out', 'offbook', 0, 9999],
  ])

  await invoice(
    'may-sale',
    'out_invoice',
    'sales',
    'customer',
    '2026-05-15T00:00:00.000Z',
    'goods',
    'receivable',
    1000,
  )
  await invoice(
    'may-bill',
    'in_invoice',
    'purchases',
    'supplier',
    '2026-05-20T00:00:00.000Z',
    'admin',
    'payable',
    200,
  )

  await invoice(
    'june-goods',
    'out_invoice',
    'sales',
    'customer',
    '2026-06-10T00:00:00.000Z',
    'goods',
    'receivable',
    2000,
  )
  await invoice(
    'june-services',
    'out_invoice',
    'sales',
    'customer-two',
    '2026-06-20T00:00:00.000Z',
    'services',
    'receivable',
    500,
  )
  await invoice(
    'june-bill',
    'in_invoice',
    'purchases',
    'supplier-two',
    '2026-06-12T00:00:00.000Z',
    'admin',
    'payable',
    300,
  )
  await entry('june-cogs', '2026-06-10T00:00:00.000Z', [
    ['june-cogs:cost', 'cogs', 1200, 0],
    ['june-cogs:stock', 'inventory', 0, 1200],
  ])

  // Part payment of the May invoice, so one open item is partly settled and still
  // overdue: the case where an aging built from invoice totals gets it wrong.
  const open = await readAll('account.listOpenItems', { partnerId: 'customer' }, adapter)
  const mayLine = open.find((line) => String(line.moveId) === 'may-sale')
  assert.ok(mayLine, 'the May invoice should have left an open item')
  const paid = (await call(
    'account.registerPayment',
    {
      id: 'june-receipt',
      name: 'PAY/2026/0001',
      paymentType: 'inbound',
      partnerType: 'customer',
      partnerId: 'customer',
      journalId: 'bank-journal',
      destinationAccountId: 'receivable',
      amount: '400',
      date: '2026-06-25T00:00:00.000Z',
      reconcileLineId: mayLine.id,
    },
    adapter,
  )) as Row
  assert.equal(paid.ok, true, `payment was refused: ${JSON.stringify(paid.errors)}`)
  return adapter
}

test('analytics: performance reports the window it was asked for, not the whole ledger', async () => {
  const adapter = await boot()
  try {
    const june = await read('account.performance', JUNE, adapter)
    assert.equal(june.revenue, '2500')
    assert.equal(june.costOfSales, '1200')
    assert.equal(june.operatingExpense, '300')
    assert.equal(june.expense, '1500')
    assert.equal(june.grossProfit, '1300')
    assert.equal(june.profit, '1000')
    assert.equal(june.grossMargin, 1300 / 2500)

    const may = await read('account.performance', MAY, adapter)
    assert.equal(may.revenue, '1000')
    assert.equal(may.costOfSales, '0')
    assert.equal(may.operatingExpense, '200')
    assert.equal(may.profit, '800')
  } finally {
    await adapter.close?.()
  }
})

test('analytics: performance names the accounts behind each total, largest first', async () => {
  const adapter = await boot()
  try {
    const june = await read('account.performance', JUNE, adapter)
    const revenue = june.revenueByAccount as Row[]
    assert.deepEqual(
      revenue.map((row) => [row.code, row.amount]),
      [
        ['5111', '2000'],
        ['5113', '500'],
      ],
    )
    const expense = june.expenseByAccount as Row[]
    assert.deepEqual(
      expense.map((row) => [row.code, row.amount]),
      [
        ['632', '1200'],
        ['6422', '300'],
      ],
    )
    // Each breakdown adds up to the headline it explains, which is the only
    // reason a donut beside a total is readable at all.
    const sum = (rows: Row[]) => rows.reduce((total, row) => total + Number(row.amount), 0)
    assert.equal(sum(revenue), Number(june.revenue))
    assert.equal(sum(expense), Number(june.expense))
  } finally {
    await adapter.close?.()
  }
})

test('analytics: a period with no sales has no gross margin rather than a zero one', async () => {
  const adapter = await boot()
  try {
    const quiet = await read(
      'account.performance',
      { dateFrom: '2026-07-01T00:00:00.000Z', dateTo: '2026-07-31T23:59:59.999Z' },
      adapter,
    )
    assert.equal(quiet.revenue, '0')
    assert.equal(quiet.grossMargin, null)
  } finally {
    await adapter.close?.()
  }
})

test('analytics: position balances, and holds off-balance accounts out of it', async () => {
  const adapter = await boot()
  try {
    const at = await read('account.position', { asOf: JUNE.dateTo }, adapter)
    assert.equal(at.cash, '400')
    // Receivable 3100 + cash 400 + stock 1800. The 9999 parked in an off-balance
    // account is held, not owned, and must not inflate any of it.
    assert.equal(at.assets, '5300')
    assert.equal(at.liabilities, '500')
    const may = await read('account.performance', MAY, adapter)
    const june = await read('account.performance', JUNE, adapter)
    const equity = 3000 + Number(may.profit) + Number(june.profit)
    assert.equal(Number(at.assets), Number(at.liabilities) + equity)
  } finally {
    await adapter.close?.()
  }
})

test('analytics: a balance is as at a date, so narrowing the window cannot shrink it', async () => {
  const adapter = await boot()
  try {
    const whole = await read('account.position', { asOf: JUNE.dateTo }, adapter)
    const earlier = await read('account.position', { asOf: MAY.dateTo }, adapter)
    assert.equal(earlier.cash, '0')
    assert.equal(earlier.assets, '4000')
    assert.ok(Number(whole.assets) >= Number(earlier.assets))
  } finally {
    await adapter.close?.()
  }
})

test('analytics: the revenue timeline buckets by day and lands each move on its own date', async () => {
  const adapter = await boot()
  try {
    const line = await read('account.revenueTimeline', JUNE, adapter)
    assert.equal(line.granularity, 'day')
    const points = line.points as Row[]
    assert.equal(points.length, 30)
    const on = (label: string) => points.find((point) => point.label === label)
    assert.equal(on('2026-06-10')?.revenue, '2000')
    assert.equal(on('2026-06-10')?.costOfSales, '1200')
    assert.equal(on('2026-06-20')?.revenue, '500')
    assert.equal(on('2026-06-11')?.revenue, '0')
    // Buckets hold what happened inside them, so they sum to the period total.
    const june = await read('account.performance', JUNE, adapter)
    assert.equal(
      points.reduce((total, point) => total + Number(point.revenue), 0),
      Number(june.revenue),
    )
  } finally {
    await adapter.close?.()
  }
})

test('analytics: a long window buckets by month instead of by day', async () => {
  const adapter = await boot()
  try {
    const line = await read(
      'account.revenueTimeline',
      { dateFrom: '2026-01-01T00:00:00.000Z', dateTo: '2026-12-31T23:59:59.999Z' },
      adapter,
    )
    assert.equal(line.granularity, 'month')
    const points = line.points as Row[]
    assert.equal(points.length, 12)
    assert.equal(points.find((point) => point.label === '2026-05')?.revenue, '1000')
    assert.equal(points.find((point) => point.label === '2026-06')?.revenue, '2500')
  } finally {
    await adapter.close?.()
  }
})

test('analytics: open items split by due date and agree with the control balance', async () => {
  const adapter = await boot()
  try {
    const summary = await read('account.openItemSummary', { asOf: JUNE.dateTo }, adapter)
    const receivable = summary.receivable as Row
    // 600 left of the May invoice, due 14 June and so overdue; June's 2500 is not.
    assert.equal(receivable.total, '3100')
    assert.equal(receivable.overdue, '600')
    assert.equal(receivable.current, '2500')
    const position = await read('account.position', { asOf: JUNE.dateTo }, adapter)
    // Receivable is the only reconciled asset here, so the open items must add up
    // to what the balance sheet says is still owed: 5300 − 400 cash − 1800 stock.
    assert.equal(Number(receivable.total), Number(position.assets) - 400 - 1800)

    const payable = summary.payable as Row
    assert.equal(payable.total, '500')
    assert.equal(payable.overdue, '200')
    assert.equal(payable.current, '300')
  } finally {
    await adapter.close?.()
  }
})

test('analytics: open items rank the partners who owe most, both ways', async () => {
  const adapter = await boot()
  try {
    const summary = await read('account.openItemSummary', { asOf: JUNE.dateTo }, adapter)
    assert.deepEqual(
      ((summary.receivable as Row).partners as Row[]).map((row) => [row.name, row.total, row.overdue]),
      [
        ['Công ty TNHH ABC', '2600', '600'],
        ['Công ty CP XYZ', '500', '0'],
      ],
    )
    assert.deepEqual(
      ((summary.payable as Row).partners as Row[]).map((row) => [row.name, row.total]),
      [
        ['Công ty Điện Máy Tín Thành', '300'],
        ['Công ty VLXD An Phát', '200'],
      ],
    )
    const capped = await read('account.openItemSummary', { asOf: JUNE.dateTo, partnerLimit: 1 }, adapter)
    assert.equal(((capped.receivable as Row).partners as Row[]).length, 1)
  } finally {
    await adapter.close?.()
  }
})

test('analytics: cash flow follows the money and files it by its counterpart', async () => {
  const adapter = await boot()
  try {
    const flow = await read('account.cashFlow', JUNE, adapter)
    // The only cash that moved in June was the 400 receipt settling a receivable.
    assert.equal(flow.sales, '400')
    assert.equal(flow.purchases, '0')
    assert.equal(flow.operating, '0')
    assert.equal(flow.net, '400')
    // And it is exactly the change in the cash balance over the same window.
    const before = await read('account.position', { asOf: MAY.dateTo }, adapter)
    const after = await read('account.position', { asOf: JUNE.dateTo }, adapter)
    assert.equal(Number(flow.net), Number(after.cash) - Number(before.cash))
  } finally {
    await adapter.close?.()
  }
})

test('analytics: drafts are not in any aggregate until they are posted', async () => {
  const adapter = await boot()
  try {
    const before = await read('account.performance', JUNE, adapter)
    await call(
      'account.createInvoice',
      {
        id: 'june-draft',
        journalId: 'sales',
        moveType: 'out_invoice',
        partnerId: 'customer',
        invoiceDate: '2026-06-28T00:00:00.000Z',
        description: 'not posted',
        quantity: '1',
        priceUnit: '9000',
        lineAccountId: 'goods',
        counterpartAccountId: 'receivable',
      },
      adapter,
    )
    const draft = await read('account.performance', JUNE, adapter)
    assert.equal(draft.revenue, before.revenue)
    await call('account.postMove', { id: 'june-draft' }, adapter)
    const posted = await read('account.performance', JUNE, adapter)
    assert.equal(Number(posted.revenue), Number(before.revenue) + 9000)
  } finally {
    await adapter.close?.()
  }
})
