import { and, asc, defineFn, desc, eq, from, gt, lte } from '@ketvietlab/ketjs'
import type { Ctx, Expr, FnSpec, Row } from '@ketvietlab/ketjs'
import { decimal, invalid, issue, n, now } from './engine.ts'

const cutoffFor = (date: string, months: number): number => {
  const cutoff = new Date(date)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
  return cutoff.getTime()
}

export const membershipPosition = async (
  ctx: Ctx,
  partnerId: string,
  at = now(),
): Promise<{ months: number; spending: number; tier: Row | null } | null> => {
  const tiers = await ctx.db.select('loyalty.Tier', { active: true })
  if (!tiers.length) return null
  const atTime = new Date(at).getTime()
  const entries = (await ctx.db.select('loyalty.SpendEntry', { partnerId })).filter(
    (entry) => !entry.reversedAt && new Date(String(entry.occurredAt)).getTime() <= atTime,
  )
  const positions = tiers.map((tier) => {
    const months = Math.max(1, n(tier.windowMonths ?? 12))
    const cutoff = cutoffFor(at, months)
    const spending = entries
      .filter((entry) => new Date(String(entry.occurredAt)).getTime() >= cutoff)
      .reduce((sum, entry) => sum + n(entry.amount), 0)
    return { months, spending, tier }
  })
  const qualified = positions
    .filter((position) => n(position.tier.minimumSpend) <= position.spending + 0.000001)
    .sort(
      (a, b) =>
        n(b.tier.sequence) - n(a.tier.sequence) ||
        n(b.tier.minimumSpend) - n(a.tier.minimumSpend) ||
        String(a.tier.id).localeCompare(String(b.tier.id)),
    )
  if (qualified[0]) return qualified[0]
  const baseline = positions.sort(
    (a, b) => n(a.tier.sequence) - n(b.tier.sequence) || String(a.tier.id).localeCompare(String(b.tier.id)),
  )[0]!
  return { months: baseline.months, spending: baseline.spending, tier: null }
}

export const refreshMembershipRow = async (ctx: Ctx, partnerId: string, at = now()): Promise<Row | null> => {
  const position = await membershipPosition(ctx, partnerId, at)
  if (!position) return null
  const { months, spending, tier } = position
  const wallets = await ctx.db.select('loyalty.Wallet', { partnerId, active: true })
  const points = wallets.reduce((sum, wallet) => sum + n(wallet.balance), 0)
  const existing = (await ctx.db.select('loyalty.Membership', { partnerId }))[0]
  const values = {
    partnerId,
    tierId: tier?.id ?? null,
    rollingSpend: decimal(spending),
    points: decimal(points),
    windowMonths: months,
    refreshedAt: at,
    version: n(existing?.version) + 1,
  }
  if (existing) await ctx.db.update('loyalty.Membership', { id: existing.id }, values)
  else
    await ctx.db.insertIfAbsent('loyalty.Membership', {
      id: `membership:${partnerId}`,
      ...values,
    })
  return (await ctx.db.select('loyalty.Membership', { partnerId }))[0] ?? null
}

const summaryOf = async (ctx: Ctx, membership: Row | null) => {
  if (!membership) return null
  const tier = membership.tierId ? (await ctx.db.select('loyalty.Tier', { id: membership.tierId }))[0] : null
  return {
    partnerId: String(membership.partnerId),
    tierId: membership.tierId ? String(membership.tierId) : null,
    tierCode: tier ? String(tier.code) : null,
    tierName: tier ? String(tier.name) : null,
    rollingSpend: n(membership.rollingSpend),
    points: n(membership.points),
    windowMonths: n(membership.windowMonths),
    refreshedAt: String(membership.refreshedAt),
  }
}

const membershipEffects = [
  'read:partner.Partner',
  'read:loyalty.SpendEntry',
  'read:loyalty.Tier',
  'read:loyalty.Wallet',
  'read:loyalty.Membership',
  'write:loyalty.Membership',
] as const

