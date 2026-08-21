import { asc, defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { ACCOUNT_SETUP_EFFECTS, ensureCompanyAccounting } from './setup.ts'

export const ACCOUNT_TYPES = [
  'asset_receivable',
  'asset_cash',
  'asset_current',
  'asset_non_current',
  'asset_prepayments',
  'asset_fixed',
  'liability_payable',
  'liability_credit_card',
  'liability_current',
  'liability_non_current',
  'equity',
  'equity_unaffected',
  'income',
  'income_other',
  'expense',
  'expense_other',
  'expense_depreciation',
  'expense_direct_cost',
  'off_balance',
] as const
export const JOURNAL_TYPES = ['sale', 'purchase', 'cash', 'bank', 'general'] as const
export const MOVE_TYPES = [
  'entry',
  'out_invoice',
  'out_refund',
  'in_invoice',
  'in_refund',
  'out_receipt',
  'in_receipt',
] as const
export const MOVE_STATES = ['draft', 'posted', 'cancel'] as const
export const PAYMENT_STATES = [
  'not_paid',
  'in_payment',
  'paid',
  'partial',
  'reversed',
  'blocked',
  'invoicing_legacy',
] as const
export const TAX_USES = ['sale', 'purchase', 'none'] as const
export const TAX_AMOUNT_TYPES = ['group', 'fixed', 'percent', 'division'] as const
export const PAYMENT_TYPES = ['outbound', 'inbound'] as const
export const PARTNER_TYPES = ['customer', 'supplier'] as const
export const PAYMENT_TERM_VALUES = ['percent', 'fixed'] as const
export const PAYMENT_TERM_DELAY_TYPES = [
  'days_after',
  'days_after_end_of_month',
  'days_after_end_of_next_month',
  'days_end_of_month_on_the',
] as const

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const n = (value: unknown): number => Number(value ?? 0)
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100
const decimal = (value: number): string => String(money(value))
const today = (): string => new Date().toISOString()

async function companyCurrency(ctx: Ctx): Promise<string> {
  if (!ctx.scope.company) throw new Error('accounting requires an active company')
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  if (!company) throw new Error(`company ${ctx.scope.company} does not exist`)
  return String(company.currency)
}

async function accountOf(ctx: Ctx, id: unknown): Promise<Row | null> {
  return (await ctx.db.select('account.Account', { id }))[0] ?? null
}

async function dueDate(ctx: Ctx, paymentTermId: unknown, date: Date): Promise<string> {
  if (!paymentTermId) return date.toISOString()
  const lines = (await ctx.db.select('account.PaymentTermLine', { paymentId: paymentTermId })).sort(
    (a, b) => n(a.sequence) - n(b.sequence),
  )
  let latest = new Date(date)
  for (const line of lines) {
    const due = new Date(date)
    const days = n(line.nbDays)
    if (line.delayType === 'days_after') due.setUTCDate(due.getUTCDate() + days)
    else if (line.delayType === 'days_after_end_of_month') {
      due.setUTCMonth(due.getUTCMonth() + 1, 0)
      due.setUTCDate(due.getUTCDate() + days)
    } else if (line.delayType === 'days_after_end_of_next_month') {
      due.setUTCMonth(due.getUTCMonth() + 2, 0)
      due.setUTCDate(due.getUTCDate() + days)
    } else {
      due.setUTCDate(due.getUTCDate() + days)
      due.setUTCMonth(due.getUTCMonth() + 1, Math.max(1, Math.min(31, n(line.daysNextMonth) || 1)))
    }
    if (due > latest) latest = due
  }
  return latest.toISOString()
}

function taxAmounts(tax: Row | null, quantity: number, priceUnit: number, discount: number) {
  const gross = money(quantity * priceUnit * (1 - discount / 100))
  if (!tax) return { untaxed: gross, tax: 0, total: gross }
  if (tax.amountType === 'group') throw new Error('group taxes are outside the supported subset')
  const rate = n(tax.amount) / 100
  let untaxed = gross
  let taxAmount = 0
  if (tax.amountType === 'fixed') {
    taxAmount = money(n(tax.amount) * quantity)
    if (tax.priceInclude) untaxed = money(gross - taxAmount)
  } else if (tax.amountType === 'percent') {
    if (tax.priceInclude) {
      untaxed = money(gross / (1 + rate))
      taxAmount = money(gross - untaxed)
    } else taxAmount = money(gross * rate)
  } else if (tax.amountType === 'division') {
    if (tax.priceInclude) {
      untaxed = money(gross * (1 - rate))
      taxAmount = money(gross - untaxed)
    } else taxAmount = money(gross / (1 - rate) - gross)
  }
  return { untaxed, tax: taxAmount, total: money(untaxed + taxAmount) }
}

async function nextMoveName(ctx: Ctx, journal: Row, date: Date): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const current = (await ctx.db.select('account.Journal', { id: journal.id }))[0]
    if (!current) throw new Error('journal disappeared while assigning its sequence')
    const previous = n(current.sequenceNumber)
    const changed = await ctx.db.compareAndSet(
      'account.Journal',
      { id: journal.id },
      { sequenceNumber: current.sequenceNumber },
      { sequenceNumber: previous + 1 },
    )
    if ('dryRun' in changed || changed.matched)
      return `${String(journal.code).toUpperCase()}/${date.getUTCFullYear()}/${String(previous + 1).padStart(5, '0')}`
  }
  throw new Error('journal sequence did not settle after concurrent updates')
}

