import {
  and,
  asc,
  defineFn,
  deleteFrom,
  desc,
  eq,
  from,
  gte,
  ilike,
  inArray,
  lte,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { moneyText, roundMoney, scaleOf, toleranceOf } from './money.ts'
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
/**
 * The four a document can actually be in.
 *
 * Three more were carried over from the ERP this vocabulary came from, and
 * nothing in this ledger ever wrote them — so a filter offering them returned an
 * empty list however the books were kept. Same reason `group` left
 * TAX_AMOUNT_TYPES: a choice that cannot be reached only wastes the reader's
 * time.
 */
export const PAYMENT_STATES = ['not_paid', 'paid', 'partial', 'reversed'] as const
export const TAX_USES = ['sale', 'purchase', 'none'] as const
/**
 * Group taxes are deliberately absent: a line takes a list of taxes and applies
 * them in sequence, which is what a group would have expressed anyway. Offering
 * `group` as a saveable amount type only produced taxes that threw on first use.
 */
export const TAX_AMOUNT_TYPES = ['fixed', 'percent', 'division'] as const
export const PAYMENT_TYPES = ['outbound', 'inbound'] as const
export const PARTNER_TYPES = ['customer', 'supplier'] as const
export const PAYMENT_TERM_VALUES = ['percent', 'fixed'] as const
export const PAYMENT_TERM_DELAY_TYPES = [
  'days_after',
  'days_after_end_of_month',
  'days_after_end_of_next_month',
  'days_end_of_month_on_the',
] as const

/**
 * Every way this module can say no, in one place.
 *
 * A refusal travels as a code, because the words belong to whoever is reading:
 * a backend screen translates it, and a ledger read in Vietnamese must not grow
 * English prose. The sentence here is the same reason for an API client or a log
 * that has no translator, and `{name}` placeholders are filled from `params`.
 */
const REFUSALS = {
  moveMissing: 'journal entry does not exist',
  moveDraftOnly: 'only a draft entry can be posted',
  movePostedOnly: 'only a posted entry can be reversed',
  moveNotCancellable: 'a posted entry is corrected with account.reverseMove, not cancelled',
  moveConcurrent: 'the invoice changed concurrently; review it and retry',
  moveTypeUnsupported: 'unsupported move type',
  linesTooFew: 'a journal entry needs at least two lines',
  lineSideBoth: 'each line must have a non-negative debit or credit, never both',
  entryUnbalanced: 'entry is not balanced: debit {debit}, credit {credit}',
  reversalNoLines: 'the entry has no journal items to reverse',
  lineDraftOnly: 'lines can only be added to a draft entry',
  lineIdTaken: 'a different journal item already uses this id',

  accountMissing: 'account does not exist',
  accountTypeUnsupported: 'unsupported account type',
  accountCodeFormat: 'account code may contain only letters, numbers, and dots',
  offBalanceReconcile: 'off-balance accounts cannot be reconciled',
  defaultAccountMissing: 'default account does not exist',

  journalMissing: 'journal does not exist',
  journalTypeUnsupported: 'unsupported journal type',
  journalCodeFormat: 'journal code must be alphanumeric',
  journalMustBeSale: 'a customer document requires a sale journal',
  journalMustBePurchase: 'a vendor document requires a purchase journal',
  journalLiquidityMissing: 'payment journal needs a default liquidity account',
  journalNotLiquidity: 'payments require a bank or cash journal',

  taxMissing: 'tax does not exist',
  taxUseUnsupported: 'unsupported tax use',
  taxComputationUnsupported: 'unsupported tax computation',
  taxScopeUnsupported: 'tax scope must be service or consu',
  taxAccountMissing: 'tax account does not exist',
  taxDirectionMismatch: 'tax "{name}" does not match the invoice direction',
  taxPostingAccountMissing: 'tax "{name}" needs a valid posting account',
  taxMixedPriceInclude: 'a line cannot mix price-included and price-excluded taxes',
  taxManyPriceInclude: 'a line supports at most one price-included tax',
  taxDivisionFull: 'a division tax of 100% or more has no finite base',
  productMissing: 'product template does not exist',
  taxFixedExceedsLine: 'a price-included fixed tax cannot be larger than the line it is inside',
  taxQuantityPositive: 'line quantity must be positive',
  taxPriceInvalid: 'unit price and discount are invalid',

  partnerMissing: 'partner does not exist',
  paymentTermMissing: 'payment term does not exist',
  termValueUnsupported: 'value must be percent or fixed',
  termDelayUnsupported: 'unsupported delay type',
  termPercentRange: 'percentage must be between 0 and 100',

  invoiceTypeRequired: 'createInvoice requires an invoice, refund, or receipt type',
  invoiceAccountsMissing: 'invoice accounts do not exist',
  invoiceLinesAndSingle: 'give either lines or a single description, not both',
  invoiceLinesEmpty: 'an invoice needs at least one line',
  invoiceLineRequired: 'every invoice line needs a description',
  lineAccountUndecided:
    'no revenue or expense account was given, and neither the product category nor the company has a default',
  counterpartAccountUndecided:
    'no receivable or payable account was given, and neither the partner nor the company has a default',
  categoryMissing: 'the product category does not exist',
  defaultAccountType: 'that account type cannot serve as this default',
  counterpartMustBeReceivable: 'the counterpart account must be a receivable account',
  counterpartMustBePayable: 'the counterpart account must be a payable account',

  paymentTypeUnsupported: 'payment type must be inbound or outbound',
  paymentIdReused: 'a different payment already uses this id',
  partnerTypeUnsupported: 'partner type must be customer or supplier',
  amountPositive: 'payment amount must be positive',
  destinationMissing: 'destination account does not exist',
  destinationMustBeReceivable: 'a customer payment must settle a receivable account',
  destinationMustBePayable: 'a supplier payment must settle a payable account',
  openItemMissing: 'open item does not exist',
  openItemAccountMismatch: 'open item uses another destination account',
  openItemDirection: 'open item has the wrong debit or credit direction',
  amountExceedsOpenItem: 'payment amount exceeds the selected open item',
  invoicePaymentType: 'only a customer invoice can collect a payment',
  invoicePaymentState: 'only a posted customer invoice can collect a payment',
  invoicePaymentResidual: 'the customer invoice has no amount left to collect',
  invoicePaymentAccounts: 'one mobile payment cannot settle several receivable accounts',

  reconcileAmountPositive: 'reconciliation amount must be positive',
  reconcileSides: 'reconciliation needs one debit and one credit line',
  reconcileAccountMismatch: 'reconciled lines must use the same account',
  reconcilePostedOnly: 'only posted journal items can be reconciled',
  reconcileNotAllowed: 'this account does not allow reconciliation',
  reconcileAmountExceeds: 'amount exceeds a residual balance',
  reconcileConcurrent: 'residual balance changed concurrently; retry reconciliation',
} as const

type RefusalCode = keyof typeof REFUSALS

const fill = (sentence: string, params?: Record<string, unknown>): string =>
  params ? sentence.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`)) : sentence

const invalid = (field: string, code: RefusalCode, params?: Record<string, unknown>) => ({
  ok: false as const,
  errors: [{ field, code: `account.error.${code}`, message: fill(REFUSALS[code], params), params }],
})

/** A refusal raised from inside a helper or a transaction, carrying its code out. */
class Refusal extends Error {
  code: RefusalCode
  params?: Record<string, unknown>
  constructor(code: RefusalCode, params?: Record<string, unknown>) {
    super(fill(REFUSALS[code], params))
    this.code = code
    this.params = params
  }
}

/** Turn whatever a guarded block threw into a refusal the caller can act on. */
const refused = (field: string, error: unknown) =>
  error instanceof Refusal
    ? invalid(field, error.code, error.params)
    : { ok: false as const, errors: [{ field, message: (error as Error).message }] }

const n = (value: unknown): number => Number(value ?? 0)

const claimMoveRevision = async (ctx: Ctx, move: Row, expectedRevision?: unknown): Promise<boolean> => {
  const revision = n(move.revision)
  if (expectedRevision !== undefined && revision !== n(expectedRevision)) return false
  const changed = await ctx.db.compareAndSet(
    'account.Move',
    { id: move.id },
    { revision: move.revision ?? null },
    { revision: revision + 1 },
  )
  return 'dryRun' in changed || changed.matched
}
const today = (): string => new Date().toISOString()
const wildcard = (value: unknown): string => String(value ?? '').replace(/[\\%_]/g, '\\$&')

/** The currency a ledger write is denominated in, with the scale its arithmetic must use. */
export type Ledger = { currency: string; scale: number }

export async function ledgerOf(ctx: Ctx): Promise<Ledger> {
  if (!ctx.scope.company) throw new Error('accounting requires an active company')
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  if (!company) throw new Error(`company ${ctx.scope.company} does not exist`)
  const currency = String(company.currency)
  return { currency, scale: scaleOf(currency) }
}

async function accountOf(ctx: Ctx, id: unknown): Promise<Row | null> {
  return (await ctx.db.select('account.Account', { id }))[0] ?? null
}

/** Reads a company's fallback accounts, whether or not a row has been written yet. */
async function defaultsOf(ctx: Ctx): Promise<Row> {
  return (await ctx.db.select('account.Defaults'))[0] ?? {}
}

/**
 * The category a variant belongs to, through its template.
 *
 * An invoice line names a variant, the catalogue hangs the category off the
 * template, and the accounts hang off the category — so reaching one from the
 * other is two hops, not a join this query layer offers.
 */
async function categoryOfProduct(ctx: Ctx, productId: unknown): Promise<unknown> {
  if (!productId) return null
  const variant = (await ctx.db.select('product.Product', { id: productId }))[0]
  if (!variant) return null
  const template = (await ctx.db.select('product.Template', { id: variant.templateId }))[0]
  return template?.categoryId ?? null
}

export const ACCOUNT_RESOLUTION_EFFECTS = [
  'read:account.Account',
  'read:account.Defaults',
  'read:account.CategoryAccount',
  'read:product.Product',
  'read:product.Template',
  'read:partner.CompanyTerms',
] as const

/** Where an invoice line and its counterpart post, and what decided each. */
export type ResolvedAccounts = {
  lineAccountId: unknown
  lineAccountFrom: 'explicit' | 'category' | 'company' | null
  counterpartAccountId: unknown
  counterpartAccountFrom: 'explicit' | 'partner' | 'company' | null
}

/**
 * Decide which accounts a document posts to.
 *
 * Most: an explicit choice wins, then the narrowest configured default, then the
 * company's. Asking the person writing an invoice to name a revenue account out
 * of 216 is asking them to re-answer a question the chart already answers the
 * same way every time — and to get it wrong occasionally.
 *
 * The partner's control accounts are read from `partner.CompanyTerms`, whose
 * account fields the optional `account_partner` module adds. When it is not
 * installed the fields are simply absent and resolution falls through to the
 * company default, which is why this reads them rather than depending on it.
 */
async function resolveAccounts(
  ctx: Ctx,
  args: { moveType: string; partnerId?: unknown; productId?: unknown },
  explicit: { lineAccountId?: unknown; counterpartAccountId?: unknown } = {},
): Promise<ResolvedAccounts> {
  const customer = ['out_invoice', 'out_refund', 'out_receipt'].includes(args.moveType)
  const defaults = await defaultsOf(ctx)

  let lineAccountId = explicit.lineAccountId ?? null
  let lineAccountFrom: ResolvedAccounts['lineAccountFrom'] = lineAccountId ? 'explicit' : null
  if (!lineAccountId) {
    const categoryId = await categoryOfProduct(ctx, args.productId)
    const mapped = categoryId
      ? ((await ctx.db.select('account.CategoryAccount', { categoryId }))[0] ?? null)
      : null
    const fromCategory = customer ? mapped?.incomeAccountId : mapped?.expenseAccountId
    if (fromCategory) {
      lineAccountId = fromCategory
      lineAccountFrom = 'category'
    } else {
      lineAccountId = (customer ? defaults.incomeAccountId : defaults.expenseAccountId) ?? null
      lineAccountFrom = lineAccountId ? 'company' : null
    }
  }

  let counterpartAccountId = explicit.counterpartAccountId ?? null
  let counterpartAccountFrom: ResolvedAccounts['counterpartAccountFrom'] = counterpartAccountId
    ? 'explicit'
    : null
  if (!counterpartAccountId) {
    const terms = args.partnerId
      ? ((await ctx.db.select('partner.CompanyTerms', { partnerId: args.partnerId }))[0] ?? null)
      : null
    const fromPartner = customer ? terms?.receivableAccountId : terms?.payableAccountId
    if (fromPartner) {
      counterpartAccountId = fromPartner
      counterpartAccountFrom = 'partner'
    } else {
      counterpartAccountId = (customer ? defaults.receivableAccountId : defaults.payableAccountId) ?? null
      counterpartAccountFrom = counterpartAccountId ? 'company' : null
    }
  }

  return { lineAccountId, lineAccountFrom, counterpartAccountId, counterpartAccountFrom }
}

/**
 * Paging is opt-in, never implicit. A screen asks for a page; an export or a
 * report asks for everything and gets it, rather than a silently truncated list
 * that reads as complete.
 */
const paginate = <Q extends { limit(size: number): Q; offset(start: number): Q }>(
  q: Q,
  limit: unknown,
  offset: unknown,
): Q => {
  const size = Math.trunc(n(limit))
  const start = Math.trunc(n(offset))
  const limited = size > 0 ? q.limit(size) : q
  return start > 0 ? limited.offset(start) : limited
}

const slice = <T>(rows: T[], limit: unknown, offset: unknown): T[] => {
  const size = Math.trunc(n(limit))
  const start = Math.max(0, Math.trunc(n(offset)))
  return size > 0 ? rows.slice(start, start + size) : rows.slice(start)
}

const moveTypeList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter((type) => MOVE_TYPES.includes(type as never)) : []
const paymentStateList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter((state) => PAYMENT_STATES.includes(state as never)) : []

/** The ids of every posted move inside an optional date window. */
export async function postedMoves(ctx: Ctx, dateFrom: unknown, dateTo: unknown): Promise<Map<string, Row>> {
  const M = ctx.table('account.Move')
  const moves = await ctx.db.all(
    from(M).where(
      and(
        eq(M.state, 'posted'),
        ...(dateFrom ? [gte(M.date, dateFrom)] : []),
        ...(dateTo ? [lte(M.date, dateTo)] : []),
      ),
    ),
  )
  return new Map(moves.map((move) => [String(move.id), move]))
}

/**
 * Journal items belonging to the given moves. The ids go into the query so the
 * database does the narrowing; chunking keeps a long reporting window from
 * building a parameter list no driver will accept.
 */
export async function linesOfMoves(ctx: Ctx, moveIds: string[], accountId?: unknown): Promise<Row[]> {
  if (!moveIds.length) return []
  const L = ctx.table('account.MoveLine')
  const rows: Row[] = []
  for (let at = 0; at < moveIds.length; at += 400) {
    const chunk = moveIds.slice(at, at + 400)
    rows.push(
      ...(await ctx.db.all(
        from(L).where(and(inArray(L.moveId, chunk), ...(accountId ? [eq(L.accountId, accountId)] : []))),
      )),
    )
  }
  return rows
}

/**
 * Every account of the active company, by id. Callers that classify a whole page
 * of journal items need this once instead of a lookup per line — a chart of
 * accounts is bounded (216 rows under TT99) while a ledger is not.
 */
export async function accountsById(ctx: Ctx): Promise<Map<string, Row>> {
  return new Map((await ctx.db.select('account.Account')).map((row) => [String(row.id), row]))
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

/** One tax's share of a line, carrying where it has to post. */
export type TaxShare = { taxId: unknown; name: string; accountId: unknown; amount: number }
export type LineAmounts = { untaxed: number; tax: number; total: number; shares: TaxShare[] }

const taxOrder = (a: Row, b: Row): number =>
  n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id))

/**
 * Apply a line's taxes in sequence.
 *
 * A tax marked `includeBaseAmount` adds its own amount to the base every later
 * tax is computed on — this is how import duty compounds into import VAT, which
 * is the case the bundled TT99 catalog ships data for.
 */
function taxAmounts(
  taxes: readonly Row[],
  quantity: number,
  priceUnit: number,
  discount: number,
  scale: number,
): LineAmounts {
  const gross = roundMoney(quantity * priceUnit * (1 - discount / 100), scale)
  if (!taxes.length) return { untaxed: gross, tax: 0, total: gross, shares: [] }

  const ordered = [...taxes].sort(taxOrder)
  const included = ordered.filter((tax) => tax.priceInclude === true)
  if (included.length && included.length !== ordered.length) throw new Refusal('taxMixedPriceInclude')
  if (included.length > 1) throw new Refusal('taxManyPriceInclude')

  const share = (tax: Row, base: number): number => {
    const rate = n(tax.amount) / 100
    if (tax.amountType === 'fixed') return roundMoney(n(tax.amount) * quantity, scale)
    if (tax.amountType === 'percent') return roundMoney(base * rate, scale)
    if (tax.amountType === 'division') {
      if (rate >= 1) throw new Refusal('taxDivisionFull')
      return roundMoney(base / (1 - rate) - base, scale)
    }
    throw new Refusal('taxComputationUnsupported')
  }

  if (included.length === 1) {
    const tax = ordered[0]!
    const rate = n(tax.amount) / 100
    let untaxed = gross
    if (tax.amountType === 'fixed') {
      untaxed = roundMoney(gross - share(tax, gross), scale)
      // A fixed tax said to be inside the price cannot be more than the price.
      // Left alone it makes the base negative, which posts a credit to revenue
      // as a debit and reverses the sign of the sale in the ledger.
      if (untaxed < 0) throw new Refusal('taxFixedExceedsLine')
    } else if (tax.amountType === 'percent') untaxed = roundMoney(gross / (1 + rate), scale)
    else if (tax.amountType === 'division') {
      if (rate >= 1) throw new Refusal('taxDivisionFull')
      untaxed = roundMoney(gross * (1 - rate), scale)
    } else throw new Refusal('taxComputationUnsupported')
    const amount = roundMoney(gross - untaxed, scale)
    return {
      untaxed,
      tax: amount,
      total: roundMoney(untaxed + amount, scale),
      shares: [{ taxId: tax.id, name: String(tax.name), accountId: tax.accountId ?? null, amount }],
    }
  }

  const shares: TaxShare[] = []
  let base = gross
  let total = 0
  for (const tax of ordered) {
    const amount = share(tax, base)
    shares.push({ taxId: tax.id, name: String(tax.name), accountId: tax.accountId ?? null, amount })
    total = roundMoney(total + amount, scale)
    if (tax.includeBaseAmount === true) base = roundMoney(base + amount, scale)
  }
  return { untaxed: gross, tax: total, total: roundMoney(gross + total, scale), shares }
}

export type TaxQuote = {
  ok: true
  currency: string
  scale: number
  quantity: string
  priceUnit: string
  discount: string
  amountUntaxed: string
  amountTax: string
  amountTotal: string
  taxIds: string[]
  taxes: Array<{
    id: string
    name: string
    amountType: string
    amount: string
    priceInclude: boolean
    includeBaseAmount: boolean
    sequence: number
    share: string
  }>
  /** Posting-only evidence. Channel projections must remove accountId. */
  shares: TaxShare[]
}

export type TaxQuoteRefusal = {
  ok: false
  errors: Array<{
    field: string
    message: string
    code?: string
    params?: Record<string, unknown>
  }>
}

/** Canonical product line calculation shared by Sales, POS and invoices. */
export async function quoteTaxLine(
  ctx: Ctx,
  input: {
    productId?: unknown
    taxIds?: unknown
    quantity: unknown
    priceUnit: unknown
    discount?: unknown
  },
): Promise<TaxQuote | TaxQuoteRefusal> {
  const quantity = n(input.quantity)
  const priceUnit = n(input.priceUnit)
  const discount = n(input.discount)
  if (!(quantity > 0)) return invalid('quantity', 'taxQuantityPositive')
  if (priceUnit < 0 || discount < 0 || discount > 100) return invalid('priceUnit', 'taxPriceInvalid')

  let wanted: string[]
  if (Array.isArray(input.taxIds)) wanted = [...new Set(input.taxIds.map(String))]
  else if (input.productId) {
    const product = (await ctx.db.select('product.Product', { id: input.productId }))[0]
    if (!product) return invalid('productId', 'productMissing')
    const mapping = (await ctx.db.select('account.ProductTax', { templateId: product.templateId }))[0]
    wanted = mapping?.taxId ? [String(mapping.taxId)] : []
  } else wanted = []

  const taxes: Row[] = []
  for (const id of wanted) {
    const tax = (await ctx.db.select('account.Tax', { id }))[0]
    if (!tax || tax.active === false) return invalid('taxIds', 'taxMissing')
    if (!['sale', 'none'].includes(String(tax.typeTaxUse)))
      return invalid('taxIds', 'taxDirectionMismatch', { name: tax.name })
    taxes.push(tax)
  }
  const { currency, scale } = await ledgerOf(ctx)
  try {
    const amounts = taxAmounts(taxes, quantity, priceUnit, discount, scale)
    const shares = new Map(amounts.shares.map((share) => [String(share.taxId), share]))
    return {
      ok: true,
      currency,
      scale,
      quantity: String(input.quantity),
      priceUnit: String(input.priceUnit),
      discount: String(input.discount ?? '0'),
      amountUntaxed: moneyText(amounts.untaxed, scale),
      amountTax: moneyText(amounts.tax, scale),
      amountTotal: moneyText(amounts.total, scale),
      taxIds: taxes.sort(taxOrder).map((tax) => String(tax.id)),
      taxes: taxes.sort(taxOrder).map((tax) => ({
        id: String(tax.id),
        name: String(tax.name),
        amountType: String(tax.amountType),
        amount: String(tax.amount),
        priceInclude: tax.priceInclude === true,
        includeBaseAmount: tax.includeBaseAmount === true,
        sequence: n(tax.sequence),
        share: moneyText(shares.get(String(tax.id))?.amount ?? 0, scale),
      })),
      shares: amounts.shares,
    }
  } catch (error) {
    return refused('taxIds', error)
  }
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

async function post(ctx: Ctx, id: unknown, expectedRevision?: unknown): Promise<Record<string, unknown>> {
  const move = (await ctx.db.select('account.Move', { id }))[0]
  if (!move) return invalid('id', 'moveMissing')
  if (move.state === 'posted') return { ok: true, id: move.id, name: move.name }
  if (move.state !== 'draft') return invalid('state', 'moveDraftOnly')
  const scale = scaleOf(move.currency)
  const lines = await ctx.db.select('account.MoveLine', { moveId: id })
  if (lines.length < 2) return invalid('lines', 'linesTooFew')
  let debit = 0
  let credit = 0
  for (const line of lines) {
    if (n(line.debit) < 0 || n(line.credit) < 0 || (n(line.debit) > 0 && n(line.credit) > 0))
      return invalid('lines', 'lineSideBoth')
    debit = roundMoney(debit + n(line.debit), scale)
    credit = roundMoney(credit + n(line.credit), scale)
  }
  if (Math.abs(debit - credit) > toleranceOf(scale))
    return invalid('lines', 'entryUnbalanced', { debit, credit })
  const journal = (await ctx.db.select('account.Journal', { id: move.journalId }))[0]
  if (!journal) return invalid('journalId', 'journalMissing')
  const postedAt = today()
  // An invoice already carries the totals its own line builder computed. A manual
  // entry has none, and a ledger that shows every entry as 0 is not a ledger.
  const totals =
    move.moveType === 'entry'
      ? {
          amountUntaxed: moneyText(debit, scale),
          amountTax: moneyText(0, scale),
          amountTotal: moneyText(debit, scale),
        }
      : {}
  let assigned: string
  try {
    assigned = await ctx.tx(async (tx) => {
      const current = (await tx.db.select('account.Move', { id }))[0]
      if (!current) throw new Refusal('moveMissing')
      if (current.state === 'posted') return String(current.name)
      if (current.state !== 'draft') throw new Refusal('moveDraftOnly')
      if (!(await claimMoveRevision(tx, current, expectedRevision))) throw new Refusal('moveConcurrent')
      const name = await nextMoveName(tx, journal, new Date(String(current.date)))
      await tx.db.update('account.Move', { id }, { name, state: 'posted', postedAt, ...totals })
      return name
    })
  } catch (error) {
    return refused('expectedRevision', error)
  }
  return { ok: true, id: move.id, name: assigned }
}

const OPEN_ITEM_TYPES = ['asset_receivable', 'liability_payable']

async function updatePaymentState(ctx: Ctx, moveId: unknown, accounts?: Map<string, Row>): Promise<void> {
  const move = (await ctx.db.select('account.Move', { id: moveId }))[0]
  if (!move || move.moveType === 'entry') return
  // A reversal settles the document; it must not be relabelled by the residual math.
  if (move.paymentState === 'reversed') return
  const byId = accounts ?? (await accountsById(ctx))
  const candidates = (await ctx.db.select('account.MoveLine', { moveId })).filter((line) =>
    OPEN_ITEM_TYPES.includes(String(byId.get(String(line.accountId))?.accountType)),
  )
  const scale = scaleOf(move.currency)
  const original = candidates.reduce((sum, line) => sum + Math.abs(n(line.balance)), 0)
  const residual = candidates.reduce((sum, line) => sum + Math.abs(n(line.amountResidual)), 0)
  const slack = toleranceOf(scale)
  const paymentState = residual < slack ? 'paid' : residual < original - slack ? 'partial' : 'not_paid'
  await ctx.db.update('account.Move', { id: moveId }, { paymentState })
}

/**
 * The slice of a list a picker actually needs.
 *
 * A relation picker sends `search` on every keystroke and `limit` to keep the
 * response small; `validateInput` rejects inputs a function does not declare, so
 * a list without them cannot back a picker at all. `product` and `uom` carry the
 * same helper for the same reason.
 */
const narrow = (rows: Row[], args: { search?: unknown; limit?: unknown }, fields: string[]): Row[] => {
  const needle = String(args.search ?? '')
    .trim()
    .toLocaleLowerCase()
  const matched = needle
    ? rows.filter((row) =>
        fields.some((field) =>
          String(row[field] ?? '')
            .toLocaleLowerCase()
            .includes(needle),
        ),
      )
    : rows
  const limit = Number(args.limit)
  return Number.isInteger(limit) && limit > 0 ? matched.slice(0, limit) : matched
}

export const functions: Record<string, FnSpec> = {
  quoteLine: defineFn({
    input: {
      productId: 'id?',
      taxIds: 'json?',
      quantity: 'decimal',
      priceUnit: 'decimal',
      discount: 'decimal?',
    },
    output: {
      ok: 'bool',
      currency: 'text?',
      scale: 'int?',
      quantity: 'decimal?',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      amountUntaxed: 'decimal?',
      amountTax: 'decimal?',
      amountTotal: 'decimal?',
      taxIds: 'json?',
      taxes: 'json?',
      errors: 'json?',
    },
    effects: ['read:company.Company', 'read:product.Product', 'read:account.ProductTax', 'read:account.Tax'],
    agent: true,
    handler: (ctx, args) =>
      quoteTaxLine(
        ctx,
        args as {
          productId?: unknown
          taxIds?: unknown
          quantity: unknown
          priceUnit: unknown
          discount?: unknown
        },
      ),
  }),
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
  /**
   * The chart of accounts, narrowed the way a picker asks for it.
   *
   * `search` and `limit` are what a relation picker sends on every keystroke, and
   * an unknown input is a hard error — so a chart of two hundred accounts is only
   * reachable through a search dialog once they are part of the signature.
   * `accountTypes` moves a restriction the forms were applying after the fact
   * into the query, so the dialog offers nothing the field would reject.
   */
  listAccounts: defineFn({
    input: { includeArchived: 'bool?', accountTypes: 'json?', search: 'text?', limit: 'int?' },
    effects: ['read:account.Account', ...ACCOUNT_SETUP_EFFECTS],
    agent: true,
    handler: async (ctx, args) => {
      await ensureCompanyAccounting(ctx)
      const A = ctx.table('account.Account')
      const q = from(A).orderBy(asc(A.code))
      const rows = await ctx.db.all(args.includeArchived ? q : q.where(eq(A.active, true)))
      const types = Array.isArray(args.accountTypes) ? args.accountTypes.map(String) : []
      const wanted = types.length
        ? rows.filter((row) =>
            types.some((type) =>
              // A prefix so a field can ask for every income account without
              // naming income_other alongside income.
              type.endsWith('*')
                ? String(row.accountType).startsWith(type.slice(0, -1))
                : String(row.accountType) === type,
            ),
          )
        : rows
      const needle = String(args.search ?? '')
        .trim()
        .toLocaleLowerCase()
      const matched = needle
        ? wanted.filter((row) =>
            `${String(row.code)} ${String(row.name)}`.toLocaleLowerCase().includes(needle),
          )
        : wanted
      const limit = Number(args.limit)
      return Number.isInteger(limit) && limit > 0 ? matched.slice(0, limit) : matched
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
        return invalid('accountType', 'accountTypeUnsupported')
      if (!/^[A-Za-z0-9.]+$/.test(String(args.code))) return invalid('code', 'accountCodeFormat')
      const forced = ['asset_receivable', 'liability_payable'].includes(String(args.accountType))
      const reconcile = forced || args.reconcile === true
      if (args.accountType === 'off_balance' && reconcile) return invalid('reconcile', 'offBalanceReconcile')
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
    input: { type: 'text?', includeArchived: 'bool?' },
    effects: ['read:account.Journal', ...ACCOUNT_SETUP_EFFECTS],
    agent: true,
    handler: async (ctx, args) => {
      await ensureCompanyAccounting(ctx)
      return ctx.db.select('account.Journal', {
        ...(args.type ? { type: args.type } : {}),
        ...(args.includeArchived ? {} : { active: true }),
      })
    },
  }),
  saveJournal: defineFn({
    input: { id: 'id', name: 'text', code: 'text', type: 'text', defaultAccountId: 'id?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.Journal', 'write:account.Journal', 'read:account.Account'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!JOURNAL_TYPES.includes(args.type as never)) return invalid('type', 'journalTypeUnsupported')
      if (!/^[A-Za-z0-9]+$/.test(String(args.code))) return invalid('code', 'journalCodeFormat')
      if (args.defaultAccountId && !(await accountOf(ctx, args.defaultAccountId)))
        return invalid('defaultAccountId', 'defaultAccountMissing')
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
    input: { typeTaxUse: 'text?', includeArchived: 'bool?', search: 'text?', limit: 'int?' },
    effects: ['read:account.Tax', ...ACCOUNT_SETUP_EFFECTS],
    agent: true,
    handler: async (ctx, args) => {
      await ensureCompanyAccounting(ctx)
      const rows = await ctx.db.select('account.Tax', {
        ...(args.typeTaxUse ? { typeTaxUse: args.typeTaxUse } : {}),
        ...(args.includeArchived ? {} : { active: true }),
      })
      return narrow(rows.sort(taxOrder), args, ['name'])
    },
  }),
  getProductTax: defineFn({
    input: { templateId: 'id' },
    output: { id: 'id', templateId: 'id', taxId: 'id' },
    effects: ['read:account.ProductTax'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.ProductTax', { templateId: args.templateId }))[0] ?? null,
  }),
  setProductTax: defineFn({
    input: { templateId: 'id', taxId: 'id?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:product.Template',
      'read:account.Tax',
      'read:account.ProductTax',
      'write:account.ProductTax',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('product.Template', { id: args.templateId }))[0])
        return invalid('templateId', 'productMissing')
      const held = (await ctx.db.select('account.ProductTax', { templateId: args.templateId }))[0]
      if (!args.taxId) {
        if (held) {
          const ProductTax = ctx.table('account.ProductTax')
          await ctx.db.del(deleteFrom(ProductTax).where(eq(ProductTax.id, held.id)))
        }
        return { ok: true }
      }
      const tax = (await ctx.db.select('account.Tax', { id: args.taxId }))[0]
      if (!tax) return invalid('taxId', 'taxMissing')
      if (!['sale', 'none'].includes(String(tax.typeTaxUse)))
        return invalid('taxId', 'taxDirectionMismatch', { name: tax.name })
      if (held) {
        await ctx.db.update('account.ProductTax', { id: held.id }, { taxId: args.taxId })
        return { ok: true, id: held.id }
      }
      const id = `product-tax:${String(ctx.scope.company ?? '')}:${String(args.templateId)}`
      await ctx.db.insert('account.ProductTax', {
        id,
        templateId: args.templateId,
        taxId: args.taxId,
      })
      return { ok: true, id }
    },
  }),
  saveTax: defineFn({
    input: {
      id: 'id',
      name: 'text',
      description: 'text?',
      typeTaxUse: 'text',
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
      if (!TAX_USES.includes(args.typeTaxUse as never)) return invalid('typeTaxUse', 'taxUseUnsupported')
      if (!TAX_AMOUNT_TYPES.includes(args.amountType as never))
        return invalid('amountType', 'taxComputationUnsupported')
      if (args.taxScope && !['service', 'consu'].includes(String(args.taxScope)))
        return invalid('taxScope', 'taxScopeUnsupported')
      if (args.accountId && !(await accountOf(ctx, args.accountId)))
        return invalid('accountId', 'taxAccountMissing')
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
  getDefaults: defineFn({
    input: {},
    output: {
      id: 'id?',
      incomeAccountId: 'id?',
      expenseAccountId: 'id?',
      receivableAccountId: 'id?',
      payableAccountId: 'id?',
    },
    effects: ['read:account.Defaults', ...ACCOUNT_SETUP_EFFECTS],
    agent: true,
    handler: async (ctx) => {
      await ensureCompanyAccounting(ctx)
      return (await ctx.db.select('account.Defaults'))[0] ?? {}
    },
  }),
  saveDefaults: defineFn({
    input: {
      incomeAccountId: 'id?',
      expenseAccountId: 'id?',
      receivableAccountId: 'id?',
      payableAccountId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.Account', 'read:account.Defaults', 'write:account.Defaults'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      // Each default has a type the ledger will insist on later; refusing here
      // means the invoice that would have used it never fails in the first place.
      for (const [field, wanted] of [
        ['incomeAccountId', ['income', 'income_other']],
        ['expenseAccountId', ['expense', 'expense_other', 'expense_depreciation', 'expense_direct_cost']],
        ['receivableAccountId', ['asset_receivable']],
        ['payableAccountId', ['liability_payable']],
      ] as const) {
        const id = args[field]
        if (!id) continue
        const account = await accountOf(ctx, id)
        if (!account) return invalid(field, 'accountMissing')
        if (!wanted.includes(String(account.accountType) as never))
          return invalid(
            field,
            field === 'receivableAccountId'
              ? 'counterpartMustBeReceivable'
              : field === 'payableAccountId'
                ? 'counterpartMustBePayable'
                : 'defaultAccountType',
          )
      }
      const held = (await ctx.db.select('account.Defaults'))[0]
      const values = {
        incomeAccountId: args.incomeAccountId ?? null,
        expenseAccountId: args.expenseAccountId ?? null,
        receivableAccountId: args.receivableAccountId ?? null,
        payableAccountId: args.payableAccountId ?? null,
      }
      if (held) {
        await ctx.db.update('account.Defaults', { id: held.id }, values)
        return { ok: true, id: held.id }
      }
      const id = `account-defaults:${String(ctx.scope.company ?? '')}`
      await ctx.db.insert('account.Defaults', { id, ...values })
      return { ok: true, id }
    },
  }),
  listCategoryAccounts: defineFn({
    input: {},
    effects: ['read:account.CategoryAccount', 'read:product.Category'],
    agent: true,
    handler: async (ctx) => {
      const categories = new Map(
        (await ctx.db.select('product.Category')).map((row) => [String(row.id), row]),
      )
      return (await ctx.db.select('account.CategoryAccount')).map((row) => ({
        ...row,
        categoryName: categories.get(String(row.categoryId))?.name ?? null,
      }))
    },
  }),
  saveCategoryAccount: defineFn({
    input: { categoryId: 'id', incomeAccountId: 'id?', expenseAccountId: 'id?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:account.Account',
      'read:account.CategoryAccount',
      'read:product.Category',
      'write:account.CategoryAccount',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('product.Category', { id: args.categoryId }))[0])
        return invalid('categoryId', 'categoryMissing')
      for (const [field, wanted] of [
        ['incomeAccountId', ['income', 'income_other']],
        ['expenseAccountId', ['expense', 'expense_other', 'expense_depreciation', 'expense_direct_cost']],
      ] as const) {
        const id = args[field]
        if (!id) continue
        const account = await accountOf(ctx, id)
        if (!account) return invalid(field, 'accountMissing')
        if (!wanted.includes(String(account.accountType) as never))
          return invalid(field, 'defaultAccountType')
      }
      const values = {
        incomeAccountId: args.incomeAccountId ?? null,
        expenseAccountId: args.expenseAccountId ?? null,
      }
      const held = (await ctx.db.select('account.CategoryAccount', { categoryId: args.categoryId }))[0]
      if (held) {
        await ctx.db.update('account.CategoryAccount', { id: held.id }, values)
        return { ok: true, id: held.id }
      }
      // One row per company and category, so the id can be derived rather than
      // generated: a second save corrects the first instead of racing it.
      const id = `category-account:${String(ctx.scope.company ?? '')}:${String(args.categoryId)}`
      await ctx.db.insert('account.CategoryAccount', { id, categoryId: args.categoryId, ...values })
      return { ok: true, id }
    },
  }),
  /** What a document would post to, and what decided it. The forms use this to explain themselves. */
  previewAccounts: defineFn({
    input: { moveType: 'text', partnerId: 'id?', productId: 'id?' },
    output: {
      lineAccountId: 'id?',
      lineAccountFrom: 'text?',
      counterpartAccountId: 'id?',
      counterpartAccountFrom: 'text?',
    },
    effects: [...ACCOUNT_RESOLUTION_EFFECTS],
    agent: true,
    handler: (ctx, args) =>
      resolveAccounts(ctx, {
        moveType: String(args.moveType),
        partnerId: args.partnerId,
        productId: args.productId,
      }),
  }),
  listPaymentTerms: defineFn({
    input: { includeArchived: 'bool?' },
    effects: ['read:account.PaymentTerm', 'read:account.PaymentTermLine', ...ACCOUNT_SETUP_EFFECTS],
    agent: true,
    handler: async (ctx, args) => {
      await ensureCompanyAccounting(ctx)
      const T = ctx.table('account.PaymentTerm')
      const q = from(T).orderBy(asc(T.name)).preload('lines')
      return ctx.db.all(args.includeArchived ? q : q.where(eq(T.active, true)))
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
        return invalid('paymentId', 'paymentTermMissing')
      if (!PAYMENT_TERM_VALUES.includes(args.value as never)) return invalid('value', 'termValueUnsupported')
      if (!PAYMENT_TERM_DELAY_TYPES.includes(args.delayType as never))
        return invalid('delayType', 'termDelayUnsupported')
      if (args.value === 'percent' && (n(args.valueAmount) < 0 || n(args.valueAmount) > 100))
        return invalid('valueAmount', 'termPercentRange')
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
    input: {
      moveType: 'text?',
      moveTypes: 'json?',
      state: 'text?',
      paymentState: 'text?',
      paymentStates: 'json?',
      partnerId: 'id?',
      search: 'text?',
      dateFrom: 'datetime?',
      dateTo: 'datetime?',
      order: 'text?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: ['read:account.Move'],
    agent: true,
    handler: (ctx, args) => {
      const M = ctx.table('account.Move')
      const where = [
        ...(args.moveType ? [eq(M.moveType, args.moveType)] : []),
        ...(moveTypeList(args.moveTypes).length ? [inArray(M.moveType, moveTypeList(args.moveTypes))] : []),
        ...(args.state ? [eq(M.state, args.state)] : []),
        ...(args.paymentState ? [eq(M.paymentState, args.paymentState)] : []),
        ...(paymentStateList(args.paymentStates).length
          ? [inArray(M.paymentState, paymentStateList(args.paymentStates))]
          : []),
        ...(args.partnerId ? [eq(M.partnerId, args.partnerId)] : []),
        ...(args.search
          ? [
              or(
                ilike(M.name, `%${wildcard(args.search)}%`, true),
                ilike(M.ref, `%${wildcard(args.search)}%`, true),
              ),
            ]
          : []),
        ...(args.dateFrom ? [gte(M.date, args.dateFrom)] : []),
        ...(args.dateTo ? [lte(M.date, args.dateTo)] : []),
      ]
      const direction = args.order === 'desc' ? desc : asc
      const q = (where.length ? from(M).where(and(...where)) : from(M)).orderBy(
        direction(M.date),
        direction(M.id),
      )
      return ctx.db.all(paginate(q, args.limit, args.offset))
    },
  }),
  countMoves: defineFn({
    input: {
      moveType: 'text?',
      moveTypes: 'json?',
      state: 'text?',
      paymentState: 'text?',
      partnerId: 'id?',
    },
    output: { count: 'int' },
    effects: ['read:account.Move'],
    agent: true,
    handler: async (ctx, args) => {
      const M = ctx.table('account.Move')
      const where = [
        ...(args.moveType ? [eq(M.moveType, args.moveType)] : []),
        ...(moveTypeList(args.moveTypes).length ? [inArray(M.moveType, moveTypeList(args.moveTypes))] : []),
        ...(args.state ? [eq(M.state, args.state)] : []),
        ...(args.paymentState ? [eq(M.paymentState, args.paymentState)] : []),
        ...(args.partnerId ? [eq(M.partnerId, args.partnerId)] : []),
      ]
      return { count: await ctx.db.count(where.length ? from(M).where(and(...where)) : from(M)) }
    },
  }),
  listMoveResiduals: defineFn({
    input: { moveIds: 'json' },
    effects: ['read:account.MoveLine'],
    agent: true,
    handler: async (ctx, args) => {
      const ids = Array.isArray(args.moveIds) ? [...new Set(args.moveIds.map(String).filter(Boolean))] : []
      const totals = new Map(ids.map((id) => [id, 0]))
      const L = ctx.table('account.MoveLine')
      for (let at = 0; at < ids.length; at += 400) {
        const chunk = ids.slice(at, at + 400)
        for (const line of await ctx.db.all(from(L).where(inArray(L.moveId, chunk)))) {
          const residual = n(line.amountResidual)
          if (residual > 0) totals.set(String(line.moveId), (totals.get(String(line.moveId)) ?? 0) + residual)
        }
      }
      return ids.map((moveId) => ({ moveId, amountResidual: String(totals.get(moveId) ?? 0) }))
    },
  }),
  listOpenItems: defineFn({
    input: { partnerId: 'id?', accountId: 'id?', limit: 'int?', offset: 'int?' },
    effects: ['read:account.Account', 'read:account.Move', 'read:account.MoveLine'],
    agent: true,
    handler: async (ctx, args) => {
      const byId = await accountsById(ctx)
      const reconcilable = [...byId.values()].filter((row) => row.reconcile === true).map((row) => row.id)
      if (!reconcilable.length) return []
      const posted = new Map(
        (await ctx.db.select('account.Move', { state: 'posted' })).map((move) => [String(move.id), move]),
      )
      if (!posted.size) return []
      const L = ctx.table('account.MoveLine')
      const lines = await ctx.db.all(
        from(L).where(
          and(
            eq(L.reconciled, false),
            inArray(L.accountId, args.accountId ? [args.accountId] : reconcilable),
            ...(args.partnerId ? [eq(L.partnerId, args.partnerId)] : []),
          ),
        ),
      )
      const rows = lines
        .filter((line) => posted.has(String(line.moveId)) && n(line.amountResidual) > 0)
        .map((line): Row & { move: Row } => ({ ...line, move: posted.get(String(line.moveId))! }))
        .sort(
          (a, b) =>
            String(a.move.date).localeCompare(String(b.move.date)) ||
            String(a.id).localeCompare(String(b.id)),
        )
      return slice(rows, args.limit, args.offset)
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
      'read:account.PaymentTerm',
      'read:account.PaymentTermLine',
      'read:partner.Partner',
      'read:company.Company',
      'write:account.Move',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      if (!journal) return invalid('journalId', 'journalMissing')
      const moveType = String(args.moveType ?? 'entry')
      if (!MOVE_TYPES.includes(moveType as never)) return invalid('moveType', 'moveTypeUnsupported')
      if (args.partnerId && !(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid('partnerId', 'partnerMissing')
      if (args.paymentTermId && !(await ctx.db.select('account.PaymentTerm', { id: args.paymentTermId }))[0])
        return invalid('paymentTermId', 'paymentTermMissing')
      const existing = (await ctx.db.select('account.Move', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id }
      const { currency, scale } = await ledgerOf(ctx)
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
        currency,
        amountUntaxed: moneyText(0, scale),
        amountTax: moneyText(0, scale),
        amountTotal: moneyText(0, scale),
        postedAt: null,
        revision: 0,
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
    output: { ok: 'bool', id: 'id?', existing: 'bool?', errors: 'json?' },
    effects: [
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Account',
      'read:account.Tax',
      'write:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const move = (await ctx.db.select('account.Move', { id: args.moveId }))[0]
      if (move?.state !== 'draft') return invalid('moveId', 'lineDraftOnly')
      const account = await accountOf(ctx, args.accountId)
      if (!account) return invalid('accountId', 'accountMissing')
      if (args.taxId && !(await ctx.db.select('account.Tax', { id: args.taxId }))[0])
        return invalid('taxId', 'taxMissing')
      const scale = scaleOf(move.currency)
      const debit = roundMoney(n(args.debit), scale),
        credit = roundMoney(n(args.credit), scale)
      if (debit < 0 || credit < 0 || (debit > 0 && credit > 0)) return invalid('debit', 'lineSideBoth')
      const row = {
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
        debit: moneyText(debit, scale),
        credit: moneyText(credit, scale),
        balance: moneyText(debit - credit, scale),
        dateMaturity: args.dateMaturity ?? null,
        displayType: args.displayType ?? null,
        reconciled: false,
        amountResidual: account.reconcile ? moneyText(Math.abs(debit - credit), scale) : moneyText(0, scale),
        sequence: args.sequence ?? 10,
      }
      const inserted = await ctx.db.insertIfAbsent('account.MoveLine', row)
      if ('dryRun' in inserted) return { ok: true, id: args.id, existing: false }
      if (inserted.inserted) return { ok: true, id: args.id, existing: false }
      // A retry of the same call is a success. A different line under an id that is
      // already taken is not, and reporting it as one loses a write silently.
      const held = (await ctx.db.select('account.MoveLine', { id: args.id }))[0]
      const differs =
        held &&
        (String(held.moveId) !== String(row.moveId) ||
          String(held.accountId) !== String(row.accountId) ||
          n(held.debit) !== debit ||
          n(held.credit) !== credit)
      if (differs) return invalid('id', 'lineIdTaken')
      return { ok: true, id: args.id, existing: true }
    },
  }),
  /**
   * An invoice, in one call, with one line or many.
   *
   * A document with several lines cannot be assembled out of `createMove` and
   * `addMoveLine`: those write exactly what they are given, and the tax a line
   * carries has to become a posting of its own, computed in the order taxes
   * compound. Leaving that to callers means every caller re-derives VAT, and
   * they will not all round it the same way.
   *
   * So `lines` is the general form and the flat `description`/`quantity`/
   * `priceUnit` arguments are the one-line shorthand. A single-line document
   * built either way lands on the same rows with the same ids, which is what
   * lets an existing caller keep its `${id}:base` and `${id}:tax` identifiers.
   */
  createInvoice: defineFn({
    input: {
      id: 'id',
      journalId: 'id',
      moveType: 'text',
      partnerId: 'id',
      invoiceDate: 'datetime?',
      paymentTermId: 'id?',
      ref: 'text?',
      /**
       * The lines of the document, when there is more than one.
       *
       * `{ description, quantity, priceUnit, productId?, productUomId?,
       * discount?, taxId?, taxIds?, lineAccountId?, taxAccountId? }` — the same
       * fields as the shorthand below, per line. Give this or the shorthand,
       * never both.
       */
      lines: 'json?',
      description: 'text?',
      productId: 'id?',
      productUomId: 'id?',
      quantity: 'decimal?',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      // Optional: left out, they come from the product's category, the partner,
      // and the company's defaults, in that order.
      lineAccountId: 'id?',
      counterpartAccountId: 'id?',
      taxId: 'id?',
      taxIds: 'json?',
      taxAccountId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', amountTotal: 'decimal?', errors: 'json?' },
    effects: [
      'read:account.Journal',
      'read:account.Tax',
      'read:account.Move',
      'read:account.PaymentTermLine',
      'read:company.Company',
      ...ACCOUNT_RESOLUTION_EFFECTS,
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
        return invalid('moveType', 'invoiceTypeRequired')
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      if (!journal) return invalid('journalId', 'journalMissing')
      const customerDocument = ['out_invoice', 'out_refund', 'out_receipt'].includes(String(args.moveType))
      if (journal.type !== (customerDocument ? 'sale' : 'purchase'))
        return invalid('journalId', customerDocument ? 'journalMustBeSale' : 'journalMustBePurchase')

      // One shape or the other. Accepting both would leave the shorthand's line
      // either silently dropped or silently appended, and neither is obvious
      // from the call site.
      const many = args.lines !== undefined && args.lines !== null
      if (many && args.description !== undefined) return invalid('lines', 'invoiceLinesAndSingle')
      const given: unknown[] = many ? (Array.isArray(args.lines) ? args.lines : []) : [args]
      if (many && !given.length) return invalid('lines', 'invoiceLinesEmpty')
      if (!many && (args.description === undefined || args.description === null))
        return invalid('description', 'invoiceLineRequired')

      const { currency, scale } = await ledgerOf(ctx)

      /** A line as it will be written, with its taxes already applied. */
      type Priced = {
        spec: Record<string, unknown>
        accountId: unknown
        amounts: LineAmounts
        firstTaxId: unknown
      }
      const priced: Priced[] = []
      // Tax shares are accumulated across the whole document: two lines at the
      // same rate post one tax line, as a paper invoice shows one VAT figure per
      // rate rather than one per row.
      const shares = new Map<string, TaxShare & { accountId: unknown }>()

      for (const [at, entry] of given.entries()) {
        const spec = (entry ?? {}) as Record<string, unknown>
        const where = many ? `lines.${at}` : 'description'
        if (spec.description === undefined || spec.description === null)
          return invalid(where, 'invoiceLineRequired')

        const resolved = await resolveAccounts(
          ctx,
          { moveType: String(args.moveType), partnerId: args.partnerId, productId: spec.productId },
          { lineAccountId: spec.lineAccountId },
        )
        if (!resolved.lineAccountId) return invalid(many ? where : 'lineAccountId', 'lineAccountUndecided')
        if (!(await accountOf(ctx, resolved.lineAccountId)))
          return invalid(many ? where : 'lineAccountId', 'invoiceAccountsMissing')

        // `taxId` stays accepted so existing callers keep working; `taxIds` is how a
        // line carries the sequence of taxes that compound into one another.
        const wanted = [
          ...(Array.isArray(spec.taxIds) ? spec.taxIds.map(String) : []),
          ...(spec.taxId ? [String(spec.taxId)] : []),
        ].filter((id, index, all) => all.indexOf(id) === index)
        const taxes: Row[] = []
        for (const id of wanted) {
          const tax = (await ctx.db.select('account.Tax', { id }))[0]
          if (!tax) return invalid(many ? where : 'taxIds', 'taxMissing')
          if (![customerDocument ? 'sale' : 'purchase', 'none'].includes(String(tax.typeTaxUse)))
            return invalid(many ? where : 'taxIds', 'taxDirectionMismatch', { name: tax.name })
          taxes.push(tax)
        }

        let amounts: LineAmounts
        try {
          amounts = taxAmounts(taxes, n(spec.quantity), n(spec.priceUnit), n(spec.discount), scale)
        } catch (error) {
          return refused(many ? where : 'taxIds', error)
        }

        // Each tax posts to its own account. A single override stays meaningful only
        // while there is one tax to override.
        for (const held of amounts.shares) {
          if (!held.amount) continue
          const accountId = (amounts.shares.length === 1 ? spec.taxAccountId : null) ?? held.accountId
          if (!accountId || !(await accountOf(ctx, accountId)))
            return invalid(many ? where : 'taxAccountId', 'taxPostingAccountMissing', { name: held.name })
          const key = `${String(held.taxId)}:${String(accountId)}`
          const running = shares.get(key)
          if (running) running.amount = roundMoney(running.amount + held.amount, scale)
          else shares.set(key, { ...held, accountId })
        }

        priced.push({
          spec,
          accountId: resolved.lineAccountId,
          amounts,
          firstTaxId: taxes[0]?.id ?? null,
        })
      }

      // After the lines, so a document with nothing to post still reports the
      // revenue account it could not decide before the receivable one.
      const resolvedCounterpart = await resolveAccounts(
        ctx,
        { moveType: String(args.moveType), partnerId: args.partnerId },
        { counterpartAccountId: args.counterpartAccountId },
      )
      if (!resolvedCounterpart.counterpartAccountId)
        return invalid('counterpartAccountId', 'counterpartAccountUndecided')
      const counterpart = await accountOf(ctx, resolvedCounterpart.counterpartAccountId)
      if (!counterpart) return invalid('counterpartAccountId', 'invoiceAccountsMissing')
      if (counterpart.accountType !== (customerDocument ? 'asset_receivable' : 'liability_payable'))
        return invalid(
          'counterpartAccountId',
          customerDocument ? 'counterpartMustBeReceivable' : 'counterpartMustBePayable',
        )

      const untaxed = roundMoney(
        priced.reduce((sum, line) => sum + line.amounts.untaxed, 0),
        scale,
      )
      const tax = roundMoney(
        [...shares.values()].reduce((sum, held) => sum + held.amount, 0),
        scale,
      )
      const total = roundMoney(untaxed + tax, scale)
      const posting = [...shares.values()]

      const existing = (await ctx.db.select('account.Move', { id: args.id }))[0]
      if (existing) return { ok: true, id: args.id, amountTotal: existing.amountTotal }
      const invoiceDate = String(args.invoiceDate ?? today())
      const mainDebit = ['in_invoice', 'in_receipt', 'out_refund'].includes(String(args.moveType))
      await ctx.tx(async (tx) => {
        const due = await dueDate(tx, args.paymentTermId, new Date(invoiceDate))
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
          invoiceDateDue: due,
          paymentTermId: args.paymentTermId ?? null,
          paymentState: 'not_paid',
          currency,
          amountUntaxed: moneyText(untaxed, scale),
          amountTax: moneyText(tax, scale),
          amountTotal: moneyText(total, scale),
          postedAt: null,
          revision: 0,
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
            priceUnit: moneyText(amount, scale),
            discount: '0',
            taxId: null,
            debit: debitSide ? moneyText(amount, scale) : moneyText(0, scale),
            credit: debitSide ? moneyText(0, scale) : moneyText(amount, scale),
            balance: moneyText(debitSide ? amount : -amount, scale),
            dateMaturity: null,
            displayType: null,
            reconciled: false,
            amountResidual: moneyText(reconcilable ? amount : 0, scale),
            sequence: 10,
            ...extra,
          })
        for (const [at, held] of priced.entries())
          await line(
            // The first line keeps the historical id, so a single-line document
            // written through either shape lands on exactly the same row.
            at === 0 ? `${String(args.id)}:base` : `${String(args.id)}:base:${at}`,
            held.accountId,
            held.amounts.untaxed,
            mainDebit,
            String(held.spec.description),
            false,
            {
              productId: held.spec.productId ?? null,
              productUomId: held.spec.productUomId ?? null,
              quantity: String(held.spec.quantity ?? 0),
              priceUnit: String(held.spec.priceUnit ?? 0),
              discount: String(held.spec.discount ?? 0),
              taxId: held.firstTaxId,
              sequence: 10 + at,
            },
          )
        for (const [at, held] of posting.entries())
          await line(
            // The first tax line keeps the historical id so an existing document
            // reprocessed by id lands on the same rows.
            at === 0 ? `${String(args.id)}:tax` : `${String(args.id)}:tax:${String(held.taxId)}`,
            held.accountId,
            held.amount,
            mainDebit,
            held.name,
            false,
            { taxId: held.taxId, sequence: 10 + priced.length + at },
          )
        await line(
          `${String(args.id)}:counterpart`,
          resolvedCounterpart.counterpartAccountId,
          total,
          !mainDebit,
          String(args.ref ?? priced[0]?.spec.description ?? args.id),
          true,
          { dateMaturity: due, sequence: 10 + priced.length + posting.length },
        )
      })
      return { ok: true, id: args.id, amountTotal: moneyText(total, scale) }
    },
  }),
  postMove: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
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
    handler: (ctx, args) => post(ctx, args.id, args.expectedRevision),
  }),
  cancelMove: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:account.Move', 'write:account.Move'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const move = (await ctx.db.select('account.Move', { id: args.id }))[0]
      if (!move) return invalid('id', 'moveMissing')
      if (move.state === 'cancel') return { ok: true, id: args.id }
      if (move.state === 'posted') return invalid('state', 'moveNotCancellable')
      try {
        await ctx.tx(async (tx) => {
          const current = (await tx.db.select('account.Move', { id: args.id }))[0]
          if (!current) throw new Refusal('moveMissing')
          if (current.state === 'cancel') return
          if (current.state === 'posted') throw new Refusal('moveNotCancellable')
          if (!(await claimMoveRevision(tx, current, args.expectedRevision)))
            throw new Refusal('moveConcurrent')
          await tx.db.update('account.Move', { id: args.id }, { state: 'cancel' })
        })
        return { ok: true, id: args.id }
      } catch (error) {
        return refused('expectedRevision', error)
      }
    },
  }),
  /**
   * Post the mirror image of an entry that is already in the books.
   *
   * A posted entry is never edited or deleted — the correction is a second entry
   * whose debits and credits are the first one's, swapped. Where the original
   * opened an item on a reconcilable account, the reversal closes it against the
   * original, so the document stops showing up as owed.
   */
  reverseMove: defineFn({
    input: { id: 'id', reversalId: 'id', date: 'datetime?', ref: 'text?', journalId: 'id?' },
    output: { ok: 'bool', id: 'id?', reversalId: 'id?', name: 'text?', errors: 'json?' },
    effects: [
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Account',
      'read:account.Journal',
      'read:account.PartialReconcile',
      'read:account.Payment',
      'read:company.Company',
      'write:account.Journal',
      'write:account.Move',
      'write:account.MoveLine',
      'write:account.PartialReconcile',
      'write:account.Payment',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const move = (await ctx.db.select('account.Move', { id: args.id }))[0]
      if (!move) return invalid('id', 'moveMissing')
      if (move.state !== 'posted') return invalid('state', 'movePostedOnly')

      const already = (await ctx.db.select('account.Move', { id: args.reversalId }))[0]
      if (already) return { ok: true, id: args.id, reversalId: args.reversalId, name: already.name }

      const lines = (await ctx.db.select('account.MoveLine', { moveId: args.id })).sort(
        (a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)),
      )
      if (!lines.length) return invalid('lines', 'reversalNoLines')
      const journalId = args.journalId ?? move.journalId
      if (!(await ctx.db.select('account.Journal', { id: journalId }))[0])
        return invalid('journalId', 'journalMissing')

      const scale = scaleOf(move.currency)
      const byId = await accountsById(ctx)
      const date = String(args.date ?? today())
      const reversalId = String(args.reversalId)

      await ctx.tx(async (tx) => {
        await tx.db.insert('account.Move', {
          id: reversalId,
          name: reversalId,
          // The reference is the document being corrected, not a sentence about it:
          // this module has no translator, and a ledger read in Vietnamese must not
          // grow English prose.
          ref: args.ref ?? move.name,
          date,
          moveType: 'entry',
          state: 'draft',
          journalId,
          partnerId: move.partnerId ?? null,
          invoiceDate: null,
          invoiceDateDue: null,
          paymentTermId: null,
          paymentState: 'paid',
          currency: move.currency,
          amountUntaxed: move.amountUntaxed,
          amountTax: move.amountTax,
          amountTotal: move.amountTotal,
          postedAt: null,
          revision: 0,
        })
        for (const line of lines) {
          const debit = n(line.credit)
          const credit = n(line.debit)
          const reconcilable = byId.get(String(line.accountId))?.reconcile === true
          await tx.db.insert('account.MoveLine', {
            id: `${reversalId}:${String(line.id)}`,
            moveId: reversalId,
            name: line.name,
            accountId: line.accountId,
            partnerId: line.partnerId ?? null,
            productId: line.productId ?? null,
            productUomId: line.productUomId ?? null,
            quantity: line.quantity,
            priceUnit: line.priceUnit,
            discount: line.discount,
            taxId: line.taxId ?? null,
            debit: moneyText(debit, scale),
            credit: moneyText(credit, scale),
            balance: moneyText(debit - credit, scale),
            dateMaturity: null,
            displayType: line.displayType ?? null,
            reconciled: false,
            amountResidual: moneyText(reconcilable ? Math.abs(debit - credit) : 0, scale),
            sequence: line.sequence,
          })
        }
      })

      const posted = await post(ctx, reversalId)
      if (posted.ok !== true) return posted

      // Close what the original left open, as far as each side still allows.
      for (const line of lines) {
        if (byId.get(String(line.accountId))?.reconcile !== true) continue
        const mirror = (
          await ctx.db.select('account.MoveLine', { id: `${reversalId}:${String(line.id)}` })
        )[0]
        const fresh = (await ctx.db.select('account.MoveLine', { id: line.id }))[0]
        if (!mirror || !fresh) continue
        const amount = Math.min(n(fresh.amountResidual), n(mirror.amountResidual))
        if (amount <= 0) continue
        const debitFirst = n(fresh.balance) > 0
        const result = await functions.reconcile!.handler(ctx, {
          id: `${reversalId}:reconcile:${String(line.id)}`,
          debitMoveId: debitFirst ? fresh.id : mirror.id,
          creditMoveId: debitFirst ? mirror.id : fresh.id,
          amount: moneyText(amount, scale),
          date,
        })
        if ((result as Row).ok !== true) return result as Record<string, unknown>
      }

      if (move.moveType !== 'entry')
        await ctx.db.update('account.Move', { id: args.id }, { paymentState: 'reversed' })

      // A payment's own move is an `entry`, so the line above never reaches it
      // and the payment kept reading `paid` after the money had been reversed
      // out of the books — the ledger and the payments list disagreeing about
      // whether a customer had paid.
      for (const payment of await ctx.db.select('account.Payment', { moveId: args.id }))
        await ctx.db.update('account.Payment', { id: payment.id }, { state: 'reversed' })
      return { ok: true, id: args.id, reversalId, name: posted.name }
    },
  }),
  listPayments: defineFn({
    input: { partnerId: 'id?', state: 'text?', limit: 'int?', offset: 'int?' },
    effects: ['read:account.Payment'],
    agent: true,
    handler: (ctx, args) => {
      const P = ctx.table('account.Payment')
      const where = [
        ...(args.partnerId ? [eq(P.partnerId, args.partnerId)] : []),
        ...(args.state ? [eq(P.state, args.state)] : []),
      ]
      const q = (where.length ? from(P).where(and(...where)) : from(P)).orderBy(asc(P.date), asc(P.id))
      return ctx.db.all(paginate(q, args.limit, args.offset))
    },
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
      invoiceId: 'id?',
      expectedRevision: 'int?',
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
        return invalid('paymentType', 'paymentTypeUnsupported')
      if (!PARTNER_TYPES.includes(args.partnerType as never))
        return invalid('partnerType', 'partnerTypeUnsupported')
      const { currency, scale } = await ledgerOf(ctx)
      const amount = roundMoney(n(args.amount), scale)
      const slack = toleranceOf(scale)
      if (!(amount > 0)) return invalid('amount', 'amountPositive')
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      if (!journal?.defaultAccountId) return invalid('journalId', 'journalLiquidityMissing')
      if (!['bank', 'cash'].includes(String(journal.type))) return invalid('journalId', 'journalNotLiquidity')
      const destination = await accountOf(ctx, args.destinationAccountId)
      if (!destination) return invalid('destinationAccountId', 'destinationMissing')
      const forCustomer = args.partnerType === 'customer'
      if (destination.accountType !== (forCustomer ? 'asset_receivable' : 'liability_payable'))
        return invalid(
          'destinationAccountId',
          forCustomer ? 'destinationMustBeReceivable' : 'destinationMustBePayable',
        )
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
        if (!reconcileTarget) return invalid('reconcileLineId', 'openItemMissing')
        if (reconcileTarget.accountId !== args.destinationAccountId)
          return invalid('reconcileLineId', 'openItemAccountMismatch')
        const expectedDebit = args.paymentType === 'inbound'
        if (
          (expectedDebit && n(reconcileTarget.balance) <= 0) ||
          (!expectedDebit && n(reconcileTarget.balance) >= 0)
        )
          return invalid('reconcileLineId', 'openItemDirection')
        if (amount - n(reconcileTarget.amountResidual) > slack)
          return invalid('amount', 'amountExceedsOpenItem')
      }
      const reconcilePayment = async (paymentMoveId: string) => {
        if (!reconcileTarget) return null
        const counterpartId = `${paymentMoveId}:counterpart`
        const result = await functions.reconcile!.handler(ctx, {
          id: `${String(args.id)}:reconcile:${String(reconcileTarget.id)}`,
          debitMoveId: args.paymentType === 'inbound' ? reconcileTarget.id : counterpartId,
          creditMoveId: args.paymentType === 'inbound' ? counterpartId : reconcileTarget.id,
          amount: moneyText(amount, scale),
          date: args.date ?? today(),
        })
        return (result as Row).ok === true ? null : result
      }
      if (existing) {
        // A retry of the same call is a success. A different payment under an id
        // that is already taken is not: the stored move is left as it was, and
        // reconciling it for a newly supplied amount would settle an open item
        // against money the ledger never recorded.
        if (
          roundMoney(n(existing.amount), scale) !== amount ||
          String(existing.paymentType) !== String(args.paymentType) ||
          String(existing.journalId) !== String(args.journalId) ||
          String(existing.destinationAccountId) !== String(args.destinationAccountId) ||
          String(existing.invoiceId ?? '') !== String(args.invoiceId ?? '')
        )
          return invalid('id', 'paymentIdReused')
        const failed = await reconcilePayment(String(existing.moveId))
        return failed ?? { ok: true, id: args.id, moveId: existing.moveId }
      }
      const moveId = `${String(args.id)}:move`,
        date = String(args.date ?? today()),
        inbound = args.paymentType === 'inbound'
      try {
        await ctx.tx(async (tx) => {
          if (args.invoiceId) {
            const invoice = (await tx.db.select('account.Move', { id: args.invoiceId }))[0]
            if (!invoice) throw new Refusal('moveMissing')
            if (!(await claimMoveRevision(tx, invoice, args.expectedRevision)))
              throw new Refusal('moveConcurrent')
          }
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
            amountUntaxed: moneyText(0, scale),
            amountTax: moneyText(0, scale),
            amountTotal: moneyText(amount, scale),
            postedAt: null,
            revision: 0,
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
              priceUnit: moneyText(amount, scale),
              discount: '0',
              taxId: null,
              debit: moneyText(debitSide ? amount : 0, scale),
              credit: moneyText(debitSide ? 0 : amount, scale),
              balance: moneyText(debitSide ? amount : -amount, scale),
              dateMaturity: null,
              displayType: null,
              reconciled: false,
              amountResidual: moneyText(reconcilable ? amount : 0, scale),
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
            amount: moneyText(amount, scale),
            date,
            memo: args.memo ?? null,
            paymentReference: args.paymentReference ?? null,
            state: 'in_process',
            currency,
            moveId,
            invoiceId: args.invoiceId ?? null,
          })
        })
      } catch (error) {
        return refused('expectedRevision', error)
      }
      const posted = await post(ctx, moveId)
      if (posted.ok !== true) return posted
      await ctx.db.update('account.Payment', { id: args.id }, { state: 'paid' })
      const failed = await reconcilePayment(moveId)
      if (failed) return failed
      return { ok: true, id: args.id, moveId }
    },
  }),
  /**
   * Collect the complete residual of one posted customer invoice.
   *
   * A payment can settle several due-date lines. The lower-level payment
   * primitive intentionally accepts one open item, so this aggregate creates a
   * single deterministic payment and reconciles its counterpart across every
   * receivable line. Retries resume unfinished reconciliations from the same
   * payment id; the invoice revision is claimed in the transaction that first
   * creates that payment, preventing two collectors from recording the same
   * money concurrently.
   */
  registerInvoicePayment: defineFn({
    input: {
      id: 'id',
      invoiceId: 'id',
      journalId: 'id',
      expectedRevision: 'int?',
      date: 'datetime?',
    },
    output: { ok: 'bool', id: 'id?', moveId: 'id?', amount: 'decimal?', errors: 'json?' },
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
      const invoice = (await ctx.db.select('account.Move', { id: args.invoiceId }))[0]
      if (!invoice) return invalid('invoiceId', 'moveMissing')
      if (invoice.moveType !== 'out_invoice') return invalid('invoiceId', 'invoicePaymentType')
      if (invoice.state !== 'posted') return invalid('state', 'invoicePaymentState')

      const existing = (await ctx.db.select('account.Payment', { id: args.id }))[0]
      if (existing && String(existing.invoiceId ?? '') !== String(args.invoiceId))
        return invalid('id', 'paymentIdReused')

      const { scale } = await ledgerOf(ctx)
      const slack = toleranceOf(scale)
      const accounts = await accountsById(ctx)
      const receivables = (await ctx.db.select('account.MoveLine', { moveId: args.invoiceId }))
        .filter(
          (line) =>
            accounts.get(String(line.accountId))?.accountType === 'asset_receivable' &&
            n(line.amountResidual) > slack,
        )
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      if (!receivables.length) {
        if (existing)
          return { ok: true, id: args.id, moveId: existing.moveId, amount: String(existing.amount) }
        return invalid('invoiceId', 'invoicePaymentResidual')
      }
      const destinationIds = [...new Set(receivables.map((line) => String(line.accountId)))]
      if (destinationIds.length !== 1) return invalid('invoiceId', 'invoicePaymentAccounts')
      const amount = existing
        ? roundMoney(n(existing.amount), scale)
        : roundMoney(
            receivables.reduce((sum, line) => sum + n(line.amountResidual), 0),
            scale,
          )

      const registered = (await functions.registerPayment!.handler(ctx, {
        id: args.id,
        name: `Payment ${String(invoice.name)}`,
        paymentType: 'inbound',
        partnerType: 'customer',
        partnerId: invoice.partnerId,
        journalId: args.journalId,
        destinationAccountId: destinationIds[0],
        amount: moneyText(amount, scale),
        date: args.date ?? today(),
        memo: String(invoice.name),
        paymentReference: String(invoice.name),
        invoiceId: args.invoiceId,
        expectedRevision: args.expectedRevision,
      })) as Row
      if (registered.ok !== true) return registered

      const counterpartId = `${String(registered.moveId)}:counterpart`
      for (const line of receivables) {
        const current = (await ctx.db.select('account.MoveLine', { id: line.id }))[0]
        const residual = n(current?.amountResidual)
        if (residual <= slack) continue
        const reconciled = (await functions.reconcile!.handler(ctx, {
          id: `${String(args.id)}:invoice:${String(line.id)}`,
          debitMoveId: line.id,
          creditMoveId: counterpartId,
          amount: moneyText(residual, scale),
          date: args.date ?? today(),
        })) as Row
        if (reconciled.ok !== true) return reconciled
      }
      return {
        ok: true,
        id: args.id,
        moveId: registered.moveId,
        amount: moneyText(amount, scale),
      }
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
      'read:company.Company',
      'write:account.Move',
      'write:account.MoveLine',
      'write:account.PartialReconcile',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const { scale } = await ledgerOf(ctx)
      const slack = toleranceOf(scale)
      const amount = roundMoney(n(args.amount), scale)
      if (!(amount > 0)) return invalid('amount', 'reconcileAmountPositive')
      if ((await ctx.db.select('account.PartialReconcile', { id: args.id }))[0])
        return { ok: true, id: args.id }
      let moveIds: [unknown, unknown] | null = null
      try {
        moveIds = await ctx.tx(async (tx) => {
          const debit = (await tx.db.select('account.MoveLine', { id: args.debitMoveId }))[0]
          const credit = (await tx.db.select('account.MoveLine', { id: args.creditMoveId }))[0]
          if (!debit || !credit || n(debit.balance) <= 0 || n(credit.balance) >= 0)
            throw new Refusal('reconcileSides')
          if (debit.accountId !== credit.accountId) throw new Refusal('reconcileAccountMismatch')
          const [debitMove, creditMove] = await Promise.all([
            tx.db.select('account.Move', { id: debit.moveId }),
            tx.db.select('account.Move', { id: credit.moveId }),
          ])
          if (debitMove[0]?.state !== 'posted' || creditMove[0]?.state !== 'posted')
            throw new Refusal('reconcilePostedOnly')
          const account = await accountOf(tx, debit.accountId)
          if (!account?.reconcile) throw new Refusal('reconcileNotAllowed')
          if (amount - n(debit.amountResidual) > slack || amount - n(credit.amountResidual) > slack)
            throw new Refusal('reconcileAmountExceeds')
          const held = await tx.db.insertIfAbsent('account.PartialReconcile', {
            id: args.id,
            debitMoveId: args.debitMoveId,
            creditMoveId: args.creditMoveId,
            amount: moneyText(amount, scale),
            date: args.date ?? today(),
          })
          if (!('dryRun' in held) && !held.inserted) return [debit.moveId, credit.moveId]
          const debitResidual = roundMoney(n(debit.amountResidual) - amount, scale)
          const creditResidual = roundMoney(n(credit.amountResidual) - amount, scale)
          const debitWrite = await tx.db.compareAndSet(
            'account.MoveLine',
            { id: debit.id },
            { amountResidual: debit.amountResidual },
            { amountResidual: moneyText(debitResidual, scale), reconciled: debitResidual <= slack },
          )
          const creditWrite = await tx.db.compareAndSet(
            'account.MoveLine',
            { id: credit.id },
            { amountResidual: credit.amountResidual },
            { amountResidual: moneyText(creditResidual, scale), reconciled: creditResidual <= slack },
          )
          if (
            (!('dryRun' in debitWrite) && !debitWrite.matched) ||
            (!('dryRun' in creditWrite) && !creditWrite.matched)
          )
            throw new Refusal('reconcileConcurrent')
          return [debit.moveId, credit.moveId]
        })
      } catch (error) {
        return refused('lines', error)
      }
      if (moveIds) {
        const accounts = await accountsById(ctx)
        await updatePaymentState(ctx, moveIds[0], accounts)
        await updatePaymentState(ctx, moveIds[1], accounts)
      }
      return { ok: true, id: args.id }
    },
  }),
  trialBalance: defineFn({
    input: { dateFrom: 'datetime?', dateTo: 'datetime?' },
    effects: ['read:account.Account', 'read:account.Move', 'read:account.MoveLine', 'read:company.Company'],
    agent: true,
    handler: async (ctx, args) => {
      const { scale } = await ledgerOf(ctx)
      const accounts = await ctx.db.select('account.Account')
      // The date window belongs to the move, so it narrows the move query and the
      // journal items are then fetched for those moves alone.
      const moves = await postedMoves(ctx, args.dateFrom, args.dateTo)
      const result = new Map<string, { debit: number; credit: number }>()
      for (const line of await linesOfMoves(ctx, [...moves.keys()])) {
        const held = result.get(String(line.accountId)) ?? { debit: 0, credit: 0 }
        held.debit = roundMoney(held.debit + n(line.debit), scale)
        held.credit = roundMoney(held.credit + n(line.credit), scale)
        result.set(String(line.accountId), held)
      }
      return accounts
        .map((account) => {
          const held = result.get(String(account.id)) ?? { debit: 0, credit: 0 }
          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            debit: moneyText(held.debit, scale),
            credit: moneyText(held.credit, scale),
            balance: moneyText(held.debit - held.credit, scale),
          }
        })
        .filter((row) => n(row.debit) || n(row.credit))
    },
  }),
  generalLedger: defineFn({
    input: {
      accountId: 'id?',
      dateFrom: 'datetime?',
      dateTo: 'datetime?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: ['read:account.Move', 'read:account.MoveLine'],
    agent: true,
    handler: async (ctx, args) => {
      const moves = await postedMoves(ctx, args.dateFrom, args.dateTo)
      const rows = (await linesOfMoves(ctx, [...moves.keys()], args.accountId))
        .map((line): Row & { move: Row } => ({ ...line, move: moves.get(String(line.moveId))! }))
        .sort(
          (a, b) =>
            String(a.move.date).localeCompare(String(b.move.date)) ||
            String(a.moveId).localeCompare(String(b.moveId)) ||
            n(a.sequence) - n(b.sequence),
        )
      return slice(rows, args.limit, args.offset)
    },
  }),
  partnerStatement: defineFn({
    input: {
      partnerId: 'id',
      dateFrom: 'datetime?',
      dateTo: 'datetime?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: ['read:account.Move', 'read:account.MoveLine', 'read:account.Account'],
    agent: true,
    handler: async (ctx, args) => {
      const byId = await accountsById(ctx)
      const control = [...byId.values()]
        .filter((row) => OPEN_ITEM_TYPES.includes(String(row.accountType)))
        .map((row) => row.id)
      if (!control.length) return []
      const M = ctx.table('account.Move')
      const moves = new Map(
        (
          await ctx.db.all(
            from(M).where(
              and(
                eq(M.state, 'posted'),
                eq(M.partnerId, args.partnerId),
                ...(args.dateFrom ? [gte(M.date, args.dateFrom)] : []),
                ...(args.dateTo ? [lte(M.date, args.dateTo)] : []),
              ),
            ),
          )
        ).map((move) => [String(move.id), move]),
      )
      if (!moves.size) return []
      const L = ctx.table('account.MoveLine')
      const lines = await ctx.db.all(
        from(L).where(and(eq(L.partnerId, args.partnerId), inArray(L.accountId, control))),
      )
      const rows = lines
        .filter((line) => moves.has(String(line.moveId)))
        .map((line): Row & { move: Row } => ({ ...line, move: moves.get(String(line.moveId))! }))
        .sort(
          (a, b) =>
            String(a.move.date).localeCompare(String(b.move.date)) ||
            String(a.id).localeCompare(String(b.id)),
        )
      return slice(rows, args.limit, args.offset)
    },
  }),
}