export const membershipFunctions: Record<string, FnSpec> = {
  /**
   * Members, ranked by what they have spent in the window.
   *
   * `state` splits the base by whether the rolling window still holds anything:
   * a membership that has emptied is a customer who stopped coming, and it is
   * the half of the list worth acting on.
   */
  'membership.list': defineFn({
    input: { tierId: 'id?', state: 'text?', limit: 'int?', offset: 'int?' },
    effects: ['read:loyalty.Membership', 'read:loyalty.Tier'],
    agent: true,
    handler: async (ctx, args) => {
      const M = ctx.table('loyalty.Membership')
      const parts: Expr[] = []
      if (args.tierId) parts.push(eq(M.tierId, args.tierId))
      if (args.state === 'active') parts.push(gt(M.rollingSpend, 0))
      else if (args.state === 'dormant') parts.push(lte(M.rollingSpend, 0))

      let query = from(M).orderBy(desc(M.rollingSpend), asc(M.id))
      if (parts.length) query = query.where(and(...parts))
      const size = Math.min(1000, Math.max(1, n(args.limit ?? 100)))
      const skip = Math.max(0, n(args.offset ?? 0))

      const tiers = new Map((await ctx.db.select('loyalty.Tier')).map((tier) => [String(tier.id), tier]))
      return (await ctx.db.all(skip ? query.limit(size).offset(skip) : query.limit(size))).map(
        (membership) => ({
          ...membership,
          tierCode: membership.tierId ? tiers.get(String(membership.tierId))?.code : null,
          tierName: membership.tierId ? tiers.get(String(membership.tierId))?.name : null,
        }),
      )
    },
  }),

  'membership.refresh': defineFn({
    input: { partnerId: 'id', at: 'datetime?' },
    effects: [...membershipEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid(issue('partnerId', 'loyalty.error.partnerMissing'))
      return {
        ok: true,
        summary: await summaryOf(
          ctx,
          await refreshMembershipRow(ctx, String(args.partnerId), args.at ? String(args.at) : now()),
        ),
      }
    },
  }),

  'membership.getSummary': defineFn({
    input: { partnerId: 'id', refresh: 'bool?' },
    effects: [...membershipEffects],
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0]) return null
      const membership = args.refresh
        ? await refreshMembershipRow(ctx, String(args.partnerId))
        : ((await ctx.db.select('loyalty.Membership', { partnerId: args.partnerId }))[0] ?? null)
      return summaryOf(ctx, membership)
    },
  }),

  'portal.summary': defineFn({
    input: { partnerId: 'id' },
    effects: [...membershipEffects, 'read:loyalty.Program', 'read:loyalty.LedgerEntry'],
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid(issue('partnerId', 'loyalty.error.partnerMissing'))
      const membership = await refreshMembershipRow(ctx, String(args.partnerId))
      const programs = new Map(
        (await ctx.db.select('loyalty.Program', { active: true }))
          .filter((program) => program.portalVisible)
          .map((program) => [String(program.id), program]),
      )
      const wallets = (await ctx.db.select('loyalty.Wallet', { partnerId: args.partnerId, active: true }))
        .filter((wallet) => programs.has(String(wallet.programId)))
        .map((wallet) => ({
          id: wallet.id,
          programId: wallet.programId,
          programName: programs.get(String(wallet.programId))?.name,
          pointName: programs.get(String(wallet.programId))?.pointName,
          code: wallet.code,
          balance: n(wallet.balance),
          reserved: n(wallet.reserved),
          available: n(wallet.balance) - n(wallet.reserved),
          expiresAt: wallet.expiresAt,
        }))
      const walletIds = new Set(wallets.map((wallet) => String(wallet.id)))
      const walletCodes = new Map(wallets.map((wallet) => [String(wallet.id), String(wallet.code)]))
      const ledger = (await ctx.db.select('loyalty.LedgerEntry'))
        .filter((entry) => walletIds.has(String(entry.walletId)))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 100)
        .map((entry) => ({
          id: entry.id,
          walletId: entry.walletId,
          walletCode: walletCodes.get(String(entry.walletId)),
          operation: entry.operation,
          amount: n(entry.amount),
          balanceDelta: n(entry.balanceDelta),
          sourceId: entry.sourceId,
          descriptionCode: entry.descriptionCode,
          createdAt: entry.createdAt,
        }))
      return { ok: true, membership: await summaryOf(ctx, membership), wallets, ledger }
    },
  }),
}
