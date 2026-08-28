import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  callFn,
  compose,
  defineFn,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import {
  account,
  accountingFilterDateText,
  addCivilDays,
  canonicalDecimalText,
  civilDateAt,
  company,
  currencyScale,
  DraftMoveBoundaryError,
  fiscalYearKey,
  insertDraftMove,
  MONEY_MAX_DIGITS,
  MONEY_POLICY_VERSION,
  MOVE_TYPES,
  partner,
  periodKey,
  product,
  quarterKey,
  quantizeMoneyText,
  TAX_AMOUNT_TYPES,
  uom,
} from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'
import { roundMoney } from '../packages/ketsuite/src/modules/account/money.ts'

const boundaryProbe = defineModule({
  name: 'account_boundary_probe',
  depends: ['account'],
  functions: {
    mutateDraftLine: defineFn({
      input: { id: 'id', balance: 'decimal?', amountResidual: 'decimal?' },
      effects: ['write:account.MoveLine'],
      handler: async (ctx, args) => {
        await ctx.db.update(
          'account.MoveLine',
          { id: args.id },
          {
            ...(args.balance === undefined ? {} : { balance: args.balance }),
            ...(args.amountResidual === undefined ? {} : { amountResidual: args.amountResidual }),
          },
        )
        return { ok: true }
      },
    }),
    insertDraft: defineFn({
      input: { id: 'id', creditAccountId: 'id', badBalance: 'bool?' },
      effects: [
        'read:company.Company',
        'read:account.Journal',
        'read:account.Account',
        'read:account.Move',
        'read:account.MoveLine',
        'write:account.Move',
        'write:account.MoveLine',
      ],
      handler: (ctx, args) =>
        ctx.tx((tx) =>
          insertDraftMove(tx, {
            move: {
              id: args.id,
              name: args.id,
              ref: null,
              date: '2026-08-20T00:00:00.000Z',
              moveType: 'entry',
              state: 'draft',
              journalId: 'sales',
              partnerId: null,
              invoiceDate: null,
              invoiceDateDue: null,
              paymentTermId: null,
              paymentState: 'paid',
              currency: 'VND',
              amountUntaxed: '10',
              amountTax: '0',
              amountTotal: '10',
              postedAt: null,
            },
            lines: [
              {
                id: `${String(args.id)}:debit`,
                moveId: args.id,
                name: 'Debit',
                accountId: 'bank',
                quantity: '1',
                priceUnit: '10',
                discount: '0',
                debit: '10',
                credit: '0',
                balance: '10',
                reconciled: false,
                amountResidual: '0',
                sequence: 10,
              },
              {
                id: `${String(args.id)}:credit`,
                moveId: args.id,
                name: 'Credit',
                accountId: args.creditAccountId,
                quantity: '1',
                priceUnit: '10',
                discount: '0',
                debit: '0',
                credit: '10',
                balance: args.badBalance ? '-9' : '-10',
                reconciled: false,
                amountResidual: '0',
                sequence: 20,
              },
            ],
          }),
        ),
    }),
  },
})

const modules = [address, partner, company, uom, product, account, boundaryProbe]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }

const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

test('accounting: half-up rounding survives binary representation at currency scale', () => {
  assert.equal(roundMoney(1.005, 2), 1.01)
  assert.equal(roundMoney(-1.005, 2), -1.01)
})

test('accounting: public money policy quantizes exact decimal text without Number', () => {
  assert.equal(MONEY_MAX_DIGITS, 38)
  assert.equal(MONEY_POLICY_VERSION, 'iso4217-half-away-v1')
  for (const [currency, input, output] of [
    ['VND', '1234567.5', '1234568'],
    ['VND', '-1234567.5', '-1234568'],
    ['VND', '9007199254740993.5', '9007199254740994'],
    ['USD', '1.005', '1.01'],
    ['USD', '-1.005', '-1.01'],
    ['USD', '-0.004', '0.00'],
    ['KWD', '1.2345', '1.235'],
  ] as const)
    assert.equal(quantizeMoneyText(input, currencyScale(currency)), output)

  assert.equal(canonicalDecimalText('+001.2300'), '1.23')
  assert.throws(() => currencyScale('XXX'), /unsupported currency/u)
  assert.throws(() => quantizeMoneyText('NaN', 2), /invalid canonical decimal/u)
  assert.throws(() => quantizeMoneyText('Infinity', 2), /invalid canonical decimal/u)
  assert.throws(() => quantizeMoneyText('1e3', 2), /invalid canonical decimal/u)
  assert.throws(() => quantizeMoneyText(1.005, 2), /canonical decimal string/u)
  assert.throws(() => quantizeMoneyText('123456789012345678901234567890123456789', 2), /38-digit/u)
})

test('accounting: civil dates are stable at Vietnam period boundaries', () => {
  assert.equal(civilDateAt('2026-07-31T16:59:59.999Z', 'Asia/Ho_Chi_Minh'), '2026-07-31')
  assert.equal(civilDateAt('2026-07-31T17:00:00.000Z', 'Asia/Ho_Chi_Minh'), '2026-08-01')
  assert.equal(civilDateAt('2026-12-31T17:00:00.000Z', 'Asia/Ho_Chi_Minh'), '2027-01-01')
  assert.equal(periodKey('2026-08-01'), '2026-08')
  assert.equal(quarterKey('2026-10-01'), '2026-Q4')
  assert.equal(fiscalYearKey('2027-01-01'), '2027')
  assert.equal(addCivilDays('2024-02-28', 1), '2024-02-29')
  assert.equal(accountingFilterDateText('2026-06-30T23:59:59.999Z'), '2026-06-30')
  assert.throws(() => civilDateAt('2026-02-30', 'Asia/Ho_Chi_Minh'), /invalid accounting date source/u)
  assert.throws(() => civilDateAt('2026-01-01T00:00:00.000Z', 'Mars/Olympus'), /invalid IANA/u)
})

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
  await call(
    'account.saveJournal',
    { id: 'purchase', name: 'Purchases', code: 'PUR', type: 'purchase' },
    adapter,
  )
  await call(
    'account.saveJournal',
    { id: 'bank-journal', name: 'Bank', code: 'BNK', type: 'bank', defaultAccountId: 'bank' },
    adapter,
  )
  await call(
    'account.saveTax',
    { id: 'vat10', name: 'VAT 10%', typeTaxUse: 'sale', amountType: 'percent', amount: '10' },
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
  return adapter
}

