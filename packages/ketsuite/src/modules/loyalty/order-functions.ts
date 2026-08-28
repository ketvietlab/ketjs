import { createHash } from 'node:crypto'
import {
  and,
  asc,
  defineFn,
  desc,
  eq,
  from,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, Expr, FnSpec, Query, Row } from '@ketvietlab/ketjs'
import { canonicalDecimalText, minorText, moneyMinor, percentOfMinor, scaleOf } from '../account/money.ts'
import { decimal, evaluate, invalid, issue, n, normalizeCode, now, snapshotOf } from './engine.ts'
import {
  finalizeReservation,
  InsufficientBalance,
  LoyaltyConflict,
  postDelta,
  release,
  reserve,
  walletSummary,
} from './ledger.ts'
import { refreshMembershipRow } from './membership-functions.ts'

/**
 * A page of a list, bounded whether or not the caller asked for one.
 *
 * The cap is the point: a screen asks for twenty, an export asks for a thousand,
 * and nothing gets to ask for the whole table by leaving the argument out.
 */
const paged = (query: Query, args: { limit?: unknown; offset?: unknown }): Query => {
  const size = Math.min(1000, Math.max(1, n(args.limit ?? 100)))
  const skip = Math.max(0, n(args.offset ?? 0))
  return skip ? query.limit(size).offset(skip) : query.limit(size)
}

const codeFor = (seed: string): string =>
  `KET-${createHash('sha256').update(seed).digest('hex').slice(0, 12).toUpperCase()}`
const applicationId = (orderType: string, orderId: string, programId: string) =>
  `${orderType}:${orderId}:${programId}`

const codeAvailable = async (ctx: Ctx, code: string, exceptWalletId?: string): Promise<boolean> =>
  !(await ctx.db.select('loyalty.Rule', { normalizedCode: code })).some((row) => row.active) &&
  !(await ctx.db.select('loyalty.Wallet', { normalizedCode: code })).some(
    (row) => row.active && row.id !== exceptWalletId,
  )

const ensureWallet = async (
  ctx: Ctx,
  program: Row,
  options: {
    id: string
    partnerId?: string | null
    code?: string
    expiresAt?: string | null
  },
): Promise<Row> => {
  const existingById = (await ctx.db.select('loyalty.Wallet', { id: options.id }))[0]
  if (existingById) return existingById
  if (options.partnerId && ['loyalty', 'ewallet'].includes(String(program.programType))) {
    const member = (
      await ctx.db.select('loyalty.Wallet', {
        programId: program.id,
        partnerId: options.partnerId,
        active: true,
      })
    )[0]
    if (member) return member
  }
  const code = normalizeCode(options.code ?? codeFor(options.id))
  if (!(await codeAvailable(ctx, code))) throw new LoyaltyConflict('wallet code changed')
  await ctx.db.insert('loyalty.Wallet', {
    id: options.id,
    programId: program.id,
    partnerId: options.partnerId ?? null,
    code,
    normalizedCode: code,
    unit: ['gift_card', 'ewallet'].includes(String(program.programType)) ? 'currency' : 'points',
    balance: '0',
    reserved: '0',
    expiresAt: options.expiresAt ?? null,
    active: true,
    version: 0,
    createdAt: now(),
  })
  return (await ctx.db.select('loyalty.Wallet', { id: options.id }))[0]!
}

const upsertApplication = async (
  ctx: Ctx,
  values: {
    orderType: string
    orderId: string
    partnerId?: string | null
    programId: string
    walletId?: string | null
    rewardId?: string | null
    code?: string | null
    pointsEarned?: number
    pointsSpent?: number
    discountAmount?: string
    rewardPayload?: unknown
    currency: string
    state?: string
  },
): Promise<Row> => {
  const id = applicationId(values.orderType, values.orderId, values.programId)
  const existing = (await ctx.db.select('loyalty.Application', { id }))[0]
  const patch = {
    orderType: values.orderType,
    orderId: values.orderId,
    partnerId: values.partnerId ?? null,
    programId: values.programId,
    walletId: values.walletId ?? null,
    rewardId: values.rewardId ?? null,
    code: values.code ?? null,
    pointsEarned: decimal(values.pointsEarned ?? 0),
    pointsSpent: decimal(values.pointsSpent ?? 0),
    discountAmount: canonicalDecimalText(values.discountAmount ?? '0'),
    rewardPayload: values.rewardPayload ?? null,
    currency: values.currency,
    state: values.state ?? 'draft',
    updatedAt: now(),
  }
  if (existing) await ctx.db.update('loyalty.Application', { id }, patch)
  else
    await ctx.db.insert('loyalty.Application', {
      id,
      ...patch,
      createdAt: now(),
    })
  return (await ctx.db.select('loyalty.Application', { id }))[0]!
}

