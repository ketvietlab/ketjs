/**
 * Ledger analytics: the aggregates an accounting overview is made of.
 *
 * These live apart from `functions.ts` because they answer a different kind of
 * question. Everything there reads or writes one document; everything here reads
 * the whole ledger for a window and returns a number nobody can point at a row
 * for. Keeping them together would have hidden that difference behind a shared
 * file — and the aggregates need their own rule about signs, which is worth
 * stating once rather than per call site.
 *
 * The rule: a balance is always reported in the direction the account is kept.
 * Revenue and liabilities read credit minus debit, expenses and assets read
 * debit minus credit. So every amount here is positive when the books say the
 * ordinary thing, and a negative revenue figure means refunds outran sales
 * rather than that a sign convention leaked out of the module.
 *
 * Drafts never count. Every aggregate is built from posted moves alone, which is
 * the same ledger `trialBalance` reports, so a dashboard total and a trial
 * balance run over the same window agree.
 */

import { and, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { accountsById, ledgerOf, linesOfMoves, postedMoves } from './functions.ts'
import type { ACCOUNT_TYPES } from './functions.ts'
import { accountingFilterDateText, civilDateAt } from './date.ts'
import { minorText, moneyMinor, roundedQuotient } from './money.ts'

const n = (value: unknown): number => Number(value ?? 0)

/** Revenue, in the direction revenue is kept. */
const REVENUE_TYPES = ['income', 'income_other'] as const
/** What the goods sold actually cost — the subtrahend in a gross margin. */
const COST_OF_SALES_TYPES = ['expense_direct_cost'] as const
/** Everything spent that is not the cost of the goods sold. */
const OPERATING_EXPENSE_TYPES = ['expense', 'expense_other', 'expense_depreciation'] as const
const EXPENSE_TYPES = [...COST_OF_SALES_TYPES, ...OPERATING_EXPENSE_TYPES] as const
const ASSET_TYPES = [
  'asset_receivable',
  'asset_cash',
  'asset_current',
  'asset_non_current',
  'asset_prepayments',
  'asset_fixed',
] as const
const LIABILITY_TYPES = [
  'liability_payable',
  'liability_credit_card',
  'liability_current',
  'liability_non_current',
] as const
const CASH_TYPES = ['asset_cash'] as const
const RECEIVABLE_TYPES = ['asset_receivable'] as const
const PAYABLE_TYPES = ['liability_payable'] as const

/**
 * Equity and off-balance accounts belong to no group above, on purpose. Equity is
 * not a period result and off-balance records what the company holds without
 * owning — adding either to total assets is the mistake a statutory chart makes
 * easy.
 *
 * Adding an account type to the ledger and forgetting it here would silently drop
 * it out of every total on the dashboard, so the omission is a compile error
 * instead: `Record<Unclassified, never>` needs a key the moment `Unclassified`
 * stops being `never`.
 */
const CLASSIFIED = [
  ...REVENUE_TYPES,
  ...EXPENSE_TYPES,
  ...ASSET_TYPES,
  ...LIABILITY_TYPES,
  'equity',
  'equity_unaffected',
  'off_balance',
] as const
type Unclassified = Exclude<(typeof ACCOUNT_TYPES)[number], (typeof CLASSIFIED)[number]>
const EVERY_TYPE_CLASSIFIED: Record<Unclassified, never> = {}
void EVERY_TYPE_CLASSIFIED

/** Debit and credit summed per account, over whichever moves were asked for. */
type Totals = Map<string, { debit: bigint; credit: bigint }>

async function totalsOf(ctx: Ctx, dateFrom: unknown, dateTo: unknown, scale: number): Promise<Totals> {
  const moves = await postedMoves(ctx, dateFrom, dateTo)
  const totals: Totals = new Map()
  for (const line of await linesOfMoves(ctx, [...moves.keys()])) {
    const held = totals.get(String(line.accountId)) ?? { debit: 0n, credit: 0n }
    held.debit += moneyMinor(line.debit, scale)
    held.credit += moneyMinor(line.credit, scale)
    totals.set(String(line.accountId), held)
  }
  return totals
}

/** Sums one side of the books: `credit` for what is owed or earned, `debit` for what is held or spent. */
const sumOf = (
  totals: Totals,
  accounts: Map<string, Row>,
  types: readonly string[],
  natural: 'debit' | 'credit',
): bigint => {
  let sum = 0n
  for (const [accountId, held] of totals) {
    const type = String(accounts.get(accountId)?.accountType)
    if (!types.includes(type)) continue
    sum += natural === 'debit' ? held.debit - held.credit : held.credit - held.debit
  }
  return sum
}

/** The per-account contribution behind a total, largest first and never noise. */
const breakdownOf = (
  totals: Totals,
  accounts: Map<string, Row>,
  types: readonly string[],
  natural: 'debit' | 'credit',
  scale: number,
): Row[] =>
  [...totals]
    .map(([accountId, held]) => {
      const account = accounts.get(accountId)
      return {
        accountId,
        code: String(account?.code ?? ''),
        name: String(account?.name ?? ''),
        accountType: String(account?.accountType ?? ''),
        amount: natural === 'debit' ? held.debit - held.credit : held.credit - held.debit,
      }
    })
    .filter((row) => types.includes(row.accountType) && row.amount !== 0n)
    .sort((a, b) => (a.amount === b.amount ? a.code.localeCompare(b.code) : a.amount > b.amount ? -1 : 1))
    .map((row) => ({ ...row, amount: minorText(row.amount, scale) }))

/** Exact ratio reduced to six decimals before crossing the JSON number boundary. */
const ratioOf = (numerator: bigint, denominator: bigint): number | null => {
  if (denominator === 0n) return null
  const sign = denominator < 0n ? -1n : 1n
  return Number(roundedQuotient(numerator * sign * 1_000_000n, denominator * sign)) / 1_000_000
}

/**
 * A date window split into buckets.
 *
 * Days for a window a month or two long, months beyond that: thirty points read
 * as a shape, and four hundred read as a smear. The caller may force either,
 * because a screen comparing two windows must bucket both the same way even when
 * one of them is a day shorter.
 */
const DAY = 86_400_000

type Bucket = { start: string; end: string; label: string }

const startOfDay = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))

