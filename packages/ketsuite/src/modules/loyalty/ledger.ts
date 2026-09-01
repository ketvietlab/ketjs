import type { Ctx, Row } from '@ketvietlab/ketjs'
import { decimal, n, now } from './engine.ts'

export class LoyaltyConflict extends Error {}
export class InsufficientBalance extends Error {}

export const walletSummary = (wallet: Row) => ({
  id: String(wallet.id),
  programId: String(wallet.programId),
  partnerId: wallet.partnerId ? String(wallet.partnerId) : null,
  code: String(wallet.code),
  unit: String(wallet.unit),
  balance: n(wallet.balance),
  reserved: n(wallet.reserved),
  available: n(wallet.balance) - n(wallet.reserved),
  expiresAt: wallet.expiresAt ? String(wallet.expiresAt) : null,
  active: Boolean(wallet.active),
})

export const postDelta = async (
  ctx: Ctx,
  args: {
    id: string
    walletId: string
    operation: string
    amount: number
    balanceDelta: number
    sourceType: string
    sourceId: string
    sourceOperation: string
    sourceKey: string
    descriptionCode: string
    reversedEntryId?: string | null
    metadata?: Record<string, unknown> | null
    allowNegative?: boolean
  },
): Promise<{ entry: Row; wallet: Row; replayed: boolean }> => {
  const previous = (await ctx.db.select('loyalty.LedgerEntry', { sourceKey: args.sourceKey }))[0]
  if (previous) {
    if (
      String(previous.id) !== String(args.id) ||
      String(previous.walletId) !== String(args.walletId) ||
      String(previous.operation) !== String(args.operation) ||
      Math.abs(n(previous.amount) - Math.abs(args.amount)) > 0.000001 ||
      Math.abs(n(previous.balanceDelta) - args.balanceDelta) > 0.000001 ||
      String(previous.sourceType) !== String(args.sourceType) ||
      String(previous.sourceId) !== String(args.sourceId) ||
      String(previous.sourceOperation) !== String(args.sourceOperation) ||
      String(previous.descriptionCode) !== String(args.descriptionCode) ||
      String(previous.reversedEntryId ?? '') !== String(args.reversedEntryId ?? '')
    )
      throw new LoyaltyConflict('ledger source key changed')
    const wallet = (await ctx.db.select('loyalty.Wallet', { id: previous.walletId }))[0]!
    return { entry: previous, wallet, replayed: true }
  }
  const wallet = (await ctx.db.select('loyalty.Wallet', { id: args.walletId }))[0]
  if (!wallet) throw new InsufficientBalance('wallet missing')
  const nextBalance = n(wallet.balance) + args.balanceDelta
  if (!args.allowNegative && nextBalance < -0.000001) throw new InsufficientBalance('negative balance')
  const inserted = await ctx.db.insertIfAbsent('loyalty.LedgerEntry', {
    id: args.id,
    walletId: args.walletId,
    operation: args.operation,
    amount: decimal(Math.abs(args.amount)),
    balanceDelta: decimal(args.balanceDelta),
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    sourceOperation: args.sourceOperation,
    sourceKey: args.sourceKey,
    descriptionCode: args.descriptionCode,
    reversedEntryId: args.reversedEntryId ?? null,
    metadata: args.metadata ?? null,
    createdAt: now(),
  })
  if (!('dryRun' in inserted) && !inserted.inserted) {
    const entry = (await ctx.db.select('loyalty.LedgerEntry', { sourceKey: args.sourceKey }))[0]!
    const held = (await ctx.db.select('loyalty.Wallet', { id: entry.walletId }))[0]!
    return { entry, wallet: held, replayed: true }
  }
  const changed = await ctx.db.compareAndSet(
    'loyalty.Wallet',
    { id: wallet.id },
    { balance: wallet.balance, reserved: wallet.reserved, version: wallet.version },
    { balance: decimal(nextBalance), version: n(wallet.version) + 1 },
  )
  if (!('dryRun' in changed) && !changed.matched) throw new LoyaltyConflict('wallet changed')
  return {
    entry: (await ctx.db.select('loyalty.LedgerEntry', { sourceKey: args.sourceKey }))[0]!,
    wallet: { ...wallet, balance: decimal(nextBalance), version: n(wallet.version) + 1 },
    replayed: false,
  }
}

