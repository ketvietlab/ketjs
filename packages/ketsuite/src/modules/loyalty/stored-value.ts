import { createHash } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { decimal, invalid, issue, n, now } from './engine.ts'
import { InsufficientBalance, LoyaltyConflict, postDelta } from './ledger.ts'

const STORED_VALUE_PROGRAM_TYPES = ['gift_card', 'ewallet'] as const
const STORED_VALUE_STATES = ['reserved', 'finalized', 'released'] as const

const opaqueCode = (ctx: Ctx, programId: unknown, walletId: unknown): string =>
  `VALUE-${createHash('sha256')
    .update(`${String(ctx.scope.company ?? '')}\n${String(programId)}\n${String(walletId)}`)
    .digest('hex')
    .slice(0, 20)
    .toUpperCase()}`

const activeStoredValueWallet = async (ctx: Ctx, walletId: unknown, at = now()): Promise<Row> => {
  const wallet = (await ctx.db.select('loyalty.Wallet', { id: walletId }))[0]
  if (wallet?.unit !== 'currency' || wallet.active === false)
    throw new InsufficientBalance('stored value wallet is unavailable')
  const program = (await ctx.db.select('loyalty.Program', { id: wallet.programId }))[0]
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
    : null
  if (
    !program ||
    !(STORED_VALUE_PROGRAM_TYPES as readonly string[]).includes(String(program.programType)) ||
    program.active === false ||
    String(program.currency) !== String(company?.currency ?? '')
  )
    throw new LoyaltyConflict('wallet is not backed by an active stored value program')
  if (wallet.expiresAt && new Date(String(wallet.expiresAt)).getTime() <= new Date(at).getTime())
    throw new InsufficientBalance('stored value wallet expired')
  return wallet
}