const bucketsOf = (dateFrom: string, dateTo: string, granularity: 'day' | 'month'): Bucket[] => {
  const fromText = accountingFilterDateText(dateFrom)
  const toText = accountingFilterDateText(dateTo)
  if (!fromText || !toText) return []
  const from = startOfDay(new Date(`${fromText}T00:00:00.000Z`))
  const to = startOfDay(new Date(`${toText}T00:00:00.000Z`))
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) return []
  const buckets: Bucket[] = []
  if (granularity === 'day') {
    for (let at = from.getTime(); at <= to.getTime(); at += DAY) {
      const start = new Date(at)
      buckets.push({
        start: start.toISOString(),
        end: new Date(at + DAY - 1).toISOString(),
        label: start.toISOString().slice(0, 10),
      })
    }
    return buckets
  }
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
  while (cursor <= to) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
    buckets.push({
      start: cursor.toISOString(),
      end: new Date(next.getTime() - 1).toISOString(),
      label: cursor.toISOString().slice(0, 7),
    })
    cursor = next
  }
  return buckets
}

/** Days for two months or less, months above that. */
const granularityOf = (dateFrom: string, dateTo: string): 'day' | 'month' => {
  const from = accountingFilterDateText(dateFrom)
  const to = accountingFilterDateText(dateTo)
  if (!from || !to) return 'day'
  const span =
    (startOfDay(new Date(`${to}T00:00:00.000Z`)).getTime() -
      startOfDay(new Date(`${from}T00:00:00.000Z`)).getTime()) /
    DAY
  return Number.isFinite(span) && span <= 62 ? 'day' : 'month'
}

/** The date an open item came due, falling back through what the document knows. */
const maturityOf = (line: Row, move: Row): string =>
  String(line.dateMaturity ?? move.invoiceDateDue ?? move.documentDate ?? move.accountingDate ?? '').slice(
    0,
    10,
  )