test('accounting: amounts beyond JavaScript safe integers stay exact through posting and reports', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.createMove',
      { id: 'large-entry', journalId: 'sales', moveType: 'entry', date: '2026-08-20T00:00:00.000Z' },
      adapter,
    )
    await call(
      'account.addMoveLine',
      {
        id: 'large-entry:debit',
        moveId: 'large-entry',
        name: 'Exact debit',
        accountId: 'bank',
        debit: '9007199254740994',
      },
      adapter,
    )
    await call(
      'account.addMoveLine',
      {
        id: 'large-entry:credit',
        moveId: 'large-entry',
        name: 'Exact credit',
        accountId: 'revenue',
        credit: '9007199254740994',
      },
      adapter,
    )
    assert.equal(((await call('account.postMove', { id: 'large-entry' }, adapter)).value as Row).ok, true)
    const move = (await call('account.getMove', { id: 'large-entry' }, adapter)).value as Row
    assert.equal(move.amountTotal, '9007199254740994')
    const trial = (await call('account.trialBalance', {}, adapter)).value as Row[]
    assert.equal(trial.find((row) => row.accountId === 'bank')?.debit, '9007199254740994')
    assert.equal(trial.find((row) => row.accountId === 'revenue')?.credit, '9007199254740994')

    const rejected = (
      await call(
        'account.createInvoice',
        {
          id: 'unsafe-number',
          journalId: 'sales',
          moveType: 'out_invoice',
          partnerId: 'customer',
          description: 'Must use exact text',
          quantity: '1',
          priceUnit: 1.005,
          lineAccountId: 'revenue',
          counterpartAccountId: 'receivable',
        },
        adapter,
      )
    ).value as Row
    assert.equal(rejected.ok, false)
  } finally {
    await adapter.close()
  }
})

test('accounting: posting freezes company-civil dates, policy and sequence year', async () => {
  const adapter = await boot()
  try {
    await call('account.initializeCompany', {}, adapter)
    const configured = (await call('company.getCompany', { id: 'acme' }, adapter)).value as Row
    assert.equal(configured.accountingTimezone, 'Asia/Ho_Chi_Minh')
    const timezoneChange = (
      await call(
        'company.saveCompany',
        {
          id: 'acme',
          partnerId: 'acme-party',
          currency: 'VND',
          accountingTimezone: 'UTC',
          expectedVersion: configured.version,
        },
        adapter,
      )
    ).value as Row
    assert.equal(timezoneChange.ok, false)
    assert.match(JSON.stringify(timezoneChange.errors), /accountingTimezoneLocked/u)

    const entry = async (id: string, date: string, amount: string, documentDate?: string) => {
      const created = (
        await call(
          'account.createMove',
          {
            id,
            journalId: 'sales',
            moveType: 'entry',
            date,
            ...(documentDate ? { documentDate } : {}),
          },
          adapter,
        )
      ).value as Row
      assert.equal(created.ok, true)
      await call(
        'account.addMoveLine',
        { id: `${id}:debit`, moveId: id, name: id, accountId: 'bank', debit: amount },
        adapter,
      )
      await call(
        'account.addMoveLine',
        { id: `${id}:credit`, moveId: id, name: id, accountId: 'revenue', credit: amount },
        adapter,
      )
      return (await call('account.postMove', { id }, adapter)).value as Row
    }

    await entry('before-midnight', '2026-07-31T16:59:59.999Z', '10', '2026-07-30')
    await entry('at-midnight', '2026-07-31T17:00:00.000Z', '20')
    const nextYear = await entry('next-civil-year', '2026-12-31T17:00:00.000Z', '30')
    assert.match(String(nextYear.name), /^SAL\/2027\//u)

    const before = (await call('account.getMove', { id: 'before-midnight' }, adapter)).value as Row
    const after = (await call('account.getMove', { id: 'at-midnight' }, adapter)).value as Row
    const year = (await call('account.getMove', { id: 'next-civil-year' }, adapter)).value as Row
    assert.equal(before.accountingDate, '2026-07-31')
    assert.equal(before.documentDate, '2026-07-30')
    assert.equal(after.accountingDate, '2026-08-01')
    assert.equal(year.accountingDate, '2027-01-01')
    assert.equal(year.moneyPolicyVersion, MONEY_POLICY_VERSION)

    const july = (
      await call('account.trialBalance', { dateFrom: '2026-07-31', dateTo: '2026-07-31' }, adapter)
    ).value as Row[]
    const august = (
      await call('account.trialBalance', { dateFrom: '2026-08-01', dateTo: '2026-08-01' }, adapter)
    ).value as Row[]
    assert.equal(july.find((row) => row.accountId === 'bank')?.debit, '10')
    assert.equal(august.find((row) => row.accountId === 'bank')?.debit, '20')
  } finally {
    await adapter.close()
  }
})

test('accounting: the shared draft boundary rejects malformed and cross-company ledger writes', async () => {
  const adapter = await boot()
  try {
    await assert.rejects(
      () =>
        call(
          'account_boundary_probe.insertDraft',
          { id: 'bad-balance', creditAccountId: 'revenue', badBalance: true },
          adapter,
        ),
      (error: unknown) => error instanceof DraftMoveBoundaryError && error.field === 'lines.balance',
    )
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM account_move WHERE id = ?', ['bad-balance']))[0]!.n,
      0,
    )

    const betaScope = { company: 'beta', branches: null }
    const betaCall = (name: string, args: Record<string, unknown>) =>
      callFn(name, args, { adapter, manifest, scope: betaScope })
    await betaCall('partner.savePartner', { id: 'beta-party', kind: 'company', name: 'Beta' })
    await betaCall('company.saveCompany', { id: 'beta', partnerId: 'beta-party', currency: 'VND' })
    await betaCall('account.saveAccount', {
      id: 'beta-revenue',
      code: '511',
      name: 'Beta revenue',
      accountType: 'income',
    })
    await assert.rejects(
      () =>
        call(
          'account_boundary_probe.insertDraft',
          { id: 'cross-company', creditAccountId: 'beta-revenue' },
          adapter,
        ),
      (error: unknown) => error instanceof DraftMoveBoundaryError && error.field === 'lines.accountId',
    )
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM account_move WHERE id = ?', ['cross-company']))[0]!.n,
      0,
    )
  } finally {
    await adapter.close()
  }
})

