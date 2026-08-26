/**
 * The figures a loyalty screen leads with, counted by the database.
 *
 * Every list here can run to five figures — a year of ledger entries, a
 * membership base — and the numbers above the table are about all of them, not
 * about the twenty rows on screen. Counting in JavaScript would mean reading the
 * whole table to print one number, so each of these is a `COUNT` or a `SUM` the
 * store answers on its own.
 *
 * They take the same filters as the list they sit above, because a total that
 * ignores the filter is a total for a different question than the one the
 * operator asked.
 */

import { and, defineFn, eq, from, gt, gte, inArray, isNull, lt, lte, or } from '@ketvietlab/ketjs'
import type { Col, Ctx, Expr, FnSpec, Query, Row } from '@ketvietlab/ketjs'
import { n, now } from './engine.ts'

/** The conditions the caller actually supplied, as one filter or none at all. */
const all = (...parts: Array<Expr | null>): Expr | null => {
  const kept = parts.filter((part): part is Expr => part !== null)
  return kept.length ? and(...kept) : null
}

const where = (query: Query, expr: Expr | null): Query => (expr ? query.where(expr) : query)

/** `SUM` of one column, or zero when the filter matches nothing. */
const sumOf = async (ctx: Ctx, query: Query, col: Col): Promise<number> => {
  const [row] = await ctx.db.group(query.aggregate({ fn: 'sum', col, as: 'total' }))
  return row ? n(row.aggregates.total) : 0
}

/**
 * Which wallets a ledger question is about.
 *
 * The ledger carries a wallet, not a program, so filtering entries by program
 * means resolving the program's wallets first. Returned as ids because the
 * alternative — a join this query layer does not offer — is reading every entry
 * and matching in memory.
 */
const walletsOfProgram = async (ctx: Ctx, programId: unknown): Promise<unknown[]> => {
  const W = ctx.table('loyalty.Wallet')
  return (await ctx.db.all(from(W).where(eq(W.programId, programId)))).map((row) => row.id)
}