export const openStoredValueWallet = async (
  ctx: Ctx,
  args: { id: unknown; programId: unknown; partnerId?: unknown; expiresAt?: unknown },
): Promise<Row> => {
  const existing = (await ctx.db.select('loyalty.Wallet', { id: args.id }))[0]
  if (existing) {
    if (
      String(existing.programId) !== String(args.programId) ||
      String(existing.partnerId ?? '') !== String(args.partnerId ?? '') ||
      String(existing.expiresAt ?? '') !== String(args.expiresAt ?? '') ||
      existing.unit !== 'currency'
    )
      throw new LoyaltyConflict('stored value wallet id changed')
    return existing
  }
  const program = (await ctx.db.select('loyalty.Program', { id: args.programId }))[0]
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
    : null
  if (
    !program ||
    !(STORED_VALUE_PROGRAM_TYPES as readonly string[]).includes(String(program.programType)) ||
    program.active === false ||
    String(program.currency) !== String(company?.currency ?? '')
  )
    throw new LoyaltyConflict('stored value program is unavailable')
  if (args.partnerId && !(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
    throw new LoyaltyConflict('stored value partner is unavailable')
  const code = opaqueCode(ctx, args.programId, args.id)
  const collision = (await ctx.db.select('loyalty.Wallet', { normalizedCode: code }))[0]
  if (collision) throw new LoyaltyConflict('stored value wallet code changed')
  await ctx.db.insert('loyalty.Wallet', {
    id: args.id,
    programId: args.programId,
    partnerId: args.partnerId ?? null,
    code,
    normalizedCode: code,
    unit: 'currency',
    balance: '0',
    reserved: '0',
    expiresAt: args.expiresAt ?? null,
    active: true,
    version: 0,
    createdAt: now(),
  })
  return (await ctx.db.select('loyalty.Wallet', { id: args.id }))[0]!
}

const creditStoredValue = async (
  ctx: Ctx,
  operation: 'issue' | 'refund',
  args: {
    id: string
    walletId: string
    amount: unknown
    sourceType: string
    sourceId: string
    sourceKey: string
    reversedEntryId?: string | null
  },
): Promise<Row> => {
  const amount = n(args.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new InsufficientBalance('amount must be positive')
  const previous = (await ctx.db.select('loyalty.LedgerEntry', { sourceKey: args.sourceKey }))[0]
  if (previous) {
    const posted = await postDelta(ctx, {
      id: args.id,
      walletId: args.walletId,
      operation,
      amount,
      balanceDelta: amount,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      sourceOperation: operation,
      sourceKey: args.sourceKey,
      descriptionCode: `loyalty.ledger.description.${operation}`,
      reversedEntryId: args.reversedEntryId ?? null,
    })
    return { entry: posted.entry, wallet: posted.wallet, replayed: true }
  }
  await activeStoredValueWallet(ctx, args.walletId)
  const posted = await postDelta(ctx, {
    id: args.id,
    walletId: args.walletId,
    operation,
    amount,
    balanceDelta: amount,
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    sourceOperation: operation,
    sourceKey: args.sourceKey,
    descriptionCode: `loyalty.ledger.description.${operation}`,
    reversedEntryId: args.reversedEntryId ?? null,
  })
  return { entry: posted.entry, wallet: posted.wallet, replayed: posted.replayed }
}

export const issueStoredValue = (ctx: Ctx, args: Parameters<typeof creditStoredValue>[2]): Promise<Row> =>
  creditStoredValue(ctx, 'issue', args)

export const refundStoredValue = (ctx: Ctx, args: Parameters<typeof creditStoredValue>[2]): Promise<Row> =>
  creditStoredValue(ctx, 'refund', args)

export const reserveStoredValue = async (
  ctx: Ctx,
  args: {
    id: string
    walletId: string
    amount: unknown
    sourceType: string
    sourceId: string
    sourceKey: string
    expiresAt?: string | null
  },
): Promise<Row> => {
  const previous = (await ctx.db.select('loyalty.StoredValueReservation', { sourceKey: args.sourceKey }))[0]
  const amount = n(args.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new InsufficientBalance('amount must be positive')
  if (previous) {
    if (
      String(previous.id) !== args.id ||
      String(previous.walletId) !== args.walletId ||
      Math.abs(n(previous.amount) - amount) > 0.000001 ||
      String(previous.sourceType) !== args.sourceType ||
      String(previous.sourceId) !== args.sourceId ||
      String(previous.expiresAt ?? '') !== String(args.expiresAt ?? '')
    )
      throw new LoyaltyConflict('stored value reservation source changed')
    return previous
  }
  const wallet = await activeStoredValueWallet(ctx, args.walletId)
  if (n(wallet.balance) - n(wallet.reserved) + 0.000001 < amount)
    throw new InsufficientBalance('insufficient stored value')
  await ctx.db.insert('loyalty.StoredValueReservation', {
    id: args.id,
    walletId: args.walletId,
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    sourceKey: args.sourceKey,
    amount: decimal(amount),
    state: 'reserved',
    expiresAt: args.expiresAt ?? null,
    createdAt: now(),
    updatedAt: now(),
  })
  const changed = await ctx.db.compareAndSet(
    'loyalty.Wallet',
    { id: wallet.id },
    { balance: wallet.balance, reserved: wallet.reserved, version: wallet.version },
    { reserved: decimal(n(wallet.reserved) + amount), version: n(wallet.version) + 1 },
  )
  if (!('dryRun' in changed) && !changed.matched) throw new LoyaltyConflict('wallet changed')
  return (await ctx.db.select('loyalty.StoredValueReservation', { id: args.id }))[0]!
}

export const releaseStoredValue = async (ctx: Ctx, reservationId: unknown): Promise<Row> => {
  const reservation = (await ctx.db.select('loyalty.StoredValueReservation', { id: reservationId }))[0]
  if (!reservation) throw new LoyaltyConflict('stored value reservation is missing')
  if (reservation.state === 'released') return reservation
  if (reservation.state !== 'reserved') throw new LoyaltyConflict('stored value reservation is not active')
  const wallet = (await ctx.db.select('loyalty.Wallet', { id: reservation.walletId }))[0]
  if (!wallet) throw new LoyaltyConflict('stored value wallet is missing')
  const amount = n(reservation.amount)
  const changed = await ctx.db.compareAndSet(
    'loyalty.Wallet',
    { id: wallet.id },
    { balance: wallet.balance, reserved: wallet.reserved, version: wallet.version },
    {
      reserved: decimal(Math.max(0, n(wallet.reserved) - amount)),
      version: n(wallet.version) + 1,
    },
  )
  if (!('dryRun' in changed) && !changed.matched) throw new LoyaltyConflict('wallet changed')
  await ctx.db.update(
    'loyalty.StoredValueReservation',
    { id: reservation.id },
    { state: 'released', updatedAt: now() },
  )
  return (await ctx.db.select('loyalty.StoredValueReservation', { id: reservation.id }))[0]!
}

export const finalizeStoredValue = async (ctx: Ctx, reservationId: unknown): Promise<Row> => {
  const reservation = (await ctx.db.select('loyalty.StoredValueReservation', { id: reservationId }))[0]
  if (!reservation) throw new LoyaltyConflict('stored value reservation is missing')
  const sourceKey = `${String(reservation.sourceKey)}:redeem`
  const previous = (await ctx.db.select('loyalty.LedgerEntry', { sourceKey }))[0]
  if (reservation.state === 'finalized' && previous) {
    const wallet = (await ctx.db.select('loyalty.Wallet', { id: reservation.walletId }))[0]!
    return { reservation, entry: previous, wallet, replayed: true }
  }
  if (reservation.state !== 'reserved') throw new LoyaltyConflict('stored value reservation is not active')
  const wallet = (await ctx.db.select('loyalty.Wallet', { id: reservation.walletId }))[0]
  const amount = n(reservation.amount)
  if (!wallet || n(wallet.balance) + 0.000001 < amount || n(wallet.reserved) + 0.000001 < amount)
    throw new InsufficientBalance('insufficient stored value')
  if (previous) {
    if (
      String(previous.walletId) !== String(wallet.id) ||
      previous.operation !== 'redeem' ||
      Math.abs(n(previous.amount) - amount) > 0.000001
    )
      throw new LoyaltyConflict('stored value redemption source changed')
  } else {
    await ctx.db.insert('loyalty.LedgerEntry', {
      id: `${String(reservation.id)}:ledger`,
      walletId: wallet.id,
      operation: 'redeem',
      amount: decimal(amount),
      balanceDelta: decimal(-amount),
      sourceType: reservation.sourceType,
      sourceId: reservation.sourceId,
      sourceOperation: 'redeem',
      sourceKey,
      descriptionCode: 'loyalty.ledger.description.redeem',
      reversedEntryId: null,
      metadata: { reservationId: reservation.id },
      createdAt: now(),
    })
    const changed = await ctx.db.compareAndSet(
      'loyalty.Wallet',
      { id: wallet.id },
      { balance: wallet.balance, reserved: wallet.reserved, version: wallet.version },
      {
        balance: decimal(n(wallet.balance) - amount),
        reserved: decimal(Math.max(0, n(wallet.reserved) - amount)),
        version: n(wallet.version) + 1,
      },
    )
    if (!('dryRun' in changed) && !changed.matched) throw new LoyaltyConflict('wallet changed')
  }
  await ctx.db.update(
    'loyalty.StoredValueReservation',
    { id: reservation.id },
    { state: 'finalized', updatedAt: now() },
  )
  return {
    reservation: (await ctx.db.select('loyalty.StoredValueReservation', { id: reservation.id }))[0],
    entry: (await ctx.db.select('loyalty.LedgerEntry', { sourceKey }))[0],
    wallet: (await ctx.db.select('loyalty.Wallet', { id: wallet.id }))[0],
    replayed: Boolean(previous),
  }
}

export const expireStoredValue = async (
  ctx: Ctx,
  args: {
    id: string
    walletId: string
    sourceType: string
    sourceId: string
    sourceKey: string
    at?: string
  },
): Promise<Row> => {
  const at = args.at ?? now()
  const previous = (await ctx.db.select('loyalty.LedgerEntry', { sourceKey: args.sourceKey }))[0]
  if (previous) {
    const posted = await postDelta(ctx, {
      id: args.id,
      walletId: args.walletId,
      operation: 'expire',
      amount: n(previous.amount),
      balanceDelta: -n(previous.amount),
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      sourceOperation: 'expire',
      sourceKey: args.sourceKey,
      descriptionCode: 'loyalty.ledger.description.expire',
    })
    return { entry: posted.entry, wallet: posted.wallet, replayed: true }
  }
  const wallet = (await ctx.db.select('loyalty.Wallet', { id: args.walletId }))[0]
  if (wallet?.unit !== 'currency') throw new InsufficientBalance('stored value wallet is unavailable')
  if (!wallet.expiresAt || new Date(String(wallet.expiresAt)).getTime() > new Date(at).getTime())
    throw new LoyaltyConflict('stored value wallet has not expired')
  if (n(wallet.reserved) > 0.000001) throw new LoyaltyConflict('stored value wallet has active reservations')
  const amount = n(wallet.balance)
  if (amount <= 0) {
    if (wallet.active !== false) await ctx.db.update('loyalty.Wallet', { id: wallet.id }, { active: false })
    return { wallet: { ...wallet, active: false }, entry: null, replayed: true }
  }
  const posted = await postDelta(ctx, {
    id: args.id,
    walletId: args.walletId,
    operation: 'expire',
    amount,
    balanceDelta: -amount,
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    sourceOperation: 'expire',
    sourceKey: args.sourceKey,
    descriptionCode: 'loyalty.ledger.description.expire',
  })
  await ctx.db.update('loyalty.Wallet', { id: wallet.id }, { active: false })
  return { entry: posted.entry, wallet: { ...posted.wallet, active: false }, replayed: posted.replayed }
}

const STORED_VALUE_EFFECTS = [
  'read:company.Company',
  'read:partner.Partner',
  'read:loyalty.Program',
  'read:loyalty.Rule',
  'read:loyalty.Wallet',
  'read:loyalty.LedgerEntry',
  'read:loyalty.StoredValueReservation',
  'write:loyalty.Wallet',
  'write:loyalty.LedgerEntry',
  'write:loyalty.StoredValueReservation',
] as const

const guarded = async (body: () => Promise<Row>): Promise<Row> => {
  try {
    return { ok: true, ...(await body()) }
  } catch (error) {
    const code =
      error instanceof InsufficientBalance ? 'loyalty.error.insufficientPoints' : 'loyalty.error.concurrent'
    return invalid(issue('storedValue', code))
  }
}

export const storedValueFunctions: Record<string, FnSpec> = {
  'storedValue.open': defineFn({
    input: { id: 'id', programId: 'id', partnerId: 'id?', expiresAt: 'datetime?' },
    effects: [...STORED_VALUE_EFFECTS],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => guarded(() => ctx.tx((tx) => openStoredValueWallet(tx, args as never))),
  }),
  'storedValue.issue': defineFn({
    input: {
      id: 'id',
      walletId: 'id',
      amount: 'decimal',
      sourceType: 'text',
      sourceId: 'text',
      sourceKey: 'text',
    },
    effects: [...STORED_VALUE_EFFECTS],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => guarded(() => ctx.tx((tx) => issueStoredValue(tx, args as never))),
  }),
  'storedValue.reserve': defineFn({
    input: {
      id: 'id',
      walletId: 'id',
      amount: 'decimal',
      sourceType: 'text',
      sourceId: 'text',
      sourceKey: 'text',
      expiresAt: 'datetime?',
    },
    effects: [...STORED_VALUE_EFFECTS],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => guarded(() => ctx.tx((tx) => reserveStoredValue(tx, args as never))),
  }),
  'storedValue.finalize': defineFn({
    input: { reservationId: 'id' },
    effects: [...STORED_VALUE_EFFECTS],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => guarded(() => ctx.tx((tx) => finalizeStoredValue(tx, args.reservationId))),
  }),
  'storedValue.release': defineFn({
    input: { reservationId: 'id' },
    effects: [...STORED_VALUE_EFFECTS],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => guarded(() => ctx.tx((tx) => releaseStoredValue(tx, args.reservationId))),
  }),
  'storedValue.refund': defineFn({
    input: {
      id: 'id',
      walletId: 'id',
      amount: 'decimal',
      sourceType: 'text',
      sourceId: 'text',
      sourceKey: 'text',
      reversedEntryId: 'id?',
    },
    effects: [...STORED_VALUE_EFFECTS],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => guarded(() => ctx.tx((tx) => refundStoredValue(tx, args as never))),
  }),
  'storedValue.expire': defineFn({
    input: {
      id: 'id',
      walletId: 'id',
      sourceType: 'text',
      sourceId: 'text',
      sourceKey: 'text',
      at: 'datetime?',
    },
    effects: [...STORED_VALUE_EFFECTS],
    idempotent: true,
    agent: true,
    handler: (ctx, args) => guarded(() => ctx.tx((tx) => expireStoredValue(tx, args as never))),
  }),
}

export { STORED_VALUE_PROGRAM_TYPES, STORED_VALUE_STATES }