test('accounting: domain modules cannot bypass the shared draft boundary', async () => {
  for (const module of ['sale', 'purchase', 'pos']) {
    const source = await readFile(`packages/ketsuite/src/modules/${module}/functions.ts`, 'utf8')
    assert.doesNotMatch(source, /\.insert(?:IfAbsent)?\('account\.(?:Move|MoveLine)'/u, module)
    assert.match(source, /insertDraftMove/u, module)
  }
})

test('accounting: posting revalidates line, residual, account, and journal invariants', async () => {
  const adapter = await boot()
  try {
    await call('account.createMove', { id: 'post-guard', journalId: 'sales', moveType: 'entry' }, adapter)
    await call(
      'account.addMoveLine',
      { id: 'post-guard:debit', moveId: 'post-guard', name: 'Debit', accountId: 'bank', debit: '10' },
      adapter,
    )
    await call(
      'account.addMoveLine',
      { id: 'post-guard:credit', moveId: 'post-guard', name: 'Credit', accountId: 'revenue', credit: '10' },
      adapter,
    )

    await call('account_boundary_probe.mutateDraftLine', { id: 'post-guard:debit', balance: '9' }, adapter)
    let refused = (await call('account.postMove', { id: 'post-guard' }, adapter)).value as Row
    assert.equal((refused.errors as Row[])[0]?.code, 'account.error.lineBalanceInvalid')

    await call(
      'account_boundary_probe.mutateDraftLine',
      { id: 'post-guard:debit', balance: '10', amountResidual: '1' },
      adapter,
    )
    refused = (await call('account.postMove', { id: 'post-guard' }, adapter)).value as Row
    assert.equal((refused.errors as Row[])[0]?.code, 'account.error.lineResidualInvalid')

    await call(
      'account_boundary_probe.mutateDraftLine',
      { id: 'post-guard:debit', amountResidual: '0' },
      adapter,
    )
    await call(
      'account.saveAccount',
      { id: 'bank', code: '1121', name: 'Bank', accountType: 'asset_cash', active: false },
      adapter,
    )
    refused = (await call('account.postMove', { id: 'post-guard' }, adapter)).value as Row
    assert.equal((refused.errors as Row[])[0]?.code, 'account.error.accountInactive')

    await call(
      'account.saveAccount',
      { id: 'bank', code: '1121', name: 'Bank', accountType: 'asset_cash', active: true },
      adapter,
    )
    await call(
      'account.saveJournal',
      { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale', active: false },
      adapter,
    )
    refused = (await call('account.postMove', { id: 'post-guard' }, adapter)).value as Row
    assert.equal((refused.errors as Row[])[0]?.code, 'account.error.journalInactive')

    await call(
      'account.saveJournal',
      { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale', active: true },
      adapter,
    )
    assert.equal(((await call('account.postMove', { id: 'post-guard' }, adapter)).value as Row).ok, true)
  } finally {
    await adapter.close()
  }
})

test('accounting: customer invoice computes tax, due date, and balanced posting', async () => {
  const adapter = await boot()
  try {
    const created = await call(
      'account.createInvoice',
      {
        id: 'invoice-1',
        journalId: 'sales',
        moveType: 'out_invoice',
        partnerId: 'customer',
        invoiceDate: '2026-08-20T00:00:00.000Z',
        paymentTermId: 'net30',
        description: 'Consulting',
        quantity: '2',
        priceUnit: '100',
        lineAccountId: 'revenue',
        counterpartAccountId: 'receivable',
        taxId: 'vat10',
        taxAccountId: 'tax',
      },
      adapter,
    )
    assert.deepEqual(created.value, { ok: true, id: 'invoice-1', amountTotal: '220' })
    const invoice = (await call('account.getMove', { id: 'invoice-1' }, adapter)).value as Row & {
      lines: Row[]
    }
    assert.equal(Number(invoice.amountUntaxed), 200)
    assert.equal(Number(invoice.amountTax), 20)
    assert.equal(String(invoice.invoiceDateDue).slice(0, 10), '2026-09-19')
    assert.equal(
      invoice.lines.reduce((sum, line) => sum + Number(line.debit), 0),
      220,
    )
    assert.equal(
      invoice.lines.reduce((sum, line) => sum + Number(line.credit), 0),
      220,
    )
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

test('accounting: a product keeps its company-scoped sales tax in the account module', async () => {
  const adapter = await boot()
  try {
    await call('product.saveTemplate', { id: 'product-tax-template', name: 'Taxed', type: 'goods' }, adapter)
    const saved = (
      await call('account.setProductTax', { templateId: 'product-tax-template', taxId: 'vat10' }, adapter)
    ).value as Row
    assert.equal(saved.ok, true)
    assert.equal(
      ((await call('account.getProductTax', { templateId: 'product-tax-template' }, adapter)).value as Row)
        .taxId,
      'vat10',
    )

    await call('account.setProductTax', { templateId: 'product-tax-template', taxId: null }, adapter)
    assert.equal(
      (await call('account.getProductTax', { templateId: 'product-tax-template' }, adapter)).value,
      null,
    )
  } finally {
    await adapter.close()
  }
})

test('accounting: draft entries refuse imbalance and journal sequences advance without gaps', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.createMove',
      { id: 'bad', journalId: 'sales', moveType: 'entry', date: '2026-08-20T00:00:00.000Z' },
      adapter,
    )
    await call(
      'account.addMoveLine',
      { id: 'bad:1', moveId: 'bad', name: 'One-sided', accountId: 'bank', debit: '10' },
      adapter,
    )
    await call(
      'account.addMoveLine',
      { id: 'bad:2', moveId: 'bad', name: 'Wrong', accountId: 'revenue', credit: '9' },
      adapter,
    )
    const rejected = (await call('account.postMove', { id: 'bad' }, adapter)).value as Row
    assert.equal(rejected.ok, false)

    for (const id of ['a', 'b']) {
      await call(
        'account.createMove',
        { id, journalId: 'sales', moveType: 'entry', date: '2026-08-20T00:00:00.000Z' },
        adapter,
      )
      await call(
        'account.addMoveLine',
        { id: `${id}:d`, moveId: id, name: 'Debit', accountId: 'bank', debit: '10' },
        adapter,
      )
      await call(
        'account.addMoveLine',
        { id: `${id}:c`, moveId: id, name: 'Credit', accountId: 'revenue', credit: '10' },
        adapter,
      )
    }
    const results = []
    for (const id of ['a', 'b']) results.push(await call('account.postMove', { id }, adapter))
    const names = results.map((result) => String((result.value as Row).name)).sort()
    assert.deepEqual(names, ['SAL/2026/00001', 'SAL/2026/00002'])
  } finally {
    await adapter.close()
  }
})

test('accounting: partial payments reconcile residuals and update invoice payment state', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.createInvoice',
      {
        id: 'invoice-1',
        journalId: 'sales',
        moveType: 'out_invoice',
        partnerId: 'customer',
        description: 'Subscription',
        quantity: '1',
        priceUnit: '220',
        lineAccountId: 'revenue',
        counterpartAccountId: 'receivable',
      },
      adapter,
    )
    await call('account.postMove', { id: 'invoice-1' }, adapter)
    const invoice = (await call('account.getMove', { id: 'invoice-1' }, adapter)).value as Row & {
      lines: Row[]
    }
    const receivable = invoice.lines.find((line) => line.accountId === 'receivable')!

    for (const [id, amount, state] of [
      ['payment-1', '100', 'partial'],
      ['payment-2', '120', 'paid'],
    ] as const) {
      const payment = {
        id,
        name: id,
        paymentType: 'inbound',
        partnerType: 'customer',
        partnerId: 'customer',
        journalId: 'bank-journal',
        destinationAccountId: 'receivable',
        amount,
        reconcileLineId: receivable.id,
      }
      const first = (await call('account.registerPayment', payment, adapter)).value as Row
      assert.equal(first.ok, true, JSON.stringify(first))
      const retry = (await call('account.registerPayment', payment, adapter)).value as Row
      assert.equal(retry.ok, true, JSON.stringify(retry))
      assert.equal(
        ((await call('account.getMove', { id: 'invoice-1' }, adapter)).value as Row).paymentState,
        state,
      )
    }
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_partial_reconcile'))[0]!.n, 2)
  } finally {
    await adapter.close()
  }
})