const evaluationEffects = [
  'read:loyalty.Program',
  'read:loyalty.ProgramPricelist',
  'read:loyalty.Rule',
  'read:loyalty.RuleProduct',
  'read:loyalty.Reward',
  'read:loyalty.RewardProduct',
  'read:loyalty.Wallet',
  'read:loyalty.Reservation',
  'read:loyalty.Application',
  'read:loyalty.ProductTag',
  'read:loyalty.MembershipConfig',
  'read:loyalty.EarnGroup',
  'read:product.Product',
  'read:product.Template',
  'read:product.Category',
] as const

const walletWriteEffects = [
  'read:loyalty.Wallet',
  'write:loyalty.Wallet',
  'read:loyalty.LedgerEntry',
  'write:loyalty.LedgerEntry',
] as const

const membershipEffects = [
  'read:loyalty.MembershipConfig',
  'read:loyalty.SpendEntry',
  'write:loyalty.SpendEntry',
  'read:loyalty.Tier',
  'read:loyalty.Membership',
  'write:loyalty.Membership',
] as const

const orderWriteEffects = [
  ...evaluationEffects,
  ...walletWriteEffects,
  ...membershipEffects,
  'read:loyalty.Reservation',
  'write:loyalty.Reservation',
  'write:loyalty.Application',
  'read:partner.Partner',
] as const

const concurrentError = (error: unknown) => {
  if (error instanceof InsufficientBalance)
    return invalid(issue('points', 'loyalty.error.insufficientPoints'))
  if (error instanceof LoyaltyConflict) return invalid(issue('wallet', 'loyalty.error.concurrent'))
  throw error
}

type TransactionOptions = { inTransaction?: boolean }

const transact = <T>(ctx: Ctx, options: TransactionOptions, body: (tx: Ctx) => Promise<T>): Promise<T> =>
  options.inTransaction ? body(ctx) : ctx.tx(body)

export const applyOrderReward = async (
  ctx: Ctx,
  args: Row,
  options: TransactionOptions = {},
): Promise<Row> => {
  const snapshot = snapshotOf(args.order)
  if (!snapshot) return invalid(issue('order', 'loyalty.error.order'))
  const program = (await ctx.db.select('loyalty.Program', { id: args.programId }))[0]
  if (!program) return invalid(issue('programId', 'loyalty.error.programMissing'))
  const reward = (
    await ctx.db.select('loyalty.Reward', {
      id: args.rewardId,
      programId: args.programId,
    })
  )[0]
  if (!reward?.active) return invalid(issue('rewardId', 'loyalty.error.rewardMissing'))
  const current = (
    await ctx.db.select('loyalty.Application', {
      orderType: snapshot.orderType,
      orderId: snapshot.orderId,
      programId: args.programId,
    })
  )[0]
  const codes = current?.code
    ? [...new Set([...(snapshot.codes ?? []), normalizeCode(current.code)])]
    : snapshot.codes
  const evaluated = await evaluate(
    ctx,
    { ...snapshot, codes },
    {
      onlyProgramId: String(args.programId),
      ...(args.points === undefined ? {} : { requestedPoints: n(args.points) }),
    },
  )
  const result = evaluated[0],
    quote = result?.rewards.find((candidate) => candidate.rewardId === args.rewardId)
  if (!result || !quote) return invalid(issue('rewardId', 'loyalty.error.ineligible'))
  const requestedPoints = n(args.points ?? quote.requiredPoints)
  const config = (
    await ctx.db.select('loyalty.MembershipConfig', {
      programId: args.programId,
    })
  )[0]
  if (config && program.programType === 'loyalty') {
    const step = n(config.minimumRedeemStep)
    if (step > 0 && Math.abs(requestedPoints / step - Math.round(requestedPoints / step)) > 0.000001)
      return invalid(issue('points', 'loyalty.error.redeemStep'))
    if (!snapshot.partnerId) return invalid(issue('partnerId', 'loyalty.error.partnerMissing'))
    const membership = await refreshMembershipRow(ctx, snapshot.partnerId)
    const tier = membership?.tierId
      ? (await ctx.db.select('loyalty.Tier', { id: membership.tierId }))[0]
      : null
    const scale = scaleOf(snapshot.currency)
    let merchandise = 0n
    for (const line of snapshot.lines.filter((line) => line.lineKind === 'product'))
      merchandise += moneyMinor(line.untaxed, scale)
    const maximumDiscount = percentOfMinor(merchandise, String(tier?.redeemPercent ?? '0'))
    if (moneyMinor(quote.discountAmount, scale) > maximumDiscount)
      return invalid(issue('points', 'loyalty.error.redeemCap'))
  }
  const walletId = String(current?.walletId ?? result.walletId ?? '')
  const fromCurrentOrder = program.appliesOn === 'future' ? 0 : result.points
  const walletSpend = Math.max(0, requestedPoints - fromCurrentOrder)
  if (walletSpend > 0 && !walletId) return invalid(issue('points', 'loyalty.error.insufficientPoints'))
  try {
    const application = await transact(ctx, options, async (tx) => {
      for (const held of await tx.db.select('loyalty.Reservation', {
        orderType: snapshot.orderType,
        orderId: snapshot.orderId,
      }))
        if (held.state === 'reserved' && held.rewardId !== args.rewardId) await release(tx, held)
      if (walletSpend > 0)
        await reserve(tx, {
          id: `${snapshot.orderType}:${snapshot.orderId}:${String(args.rewardId)}`,
          walletId,
          orderType: snapshot.orderType,
          orderId: snapshot.orderId,
          rewardId: String(args.rewardId),
          amount: walletSpend,
        })
      return upsertApplication(tx, {
        orderType: snapshot.orderType,
        orderId: snapshot.orderId,
        partnerId: snapshot.partnerId,
        programId: String(args.programId),
        walletId: walletId || null,
        rewardId: String(args.rewardId),
        code: current?.code ? String(current.code) : null,
        pointsEarned: result.points,
        pointsSpent: requestedPoints,
        discountAmount: quote.discountAmount,
        rewardPayload: { ...quote, requiredPoints: requestedPoints },
        currency: snapshot.currency,
        state: walletSpend > 0 ? 'reserved' : 'draft',
      })
    })
    return {
      ok: true,
      applicationId: application.id,
      reward: { ...quote, requiredPoints: requestedPoints },
    }
  } catch (error) {
    return concurrentError(error)
  }
}