export const reserve = async (
  ctx: Ctx,
  args: {
    id: string
    walletId: string
    orderType: string
    orderId: string
    rewardId: string
    amount: number
    expiresAt?: string | null
  },
): Promise<Row> => {
  const existing = (
    await ctx.db.select('loyalty.Reservation', {
      orderType: args.orderType,
      orderId: args.orderId,
      rewardId: args.rewardId,
    })
  )[0]
  if (existing?.state === 'reserved' || existing?.state === 'finalized') return existing
  const wallet = (await ctx.db.select('loyalty.Wallet', { id: args.walletId }))[0]
  if (!wallet) throw new InsufficientBalance('wallet does not exist')
  if (!wallet.active || n(wallet.balance) - n(wallet.reserved) + 0.000001 < args.amount)
    throw new InsufficientBalance('insufficient available balance')
  if (!existing) {
    const inserted = await ctx.db.insertIfAbsent('loyalty.Reservation', {
      id: args.id,
      walletId: args.walletId,
      orderType: args.orderType,
      orderId: args.orderId,
      rewardId: args.rewardId,
      amount: decimal(args.amount),
      state: 'reserved',
      expiresAt: args.expiresAt ?? null,
      createdAt: now(),
      updatedAt: now(),
    })
    if (!('dryRun' in inserted) && !inserted.inserted) throw new LoyaltyConflict('reservation changed')
  }
  const changed = await ctx.db.compareAndSet(
    'loyalty.Wallet',
    { id: wallet.id },
    { balance: wallet.balance, reserved: wallet.reserved, version: wallet.version },
    { reserved: decimal(n(wallet.reserved) + args.amount), version: n(wallet.version) + 1 },
  )
  if (!('dryRun' in changed) && !changed.matched) throw new LoyaltyConflict('wallet changed')
  if (existing)
    await ctx.db.update(
      'loyalty.Reservation',
      { id: existing.id },
      {
        walletId: args.walletId,
        amount: decimal(args.amount),
        state: 'reserved',
        expiresAt: args.expiresAt ?? null,
        updatedAt: now(),
      },
    )
  return (
    await ctx.db.select('loyalty.Reservation', {
      orderType: args.orderType,
      orderId: args.orderId,
      rewardId: args.rewardId,
    })
  )[0]!
}

export const release = async (ctx: Ctx, reservation: Row): Promise<Row> => {
  if (reservation.state !== 'reserved') return reservation
  const wallet = (await ctx.db.select('loyalty.Wallet', { id: reservation.walletId }))[0]
  if (!wallet) throw new LoyaltyConflict('wallet missing')
  const changed = await ctx.db.compareAndSet(
    'loyalty.Wallet',
    { id: wallet.id },
    { balance: wallet.balance, reserved: wallet.reserved, version: wallet.version },
    {
      reserved: decimal(Math.max(0, n(wallet.reserved) - n(reservation.amount))),
      version: n(wallet.version) + 1,
    },
  )
  if (!('dryRun' in changed) && !changed.matched) throw new LoyaltyConflict('wallet changed')
  await ctx.db.update('loyalty.Reservation', { id: reservation.id }, { state: 'released', updatedAt: now() })
  return { ...reservation, state: 'released', updatedAt: now() }
}

export const finalizeReservation = async (ctx: Ctx, reservation: Row, spendAmount: number): Promise<Row> => {
  if (reservation.state === 'finalized')
    return (await ctx.db.select('loyalty.Wallet', { id: reservation.walletId }))[0]!
  if (reservation.state !== 'reserved') throw new LoyaltyConflict('reservation is not active')
  const sourceKey = `${String(reservation.orderType)}:${String(reservation.orderId)}:${String(reservation.rewardId)}:redeem`
  const previous = (await ctx.db.select('loyalty.LedgerEntry', { sourceKey }))[0]
  if (previous) {
    await ctx.db.update(
      'loyalty.Reservation',
      { id: reservation.id },
      { state: 'finalized', updatedAt: now() },
    )
    return (await ctx.db.select('loyalty.Wallet', { id: reservation.walletId }))[0]!
  }
  const wallet = (await ctx.db.select('loyalty.Wallet', { id: reservation.walletId }))[0]
  if (!wallet || n(wallet.balance) + 0.000001 < spendAmount)
    throw new InsufficientBalance('insufficient balance')
  await ctx.db.insert('loyalty.LedgerEntry', {
    id: `${String(reservation.id)}:ledger`,
    walletId: reservation.walletId,
    operation: 'redeem',
    amount: decimal(spendAmount),
    balanceDelta: decimal(-spendAmount),
    sourceType: reservation.orderType,
    sourceId: reservation.orderId,
    sourceOperation: 'redeem',
    sourceKey,
    descriptionCode: 'loyalty.ledger.description.redeem',
    reversedEntryId: null,
    metadata: { rewardId: reservation.rewardId },
    createdAt: now(),
  })
  const changed = await ctx.db.compareAndSet(
    'loyalty.Wallet',
    { id: wallet.id },
    { balance: wallet.balance, reserved: wallet.reserved, version: wallet.version },
    {
      balance: decimal(n(wallet.balance) - spendAmount),
      reserved: decimal(Math.max(0, n(wallet.reserved) - n(reservation.amount))),
      version: n(wallet.version) + 1,
    },
  )
  if (!('dryRun' in changed) && !changed.matched) throw new LoyaltyConflict('wallet changed')
  await ctx.db.update('loyalty.Reservation', { id: reservation.id }, { state: 'finalized', updatedAt: now() })
  return {
    ...wallet,
    balance: decimal(n(wallet.balance) - spendAmount),
    reserved: decimal(Math.max(0, n(wallet.reserved) - n(reservation.amount))),
    version: n(wallet.version) + 1,
  }
}