async function post(ctx: Ctx, id: unknown): Promise<Record<string, unknown>> {
  const move = (await ctx.db.select('account.Move', { id }))[0]
  if (!move) return invalid('id', 'journal entry does not exist')
  if (move.state === 'posted') return { ok: true, id: move.id, name: move.name }
  if (move.state !== 'draft') return invalid('state', 'only a draft entry can be posted')
  const lines = await ctx.db.select('account.MoveLine', { moveId: id })
  if (lines.length < 2) return invalid('lines', 'a journal entry needs at least two lines')
  let debit = 0
  let credit = 0
  for (const line of lines) {
    if (n(line.debit) < 0 || n(line.credit) < 0 || (n(line.debit) > 0 && n(line.credit) > 0))
      return invalid('lines', 'each line must have a non-negative debit or credit, never both')
    debit = money(debit + n(line.debit))
    credit = money(credit + n(line.credit))
  }
  if (Math.abs(debit - credit) > 0.000001)
    return invalid('lines', `entry is not balanced: debit ${debit}, credit ${credit}`)
  const journal = (await ctx.db.select('account.Journal', { id: move.journalId }))[0]
  if (!journal) return invalid('journalId', 'journal does not exist')
  const postedAt = today()
  const assigned = await ctx.tx(async (tx) => {
    const name = await nextMoveName(tx, journal, new Date(String(move.date)))
    await tx.db.update('account.Move', { id }, { name, state: 'posted', postedAt })
    return name
  })
  return { ok: true, id: move.id, name: assigned }
}

async function updatePaymentState(ctx: Ctx, moveId: unknown): Promise<void> {
  const move = (await ctx.db.select('account.Move', { id: moveId }))[0]
  if (!move || move.moveType === 'entry') return
  const lines = await ctx.db.select('account.MoveLine', { moveId })
  const candidates: Row[] = []
  for (const line of lines) {
    const account = await accountOf(ctx, line.accountId)
    if (account?.accountType === 'asset_receivable' || account?.accountType === 'liability_payable')
      candidates.push(line)
  }
  const original = candidates.reduce((sum, line) => sum + Math.abs(n(line.balance)), 0)
  const residual = candidates.reduce((sum, line) => sum + Math.abs(n(line.amountResidual)), 0)
  const paymentState = residual < 0.000001 ? 'paid' : residual < original ? 'partial' : 'not_paid'
  await ctx.db.update('account.Move', { id: moveId }, { paymentState })
}