test('accounting: reports read posted lines only and preserve stable selection codes', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.createInvoice',
      {
        id: 'invoice-1',
        journalId: 'sales',
        moveType: 'out_invoice',
        partnerId: 'customer',
        description: 'Service',
        quantity: '1',
        priceUnit: '100',
        lineAccountId: 'revenue',
        counterpartAccountId: 'receivable',
      },
      adapter,
    )
    assert.deepEqual((await call('account.trialBalance', {}, adapter)).value, [])
    await call('account.postMove', { id: 'invoice-1' }, adapter)
    const trial = (await call('account.trialBalance', {}, adapter)).value as Row[]
    assert.equal(
      trial.reduce((sum, row) => sum + Number(row.debit), 0),
      100,
    )
    assert.equal(
      trial.reduce((sum, row) => sum + Number(row.credit), 0),
      100,
    )
    assert.deepEqual(MOVE_TYPES, [
      'entry',
      'out_invoice',
      'out_refund',
      'in_invoice',
      'in_refund',
      'out_receipt',
      'in_receipt',
    ])
  } finally {
    await adapter.close()
  }
})

test('accounting: a VND invoice settles at the amount the ledger shows', async () => {
  const adapter = await boot()
  try {
    // 1,234,567 plus 10% VAT is 1,358,023.7 under two-decimal arithmetic. VND has
    // no minor unit, so the open item must be a whole number of đồng — otherwise
    // the amount the screen prints back can never clear it.
    const created = (
      await call(
        'account.createInvoice',
        {
          id: 'invoice-vnd',
          journalId: 'sales',
          moveType: 'out_invoice',
          partnerId: 'customer',
          description: 'Dich vu',
          quantity: '1',
          priceUnit: '1234567',
          lineAccountId: 'revenue',
          counterpartAccountId: 'receivable',
          taxId: 'vat10',
          taxAccountId: 'tax',
        },
        adapter,
      )
    ).value as Row
    assert.equal(created.amountTotal, '1358024')
    await call('account.postMove', { id: 'invoice-vnd' }, adapter)

    const open = (await call('account.listOpenItems', {}, adapter)).value as Row[]
    assert.equal(open.length, 1)
    assert.equal(Number(open[0]!.amountResidual), 1358024)

    const paid = (
      await call(
        'account.registerPayment',
        {
          id: 'payment-vnd',
          name: 'PAY/1',
          paymentType: 'inbound',
          partnerType: 'customer',
          partnerId: 'customer',
          journalId: 'bank-journal',
          destinationAccountId: 'receivable',
          amount: '1358024',
          reconcileLineId: open[0]!.id,
        },
        adapter,
      )
    ).value as Row
    assert.equal(paid.ok, true)
    assert.equal(
      ((await call('account.getMove', { id: 'invoice-vnd' }, adapter)).value as Row).paymentState,
      'paid',
    )
  } finally {
    await adapter.close()
  }
})

test('accounting: a tax that affects the base compounds into the next one', async () => {
  const adapter = await boot()
  try {
    // With several taxes on a line each one posts to its own account, so both have
    // to name one — a single `taxAccountId` override would be ambiguous.
    await call(
      'account.saveTax',
      {
        id: 'vat10',
        name: 'VAT 10%',
        typeTaxUse: 'sale',
        amountType: 'percent',
        amount: '10',
        accountId: 'tax',
        sequence: 10,
      },
      adapter,
    )
    await call(
      'account.saveTax',
      {
        id: 'import5',
        name: 'Thue nhap khau 5%',
        typeTaxUse: 'sale',
        amountType: 'percent',
        amount: '5',
        includeBaseAmount: true,
        accountId: 'tax',
        sequence: 5,
      },
      adapter,
    )
    const quote = (
      await call(
        'account.quoteLine',
        { quantity: '1', priceUnit: '1000000', taxIds: ['vat10', 'import5'] },
        adapter,
      )
    ).value as Row
    assert.deepEqual(
      [quote.amountUntaxed, quote.amountTax, quote.amountTotal],
      ['1000000', '155000', '1155000'],
    )
    assert.deepEqual(
      (quote.taxes as Row[]).map((tax) => [tax.id, tax.share]),
      [
        ['import5', '50000'],
        ['vat10', '105000'],
      ],
    )
    const created = (
      await call(
        'account.createInvoice',
        {
          id: 'invoice-import',
          journalId: 'sales',
          moveType: 'out_invoice',
          partnerId: 'customer',
          description: 'Hang nhap khau',
          quantity: '1',
          priceUnit: '1000000',
          lineAccountId: 'revenue',
          counterpartAccountId: 'receivable',
          taxIds: ['vat10', 'import5'],
        },
        adapter,
      )
    ).value as Row
    // Import duty of 5% on 1,000,000 is 50,000 and joins the base, so VAT of 10%
    // applies to 1,050,000 and is 105,000 rather than 100,000.
    assert.equal(created.amountTotal, '1155000')
    const invoice = (await call('account.getMove', { id: 'invoice-import' }, adapter)).value as Row & {
      lines: Row[]
    }
    assert.equal(Number(invoice.amountUntaxed), 1000000)
    assert.equal(Number(invoice.amountTax), 155000)
    assert.deepEqual(
      invoice.lines
        .filter((line) => line.accountId === 'tax')
        .map((line) => Number(line.credit))
        .sort((a, b) => a - b),
      [50000, 105000],
    )
    assert.equal(
      invoice.lines.reduce((sum, line) => sum + Number(line.debit), 0),
      invoice.lines.reduce((sum, line) => sum + Number(line.credit), 0),
    )
  } finally {
    await adapter.close()
  }
})