export const analyticsFunctions: Record<string, FnSpec> = {
  /**
   * Revenue, cost, and profit for one window, with the accounts behind each.
   *
   * Gross margin divides by revenue, so it is null rather than zero when nothing
   * was earned: a period with no sales has no margin, and reporting 0% would
   * read as one that sold at exactly cost.
   */
  performance: defineFn({
    input: { dateFrom: 'date?', dateTo: 'date?' },
    effects: ['read:account.Account', 'read:account.Move', 'read:account.MoveLine', 'read:company.Company'],
    agent: true,
    handler: async (ctx, args) => {
      const { currency, scale } = await ledgerOf(ctx)
      const [accounts, totals] = await Promise.all([
        accountsById(ctx),
        totalsOf(ctx, args.dateFrom, args.dateTo, scale),
      ])
      const revenue = sumOf(totals, accounts, REVENUE_TYPES, 'credit')
      const costOfSales = sumOf(totals, accounts, COST_OF_SALES_TYPES, 'debit')
      const operatingExpense = sumOf(totals, accounts, OPERATING_EXPENSE_TYPES, 'debit')
      const expense = costOfSales + operatingExpense
      return {
        currency,
        revenue: minorText(revenue, scale),
        costOfSales: minorText(costOfSales, scale),
        operatingExpense: minorText(operatingExpense, scale),
        expense: minorText(expense, scale),
        grossProfit: minorText(revenue - costOfSales, scale),
        profit: minorText(revenue - expense, scale),
        grossMargin: ratioOf(revenue - costOfSales, revenue),
        revenueByAccount: breakdownOf(totals, accounts, REVENUE_TYPES, 'credit', scale),
        expenseByAccount: breakdownOf(totals, accounts, EXPENSE_TYPES, 'debit', scale),
      }
    },
  }),

  /**
   * What the company holds and owes as at a date.
   *
   * No `dateFrom`: a balance is the whole ledger up to a moment, and a window
   * would report the movement instead — the mistake that makes total assets
   * shrink when a user narrows the date filter.
   */
  position: defineFn({
    input: { asOf: 'date?' },
    effects: ['read:account.Account', 'read:account.Move', 'read:account.MoveLine', 'read:company.Company'],
    agent: true,
    handler: async (ctx, args) => {
      const { currency, scale } = await ledgerOf(ctx)
      const [accounts, totals] = await Promise.all([
        accountsById(ctx),
        totalsOf(ctx, undefined, args.asOf, scale),
      ])
      return {
        currency,
        cash: minorText(sumOf(totals, accounts, CASH_TYPES, 'debit'), scale),
        assets: minorText(sumOf(totals, accounts, ASSET_TYPES, 'debit'), scale),
        liabilities: minorText(sumOf(totals, accounts, LIABILITY_TYPES, 'credit'), scale),
      }
    },
  }),

  /**
   * Revenue and cost of sales per bucket across a window.
   *
   * Each bucket holds what was earned inside it, not a running total: a reader
   * asking which week was weak needs the weeks, and a cumulative line answers a
   * different question while looking like this one.
   */
  revenueTimeline: defineFn({
    input: { dateFrom: 'date', dateTo: 'date', granularity: 'text?' },
    effects: ['read:account.Account', 'read:account.Move', 'read:account.MoveLine', 'read:company.Company'],
    agent: true,
    handler: async (ctx, args) => {
      const { currency, scale } = await ledgerOf(ctx)
      const asked = String(args.granularity ?? '')
      const granularity: 'day' | 'month' =
        asked === 'day' || asked === 'month'
          ? asked
          : granularityOf(String(args.dateFrom), String(args.dateTo))
      const buckets = bucketsOf(String(args.dateFrom), String(args.dateTo), granularity)
      if (!buckets.length) return { currency, granularity, points: [] }
      const accounts = await accountsById(ctx)
      const moves = await postedMoves(ctx, args.dateFrom, args.dateTo)
      const lines = await linesOfMoves(ctx, [...moves.keys()])
      const points = buckets.map((bucket) => ({ ...bucket, revenue: 0n, costOfSales: 0n }))
      // One pass over the journal items, each landing in the bucket its move's
      // date falls in. Binary search would be premature: a window is at most a
      // few hundred buckets and the line count dominates either way.
      const index = new Map(points.map((point, at) => [point.label, at]))
      const labelOf = (date: string): string => (granularity === 'day' ? date.slice(0, 10) : date.slice(0, 7))
      for (const line of lines) {
        const move = moves.get(String(line.moveId))
        if (!move) continue
        const at = index.get(labelOf(String(move.accountingDate)))
        if (at === undefined) continue
        const type = String(accounts.get(String(line.accountId))?.accountType)
        if ((REVENUE_TYPES as readonly string[]).includes(type)) {
          points[at]!.revenue += moneyMinor(line.credit, scale) - moneyMinor(line.debit, scale)
        } else if ((COST_OF_SALES_TYPES as readonly string[]).includes(type)) {
          points[at]!.costOfSales += moneyMinor(line.debit, scale) - moneyMinor(line.credit, scale)
        }
      }
      return {
        currency,
        granularity,
        points: points.map((point) => ({
          start: point.start,
          end: point.end,
          label: point.label,
          revenue: minorText(point.revenue, scale),
          costOfSales: minorText(point.costOfSales, scale),
        })),
      }
    },
  }),

  /**
   * What is still owed, both ways, split by whether it has come due.
   *
   * Read from unreconciled journal items rather than from invoice totals, so a
   * partly paid invoice contributes what is left of it instead of all or none.
   */
  openItemSummary: defineFn({
    input: { asOf: 'date?', partnerLimit: 'int?' },
    effects: [
      'read:account.Account',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
      'read:partner.Partner',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const { currency, scale, timezone } = await ledgerOf(ctx)
      const asOf = accountingFilterDateText(args.asOf) ?? civilDateAt(new Date(), timezone)
      const limit = Math.max(0, Math.trunc(n(args.partnerLimit))) || 5
      const accounts = await accountsById(ctx)
      const sides = {
        receivable: [...accounts.values()]
          .filter((row) => (RECEIVABLE_TYPES as readonly string[]).includes(String(row.accountType)))
          .map((row) => String(row.id)),
        payable: [...accounts.values()]
          .filter((row) => (PAYABLE_TYPES as readonly string[]).includes(String(row.accountType)))
          .map((row) => String(row.id)),
      }
      const control = [...sides.receivable, ...sides.payable]
      const zero = minorText(0n, scale)
      const empty = { total: zero, current: zero, overdue: zero, partners: [] as Row[] }
      if (!control.length) return { currency, asOf, receivable: empty, payable: empty }
      const moves = await postedMoves(ctx, undefined, asOf)
      const L = ctx.table('account.MoveLine')
      const lines: Row[] = []
      for (let at = 0; at < control.length; at += 400) {
        lines.push(
          ...(await ctx.db.all(
            from(L).where(and(eq(L.reconciled, false), inArray(L.accountId, control.slice(at, at + 400)))),
          )),
        )
      }
      type Side = {
        total: bigint
        current: bigint
        overdue: bigint
        partners: Map<string, [bigint, bigint]>
      }
      const held: Record<'receivable' | 'payable', Side> = {
        receivable: { total: 0n, current: 0n, overdue: 0n, partners: new Map() },
        payable: { total: 0n, current: 0n, overdue: 0n, partners: new Map() },
      }
      const partnerIds = new Set<string>()
      for (const line of lines) {
        const move = moves.get(String(line.moveId))
        const residual = moneyMinor(line.amountResidual, scale)
        if (!move || residual <= 0n) continue
        const side = sides.receivable.includes(String(line.accountId)) ? 'receivable' : 'payable'
        const bucket = held[side]
        const overdue = maturityOf(line, move) < asOf
        bucket.total += residual
        if (overdue) bucket.overdue += residual
        else bucket.current += residual
        const partnerId = String(line.partnerId ?? move.partnerId ?? '')
        if (!partnerId) continue
        partnerIds.add(partnerId)
        const seen = bucket.partners.get(partnerId) ?? [0n, 0n]
        bucket.partners.set(partnerId, [seen[0] + residual, seen[1] + (overdue ? residual : 0n)])
      }
      const P = ctx.table('partner.Partner')
      const names = new Map(
        partnerIds.size
          ? (await ctx.db.all(from(P).where(inArray(P.id, [...partnerIds])))).map((row): [string, string] => [
              String(row.id),
              String(row.name ?? ''),
            ])
          : [],
      )
      const report = (side: Side): Row => ({
        total: minorText(side.total, scale),
        current: minorText(side.current, scale),
        overdue: minorText(side.overdue, scale),
        partners: [...side.partners]
          .map(([partnerId, [total, overdue]]) => ({
            partnerId,
            name: names.get(partnerId) ?? partnerId,
            total,
            overdue,
          }))
          .sort((a, b) => (a.total === b.total ? a.name.localeCompare(b.name) : a.total > b.total ? -1 : 1))
          .slice(0, limit)
          .map((row) => ({
            ...row,
            total: minorText(row.total, scale),
            overdue: minorText(row.overdue, scale),
          })),
      })
      return { currency, asOf, receivable: report(held.receivable), payable: report(held.payable) }
    },
  }),

  /**
   * Money that actually moved through cash and bank accounts in a window.
   *
   * Each line is classified by what it was posted against on the same move, so
   * the figures are the ledger's own account types rather than a guess from the
   * journal a payment happened to use. Amounts are signed: positive came in.
   */
  cashFlow: defineFn({
    input: { dateFrom: 'date?', dateTo: 'date?' },
    effects: ['read:account.Account', 'read:account.Move', 'read:account.MoveLine', 'read:company.Company'],
    agent: true,
    handler: async (ctx, args) => {
      const { currency, scale } = await ledgerOf(ctx)
      const accounts = await accountsById(ctx)
      const moves = await postedMoves(ctx, args.dateFrom, args.dateTo)
      const lines = await linesOfMoves(ctx, [...moves.keys()])
      const byMove = new Map<string, Row[]>()
      for (const line of lines) {
        const held = byMove.get(String(line.moveId)) ?? []
        held.push(line)
        byMove.set(String(line.moveId), held)
      }
      const typeOf = (line: Row): string => String(accounts.get(String(line.accountId))?.accountType ?? '')
      const isCash = (line: Row): boolean => (CASH_TYPES as readonly string[]).includes(typeOf(line))
      const flows = { sales: 0n, purchases: 0n, operating: 0n, other: 0n }
      for (const held of byMove.values()) {
        const cash = held.filter(isCash)
        if (!cash.length) continue
        const movement = cash.reduce(
          (sum, line) => sum + moneyMinor(line.debit, scale) - moneyMinor(line.credit, scale),
          0n,
        )
        if (movement === 0n) continue
        // The counterpart weight decides the bucket: a receipt settling a
        // receivable is sales however it was journalled, and a move touching
        // several counterparts is filed under the largest of them.
        const weights = { sales: 0n, purchases: 0n, operating: 0n, other: 0n }
        for (const line of held) {
          if (isCash(line)) continue
          const type = typeOf(line)
          const balance = moneyMinor(line.debit, scale) - moneyMinor(line.credit, scale)
          const size = balance < 0n ? -balance : balance
          if (
            (RECEIVABLE_TYPES as readonly string[]).includes(type) ||
            (REVENUE_TYPES as readonly string[]).includes(type)
          ) {
            weights.sales += size
          } else if (
            (PAYABLE_TYPES as readonly string[]).includes(type) ||
            (COST_OF_SALES_TYPES as readonly string[]).includes(type)
          ) {
            weights.purchases += size
          } else if ((OPERATING_EXPENSE_TYPES as readonly string[]).includes(type)) {
            weights.operating += size
          } else {
            weights.other += size
          }
        }
        const bucket = (Object.entries(weights) as Array<[keyof typeof flows, bigint]>).sort((a, b) =>
          a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1,
        )[0]
        flows[bucket && bucket[1] > 0n ? bucket[0] : 'other'] += movement
      }
      const net = flows.sales + flows.purchases + flows.operating + flows.other
      return {
        currency,
        sales: minorText(flows.sales, scale),
        purchases: minorText(flows.purchases, scale),
        operating: minorText(flows.operating, scale),
        other: minorText(flows.other, scale),
        net: minorText(net, scale),
      }
    },
  }),
}

export { bucketsOf, granularityOf }