export const statsFunctions: Record<string, FnSpec> = {
  /**
   * Programs by where they stand in their own calendar.
   *
   * A program is not simply on or off: one that starts next month and one that
   * ended last week are both inactive today and mean opposite things to whoever
   * is looking at the list.
   */
  'program.stats': defineFn({
    input: {},
    output: {
      total: 'int',
      running: 'int',
      upcoming: 'int',
      paused: 'int',
      ended: 'int',
    },
    effects: ['read:loyalty.Program'],
    agent: true,
    handler: async (ctx) => {
      const P = ctx.table('loyalty.Program')
      const at = now()
      const started = or(lte(P.dateFrom, at), isNull(P.dateFrom))
      const notFinished = or(gte(P.dateTo, at), isNull(P.dateTo))
      return {
        total: await ctx.db.count(from(P)),
        running: await ctx.db.count(from(P).where(and(eq(P.active, true), started, notFinished))),
        upcoming: await ctx.db.count(from(P).where(and(eq(P.active, true), gt(P.dateFrom, at)))),
        paused: await ctx.db.count(from(P).where(eq(P.active, false))),
        ended: await ctx.db.count(from(P).where(and(eq(P.active, true), lt(P.dateTo, at)))),
      }
    },
  }),

  /**
   * Wallets, their balance, and the three ways one stops being usable.
   *
   * Locked and expired are counted apart because they are undone differently:
   * one is a decision somebody made, the other is a date that passed.
   */
  'wallet.stats': defineFn({
    input: { programId: 'id?' },
    output: {
      total: 'int',
      balance: 'decimal',
      active: 'int',
      locked: 'int',
      expired: 'int',
    },
    effects: ['read:loyalty.Wallet'],
    agent: true,
    handler: async (ctx, args) => {
      const W = ctx.table('loyalty.Wallet')
      const at = now()
      const scope = args.programId ? eq(W.programId, args.programId) : null
      const live = and(eq(W.active, true), or(gt(W.expiresAt, at), isNull(W.expiresAt)))
      return {
        total: await ctx.db.count(where(from(W), scope)),
        balance: await sumOf(ctx, where(from(W), scope), W.balance),
        active: await ctx.db.count(where(from(W), all(scope)).where(live)),
        locked: await ctx.db.count(where(from(W), all(scope)).where(eq(W.active, false))),
        expired: await ctx.db.count(
          where(from(W), all(scope)).where(and(eq(W.active, true), lte(W.expiresAt, at))),
        ),
      }
    },
  }),

  /**
   * Members, and how many of them are still moving.
   *
   * Active means the rolling window still holds spend: a membership whose window
   * has emptied is a customer who stopped coming, which is the number worth
   * showing next to the total rather than buried in it.
   */
  'membership.stats': defineFn({
    input: { tierId: 'id?' },
    output: { total: 'int', active: 'int', dormant: 'int', points: 'decimal', spend: 'decimal' },
    effects: ['read:loyalty.Membership'],
    agent: true,
    handler: async (ctx, args) => {
      const M = ctx.table('loyalty.Membership')
      const scope = args.tierId ? eq(M.tierId, args.tierId) : null
      return {
        total: await ctx.db.count(where(from(M), scope)),
        active: await ctx.db.count(where(from(M), all(scope)).where(gt(M.rollingSpend, 0))),
        dormant: await ctx.db.count(where(from(M), all(scope)).where(lte(M.rollingSpend, 0))),
        points: await sumOf(ctx, where(from(M), scope), M.points),
        spend: await sumOf(ctx, where(from(M), scope), M.rollingSpend),
      }
    },
  }),

  /**
   * A period of the ledger, in the five figures a statement opens with.
   *
   * Credits and debits are summed apart rather than netted, because a period
   * that earned and redeemed the same amount is not a period where nothing
   * happened. Opening balance is everything before the window and closing is
   * everything up to its end — both ignore the operation filter on purpose: a
   * balance is the balance whatever kinds of entry the reader is looking at.
   */
  'ledger.stats': defineFn({
    input: { walletId: 'id?', programId: 'id?', operation: 'text?', from: 'datetime?', to: 'datetime?' },
    output: {
      entries: 'int',
      credit: 'decimal',
      debit: 'decimal',
      opening: 'decimal',
      closing: 'decimal',
    },
    effects: ['read:loyalty.LedgerEntry', 'read:loyalty.Wallet'],
    agent: true,
    handler: async (ctx, args) => {
      const L = ctx.table('loyalty.LedgerEntry')
      const wallets = args.programId ? await walletsOfProgram(ctx, args.programId) : null
      // A program with no wallets matches no entry, and an empty `IN ()` is not
      // a filter — so the answer is zeros rather than the unfiltered ledger.
      if (wallets && !wallets.length) return { entries: 0, credit: 0, debit: 0, opening: 0, closing: 0 }

      const scope = all(
        args.walletId ? eq(L.walletId, args.walletId) : null,
        wallets ? inArray(L.walletId, wallets) : null,
      )
      const window = all(
        args.from ? gte(L.createdAt, args.from) : null,
        args.to ? lte(L.createdAt, args.to) : null,
      )
      const kind = args.operation ? eq(L.operation, args.operation) : null

      const inPeriod = where(where(where(from(L), scope), window), kind)
      return {
        entries: await ctx.db.count(inPeriod),
        credit: await sumOf(ctx, inPeriod.where(gt(L.balanceDelta, 0)), L.balanceDelta),
        debit: await sumOf(ctx, inPeriod.where(lt(L.balanceDelta, 0)), L.balanceDelta),
        opening: args.from
          ? await sumOf(ctx, where(from(L), scope).where(lt(L.createdAt, args.from)), L.balanceDelta)
          : 0,
        closing: await sumOf(
          ctx,
          args.to ? where(from(L), scope).where(lte(L.createdAt, args.to)) : where(from(L), scope),
          L.balanceDelta,
        ),
      }
    },
  }),
}

export type LoyaltyStats = Record<string, Row>