test('accounting: the public quote separates a price-included percentage before submit', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.saveTax',
      {
        id: 'vat-included',
        name: 'VAT 10% included',
        typeTaxUse: 'sale',
        amountType: 'percent',
        amount: '10',
        priceInclude: true,
      },
      adapter,
    )
    const quote = (
      await call('account.quoteLine', { quantity: '1', priceUnit: '110', taxIds: ['vat-included'] }, adapter)
    ).value as Row
    assert.deepEqual([quote.amountUntaxed, quote.amountTax, quote.amountTotal], ['100', '10', '110'])
  } finally {
    await adapter.close()
  }
})

test('accounting: a posted entry is corrected by its reversal, not by editing', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.createInvoice',
      {
        id: 'invoice-1',
        journalId: 'sales',
        moveType: 'out_invoice',
        partnerId: 'customer',
        description: 'Wrong amount',
        quantity: '1',
        priceUnit: '500',
        lineAccountId: 'revenue',
        counterpartAccountId: 'receivable',
      },
      adapter,
    )
    await call('account.postMove', { id: 'invoice-1' }, adapter)
    assert.equal(((await call('account.cancelMove', { id: 'invoice-1' }, adapter)).value as Row).ok, false)

    const reversed = (
      await call('account.reverseMove', { id: 'invoice-1', reversalId: 'reversal-1' }, adapter)
    ).value as Row
    assert.equal(reversed.ok, true)

    const reversal = (await call('account.getMove', { id: 'reversal-1' }, adapter)).value as Row & {
      lines: Row[]
    }
    const original = (await call('account.getMove', { id: 'invoice-1' }, adapter)).value as Row & {
      lines: Row[]
    }
    assert.equal(reversal.state, 'posted')
    assert.equal(reversal.reversalOfId, original.id)
    assert.equal(original.reversedById, reversal.id)
    assert.equal(reversal.reversalStatus, 'completed')
    // The mirror image: every debit met by a credit of the same amount.
    assert.equal(
      reversal.lines.reduce((sum, line) => sum + Number(line.debit), 0),
      original.lines.reduce((sum, line) => sum + Number(line.credit), 0),
    )
    // Nothing is left owed, and the document records why.
    assert.equal(original.paymentState, 'reversed')
    assert.equal(
      original.lines.reduce((sum, line) => sum + Number(line.amountResidual), 0),
      0,
    )
    assert.deepEqual((await call('account.listOpenItems', {}, adapter)).value, [])
    // Both entries stay in the ledger, and together they net to nothing.
    assert.equal(
      ((await call('account.trialBalance', {}, adapter)).value as Row[]).reduce(
        (sum, row) => sum + Number(row.balance),
        0,
      ),
      0,
    )

    // Replaying the correction does not post a second one.
    assert.equal(
      (
        (await call('account.reverseMove', { id: 'invoice-1', reversalId: 'reversal-1' }, adapter))
          .value as Row
      ).ok,
      true,
    )
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_move'))[0]!.n, 2)
    const secondReversal = (
      await call('account.reverseMove', { id: 'invoice-1', reversalId: 'reversal-2' }, adapter)
    ).value as Row
    assert.equal(secondReversal.ok, false)
    assert.equal((secondReversal.errors as Row[])[0]?.message, 'the entry already has a different reversal')
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_move'))[0]!.n, 2)
  } finally {
    await adapter.close()
  }
})

test('accounting: reversing resumes after the mirror was posted but settlement did not finish', async () => {
  const adapter = await boot()
  try {
    await call('account.saveJournal', { id: 'misc', name: 'Misc', code: 'MISC', type: 'general' }, adapter)
    const invoiceArgs = {
      id: 'invoice-resume',
      journalId: 'sales',
      moveType: 'out_invoice',
      partnerId: 'customer',
      invoiceDate: '2026-08-20T00:00:00.000Z',
      description: 'Consulting',
      quantity: '1',
      priceUnit: '500',
      lineAccountId: 'revenue',
      counterpartAccountId: 'receivable',
    }
    await call('account.createInvoice', invoiceArgs, adapter)
    await call('account.postMove', { id: invoiceArgs.id }, adapter)
    const reversalId = 'reversal-resume'
    const reversalDate = '2026-08-21T00:00:00.000Z'
    let interrupted = false
    const failureAfterPost: Adapter = {
      ...adapter,
      async run(sql, params) {
        if (
          !interrupted &&
          sql.startsWith('UPDATE') &&
          sql.includes('account_move') &&
          sql.includes('"reversalStatus"') &&
          params?.includes('posted')
        ) {
          interrupted = true
          throw new Error('injected reversal interruption after post')
        }
        return adapter.run(sql, params)
      },
    }
    await assert.rejects(
      () =>
        call(
          'account.reverseMove',
          {
            id: invoiceArgs.id,
            reversalId,
            journalId: 'misc',
            date: reversalDate,
            ref: 'Correction batch',
          },
          failureAfterPost,
        ),
      /injected reversal interruption after post/u,
    )
    assert.equal(interrupted, true)
    const interruptedReversal = (await call('account.getMove', { id: reversalId }, adapter)).value as Row
    assert.equal(interruptedReversal.state, 'posted')
    assert.equal(interruptedReversal.reversalOfId, invoiceArgs.id)
    assert.equal(interruptedReversal.reversalStatus, 'creating')
    assert.equal(
      ((await call('account.getMove', { id: invoiceArgs.id }, adapter)).value as Row).paymentState,
      'not_paid',
      'this is the durable state left by a crash after posting the mirror',
    )

    // The retry only needs the command identity; omitted optional fields resume
    // from the durable mirror instead of reverting its custom journal/ref/date.
    const resumed = (await call('account.reverseMove', { id: invoiceArgs.id, reversalId }, adapter))
      .value as Row
    assert.equal(resumed.ok, true)
    const settled = (await call('account.getMove', { id: invoiceArgs.id }, adapter)).value as Row & {
      lines: Row[]
    }
    assert.equal(settled.paymentState, 'reversed')
    const completedReversal = (await call('account.getMove', { id: reversalId }, adapter)).value as Row
    assert.equal(settled.reversedById, reversalId)
    assert.equal(completedReversal.reversalOfId, invoiceArgs.id)
    assert.equal(completedReversal.reversalStatus, 'completed')
    assert.equal(completedReversal.journalId, 'misc')
    assert.equal(completedReversal.ref, 'Correction batch')
    assert.equal(completedReversal.date, reversalDate)
    assert.equal(
      settled.lines.reduce((sum, line) => sum + Number(line.amountResidual), 0),
      0,
    )
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_partial_reconcile'))[0]!.n, 1)

    assert.equal(
      ((await call('account.reverseMove', { id: invoiceArgs.id, reversalId }, adapter)).value as Row).ok,
      true,
      'a completed resume is idempotent too',
    )
  } finally {
    await adapter.close()
  }
})