export const removeOrderReward = async (
  ctx: Ctx,
  args: Row,
  options: TransactionOptions = {},
): Promise<Row> => {
  const application = (
    await ctx.db.select('loyalty.Application', {
      orderType: args.orderType,
      orderId: args.orderId,
      programId: args.programId,
    })
  )[0]
  if (!application) return { ok: true }
  try {
    await transact(ctx, options, async (tx) => {
      for (const reservation of await tx.db.select('loyalty.Reservation', {
        orderType: args.orderType,
        orderId: args.orderId,
      }))
        if (reservation.state === 'reserved') await release(tx, reservation)
      await tx.db.update(
        'loyalty.Application',
        { id: application.id },
        {
          rewardId: null,
          pointsSpent: '0',
          discountAmount: '0',
          rewardPayload: null,
          state: 'draft',
          updatedAt: now(),
        },
      )
    })
    return { ok: true, id: String(application.id) }
  } catch (error) {
    return concurrentError(error)
  }
}

export const orderFunctions: Record<string, FnSpec> = {
  /**
   * Wallets, filtered and paged by the store rather than in memory.
   *
   * A tenant of any size has more wallets than a screen shows, and reading all
   * of them to display twenty is the kind of thing that works until it does not.
   * `state` is separate from `includeArchived` because expiry and locking are
   * different endings: `active` is live, `locked` was switched off by somebody,
   * `expired` simply ran out of time.
   */
  'wallet.list': defineFn({
    input: {
      programId: 'id?',
      partnerId: 'id?',
      includeArchived: 'bool?',
      state: 'text?',
      search: 'text?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: ['read:loyalty.Wallet'],
    agent: true,
    handler: async (ctx, args) => {
      const W = ctx.table('loyalty.Wallet')
      const at = now()
      const parts: Expr[] = []
      if (args.programId) parts.push(eq(W.programId, args.programId))
      if (args.partnerId) parts.push(eq(W.partnerId, args.partnerId))
      if (args.state === 'active')
        parts.push(and(eq(W.active, true), or(gt(W.expiresAt, at), isNull(W.expiresAt))))
      else if (args.state === 'locked') parts.push(eq(W.active, false))
      else if (args.state === 'expired') parts.push(and(eq(W.active, true), lte(W.expiresAt, at)))
      else if (!args.includeArchived) parts.push(eq(W.active, true))
      // The code is what an operator has in front of them — on a card, in an
      // email — so it is what the search box looks at.
      if (args.search) parts.push(ilike(W.normalizedCode, `%${normalizeCode(String(args.search))}%`))

      let query = from(W).orderBy(desc(W.createdAt), asc(W.id))
      if (parts.length) query = query.where(and(...parts))
      return (await ctx.db.all(paged(query, args))).map(walletSummary)
    },
  }),

  'wallet.get': defineFn({
    input: { id: 'id?', code: 'text?', partnerId: 'id?', programId: 'id?' },
    effects: ['read:loyalty.Wallet', 'read:loyalty.LedgerEntry'],
    agent: true,
    handler: async (ctx, args) => {
      let wallet: Row | undefined
      if (args.id) wallet = (await ctx.db.select('loyalty.Wallet', { id: args.id }))[0]
      else if (args.code)
        wallet = (
          await ctx.db.select('loyalty.Wallet', {
            normalizedCode: normalizeCode(args.code),
          })
        )[0]
      else if (args.partnerId && args.programId)
        wallet = (
          await ctx.db.select('loyalty.Wallet', {
            partnerId: args.partnerId,
            programId: args.programId,
            active: true,
          })
        )[0]
      if (!wallet) return null
      return {
        ...walletSummary(wallet),
        ledger: (await ctx.db.select('loyalty.LedgerEntry', { walletId: wallet.id })).sort((a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt)),
        ),
      }
    },
  }),

  /**
   * The ledger over a period, newest first.
   *
   * A statement is read by date, so the window is a first-class filter rather
   * than something the caller trims off the end. Filtering by program resolves
   * that program's wallets first: the entry carries a wallet, not a program, and
   * this query layer does not join.
   */
  'ledger.list': defineFn({
    input: {
      walletId: 'id?',
      programId: 'id?',
      operation: 'text?',
      from: 'datetime?',
      to: 'datetime?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: ['read:loyalty.LedgerEntry', 'read:loyalty.Wallet'],
    agent: true,
    handler: async (ctx, args) => {
      const L = ctx.table('loyalty.LedgerEntry')
      const parts: Expr[] = []
      if (args.walletId) parts.push(eq(L.walletId, args.walletId))
      if (args.programId) {
        const W = ctx.table('loyalty.Wallet')
        const wallets = (await ctx.db.all(from(W).where(eq(W.programId, args.programId)))).map(
          (row) => row.id,
        )
        // No wallets means no entries. An empty `IN ()` is not a filter, so
        // saying so here is what keeps it from reading as "no filter at all".
        if (!wallets.length) return []
        parts.push(inArray(L.walletId, wallets))
      }
      if (args.operation) parts.push(eq(L.operation, args.operation))
      if (args.from) parts.push(gte(L.createdAt, args.from))
      if (args.to) parts.push(lte(L.createdAt, args.to))

      let query = from(L).orderBy(desc(L.createdAt), desc(L.id))
      if (parts.length) query = query.where(and(...parts))
      return ctx.db.all(paged(query, args))
    },
  }),

  'wallet.create': defineFn({
    input: {
      id: 'id',
      programId: 'id',
      partnerId: 'id?',
      code: 'text?',
      initialBalance: 'decimal?',
      expiresAt: 'datetime?',
    },
    output: { ok: 'bool', wallet: 'json?', errors: 'json?' },
    effects: ['read:loyalty.Program', 'read:loyalty.Rule', ...walletWriteEffects, 'read:partner.Partner'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('loyalty.Wallet', { id: args.id }))[0]
      if (existing) return { ok: true, wallet: walletSummary(existing) }
      const program = (await ctx.db.select('loyalty.Program', { id: args.programId }))[0]
      if (!program) return invalid(issue('programId', 'loyalty.error.programMissing'))
      if (args.partnerId && !(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return invalid(issue('partnerId', 'loyalty.error.partnerMissing'))
      if (program.programType === 'loyalty' && args.expiresAt)
        return invalid(issue('expiresAt', 'loyalty.error.invalid'))
      if (n(args.initialBalance) < 0) return invalid(issue('initialBalance', 'loyalty.error.invalid'))
      const code = normalizeCode(args.code ?? codeFor(String(args.id)))
      if (!(await codeAvailable(ctx, code))) return invalid(issue('code', 'loyalty.error.codeDuplicate'))
      try {
        const wallet = await ctx.tx(async (tx) => {
          const created = await ensureWallet(tx, program, {
            id: String(args.id),
            partnerId: args.partnerId ? String(args.partnerId) : null,
            code,
            expiresAt: args.expiresAt ? String(args.expiresAt) : null,
          })
          if (n(args.initialBalance) > 0)
            await postDelta(tx, {
              id: `${String(args.id)}:initial`,
              walletId: String(created.id),
              operation: 'adjust',
              amount: n(args.initialBalance),
              balanceDelta: n(args.initialBalance),
              sourceType: 'wallet',
              sourceId: String(args.id),
              sourceOperation: 'initial',
              sourceKey: `wallet:${String(args.id)}:initial`,
              descriptionCode: 'loyalty.ledger.description.adjust',
            })
          return (await tx.db.select('loyalty.Wallet', { id: created.id }))[0]!
        })
        return { ok: true, wallet: walletSummary(wallet) }
      } catch (error) {
        return concurrentError(error)
      }
    },
  }),

  'wallet.adjust': defineFn({
    input: { id: 'id', amount: 'decimal', sourceId: 'text', note: 'text?' },
    output: { ok: 'bool', wallet: 'json?', replayed: 'bool?', errors: 'json?' },
    effects: [...walletWriteEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!n(args.amount)) return invalid(issue('amount', 'loyalty.error.pointsPositive'))
      if (!(await ctx.db.select('loyalty.Wallet', { id: args.id }))[0])
        return invalid(issue('id', 'loyalty.error.walletMissing'))
      try {
        const result = await ctx.tx((tx) =>
          postDelta(tx, {
            id: `${String(args.id)}:adjust:${String(args.sourceId)}`,
            walletId: String(args.id),
            operation: 'adjust',
            amount: Math.abs(n(args.amount)),
            balanceDelta: n(args.amount),
            sourceType: 'adjustment',
            sourceId: String(args.sourceId),
            sourceOperation: 'adjust',
            sourceKey: `adjustment:${String(args.sourceId)}`,
            descriptionCode: 'loyalty.ledger.description.adjust',
            metadata: args.note ? { note: args.note } : null,
          }),
        )
        return {
          ok: true,
          wallet: walletSummary(result.wallet),
          replayed: result.replayed,
        }
      } catch (error) {
        return concurrentError(error)
      }
    },
  }),

  evaluateOrder: defineFn({
    input: { order: 'json' },
    effects: [...evaluationEffects],
    agent: true,
    handler: async (ctx, args) => {
      const snapshot = snapshotOf(args.order)
      if (!snapshot) return invalid(issue('order', 'loyalty.error.order'))
      return { ok: true, programs: await evaluate(ctx, snapshot) }
    },
  }),

  applyCode: defineFn({
    input: { order: 'json', code: 'text' },
    effects: [...evaluationEffects, 'write:loyalty.Application'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const snapshot = snapshotOf(args.order),
        normalized = normalizeCode(args.code)
      if (!snapshot) return invalid(issue('order', 'loyalty.error.order'))
      if (!normalized) return invalid(issue('code', 'loyalty.error.codeRequired'))
      const rule = (await ctx.db.select('loyalty.Rule', { normalizedCode: normalized })).find(
        (row) => row.active,
      )
      const wallet = (await ctx.db.select('loyalty.Wallet', { normalizedCode: normalized })).find(
        (row) => row.active,
      )
      if (!rule && !wallet) return invalid(issue('code', 'loyalty.error.codeInvalid'))
      if (wallet?.partnerId && wallet.partnerId !== snapshot.partnerId)
        return invalid(issue('code', 'loyalty.error.codeInvalid'))
      const programId = String(rule?.programId ?? wallet?.programId)
      const evaluated = await evaluate(
        ctx,
        {
          ...snapshot,
          codes: [...new Set([...(snapshot.codes ?? []), normalized])],
        },
        { onlyProgramId: programId },
      )
      if (!evaluated[0]) return invalid(issue('code', 'loyalty.error.ineligible'))
      const result = evaluated[0]
      const application = await upsertApplication(ctx, {
        orderType: snapshot.orderType,
        orderId: snapshot.orderId,
        partnerId: snapshot.partnerId,
        programId,
        walletId: wallet ? String(wallet.id) : result.walletId,
        code: String(args.code).trim(),
        pointsEarned: result.points,
        currency: snapshot.currency,
      })
      return { ok: true, applicationId: application.id, program: result }
    },
  }),

  applyReward: defineFn({
    input: {
      order: 'json',
      programId: 'id',
      rewardId: 'id',
      points: 'decimal?',
    },
    effects: [...orderWriteEffects],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => applyOrderReward(ctx, args),
  }),

  removeReward: defineFn({
    input: { orderType: 'text', orderId: 'text', programId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:loyalty.Application',
      'write:loyalty.Application',
      'read:loyalty.Reservation',
      'write:loyalty.Reservation',
      'read:loyalty.Wallet',
      'write:loyalty.Wallet',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => removeOrderReward(ctx, args),
  }),

  'order.finalize': defineFn({
    input: { order: 'json' },
    effects: [...orderWriteEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const snapshot = snapshotOf(args.order)
      if (!snapshot) return invalid(issue('order', 'loyalty.error.order'))
      if (snapshot.partnerId && !(await ctx.db.select('partner.Partner', { id: snapshot.partnerId }))[0])
        return invalid(issue('partnerId', 'loyalty.error.partnerMissing'))
      try {
        const finalized = await ctx.tx(async (tx) => {
          const prior = await tx.db.select('loyalty.Application', {
            orderType: snapshot.orderType,
            orderId: snapshot.orderId,
          })
          const priorByProgram = new Map(prior.map((row) => [String(row.programId), row]))
          const codes = [
            ...(snapshot.codes ?? []),
            ...prior.map((row) => normalizeCode(row.code)).filter(Boolean),
          ]
          const evaluated = await evaluate(tx, {
            ...snapshot,
            codes: [...new Set(codes)],
          })
          const applications: Row[] = []
          const issuedWallets: Row[] = []
          for (const result of evaluated) {
            const program = (await tx.db.select('loyalty.Program', { id: result.programId }))[0]!
            const previous = priorByProgram.get(result.programId)
            let wallet: Row | null = previous?.walletId
              ? ((
                  await tx.db.select('loyalty.Wallet', {
                    id: previous.walletId,
                  })
                )[0] ?? null)
              : result.walletId
                ? ((
                    await tx.db.select('loyalty.Wallet', {
                      id: result.walletId,
                    })
                  )[0] ?? null)
                : null
            if (
              ['future', 'both'].includes(String(program.appliesOn)) &&
              snapshot.partnerId &&
              ['loyalty', 'ewallet'].includes(String(program.programType))
            )
              wallet = await ensureWallet(tx, program, {
                id: `member:${String(program.id)}:${snapshot.partnerId}`,
                partnerId: snapshot.partnerId,
              })
            const points = result.splitPoints.length ? 0 : result.points
            if (['future', 'both'].includes(String(program.appliesOn))) {
              if (result.splitPoints.length) {
                let index = 0
                for (const split of result.splitPoints) {
                  const coupon = await ensureWallet(tx, program, {
                    id: `coupon:${snapshot.orderType}:${snapshot.orderId}:${String(program.id)}:${index}`,
                    partnerId: snapshot.partnerId,
                  })
                  await postDelta(tx, {
                    id: `${String(coupon.id)}:earn`,
                    walletId: String(coupon.id),
                    operation: 'earn',
                    amount: split,
                    balanceDelta: split,
                    sourceType: snapshot.orderType,
                    sourceId: snapshot.orderId,
                    sourceOperation: `earn:${String(program.id)}:${index}`,
                    sourceKey: `${snapshot.orderType}:${snapshot.orderId}:${String(program.id)}:earn:${index}`,
                    descriptionCode: 'loyalty.ledger.description.earn',
                  })
                  issuedWallets.push((await tx.db.select('loyalty.Wallet', { id: coupon.id }))[0]!)
                  index += 1
                }
              } else if (points > 0) {
                if (!wallet)
                  wallet = await ensureWallet(tx, program, {
                    id: `coupon:${snapshot.orderType}:${snapshot.orderId}:${String(program.id)}:0`,
                    partnerId: snapshot.partnerId,
                  })
                await postDelta(tx, {
                  id: `${snapshot.orderType}:${snapshot.orderId}:${String(program.id)}:earn`,
                  walletId: String(wallet.id),
                  operation: 'earn',
                  amount: points,
                  balanceDelta: points,
                  sourceType: snapshot.orderType,
                  sourceId: snapshot.orderId,
                  sourceOperation: `earn:${String(program.id)}`,
                  sourceKey: `${snapshot.orderType}:${snapshot.orderId}:${String(program.id)}:earn`,
                  descriptionCode: 'loyalty.ledger.description.earn',
                })
                issuedWallets.push((await tx.db.select('loyalty.Wallet', { id: wallet.id }))[0]!)
              }
            }
            const pointsSpent = n(previous?.pointsSpent)
            if (previous?.rewardId && pointsSpent > 0 && wallet) {
              const reservation = (
                await tx.db.select('loyalty.Reservation', {
                  orderType: snapshot.orderType,
                  orderId: snapshot.orderId,
                  rewardId: previous.rewardId,
                })
              )[0]
              if (reservation) await finalizeReservation(tx, reservation, pointsSpent)
              else
                await postDelta(tx, {
                  id: `${snapshot.orderType}:${snapshot.orderId}:${String(previous.rewardId)}:redeem`,
                  walletId: String(wallet.id),
                  operation: 'redeem',
                  amount: pointsSpent,
                  balanceDelta: -pointsSpent,
                  sourceType: snapshot.orderType,
                  sourceId: snapshot.orderId,
                  sourceOperation: 'redeem',
                  sourceKey: `${snapshot.orderType}:${snapshot.orderId}:${String(previous.rewardId)}:redeem`,
                  descriptionCode: 'loyalty.ledger.description.redeem',
                })
            }
            applications.push(
              await upsertApplication(tx, {
                orderType: snapshot.orderType,
                orderId: snapshot.orderId,
                partnerId: snapshot.partnerId,
                programId: result.programId,
                walletId: wallet ? String(wallet.id) : null,
                rewardId: previous?.rewardId ? String(previous.rewardId) : null,
                code: previous?.code ? String(previous.code) : null,
                pointsEarned: result.points + result.splitPoints.reduce((sum, value) => sum + value, 0),
                pointsSpent,
                discountAmount: canonicalDecimalText(String(previous?.discountAmount ?? '0')),
                rewardPayload: previous?.rewardPayload ?? null,
                currency: snapshot.currency,
                state: 'finalized',
              }),
            )
          }
          if (snapshot.partnerId) {
            let spend = 0n
            const scale = scaleOf(snapshot.currency)
            for (const line of snapshot.lines.filter((line) => line.lineKind === 'product'))
              spend += moneyMinor(line.total, scale)
            await tx.db.insertIfAbsent('loyalty.SpendEntry', {
              id: `${snapshot.orderType}:${snapshot.orderId}`,
              partnerId: snapshot.partnerId,
              sourceType: snapshot.orderType,
              sourceId: snapshot.orderId,
              amount: minorText(spend, scale),
              currency: snapshot.currency,
              occurredAt: snapshot.date,
              reversedAt: null,
            })
          }
          return { applications, issuedWallets }
        })
        const membership = snapshot.partnerId ? await refreshMembershipRow(ctx, snapshot.partnerId) : null
        return {
          ok: true,
          applications: finalized.applications,
          issuedWallets: finalized.issuedWallets.map(walletSummary),
          membership,
        }
      } catch (error) {
        return concurrentError(error)
      }
    },
  }),

  'order.reversePortion': defineFn({
    input: {
      orderType: 'text',
      orderId: 'text',
      reversalId: 'text',
      portion: 'decimal',
      complete: 'bool?',
      reversedAt: 'datetime?',
    },
    effects: [...orderWriteEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const portion = n(args.portion)
      if (!(portion > 0) || portion > 1.000001) return invalid(issue('portion', 'loyalty.error.order'))
      let partnerId: string | null = null
      try {
        const reversed = await ctx.tx(async (tx) => {
          const applications = await tx.db.select('loyalty.Application', {
            orderType: args.orderType,
            orderId: args.orderId,
          })
          partnerId = applications[0]?.partnerId ? String(applications[0].partnerId) : null
          const entries = (
            await tx.db.select('loyalty.LedgerEntry', {
              sourceType: args.orderType,
              sourceId: args.orderId,
            })
          ).filter((entry) => entry.operation !== 'reverse')
          let count = 0
          for (const entry of entries) {
            const prior = await tx.db.select('loyalty.LedgerEntry', { reversedEntryId: entry.id })
            const remaining = Math.max(
              0,
              Math.abs(n(entry.balanceDelta)) -
                prior.reduce((sum, reversal) => sum + Math.abs(n(reversal.balanceDelta)), 0),
            )
            const amount = args.complete
              ? remaining
              : Math.min(remaining, Math.abs(n(entry.balanceDelta)) * portion)
            if (amount <= 0.000001) continue
            const result = await postDelta(tx, {
              id: `${String(entry.id)}:reverse:${String(args.reversalId)}`,
              walletId: String(entry.walletId),
              operation: 'reverse',
              amount,
              balanceDelta: n(entry.balanceDelta) > 0 ? -amount : amount,
              sourceType: `${String(args.orderType)}_return`,
              sourceId: String(args.reversalId),
              sourceOperation: `reverse:${String(entry.id)}`,
              sourceKey: `${String(entry.sourceKey)}:reverse:${String(args.reversalId)}`,
              descriptionCode: 'loyalty.ledger.description.reverse',
              reversedEntryId: String(entry.id),
              metadata: {
                originalOrderType: String(args.orderType),
                originalOrderId: String(args.orderId),
                portion: decimal(portion),
                complete: Boolean(args.complete),
              },
              allowNegative: true,
            })
            if (!result.replayed) count += 1
          }

          const originalSpend = (
            await tx.db.select('loyalty.SpendEntry', {
              sourceType: args.orderType,
              sourceId: args.orderId,
            })
          )[0]
          if (originalSpend) {
            const returnSourceType = `${String(args.orderType)}_return:${String(args.orderId)}`
            const previousSpend = await tx.db.select('loyalty.SpendEntry', {
              sourceType: returnSourceType,
            })
            const remainingSpend = Math.max(
              0,
              n(originalSpend.amount) + previousSpend.reduce((sum, entry) => sum + n(entry.amount), 0),
            )
            const amount = args.complete
              ? remainingSpend
              : Math.min(remainingSpend, n(originalSpend.amount) * portion)
            await tx.db.insertIfAbsent('loyalty.SpendEntry', {
              id: `${String(args.orderType)}:${String(args.reversalId)}:spend`,
              partnerId: originalSpend.partnerId,
              sourceType: returnSourceType,
              sourceId: String(args.reversalId),
              amount: decimal(-amount),
              currency: originalSpend.currency,
              occurredAt: args.reversedAt ?? now(),
              reversedAt: null,
            })
          }
          if (args.complete)
            for (const application of applications)
              await tx.db.update(
                'loyalty.Application',
                { id: application.id },
                { state: 'reversed', updatedAt: now() },
              )
          return count
        })
        const membership = partnerId ? await refreshMembershipRow(ctx, partnerId) : null
        return { ok: true, reversed, membership }
      } catch (error) {
        return concurrentError(error)
      }
    },
  }),

  'order.reverse': defineFn({
    input: { orderType: 'text', orderId: 'text', reversedAt: 'datetime?' },
    effects: [...orderWriteEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      let partnerId: string | null = null
      try {
        const count = await ctx.tx(async (tx) => {
          const applications = await tx.db.select('loyalty.Application', {
            orderType: args.orderType,
            orderId: args.orderId,
          })
          partnerId = applications[0]?.partnerId ? String(applications[0].partnerId) : null
          const entries = (
            await tx.db.select('loyalty.LedgerEntry', {
              sourceType: args.orderType,
              sourceId: args.orderId,
            })
          ).filter((entry) => entry.operation !== 'reverse')
          let reversed = 0
          for (const entry of entries) {
            const result = await postDelta(tx, {
              id: `${String(entry.id)}:reverse`,
              walletId: String(entry.walletId),
              operation: 'reverse',
              amount: Math.abs(n(entry.balanceDelta)),
              balanceDelta: -n(entry.balanceDelta),
              sourceType: String(args.orderType),
              sourceId: String(args.orderId),
              sourceOperation: `reverse:${String(entry.id)}`,
              sourceKey: `${String(entry.sourceKey)}:reverse`,
              descriptionCode: 'loyalty.ledger.description.reverse',
              reversedEntryId: String(entry.id),
              allowNegative: true,
            })
            if (!result.replayed) reversed += 1
          }
          for (const reservation of await tx.db.select('loyalty.Reservation', {
            orderType: args.orderType,
            orderId: args.orderId,
          }))
            if (reservation.state === 'reserved') await release(tx, reservation)
          for (const application of applications)
            await tx.db.update(
              'loyalty.Application',
              { id: application.id },
              { state: 'reversed', updatedAt: now() },
            )
          const spend = (
            await tx.db.select('loyalty.SpendEntry', {
              sourceType: args.orderType,
              sourceId: args.orderId,
            })
          )[0]
          if (spend && !spend.reversedAt)
            await tx.db.update(
              'loyalty.SpendEntry',
              { id: spend.id },
              { reversedAt: args.reversedAt ?? now() },
            )
          return reversed
        })
        if (partnerId) await refreshMembershipRow(ctx, partnerId)
        return { ok: true, reversed: count }
      } catch (error) {
        return concurrentError(error)
      }
    },
  }),
}
