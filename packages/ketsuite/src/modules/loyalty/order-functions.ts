import { createHash } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
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
  options: { id: string; partnerId?: string | null; code?: string; expiresAt?: string | null },
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
    discountAmount?: number
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
    discountAmount: decimal(values.discountAmount ?? 0),
    rewardPayload: values.rewardPayload ?? null,
    currency: values.currency,
    state: values.state ?? 'draft',
    updatedAt: now(),
  }
  if (existing) await ctx.db.update('loyalty.Application', { id }, patch)
  else await ctx.db.insert('loyalty.Application', { id, ...patch, createdAt: now() })
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

export const orderFunctions: Record<string, FnSpec> = {
  'wallet.list': defineFn({
    input: { programId: 'id?', partnerId: 'id?', includeArchived: 'bool?' },
    effects: ['read:loyalty.Wallet'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('loyalty.Wallet'))
        .filter(
          (wallet) =>
            (args.includeArchived || wallet.active) &&
            (!args.programId || wallet.programId === args.programId) &&
            (!args.partnerId || wallet.partnerId === args.partnerId),
        )
        .map(walletSummary),
  }),

  'wallet.get': defineFn({
    input: { id: 'id?', code: 'text?', partnerId: 'id?', programId: 'id?' },
    effects: ['read:loyalty.Wallet', 'read:loyalty.LedgerEntry'],
    agent: true,
    handler: async (ctx, args) => {
      let wallet: Row | undefined
      if (args.id) wallet = (await ctx.db.select('loyalty.Wallet', { id: args.id }))[0]
      else if (args.code)
        wallet = (await ctx.db.select('loyalty.Wallet', { normalizedCode: normalizeCode(args.code) }))[0]
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

  'ledger.list': defineFn({
    input: { walletId: 'id?', operation: 'text?', limit: 'int?' },
    effects: ['read:loyalty.LedgerEntry'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('loyalty.LedgerEntry'))
        .filter(
          (entry) =>
            (!args.walletId || entry.walletId === args.walletId) &&
            (!args.operation || entry.operation === args.operation),
        )
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, Math.min(1000, Math.max(1, n(args.limit ?? 100)))),
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
        return { ok: true, wallet: walletSummary(result.wallet), replayed: result.replayed }
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
        { ...snapshot, codes: [...new Set([...(snapshot.codes ?? []), normalized])] },
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
    input: { order: 'json', programId: 'id', rewardId: 'id', points: 'decimal?' },
    effects: [...orderWriteEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const snapshot = snapshotOf(args.order)
      if (!snapshot) return invalid(issue('order', 'loyalty.error.order'))
      const program = (await ctx.db.select('loyalty.Program', { id: args.programId }))[0]
      if (!program) return invalid(issue('programId', 'loyalty.error.programMissing'))
      const reward = (
        await ctx.db.select('loyalty.Reward', { id: args.rewardId, programId: args.programId })
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
      const config = (await ctx.db.select('loyalty.MembershipConfig', { programId: args.programId }))[0]
      if (config && program.programType === 'loyalty') {
        const step = n(config.minimumRedeemStep)
        if (step > 0 && Math.abs(requestedPoints / step - Math.round(requestedPoints / step)) > 0.000001)
          return invalid(issue('points', 'loyalty.error.redeemStep'))
        if (!snapshot.partnerId) return invalid(issue('partnerId', 'loyalty.error.partnerMissing'))
        const membership = await refreshMembershipRow(ctx, snapshot.partnerId)
        const tier = membership?.tierId
          ? (await ctx.db.select('loyalty.Tier', { id: membership.tierId }))[0]
          : null
        const merchandise = snapshot.lines
          .filter((line) => line.lineKind === 'product')
          .reduce((sum, line) => sum + line.untaxed, 0)
        const maximumDiscount = merchandise * (n(tier?.redeemPercent) / 100)
        if (quote.discountAmount > maximumDiscount + 0.000001)
          return invalid(issue('points', 'loyalty.error.redeemCap'))
      }
      const walletId = String(current?.walletId ?? result.walletId ?? '')
      const fromCurrentOrder = program.appliesOn === 'future' ? 0 : result.points
      const walletSpend = Math.max(0, requestedPoints - fromCurrentOrder)
      if (walletSpend > 0 && !walletId) return invalid(issue('points', 'loyalty.error.insufficientPoints'))
      try {
        const application = await ctx.tx(async (tx) => {
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
    },
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
    handler: async (ctx, args) => {
      const application = (
        await ctx.db.select('loyalty.Application', {
          orderType: args.orderType,
          orderId: args.orderId,
          programId: args.programId,
        })
      )[0]
      if (!application) return { ok: true }
      try {
        await ctx.tx(async (tx) => {
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
    },
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
          const evaluated = await evaluate(tx, { ...snapshot, codes: [...new Set(codes)] })
          const applications: Row[] = []
          const issuedWallets: Row[] = []
          for (const result of evaluated) {
            const program = (await tx.db.select('loyalty.Program', { id: result.programId }))[0]!
            const previous = priorByProgram.get(result.programId)
            let wallet: Row | null = previous?.walletId
              ? ((await tx.db.select('loyalty.Wallet', { id: previous.walletId }))[0] ?? null)
              : result.walletId
                ? ((await tx.db.select('loyalty.Wallet', { id: result.walletId }))[0] ?? null)
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
                discountAmount: n(previous?.discountAmount),
                rewardPayload: previous?.rewardPayload ?? null,
                currency: snapshot.currency,
                state: 'finalized',
              }),
            )
          }
          if (snapshot.partnerId) {
            const spend = snapshot.lines
              .filter((line) => line.lineKind === 'product')
              .reduce((sum, line) => sum + line.total, 0)
            await tx.db.insertIfAbsent('loyalty.SpendEntry', {
              id: `${snapshot.orderType}:${snapshot.orderId}`,
              partnerId: snapshot.partnerId,
              sourceType: snapshot.orderType,
              sourceId: snapshot.orderId,
              amount: decimal(spend),
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