test('accounting: posting a manual entry records the total it carries', async () => {
  const adapter = await boot()
  try {
    await call('account.saveJournal', { id: 'misc', name: 'Misc', code: 'MISC', type: 'general' }, adapter)
    await call('account.createMove', { id: 'entry-1', journalId: 'misc', moveType: 'entry' }, adapter)
    for (const [id, account, side] of [
      ['entry-1:d', 'bank', 'debit'],
      ['entry-1:c', 'revenue', 'credit'],
    ] as const)
      await call(
        'account.addMoveLine',
        { id, moveId: 'entry-1', name: id, accountId: account, [side]: '5000000' },
        adapter,
      )
    await call('account.postMove', { id: 'entry-1' }, adapter)
    const entry = (await call('account.getMove', { id: 'entry-1' }, adapter)).value as Row
    assert.equal(Number(entry.amountTotal), 5000000)
    assert.equal(Number(entry.amountUntaxed), 5000000)
    assert.equal(Number(entry.amountTax), 0)
  } finally {
    await adapter.close()
  }
})

test('accounting: a journal item id cannot be quietly reused for a different line', async () => {
  const adapter = await boot()
  try {
    await call('account.saveJournal', { id: 'misc', name: 'Misc', code: 'MISC', type: 'general' }, adapter)
    await call('account.createMove', { id: 'entry-1', journalId: 'misc', moveType: 'entry' }, adapter)
    const line = { id: 'line-1', moveId: 'entry-1', name: 'Debit', accountId: 'bank', debit: '10' }
    assert.equal(((await call('account.addMoveLine', line, adapter)).value as Row).existing, false)
    // The identical call again is the retry it looks like.
    assert.equal(((await call('account.addMoveLine', line, adapter)).value as Row).existing, true)
    // A different line under a taken id is a lost write, not a retry.
    assert.equal(
      ((await call('account.addMoveLine', { ...line, debit: '99' }, adapter)).value as Row).ok,
      false,
    )
  } finally {
    await adapter.close()
  }
})

test('accounting: retries require the same normalized financial creation payload', async () => {
  const adapter = await boot()
  try {
    await call('account.saveJournal', { id: 'misc', name: 'Misc', code: 'MISC', type: 'general' }, adapter)
    const move = {
      id: 'entry-idempotent',
      journalId: 'misc',
      moveType: 'entry',
      date: '2026-08-20T00:00:00.000Z',
      ref: 'Batch A',
    }
    assert.equal(((await call('account.createMove', move, adapter)).value as Row).ok, true)
    assert.equal(((await call('account.createMove', move, adapter)).value as Row).ok, true)
    const reusedMove = (await call('account.createMove', { ...move, ref: 'Batch B' }, adapter)).value as Row
    assert.equal(reusedMove.ok, false)
    assert.equal((reusedMove.errors as Row[])[0]?.code, 'account.error.moveIdReused')

    const invoice = {
      id: 'invoice-idempotent',
      journalId: 'sales',
      moveType: 'out_invoice',
      partnerId: 'customer',
      invoiceDate: '2026-08-20T00:00:00.000Z',
      description: 'Consulting',
      quantity: '1',
      priceUnit: '100',
      lineAccountId: 'revenue',
      counterpartAccountId: 'receivable',
    }
    assert.equal(((await call('account.createInvoice', invoice, adapter)).value as Row).ok, true)
    await call('account.postMove', { id: invoice.id }, adapter)
    assert.equal(
      (
        (
          await call(
            'account.createInvoice',
            { ...invoice, quantity: '+01.0', priceUnit: '+0100.00', discount: '0.00' },
            adapter,
          )
        ).value as Row
      ).amountTotal,
      '100',
      'equivalent decimals replay after mutable posting fields changed',
    )
    // A financially different line under the same document id is a conflict,
    // even though mutable state such as posting name and revision is ignored.
    const reusedInvoice = (await call('account.createInvoice', { ...invoice, priceUnit: '101' }, adapter))
      .value as Row
    assert.equal(reusedInvoice.ok, false)
    assert.equal((reusedInvoice.errors as Row[])[0]?.code, 'account.error.invoiceIdReused')
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_move'))[0]!.n, 2)
  } finally {
    await adapter.close()
  }
})