export const functions: Record<string, FnSpec> = {
  initializeCompany: defineFn({
    input: {},
    output: {
      id: 'id',
      countryCode: 'text',
      standard: 'text',
      legalBasis: 'text',
      sourceChecksum: 'text',
      installedAt: 'datetime',
    },
    effects: [...ACCOUNT_SETUP_EFFECTS],
    idempotent: true,
    agent: true,
    handler: (ctx) => ensureCompanyAccounting(ctx),
  }),
  getSetup: defineFn({
    input: {},
    effects: ['read:account.Setup'],
    agent: true,
    handler: async (ctx) => (await ctx.db.select('account.Setup'))[0] ?? null,
  }),
  listAccounts: defineFn({
    input: { includeArchived: 'bool?' },
    effects: ['read:account.Account', ...ACCOUNT_SETUP_EFFECTS],
    agent: true,
    handler: async (ctx, args) => {
      await ensureCompanyAccounting(ctx)
      const A = ctx.table('account.Account')
      const q = from(A).orderBy(asc(A.code))
      return ctx.db.all(args.includeArchived ? q : q.where(eq(A.active, true)))
    },
  }),
  saveAccount: defineFn({
    input: { id: 'id', code: 'text', name: 'text', accountType: 'text', reconcile: 'bool?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.Account', 'write:account.Account'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!ACCOUNT_TYPES.includes(args.accountType as never))
        return invalid('accountType', 'unsupported account type')
      if (!/^[A-Za-z0-9.]+$/.test(String(args.code)))
        return invalid('code', 'account code may contain only letters, numbers, and dots')
      const forced = ['asset_receivable', 'liability_payable'].includes(String(args.accountType))
      const reconcile = forced || args.reconcile === true
      if (args.accountType === 'off_balance' && reconcile)
        return invalid('reconcile', 'off-balance accounts cannot be reconciled')
      const existing = (await ctx.db.select('account.Account', { id: args.id }))[0]
      const values = { ...args, reconcile, active: args.active ?? true }
      const cs = ctx
        .change('account.Account', values, existing ?? null)
        .cast(['id', 'code', 'name', 'accountType', 'reconcile', 'active'])
        .required(['code', 'name', 'accountType'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),
  listJournals: defineFn({
    input: { type: 'text?' },
    effects: ['read:account.Journal', ...ACCOUNT_SETUP_EFFECTS],
    agent: true,
    handler: async (ctx, args) => {
      await ensureCompanyAccounting(ctx)
      return ctx.db.select(
        'account.Journal',
        args.type ? { type: args.type, active: true } : { active: true },
      )
    },
  }),
  saveJournal: defineFn({
    input: { id: 'id', name: 'text', code: 'text', type: 'text', defaultAccountId: 'id?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.Journal', 'write:account.Journal', 'read:account.Account'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!JOURNAL_TYPES.includes(args.type as never)) return invalid('type', 'unsupported journal type')
      if (!/^[A-Za-z0-9]+$/.test(String(args.code)))
        return invalid('code', 'journal code must be alphanumeric')
      if (args.defaultAccountId && !(await accountOf(ctx, args.defaultAccountId)))
        return invalid('defaultAccountId', 'default account does not exist')
      const existing = (await ctx.db.select('account.Journal', { id: args.id }))[0]
      const values = {
        ...args,
        code: String(args.code).toUpperCase(),
        sequenceNumber: existing?.sequenceNumber ?? 0,
        active: args.active ?? true,
      }
      const cs = ctx
        .change('account.Journal', values, existing ?? null)
        .cast(['id', 'name', 'code', 'type', 'defaultAccountId', 'sequenceNumber', 'active'])
        .required(['name', 'code', 'type'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),
  listTaxes: defineFn({
    input: { typeTaxUse: 'text?' },
    effects: ['read:account.Tax', ...ACCOUNT_SETUP_EFFECTS],
    agent: true,
    handler: async (ctx, args) => {
      await ensureCompanyAccounting(ctx)
      return ctx.db.select(
        'account.Tax',
        args.typeTaxUse ? { typeTaxUse: args.typeTaxUse, active: true } : { active: true },
      )
    },
  }),
  saveTax: defineFn({
    input: {
      id: 'id',
      name: 'text',
      description: 'text?',
      typeTaxUse: 'text',
      taxScope: 'text?',
      amountType: 'text',
      amount: 'decimal',
      priceInclude: 'bool?',
      includeBaseAmount: 'bool?',
      accountId: 'id?',
      sequence: 'int?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.Tax', 'write:account.Tax', 'read:account.Account'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!TAX_USES.includes(args.typeTaxUse as never)) return invalid('typeTaxUse', 'unsupported tax use')
      if (!TAX_AMOUNT_TYPES.includes(args.amountType as never))
        return invalid('amountType', 'unsupported tax computation')
      if (args.taxScope && !['service', 'consu'].includes(String(args.taxScope)))
        return invalid('taxScope', 'tax scope must be service or consu')
      if (args.accountId && !(await accountOf(ctx, args.accountId)))
        return invalid('accountId', 'tax account does not exist')
      const existing = (await ctx.db.select('account.Tax', { id: args.id }))[0]
      const values = {
        ...args,
        priceInclude: args.priceInclude === true,
        includeBaseAmount: args.includeBaseAmount === true,
        sequence: args.sequence ?? 10,
        active: args.active ?? true,
      }
      const cs = ctx
        .change('account.Tax', values, existing ?? null)
        .cast([
          'id',
          'name',
          'description',
          'typeTaxUse',
          'taxScope',
          'amountType',
          'amount',
          'priceInclude',
          'includeBaseAmount',
          'accountId',
          'sequence',
          'active',
        ])
        .required(['name', 'typeTaxUse', 'amountType', 'amount'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),
  listPaymentTerms: defineFn({
    input: {},
    effects: ['read:account.PaymentTerm', 'read:account.PaymentTermLine', ...ACCOUNT_SETUP_EFFECTS],
    agent: true,
    handler: async (ctx) => {
      await ensureCompanyAccounting(ctx)
      const T = ctx.table('account.PaymentTerm')
      return ctx.db.all(from(T).where(eq(T.active, true)).orderBy(asc(T.name)).preload('lines'))
    },
  }),
  savePaymentTerm: defineFn({
    input: { id: 'id', name: 'text', note: 'text?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.PaymentTerm', 'write:account.PaymentTerm'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('account.PaymentTerm', { id: args.id }))[0]
      const values = { ...args, active: args.active ?? true }
      const cs = ctx
        .change('account.PaymentTerm', values, existing ?? null)
        .cast(['id', 'name', 'note', 'active'])
        .required(['name'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),
  savePaymentTermLine: defineFn({
    input: {
      id: 'id',
      paymentId: 'id',
      value: 'text',
      valueAmount: 'decimal',
      delayType: 'text',
      nbDays: 'int',
      daysNextMonth: 'int?',
      sequence: 'int?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.PaymentTerm', 'read:account.PaymentTermLine', 'write:account.PaymentTermLine'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('account.PaymentTerm', { id: args.paymentId }))[0])
        return invalid('paymentId', 'payment term does not exist')
      if (!PAYMENT_TERM_VALUES.includes(args.value as never))
        return invalid('value', 'value must be percent or fixed')
      if (!PAYMENT_TERM_DELAY_TYPES.includes(args.delayType as never))
        return invalid('delayType', 'unsupported delay type')
      if (args.value === 'percent' && (n(args.valueAmount) < 0 || n(args.valueAmount) > 100))
        return invalid('valueAmount', 'percentage must be between 0 and 100')
      const existing = (await ctx.db.select('account.PaymentTermLine', { id: args.id }))[0]
      const values = { ...args, sequence: args.sequence ?? 10 }
      const cs = ctx
        .change('account.PaymentTermLine', values, existing ?? null)
        .cast(['id', 'paymentId', 'value', 'valueAmount', 'delayType', 'nbDays', 'daysNextMonth', 'sequence'])
        .required(['paymentId', 'value', 'valueAmount', 'delayType'])
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs, existing ? { id: args.id } : undefined)
      return { ok: true, id: args.id }
    },
  }),
  listMoves: defineFn({
    input: { moveType: 'text?', state: 'text?', partnerId: 'id?' },
    effects: ['read:account.Move'],
    agent: true,
    handler: (ctx, args) =>
      ctx.db.select('account.Move', {
        ...(args.moveType ? { moveType: args.moveType } : {}),
        ...(args.state ? { state: args.state } : {}),
        ...(args.partnerId ? { partnerId: args.partnerId } : {}),
      }),
  }),
  listOpenItems: defineFn({
    input: { partnerId: 'id?', accountId: 'id?' },
    effects: ['read:account.Account', 'read:account.Move', 'read:account.MoveLine'],
    agent: true,
    handler: async (ctx, args) => {
      const posted = new Map(
        (await ctx.db.select('account.Move', { state: 'posted' })).map((move) => [String(move.id), move]),
      )
      const rows: Row[] = []
      for (const line of await ctx.db.select('account.MoveLine', {
        ...(args.partnerId ? { partnerId: args.partnerId } : {}),
        ...(args.accountId ? { accountId: args.accountId } : {}),
      })) {
        const move = posted.get(String(line.moveId))
        if (!move || line.reconciled || n(line.amountResidual) <= 0) continue
        const account = await accountOf(ctx, line.accountId)
        if (!account?.reconcile) continue
        rows.push({ ...line, move })
      }
      return rows.sort((a, b) => String((a.move as Row).date).localeCompare(String((b.move as Row).date)))
    },
  }),
  getMove: defineFn({
    input: { id: 'id' },
    effects: ['read:account.Move', 'read:account.MoveLine'],
    agent: true,
    handler: async (ctx, args) => {
      const move = (await ctx.db.select('account.Move', { id: args.id }))[0]
      return move ? { ...move, lines: await ctx.db.select('account.MoveLine', { moveId: args.id }) } : null
    },
  }),
  createMove: defineFn({
    input: {
      id: 'id',
      journalId: 'id',
      moveType: 'text?',
      date: 'datetime?',
      ref: 'text?',
      partnerId: 'id?',
      invoiceDate: 'datetime?',
      invoiceDateDue: 'datetime?',
      paymentTermId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:account.Journal',
      'read:account.Move',
      'read:account.PaymentTermLine',
      'read:company.Company',
      'write:account.Move',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      if (!journal) return invalid('journalId', 'journal does not exist')
      const moveType = String(args.moveType ?? 'entry')
      if (!MOVE_TYPES.includes(moveType as never)) return invalid('moveType', 'unsupported move type')
      const existing = (await ctx.db.select('account.Move', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id }
      const date = String(args.date ?? today())
      await ctx.db.insert('account.Move', {
        id: args.id,
        name: String(args.id),
        ref: args.ref ?? null,
        date,
        moveType,
        state: 'draft',
        journalId: args.journalId,
        partnerId: args.partnerId ?? null,
        invoiceDate: args.invoiceDate ?? null,
        invoiceDateDue:
          args.invoiceDateDue ??
          (args.invoiceDate
            ? await dueDate(ctx, args.paymentTermId, new Date(String(args.invoiceDate)))
            : null),
        paymentTermId: args.paymentTermId ?? null,
        paymentState: moveType === 'entry' ? 'paid' : 'not_paid',
        currency: await companyCurrency(ctx),
        amountUntaxed: '0',
        amountTax: '0',
        amountTotal: '0',
        postedAt: null,
      })
      return { ok: true, id: args.id }
    },
  }),
  addMoveLine: defineFn({
    input: {
      id: 'id',
      moveId: 'id',
      name: 'text',
      accountId: 'id',
      partnerId: 'id?',
      productId: 'id?',
      productUomId: 'id?',
      quantity: 'decimal?',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxId: 'id?',
      debit: 'decimal?',
      credit: 'decimal?',
      dateMaturity: 'datetime?',
      displayType: 'text?',
      sequence: 'int?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.Move', 'read:account.Account', 'write:account.MoveLine'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const move = (await ctx.db.select('account.Move', { id: args.moveId }))[0]
      if (move?.state !== 'draft') return invalid('moveId', 'lines can only be added to a draft entry')
      const account = await accountOf(ctx, args.accountId)
      if (!account) return invalid('accountId', 'account does not exist')
      const debit = money(n(args.debit)),
        credit = money(n(args.credit))
      if (debit < 0 || credit < 0 || (debit > 0 && credit > 0))
        return invalid('debit', 'a line may have debit or credit, never both')
      const inserted = await ctx.db.insertIfAbsent('account.MoveLine', {
        id: args.id,
        moveId: args.moveId,
        name: args.name,
        accountId: args.accountId,
        partnerId: args.partnerId ?? move.partnerId ?? null,
        productId: args.productId ?? null,
        productUomId: args.productUomId ?? null,
        quantity: args.quantity ?? '1',
        priceUnit: args.priceUnit ?? '0',
        discount: args.discount ?? '0',
        taxId: args.taxId ?? null,
        debit: decimal(debit),
        credit: decimal(credit),
        balance: decimal(debit - credit),
        dateMaturity: args.dateMaturity ?? null,
        displayType: args.displayType ?? null,
        reconciled: false,
        amountResidual: account.reconcile ? decimal(Math.abs(debit - credit)) : '0',
        sequence: args.sequence ?? 10,
      })
      return { ok: true, id: args.id, existing: !('dryRun' in inserted) && !inserted.inserted }
    },
  }),
  createInvoice: defineFn({
    input: {
      id: 'id',
      journalId: 'id',
      moveType: 'text',
      partnerId: 'id',
      invoiceDate: 'datetime?',
      paymentTermId: 'id?',
      ref: 'text?',
      description: 'text',
      productId: 'id?',
      productUomId: 'id?',
      quantity: 'decimal',
      priceUnit: 'decimal',
      discount: 'decimal?',
      lineAccountId: 'id',
      counterpartAccountId: 'id',
      taxId: 'id?',
      taxAccountId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', amountTotal: 'decimal?', errors: 'json?' },
    effects: [
      'read:account.Journal',
      'read:account.Account',
      'read:account.Tax',
      'read:account.Move',
      'read:account.PaymentTermLine',
      'read:company.Company',
      'write:account.Move',
      'write:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (
        !['out_invoice', 'out_refund', 'in_invoice', 'in_refund', 'out_receipt', 'in_receipt'].includes(
          String(args.moveType),
        )
      )
        return invalid('moveType', 'createInvoice requires an invoice, refund, or receipt type')
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      if (!journal) return invalid('journalId', 'journal does not exist')
      const customerDocument = ['out_invoice', 'out_refund', 'out_receipt'].includes(String(args.moveType))
      const expectedJournal = customerDocument ? 'sale' : 'purchase'
      if (journal.type !== expectedJournal)
        return invalid('journalId', `${String(args.moveType)} requires a ${expectedJournal} journal`)
      const lineAccount = await accountOf(ctx, args.lineAccountId),
        counterpart = await accountOf(ctx, args.counterpartAccountId)
      if (!lineAccount || !counterpart) return invalid('accountId', 'invoice accounts do not exist')
      const expectedCounterpart = customerDocument ? 'asset_receivable' : 'liability_payable'
      if (counterpart.accountType !== expectedCounterpart)
        return invalid('counterpartAccountId', `counterpart account must be ${expectedCounterpart}`)
      const tax = args.taxId ? ((await ctx.db.select('account.Tax', { id: args.taxId }))[0] ?? null) : null
      if (tax && ![customerDocument ? 'sale' : 'purchase', 'none'].includes(String(tax.typeTaxUse)))
        return invalid('taxId', 'tax use does not match the invoice direction')
      let amounts: ReturnType<typeof taxAmounts>
      try {
        amounts = taxAmounts(tax, n(args.quantity), n(args.priceUnit), n(args.discount))
      } catch (error) {
        return invalid('taxId', (error as Error).message)
      }
      const taxAccountId = args.taxAccountId ?? tax?.accountId
      if (amounts.tax && (!taxAccountId || !(await accountOf(ctx, taxAccountId))))
        return invalid('taxAccountId', 'a valid tax account is required when tax is non-zero')
      const existing = (await ctx.db.select('account.Move', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id, amountTotal: existing.amountTotal }
      const invoiceDate = String(args.invoiceDate ?? today())
      const currency = await companyCurrency(ctx)
      const mainDebit = ['in_invoice', 'in_receipt', 'out_refund'].includes(String(args.moveType))
      await ctx.tx(async (tx) => {
        await tx.db.insert('account.Move', {
          id: args.id,
          name: String(args.id),
          ref: args.ref ?? null,
          date: invoiceDate,
          moveType: args.moveType,
          state: 'draft',
          journalId: args.journalId,
          partnerId: args.partnerId,
          invoiceDate,
          invoiceDateDue: await dueDate(tx, args.paymentTermId, new Date(invoiceDate)),
          paymentTermId: args.paymentTermId ?? null,
          paymentState: 'not_paid',
          currency,
          amountUntaxed: decimal(amounts.untaxed),
          amountTax: decimal(amounts.tax),
          amountTotal: decimal(amounts.total),
          postedAt: null,
        })
        const line = async (
          id: string,
          accountId: unknown,
          amount: number,
          debitSide: boolean,
          name: string,
          reconcilable: boolean,
          extra: Row = {},
        ) =>
          tx.db.insert('account.MoveLine', {
            id,
            moveId: args.id,
            name,
            accountId,
            partnerId: args.partnerId,
            productId: null,
            productUomId: null,
            quantity: '1',
            priceUnit: decimal(amount),
            discount: '0',
            taxId: null,
            debit: debitSide ? decimal(amount) : '0',
            credit: debitSide ? '0' : decimal(amount),
            balance: decimal(debitSide ? amount : -amount),
            dateMaturity: null,
            displayType: null,
            reconciled: false,
            amountResidual: reconcilable ? decimal(amount) : '0',
            sequence: 10,
            ...extra,
          })
        await line(
          `${String(args.id)}:base`,
          args.lineAccountId,
          amounts.untaxed,
          mainDebit,
          String(args.description),
          false,
          {
            productId: args.productId ?? null,
            productUomId: args.productUomId ?? null,
            quantity: String(args.quantity),
            priceUnit: String(args.priceUnit),
            discount: String(args.discount ?? 0),
            taxId: args.taxId ?? null,
          },
        )
        if (amounts.tax)
          await line(
            `${String(args.id)}:tax`,
            taxAccountId,
            amounts.tax,
            mainDebit,
            String(tax?.name ?? 'Tax'),
            false,
            { sequence: 20 },
          )
        await line(
          `${String(args.id)}:counterpart`,
          args.counterpartAccountId,
          amounts.total,
          !mainDebit,
          String(args.ref ?? args.description),
          true,
          { dateMaturity: await dueDate(tx, args.paymentTermId, new Date(invoiceDate)), sequence: 30 },
        )
      })
      return { ok: true, id: args.id, amountTotal: decimal(amounts.total) }
    },
  }),
  postMove: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', name: 'text?', errors: 'json?' },
    effects: [
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Journal',
      'write:account.Journal',
      'write:account.Move',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => post(ctx, args.id),
  }),
  cancelMove: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.Move', 'write:account.Move'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const move = (await ctx.db.select('account.Move', { id: args.id }))[0]
      if (!move) return invalid('id', 'journal entry does not exist')
      if (move.state === 'posted')
        return invalid('state', 'posted entries must be reversed; direct cancellation is unsupported')
      await ctx.db.update('account.Move', { id: args.id }, { state: 'cancel' })
      return { ok: true, id: args.id }
    },
  }),
  listPayments: defineFn({
    input: {},
    effects: ['read:account.Payment'],
    agent: true,
    handler: (ctx) => ctx.db.select('account.Payment'),
  }),
  registerPayment: defineFn({
    input: {
      id: 'id',
      name: 'text',
      paymentType: 'text',
      partnerType: 'text',
      partnerId: 'id?',
      journalId: 'id',
      destinationAccountId: 'id',
      amount: 'decimal',
      date: 'datetime?',
      memo: 'text?',
      paymentReference: 'text?',
      reconcileLineId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', moveId: 'id?', errors: 'json?' },
    effects: [
      'read:account.Payment',
      'read:account.Journal',
      'read:account.Account',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.PartialReconcile',
      'read:company.Company',
      'write:account.Payment',
      'write:account.Journal',
      'write:account.Move',
      'write:account.MoveLine',
      'write:account.PartialReconcile',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!PAYMENT_TYPES.includes(args.paymentType as never))
        return invalid('paymentType', 'payment type must be inbound or outbound')
      if (!PARTNER_TYPES.includes(args.partnerType as never))
        return invalid('partnerType', 'partner type must be customer or supplier')
      if (!(n(args.amount) > 0)) return invalid('amount', 'payment amount must be positive')
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      if (!journal?.defaultAccountId)
        return invalid('journalId', 'payment journal needs a default liquidity account')
      if (!['bank', 'cash'].includes(String(journal.type)))
        return invalid('journalId', 'payments require a bank or cash journal')
      const destination = await accountOf(ctx, args.destinationAccountId)
      if (!destination) return invalid('destinationAccountId', 'destination account does not exist')
      const expectedDestination = args.partnerType === 'customer' ? 'asset_receivable' : 'liability_payable'
      if (destination.accountType !== expectedDestination)
        return invalid('destinationAccountId', `destination account must be ${expectedDestination}`)
      const existing = (await ctx.db.select('account.Payment', { id: args.id }))[0]
      if (
        existing &&
        args.reconcileLineId &&
        (
          await ctx.db.select('account.PartialReconcile', {
            id: `${String(args.id)}:reconcile:${String(args.reconcileLineId)}`,
          })
        )[0]
      )
        return { ok: true, id: args.id, moveId: existing.moveId }
      let reconcileTarget: Row | null = null
      if (args.reconcileLineId) {
        reconcileTarget = (await ctx.db.select('account.MoveLine', { id: args.reconcileLineId }))[0] ?? null
        if (!reconcileTarget) return invalid('reconcileLineId', 'open item does not exist')
        if (reconcileTarget.accountId !== args.destinationAccountId)
          return invalid('reconcileLineId', 'open item uses another destination account')
        const expectedDebit = args.paymentType === 'inbound'
        if (
          (expectedDebit && n(reconcileTarget.balance) <= 0) ||
          (!expectedDebit && n(reconcileTarget.balance) >= 0)
        )
          return invalid('reconcileLineId', 'open item has the wrong debit or credit direction')
        if (n(args.amount) - n(reconcileTarget.amountResidual) > 0.000001)
          return invalid('amount', 'payment amount exceeds the selected open item')
      }
      const reconcilePayment = async (paymentMoveId: string) => {
        if (!reconcileTarget) return null
        const counterpartId = `${paymentMoveId}:counterpart`
        const result = await functions.reconcile!.handler(ctx, {
          id: `${String(args.id)}:reconcile:${String(reconcileTarget.id)}`,
          debitMoveId: args.paymentType === 'inbound' ? reconcileTarget.id : counterpartId,
          creditMoveId: args.paymentType === 'inbound' ? counterpartId : reconcileTarget.id,
          amount: args.amount,
          date: args.date ?? today(),
        })
        return (result as Row).ok === true ? null : result
      }
      if (existing) {
        const failed = await reconcilePayment(String(existing.moveId))
        return failed ?? { ok: true, id: args.id, moveId: existing.moveId }
      }
      const moveId = `${String(args.id)}:move`,
        date = String(args.date ?? today()),
        currency = await companyCurrency(ctx),
        inbound = args.paymentType === 'inbound'
      await ctx.tx(async (tx) => {
        await tx.db.insert('account.Move', {
          id: moveId,
          name: moveId,
          ref: args.paymentReference ?? args.memo ?? null,
          date,
          moveType: 'entry',
          state: 'draft',
          journalId: args.journalId,
          partnerId: args.partnerId ?? null,
          invoiceDate: null,
          invoiceDateDue: null,
          paymentTermId: null,
          paymentState: 'paid',
          currency,
          amountUntaxed: '0',
          amountTax: '0',
          amountTotal: String(args.amount),
          postedAt: null,
        })
        const add = (id: string, accountId: unknown, debitSide: boolean, reconcilable: boolean) =>
          tx.db.insert('account.MoveLine', {
            id,
            moveId,
            name: args.memo ?? args.name,
            accountId,
            partnerId: args.partnerId ?? null,
            productId: null,
            productUomId: null,
            quantity: '1',
            priceUnit: String(args.amount),
            discount: '0',
            taxId: null,
            debit: debitSide ? String(args.amount) : '0',
            credit: debitSide ? '0' : String(args.amount),
            balance: decimal(debitSide ? n(args.amount) : -n(args.amount)),
            dateMaturity: null,
            displayType: null,
            reconciled: false,
            amountResidual: reconcilable ? String(args.amount) : '0',
            sequence: debitSide ? 10 : 20,
          })
        await add(`${moveId}:liquidity`, journal.defaultAccountId, inbound, false)
        await add(`${moveId}:counterpart`, args.destinationAccountId, !inbound, true)
        await tx.db.insert('account.Payment', {
          id: args.id,
          name: args.name,
          paymentType: args.paymentType,
          partnerType: args.partnerType,
          partnerId: args.partnerId ?? null,
          journalId: args.journalId,
          destinationAccountId: args.destinationAccountId,
          amount: args.amount,
          date,
          memo: args.memo ?? null,
          paymentReference: args.paymentReference ?? null,
          state: 'in_process',
          currency,
          moveId,
        })
      })
      const posted = await post(ctx, moveId)
      if (posted.ok !== true) return posted
      await ctx.db.update('account.Payment', { id: args.id }, { state: 'paid' })
      const failed = await reconcilePayment(moveId)
      if (failed) return failed
      return { ok: true, id: args.id, moveId }
    },
  }),
  reconcile: defineFn({
    input: { id: 'id', debitMoveId: 'id', creditMoveId: 'id', amount: 'decimal', date: 'datetime?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Account',
      'read:account.PartialReconcile',
      'write:account.Move',
      'write:account.MoveLine',
      'write:account.PartialReconcile',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const amount = money(n(args.amount))
      if (!(amount > 0)) return invalid('amount', 'reconciliation amount must be positive')
      if ((await ctx.db.select('account.PartialReconcile', { id: args.id }))[0])
        return { ok: true, id: args.id }
      let moveIds: [unknown, unknown] | null = null
      try {
        moveIds = await ctx.tx(async (tx) => {
          const debit = (await tx.db.select('account.MoveLine', { id: args.debitMoveId }))[0]
          const credit = (await tx.db.select('account.MoveLine', { id: args.creditMoveId }))[0]
          if (!debit || !credit || n(debit.balance) <= 0 || n(credit.balance) >= 0)
            throw new Error('reconciliation needs one debit and one credit line')
          if (debit.accountId !== credit.accountId)
            throw new Error('reconciled lines must use the same account')
          const [debitMove, creditMove] = await Promise.all([
            tx.db.select('account.Move', { id: debit.moveId }),
            tx.db.select('account.Move', { id: credit.moveId }),
          ])
          if (debitMove[0]?.state !== 'posted' || creditMove[0]?.state !== 'posted')
            throw new Error('only posted journal items can be reconciled')
          const account = await accountOf(tx, debit.accountId)
          if (!account?.reconcile) throw new Error('account does not allow reconciliation')
          if (amount - n(debit.amountResidual) > 0.000001 || amount - n(credit.amountResidual) > 0.000001)
            throw new Error('amount exceeds a residual balance')
          const held = await tx.db.insertIfAbsent('account.PartialReconcile', {
            id: args.id,
            debitMoveId: args.debitMoveId,
            creditMoveId: args.creditMoveId,
            amount: decimal(amount),
            date: args.date ?? today(),
          })
          if (!('dryRun' in held) && !held.inserted) return [debit.moveId, credit.moveId]
          const debitResidual = money(n(debit.amountResidual) - amount)
          const creditResidual = money(n(credit.amountResidual) - amount)
          const debitWrite = await tx.db.compareAndSet(
            'account.MoveLine',
            { id: debit.id },
            { amountResidual: debit.amountResidual },
            { amountResidual: decimal(debitResidual), reconciled: debitResidual === 0 },
          )
          const creditWrite = await tx.db.compareAndSet(
            'account.MoveLine',
            { id: credit.id },
            { amountResidual: credit.amountResidual },
            { amountResidual: decimal(creditResidual), reconciled: creditResidual === 0 },
          )
          if (
            (!('dryRun' in debitWrite) && !debitWrite.matched) ||
            (!('dryRun' in creditWrite) && !creditWrite.matched)
          )
            throw new Error('residual balance changed concurrently; retry reconciliation')
          return [debit.moveId, credit.moveId]
        })
      } catch (error) {
        return invalid('lines', (error as Error).message)
      }
      if (moveIds) {
        await updatePaymentState(ctx, moveIds[0])
        await updatePaymentState(ctx, moveIds[1])
      }
      return { ok: true, id: args.id }
    },
  }),
  trialBalance: defineFn({
    input: { dateFrom: 'datetime?', dateTo: 'datetime?' },
    effects: ['read:account.Account', 'read:account.Move', 'read:account.MoveLine'],
    agent: true,
    handler: async (ctx, args) => {
      const accounts = await ctx.db.select('account.Account'),
        moves = new Map(
          (await ctx.db.select('account.Move', { state: 'posted' })).map((move) => [String(move.id), move]),
        )
      const result = new Map<string, { debit: number; credit: number }>()
      for (const line of await ctx.db.select('account.MoveLine')) {
        const move = moves.get(String(line.moveId))
        if (!move) continue
        const at = new Date(String(move.date)).getTime(),
          from = args.dateFrom ? new Date(String(args.dateFrom)).getTime() : -Infinity,
          to = args.dateTo ? new Date(String(args.dateTo)).getTime() : Infinity
        if (at < from || at > to) continue
        const held = result.get(String(line.accountId)) ?? { debit: 0, credit: 0 }
        held.debit = money(held.debit + n(line.debit))
        held.credit = money(held.credit + n(line.credit))
        result.set(String(line.accountId), held)
      }
      return accounts
        .map((account) => {
          const held = result.get(String(account.id)) ?? { debit: 0, credit: 0 }
          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            debit: decimal(held.debit),
            credit: decimal(held.credit),
            balance: decimal(held.debit - held.credit),
          }
        })
        .filter((row) => n(row.debit) || n(row.credit))
    },
  }),
  generalLedger: defineFn({
    input: { accountId: 'id?', dateFrom: 'datetime?', dateTo: 'datetime?' },
    effects: ['read:account.Move', 'read:account.MoveLine'],
    agent: true,
    handler: async (ctx, args) => {
      const moves = new Map(
        (await ctx.db.select('account.Move', { state: 'posted' })).map((move) => [String(move.id), move]),
      )
      const rows: Array<Row & { move: Row }> = []
      for (const line of await ctx.db.select(
        'account.MoveLine',
        args.accountId ? { accountId: args.accountId } : {},
      )) {
        const move = moves.get(String(line.moveId))
        if (!move) continue
        const at = new Date(String(move.date)).getTime()
        if (at < (args.dateFrom ? new Date(String(args.dateFrom)).getTime() : -Infinity)) continue
        if (at > (args.dateTo ? new Date(String(args.dateTo)).getTime() : Infinity)) continue
        rows.push({ ...line, move })
      }
      return rows.sort(
        (a, b) => String(a.move.date).localeCompare(String(b.move.date)) || n(a.sequence) - n(b.sequence),
      )
    },
  }),
  partnerStatement: defineFn({
    input: { partnerId: 'id' },
    effects: ['read:account.Move', 'read:account.MoveLine', 'read:account.Account'],
    agent: true,
    handler: async (ctx, args) => {
      const moves = new Map(
          (await ctx.db.select('account.Move', { state: 'posted', partnerId: args.partnerId })).map(
            (move) => [String(move.id), move],
          ),
        ),
        rows: Row[] = []
      for (const line of await ctx.db.select('account.MoveLine', { partnerId: args.partnerId })) {
        const account = await accountOf(ctx, line.accountId)
        if (
          moves.has(String(line.moveId)) &&
          ['asset_receivable', 'liability_payable'].includes(String(account?.accountType))
        )
          rows.push({ ...line, move: moves.get(String(line.moveId)) })
      }
      return rows
    },
  }),
}