test('accounting: journal items advance the move revision before posting can claim it', async () => {
  const adapter = await boot()
  try {
    await call('account.saveJournal', { id: 'misc', name: 'Misc', code: 'MISC', type: 'general' }, adapter)
    await call(
      'account.createMove',
      {
        id: 'entry-revision',
        journalId: 'misc',
        moveType: 'entry',
        date: '2026-08-20T00:00:00.000Z',
      },
      adapter,
    )
    const debit = {
      id: 'entry-revision:debit',
      moveId: 'entry-revision',
      name: 'Debit',
      accountId: 'bank',
      debit: '10',
      expectedRevision: 0,
    }
    assert.equal(((await call('account.addMoveLine', debit, adapter)).value as Row).ok, true)
    assert.equal(
      (
        (
          await call(
            'account.addMoveLine',
            {
              id: 'entry-revision:credit',
              moveId: 'entry-revision',
              name: 'Credit',
              accountId: 'revenue',
              credit: '10',
              expectedRevision: 1,
            },
            adapter,
          )
        ).value as Row
      ).ok,
      true,
    )
    assert.equal(
      ((await call('account.getMove', { id: 'entry-revision' }, adapter)).value as Row).revision,
      2,
    )

    const stale = (await call('account.postMove', { id: 'entry-revision', expectedRevision: 1 }, adapter))
      .value as Row
    assert.equal(stale.ok, false)
    assert.equal((stale.errors as Row[])[0]?.code, 'account.error.moveConcurrent')
    assert.equal(
      ((await call('account.getMove', { id: 'entry-revision' }, adapter)).value as Row).state,
      'draft',
    )

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        call('account.postMove', { id: 'entry-revision', expectedRevision: 2 }, adapter),
      ),
    )
    assert.ok(attempts.every((attempt) => (attempt.value as Row).ok === true))
    assert.equal(new Set(attempts.map((attempt) => (attempt.value as Row).name)).size, 1)

    assert.equal(
      ((await call('account.addMoveLine', debit, adapter)).value as Row).existing,
      true,
      'the exact completed add is still an idempotent success after posting',
    )
    assert.equal(
      (
        (
          await call(
            'account.addMoveLine',
            {
              id: 'entry-revision:late',
              moveId: 'entry-revision',
              name: 'Late',
              accountId: 'bank',
              debit: '1',
            },
            adapter,
          )
        ).value as Row
      ).ok,
      false,
    )
  } finally {
    await adapter.close()
  }
})

test('accounting: an invoice takes its accounts from the configuration, narrowest first', async () => {
  const adapter = await boot()
  try {
    // The chart answers "which account" the same way every time, so the document
    // should not be asking. Nothing configured beyond the company defaults yet.
    await call(
      'account.saveDefaults',
      { incomeAccountId: 'revenue', receivableAccountId: 'receivable' },
      adapter,
    )
    const line = {
      journalId: 'sales',
      moveType: 'out_invoice',
      partnerId: 'customer',
      description: 'Dịch vụ',
      quantity: '1',
      priceUnit: '1000000',
    }
    const accountsOf = async (id: string) =>
      Object.fromEntries(
        ((await call('account.getMove', { id }, adapter)).value as Row & { lines: Row[] }).lines.map(
          (row) => [String(row.id).split(':').pop(), row.accountId],
        ),
      )

    await call('account.createInvoice', { id: 'inv-company', ...line }, adapter)
    assert.deepEqual(await accountsOf('inv-company'), {
      base: 'revenue',
      counterpart: 'receivable',
    })

    // A product category is narrower than the company, so it wins for the line.
    await call('product.saveCategory', { id: 'services', name: 'Dịch vụ' }, adapter)
    await call(
      'product.saveTemplate',
      { id: 'consulting', name: 'Tư vấn', type: 'service', categoryId: 'services', listPrice: '0' },
      adapter,
    )
    await call('product.saveVariant', { id: 'consulting-1', templateId: 'consulting' }, adapter)
    await call(
      'account.saveAccount',
      { id: 'other-revenue', code: '515', name: 'Tài chính', accountType: 'income' },
      adapter,
    )
    await call(
      'account.saveCategoryAccount',
      { categoryId: 'services', incomeAccountId: 'other-revenue' },
      adapter,
    )
    await call('account.createInvoice', { id: 'inv-category', productId: 'consulting-1', ...line }, adapter)
    assert.deepEqual(await accountsOf('inv-category'), {
      base: 'other-revenue',
      counterpart: 'receivable',
    })

    // An explicit choice still wins over every default.
    await call(
      'account.createInvoice',
      { id: 'inv-explicit', productId: 'consulting-1', lineAccountId: 'revenue', ...line },
      adapter,
    )
    assert.deepEqual(await accountsOf('inv-explicit'), {
      base: 'revenue',
      counterpart: 'receivable',
    })
  } finally {
    await adapter.close()
  }
})

test('accounting: an invoice with nothing to fall back on says so instead of guessing', async () => {
  const adapter = await boot()
  try {
    await call('account.saveDefaults', {}, adapter)
    const refused = (
      await call(
        'account.createInvoice',
        {
          id: 'inv-undecided',
          journalId: 'sales',
          moveType: 'out_invoice',
          partnerId: 'customer',
          description: 'Dịch vụ',
          quantity: '1',
          priceUnit: '1000',
        },
        adapter,
      )
    ).value as Row
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]!.field, 'lineAccountId')
    assert.equal((refused.errors as Row[])[0]!.code, 'account.error.lineAccountUndecided')
  } finally {
    await adapter.close()
  }
})

test('accounting: a default that the ledger would later refuse cannot be saved', async () => {
  const adapter = await boot()
  try {
    // 'bank' is asset_cash — a receivable default has to be a receivable account,
    // or every invoice using it fails at posting time instead of here.
    const refused = (await call('account.saveDefaults', { receivableAccountId: 'bank' }, adapter))
      .value as Row
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]!.field, 'receivableAccountId')
  } finally {
    await adapter.close()
  }
})

test('accounting: a tax computation the ledger cannot apply is refused at save time', async () => {
  const adapter = await boot()
  try {
    assert.deepEqual(TAX_AMOUNT_TYPES, ['fixed', 'percent', 'division'])
    const refused = (
      await call(
        'account.saveTax',
        { id: 'grouped', name: 'Group', typeTaxUse: 'sale', amountType: 'group', amount: '0' },
        adapter,
      )
    ).value as Row
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]!.field, 'amountType')
  } finally {
    await adapter.close()
  }
})

test('accounting: reversing a payment stops it reading as received', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.createInvoice',
      {
        id: 'invoice-p',
        journalId: 'sales',
        moveType: 'out_invoice',
        partnerId: 'customer',
        description: 'Consulting',
        quantity: '1',
        priceUnit: '1000',
        lineAccountId: 'revenue',
        counterpartAccountId: 'receivable',
      },
      adapter,
    )
    await call('account.postMove', { id: 'invoice-p' }, adapter)
    const open = (await call('account.listOpenItems', {}, adapter)).value as Row[]
    const paid = (
      await call(
        'account.registerPayment',
        {
          id: 'pay-1',
          name: 'Receipt',
          paymentType: 'inbound',
          partnerType: 'customer',
          partnerId: 'customer',
          journalId: 'bank-journal',
          destinationAccountId: 'receivable',
          amount: '1000',
          reconcileLineId: open[0]!.id,
        },
        adapter,
      )
    ).value as Row
    assert.equal(paid.ok, true)
    assert.equal(((await call('account.listPayments', {}, adapter)).value as Row[])[0]?.state, 'paid')

    // A payment's own move is an `entry`, so the branch that marks an invoice
    // `reversed` never reached it: the money left the books while the payments
    // list went on saying the customer had paid.
    const reversed = (
      await call('account.reverseMove', { id: paid.moveId, reversalId: 'pay-1-reversal' }, adapter)
    ).value as Row
    assert.equal(reversed.ok, true)
    assert.equal(((await call('account.listPayments', {}, adapter)).value as Row[])[0]?.state, 'reversed')
  } finally {
    await adapter.close()
  }
})

test('accounting: a payment id cannot be quietly reused for a different amount', async () => {
  const adapter = await boot()
  try {
    const register = (amount: string) =>
      call(
        'account.registerPayment',
        {
          id: 'pay-dup',
          name: 'Receipt',
          paymentType: 'inbound',
          partnerType: 'customer',
          partnerId: 'customer',
          journalId: 'bank-journal',
          destinationAccountId: 'receivable',
          amount,
        },
        adapter,
      )
    assert.equal(((await register('1000')).value as Row).ok, true)
    // Replaying the same call is a success — the queue retries, and a person
    // pressing a button twice must not post twice.
    assert.equal(((await register('1000')).value as Row).ok, true)

    // A different amount under a taken id is not a retry. Accepting it would
    // leave the recorded move at 1000 while settling an open item for 250.
    const different = (await register('250')).value as Row
    assert.equal(different.ok, false)
    assert.equal((different.errors as Row[])[0]?.code, 'account.error.paymentIdReused')

    const retargeted = (
      await call(
        'account.registerPayment',
        {
          id: 'pay-dup',
          name: 'Receipt',
          paymentType: 'inbound',
          partnerType: 'customer',
          partnerId: 'customer',
          journalId: 'bank-journal',
          destinationAccountId: 'receivable',
          amount: '1000',
          reconcileLineId: 'another-open-item',
        },
        adapter,
      )
    ).value as Row
    assert.equal(retargeted.ok, false)
    assert.equal((retargeted.errors as Row[])[0]?.code, 'account.error.paymentIdReused')
    assert.equal(
      ((await call('account.listPayments', {}, adapter)).value as Row[]).filter((row) => row.id === 'pay-dup')
        .length,
      1,
    )
  } finally {
    await adapter.close()
  }
})

test('accounting: a price-included fixed tax larger than the line is refused', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.saveTax',
      {
        id: 'stamp',
        name: 'Stamp duty',
        typeTaxUse: 'sale',
        amountType: 'fixed',
        amount: '5000',
        priceInclude: true,
        accountId: 'tax',
      },
      adapter,
    )
    // Left alone this made the base negative, which posts a credit to revenue as
    // a debit and reverses the sign of the sale in the ledger.
    const refused = (
      await call(
        'account.createInvoice',
        {
          id: 'invoice-neg',
          journalId: 'sales',
          moveType: 'out_invoice',
          partnerId: 'customer',
          description: 'Small sale',
          quantity: '1',
          priceUnit: '1000',
          lineAccountId: 'revenue',
          counterpartAccountId: 'receivable',
          taxId: 'stamp',
        },
        adapter,
      )
    ).value as Row
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]?.code, 'account.error.taxFixedExceedsLine')
    assert.equal((await call('account.getMove', { id: 'invoice-neg' }, adapter)).value, null)
  } finally {
    await adapter.close()
  }
})

test('accounting: an invoice of several lines posts one tax line per rate', async () => {
  const adapter = await boot()
  try {
    // A hotel folio is the case this exists for: nights at one rate, food at
    // another, on one document the guest signs once.
    await call(
      'account.saveTax',
      { id: 'vat8', name: 'VAT 8%', typeTaxUse: 'sale', amountType: 'percent', amount: '8' },
      adapter,
    )
    const created = await call(
      'account.createInvoice',
      {
        id: 'folio-1',
        journalId: 'sales',
        moveType: 'out_invoice',
        partnerId: 'customer',
        counterpartAccountId: 'receivable',
        lines: [
          {
            description: 'Phong Deluxe, 2 dem',
            quantity: '2',
            priceUnit: '500',
            lineAccountId: 'revenue',
            taxId: 'vat8',
            taxAccountId: 'tax',
          },
          {
            description: 'Minibar',
            quantity: '1',
            priceUnit: '100',
            lineAccountId: 'revenue',
            taxId: 'vat10',
            taxAccountId: 'tax',
          },
          {
            description: 'Nha hang',
            quantity: '1',
            priceUnit: '200',
            lineAccountId: 'revenue',
            taxId: 'vat10',
            taxAccountId: 'tax',
          },
        ],
      },
      adapter,
    )
    assert.deepEqual(created.value, { ok: true, id: 'folio-1', amountTotal: '1410' })

    const invoice = (await call('account.getMove', { id: 'folio-1' }, adapter)).value as Row & {
      lines: Row[]
    }
    assert.equal(Number(invoice.amountUntaxed), 1300)
    assert.equal(Number(invoice.amountTax), 110)
    // Three revenue lines, one tax line per rate — not one per revenue line —
    // and a single receivable, which is what the guest owes.
    assert.deepEqual(
      invoice.lines.map((line) => [String(line.id), Number(line.debit), Number(line.credit)]),
      [
        ['folio-1:base', 0, 1000],
        ['folio-1:base:1', 0, 100],
        ['folio-1:base:2', 0, 200],
        ['folio-1:tax', 0, 80],
        ['folio-1:tax:vat10', 0, 30],
        ['folio-1:counterpart', 1410, 0],
      ],
    )
    assert.equal(
      invoice.lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0),
      0,
    )
    assert.deepEqual((await call('account.postMove', { id: 'folio-1' }, adapter)).value, {
      ok: true,
      id: 'folio-1',
      name: 'SAL/2026/00001',
    })

    // Both shapes at once would leave the shorthand's line either dropped or
    // appended, and neither is visible from the call site.
    const refused = (
      await call(
        'account.createInvoice',
        {
          id: 'folio-2',
          journalId: 'sales',
          moveType: 'out_invoice',
          partnerId: 'customer',
          description: 'Phong',
          quantity: '1',
          priceUnit: '100',
          lines: [{ description: 'Phong', quantity: '1', priceUnit: '100' }],
        },
        adapter,
      )
    ).value as Row
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]?.code, 'account.error.invoiceLinesAndSingle')
  } finally {
    await adapter.close()
  }
})
