import { createHash } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as coreFunctions, ledgerOf } from './functions.ts'
import { minorText, moneyMinor } from './money.ts'

const now = (): string => new Date().toISOString()
const failure = (field: string, code: string, message: string) => ({
  ok: false as const,
  errors: [{ field, code: `account.error.${code}`, message }],
})
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, held]) => `${JSON.stringify(key)}:${stable(held)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
const checksum = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex')
const rowsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? (value.filter((row) => row && typeof row === 'object') as Record<string, unknown>[])
    : []
const snapshotOf = (asset: Row) => ({
  state: asset.state,
  originalCost: asset.originalCost,
  accumulatedAmount: asset.accumulatedAmount,
  carryingValue: asset.carryingValue,
  custodianId: asset.custodianId,
  dimension: asset.dimension,
  scheduleVersion: asset.scheduleVersion,
  revision: asset.revision,
})
const addMonths = (source: string, offset: number): string => {
  const [year, month, day] = source.split('-').map(Number)
  const first = new Date(Date.UTC(year!, month! - 1 + offset, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(
    Math.min(day!, lastDay),
  ).padStart(2, '0')}`
}
const callCore = async (name: keyof typeof coreFunctions, ctx: Ctx, args: Record<string, unknown>) => {
  const fn = coreFunctions[name]
  if (!fn) throw new Error(`account.${String(name)} is unavailable`)
  return (await fn.handler(ctx, args)) as Record<string, unknown>
}
const auditAsset = async (
  ctx: Ctx,
  asset: Row,
  action: string,
  before: unknown,
  after: unknown,
  args: Record<string, unknown>,
) =>
  ctx.db.insertIfAbsent('account.AssetEvent', {
    id: `${String(asset.id)}:${String(Number(asset.revision ?? 0) + 1)}:${action}`,
    assetId: asset.id,
    action,
    before,
    after,
    reason: args.reason ?? null,
    actorId: args.actorId ?? null,
    relatedId: args.relatedId ?? null,
    createdAt: now(),
  })

const scheduleAsset = async (ctx: Ctx, asset: Row): Promise<Record<string, unknown>> => {
  const category = (await ctx.db.select('account.AssetCategory', { id: asset.categoryId }))[0]
  if (!category) return failure('categoryId', 'assetCategoryMissing', 'asset category does not exist')
  const { scale } = await ledgerOf(ctx)
  const cost = moneyMinor(asset.originalCost, scale)
  const accumulated = moneyMinor(asset.accumulatedAmount, scale)
  const residual = moneyMinor(asset.residualValue, scale)
  const basis = cost - accumulated - residual
  if (basis < 0n) return failure('originalCost', 'assetBasisInvalid', 'depreciable basis cannot be negative')
  const periods = Number(category.usefulLifePeriods)
  if (!Number.isInteger(periods) || periods < 1)
    return failure('usefulLifePeriods', 'assetLifeInvalid', 'useful life must be positive')
  const version = Number(asset.scheduleVersion ?? 0) + 1
  const quotient = basis / BigInt(periods)
  const remainder = basis % BigInt(periods)
  for (let index = 0; index < periods; index += 1) {
    const amount = quotient + (BigInt(index) < remainder ? 1n : 0n)
    await ctx.db.insertIfAbsent('account.AssetScheduleLine', {
      id: `${String(asset.id)}:${version}:${index + 1}`,
      assetId: asset.id,
      scheduleVersion: version,
      sequence: index + 1,
      accountingDate: addMonths(String(asset.startDate), index),
      amount: minorText(amount, scale),
      state: amount === 0n ? 'skipped' : 'planned',
      moveId: null,
      createdAt: now(),
    })
  }
  await ctx.db.update('account.Asset', { id: asset.id }, { scheduleVersion: version })
  return { ok: true, assetId: asset.id, scheduleVersion: version, periods, basis: minorText(basis, scale) }
}

const createScheduleMove = async (ctx: Ctx, line: Row): Promise<Record<string, unknown>> => {
  const asset = (await ctx.db.select('account.Asset', { id: line.assetId }))[0]
  const category = asset ? (await ctx.db.select('account.AssetCategory', { id: asset.categoryId }))[0] : null
  if (!asset || !category) return failure('assetId', 'assetMissing', 'asset does not exist')
  if (line.moveId) return { ok: true, id: line.moveId, existing: true }
  const moveId = `asset:${String(line.id)}`
  const move = await callCore('createMove', ctx, {
    id: moveId,
    journalId: category.journalId,
    moveType: 'entry',
    accountingDate: line.accountingDate,
    documentDate: line.accountingDate,
    ref: `${category.kind === 'tool' ? 'Allocation' : 'Depreciation'} · ${String(asset.name)}`,
  })
  if (move.ok !== true) return move
  const { scale } = await ledgerOf(ctx)
  const amount = minorText(moneyMinor(line.amount, scale), scale)
  const debit = await callCore('addMoveLine', ctx, {
    id: `${moveId}:expense`,
    moveId,
    name: String(asset.name),
    accountId: category.expenseAccountId,
    debit: amount,
    credit: '0',
    sequence: 10,
  })
  if (debit.ok !== true) return debit
  const credit = await callCore('addMoveLine', ctx, {
    id: `${moveId}:accumulated`,
    moveId,
    name: String(asset.name),
    accountId: category.accumulatedAccountId,
    debit: '0',
    credit: amount,
    sequence: 20,
  })
  if (credit.ok !== true) return credit
  await ctx.db.update('account.AssetScheduleLine', { id: line.id }, { state: 'draft', moveId })
  return { ok: true, id: moveId, existing: false }
}

export const assetCostingFunctions: Record<string, FnSpec> = {
  listAssetCategories: defineFn({
    input: { active: 'bool?' },
    effects: ['read:account.AssetCategory'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.AssetCategory'))
        .filter((row) => args.active == null || row.active === args.active)
        .sort((left, right) => String(left.name).localeCompare(String(right.name))),
  }),
  listAssets: defineFn({
    input: { state: 'text?', categoryId: 'id?', kind: 'text?' },
    effects: ['read:account.Asset', 'read:account.AssetCategory'],
    agent: true,
    handler: async (ctx, args) => {
      const categories = new Map(
        (await ctx.db.select('account.AssetCategory')).map((row) => [String(row.id), row]),
      )
      return (await ctx.db.select('account.Asset'))
        .filter(
          (row) =>
            (!args.state || row.state === args.state) &&
            (!args.categoryId || row.categoryId === args.categoryId) &&
            (!args.kind || categories.get(String(row.categoryId))?.kind === args.kind),
        )
        .map((row) => ({ ...row, kind: categories.get(String(row.categoryId))?.kind ?? null }) as Row)
        .sort((left, right) => String(left.name).localeCompare(String(right.name)))
    },
  }),
  listAssetSchedule: defineFn({
    input: { assetId: 'id', scheduleVersion: 'int?' },
    effects: ['read:account.AssetScheduleLine'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.AssetScheduleLine', { assetId: args.assetId }))
        .filter((row) => args.scheduleVersion == null || row.scheduleVersion === args.scheduleVersion)
        .sort((left, right) => Number(left.sequence) - Number(right.sequence)),
  }),
  listAssetEvents: defineFn({
    input: { assetId: 'id' },
    effects: ['read:account.AssetEvent'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.AssetEvent', { assetId: args.assetId })).sort((left, right) =>
        String(left.createdAt).localeCompare(String(right.createdAt)),
      ),
  }),
  saveAssetCategory: defineFn({
    input: {
      id: 'id',
      name: 'text',
      kind: 'text',
      acquisitionAccountId: 'id',
      accumulatedAccountId: 'id',
      expenseAccountId: 'id',
      disposalGainAccountId: 'id?',
      disposalLossAccountId: 'id?',
      journalId: 'id',
      method: 'text?',
      usefulLifePeriods: 'int',
      prorataPolicy: 'text?',
      policyVersion: 'int?',
      active: 'bool?',
    },
    effects: [
      'read:account.Account',
      'read:account.Journal',
      'read:account.AssetCategory',
      'write:account.AssetCategory',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!['fixed_asset', 'tool'].includes(String(args.kind)))
        return failure('kind', 'assetKindInvalid', 'kind must be fixed_asset or tool')
      if (String(args.method ?? 'straight_line') !== 'straight_line')
        return failure('method', 'assetMethodInvalid', 'only straight-line is in the first costing scope')
      if (Number(args.usefulLifePeriods) < 1)
        return failure('usefulLifePeriods', 'assetLifeInvalid', 'useful life must be positive')
      const accounts = new Map((await ctx.db.select('account.Account')).map((row) => [String(row.id), row]))
      for (const field of ['acquisitionAccountId', 'accumulatedAccountId', 'expenseAccountId'] as const)
        if (!accounts.has(String(args[field])))
          return failure(field, 'assetAccountMissing', `${field} must reference an account`)
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      if (journal?.type !== 'general')
        return failure('journalId', 'assetJournalInvalid', 'asset policy requires a general journal')
      const values = {
        ...args,
        disposalGainAccountId: args.disposalGainAccountId ?? null,
        disposalLossAccountId: args.disposalLossAccountId ?? null,
        method: 'straight_line',
        prorataPolicy: args.prorataPolicy ?? 'monthly',
        policyVersion: args.policyVersion ?? 1,
        active: args.active ?? true,
      }
      const existing = (await ctx.db.select('account.AssetCategory', { id: args.id }))[0]
      if (existing) await ctx.db.update('account.AssetCategory', { id: args.id }, values)
      else await ctx.db.insert('account.AssetCategory', values)
      return { ok: true, id: args.id, existing: Boolean(existing) }
    },
  }),
  createAsset: defineFn({
    input: {
      id: 'id',
      name: 'text',
      categoryId: 'id',
      sourceType: 'text',
      sourceId: 'text',
      sourceLineId: 'text?',
      originalCost: 'decimal',
      accumulatedAmount: 'decimal?',
      residualValue: 'decimal?',
      startDate: 'date',
      custodianId: 'text?',
      dimension: 'json?',
      actorId: 'text?',
    },
    effects: [
      'read:account.AssetCategory',
      'read:account.Asset',
      'read:company.Company',
      'write:account.Asset',
      'write:account.AssetEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const category = (await ctx.db.select('account.AssetCategory', { id: args.categoryId }))[0]
      if (category?.active !== true)
        return failure('categoryId', 'assetCategoryMissing', 'active asset category does not exist')
      if (!['invoice', 'migration', 'manual'].includes(String(args.sourceType)))
        return failure('sourceType', 'assetSourceInvalid', 'unsupported asset source')
      const { scale } = await ledgerOf(ctx)
      let cost: bigint
      let accumulated: bigint
      let residual: bigint
      try {
        cost = moneyMinor(args.originalCost, scale)
        accumulated = moneyMinor(args.accumulatedAmount ?? '0', scale)
        residual = moneyMinor(args.residualValue ?? '0', scale)
      } catch {
        return failure('originalCost', 'moneyExactString', 'asset amounts must be exact decimal strings')
      }
      if (cost <= 0n || accumulated < 0n || residual < 0n || accumulated + residual > cost)
        return failure('originalCost', 'assetBasisInvalid', 'asset basis and accumulated amount are invalid')
      const sourceKey = checksum({
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        sourceLineId: args.sourceLineId ?? null,
      })
      const existing = (await ctx.db.select('account.Asset', { sourceKey }))[0]
      if (existing) return { ok: true, id: existing.id, duplicate: true }
      const row = {
        id: args.id,
        name: args.name,
        categoryId: args.categoryId,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        sourceLineId: args.sourceLineId ?? null,
        sourceKey,
        originalCost: minorText(cost, scale),
        accumulatedAmount: minorText(accumulated, scale),
        residualValue: minorText(residual, scale),
        carryingValue: minorText(cost - accumulated, scale),
        startDate: args.startDate,
        state: 'draft',
        custodianId: args.custodianId ?? null,
        dimension: args.dimension ?? null,
        scheduleVersion: 0,
        revision: 0,
        createdAt: now(),
        createdBy: args.actorId ?? null,
        activatedAt: null,
        disposedAt: null,
      }
      const inserted = await ctx.db.insertIfAbsent('account.Asset', row)
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const held = (await ctx.db.select('account.Asset', { sourceKey }))[0]
        return { ok: true, id: held?.id ?? args.id, duplicate: true }
      }
      await auditAsset(ctx, row, 'created', {}, snapshotOf(row), args)
      return { ok: true, id: args.id, duplicate: false }
    },
  }),
  transitionAsset: defineFn({
    input: {
      id: 'id',
      action: 'text',
      expectedRevision: 'int?',
      custodianId: 'text?',
      dimension: 'json?',
      reason: 'text?',
      actorId: 'text?',
    },
    effects: [
      'read:account.Asset',
      'read:account.AssetCategory',
      'read:account.AssetScheduleLine',
      'write:account.Asset',
      'write:account.AssetEvent',
      'write:account.AssetScheduleLine',
      'read:company.Company',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const asset = (await ctx.db.select('account.Asset', { id: args.id }))[0]
      if (!asset) return failure('id', 'assetMissing', 'asset does not exist')
      if (args.expectedRevision != null && Number(asset.revision) !== Number(args.expectedRevision))
        return failure('expectedRevision', 'assetConcurrent', 'asset changed concurrently')
      const transitions: Record<string, Record<string, string>> = {
        activate: { draft: 'running' },
        pause: { running: 'paused' },
        resume: { paused: 'running' },
        transfer: { running: 'running', paused: 'paused' },
      }
      const nextState = transitions[String(args.action)]?.[String(asset.state)]
      if (!nextState) return failure('action', 'assetTransitionInvalid', 'asset transition is not allowed')
      const before = snapshotOf(asset)
      const values = {
        state: nextState,
        custodianId: args.action === 'transfer' ? (args.custodianId ?? asset.custodianId) : asset.custodianId,
        dimension: args.action === 'transfer' ? (args.dimension ?? asset.dimension) : asset.dimension,
        activatedAt: args.action === 'activate' ? now() : asset.activatedAt,
        revision: Number(asset.revision ?? 0) + 1,
      }
      await ctx.db.update('account.Asset', { id: asset.id }, values)
      if (args.action === 'activate') {
        const scheduled = await scheduleAsset(ctx, { ...asset, ...values })
        if (scheduled.ok !== true) return scheduled
      }
      const after = snapshotOf({ ...asset, ...values })
      await auditAsset(ctx, asset, String(args.action), before, after, args)
      return { ok: true, id: asset.id, state: nextState, revision: values.revision }
    },
  }),
  runAssetBatch: defineFn({
    input: { id: 'id', idempotencyKey: 'text', cutoffDate: 'date', batchSize: 'int?' },
    effects: [
      'read:account.AssetBatchRun',
      'read:account.AssetScheduleLine',
      'read:account.Asset',
      'read:account.AssetCategory',
      'read:account.Journal',
      'read:account.Account',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
      'write:account.AssetBatchRun',
      'write:account.AssetScheduleLine',
      'write:account.Move',
      'write:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const held = (await ctx.db.select('account.AssetBatchRun', { idempotencyKey: args.idempotencyKey }))[0]
      if (held) return { ok: true, id: held.id, duplicate: true, state: held.state, artifact: held.artifact }
      const lockKey = `asset:${String(args.cutoffDate)}`
      const run = {
        id: args.id,
        idempotencyKey: args.idempotencyKey,
        activeLockKey: lockKey,
        cutoffDate: args.cutoffDate,
        state: 'running',
        progress: 0,
        checkpoint: null,
        cancelRequested: false,
        artifact: null,
        createdAt: now(),
        completedAt: null,
      }
      const inserted = await ctx.db.insertIfAbsent('account.AssetBatchRun', run)
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const duplicate = (
          await ctx.db.select('account.AssetBatchRun', { idempotencyKey: args.idempotencyKey })
        )[0]
        if (duplicate)
          return {
            ok: true,
            id: duplicate.id,
            duplicate: true,
            state: duplicate.state,
            artifact: duplicate.artifact,
          }
        return failure('cutoffDate', 'assetBatchLocked', 'another asset batch owns this cutoff')
      }
      const limit = Math.max(1, Math.min(Number(args.batchSize ?? 100), 500))
      const activeAssets = new Set(
        (await ctx.db.select('account.Asset'))
          .filter((row) => row.state === 'running')
          .map((row) => String(row.id)),
      )
      const due = (await ctx.db.select('account.AssetScheduleLine'))
        .filter(
          (line) =>
            activeAssets.has(String(line.assetId)) &&
            line.state === 'planned' &&
            String(line.accountingDate) <= String(args.cutoffDate),
        )
        .sort(
          (left, right) =>
            String(left.accountingDate).localeCompare(String(right.accountingDate)) ||
            String(left.id).localeCompare(String(right.id)),
        )
        .slice(0, limit)
      const created: string[] = []
      for (const [index, line] of due.entries()) {
        const result = await createScheduleMove(ctx, line)
        if (result.ok !== true) {
          await ctx.db.update(
            'account.AssetBatchRun',
            { id: args.id },
            {
              state: 'failed',
              checkpoint: String(line.id),
              activeLockKey: null,
              artifact: { created, error: result.errors ?? [] },
              completedAt: now(),
            },
          )
          return { ok: false, id: args.id, errors: result.errors }
        }
        created.push(String(result.id))
        await ctx.db.update(
          'account.AssetBatchRun',
          { id: args.id },
          {
            progress: index + 1,
            checkpoint: String(line.id),
          },
        )
      }
      const remaining = (await ctx.db.select('account.AssetScheduleLine')).filter(
        (line) =>
          activeAssets.has(String(line.assetId)) &&
          line.state === 'planned' &&
          String(line.accountingDate) <= String(args.cutoffDate),
      ).length
      const state = remaining > 0 ? 'checkpointed' : 'completed'
      const artifact = { created, processed: created.length, remaining, cutoffDate: args.cutoffDate }
      await ctx.db.update(
        'account.AssetBatchRun',
        { id: args.id },
        {
          state,
          activeLockKey: null,
          artifact,
          completedAt: now(),
        },
      )
      return { ok: true, id: args.id, duplicate: false, state, artifact }
    },
  }),
  postAssetScheduleLine: defineFn({
    input: { id: 'id', expectedMoveRevision: 'int?' },
    effects: [
      'read:account.AssetScheduleLine',
      'read:account.Asset',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Journal',
      'read:account.Account',
      'read:account.PeriodPolicy',
      'read:company.Company',
      'write:account.AssetScheduleLine',
      'write:account.Asset',
      'write:account.Journal',
      'write:account.Move',
      'write:account.PeriodPolicy',
      'write:account.AuditEvent',
      'write:account.AssetEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const line = (await ctx.db.select('account.AssetScheduleLine', { id: args.id }))[0]
      if (!line?.moveId) return failure('id', 'assetScheduleMissing', 'draft schedule line does not exist')
      if (line.state === 'posted') return { ok: true, id: line.id, existing: true }
      const posted = await callCore('postMove', ctx, {
        id: line.moveId,
        expectedRevision: args.expectedMoveRevision,
      })
      if (posted.ok !== true) return posted
      const asset = (await ctx.db.select('account.Asset', { id: line.assetId }))[0]
      if (!asset) return failure('assetId', 'assetMissing', 'asset does not exist')
      const { scale } = await ledgerOf(ctx)
      const accumulated = moneyMinor(asset.accumulatedAmount, scale) + moneyMinor(line.amount, scale)
      const carrying = moneyMinor(asset.originalCost, scale) - accumulated
      const before = snapshotOf(asset)
      const values = {
        accumulatedAmount: minorText(accumulated, scale),
        carryingValue: minorText(carrying, scale),
        revision: Number(asset.revision ?? 0) + 1,
      }
      await ctx.db.update('account.AssetScheduleLine', { id: line.id }, { state: 'posted' })
      await ctx.db.update('account.Asset', { id: asset.id }, values)
      await auditAsset(ctx, asset, 'schedule_posted', before, snapshotOf({ ...asset, ...values }), {
        relatedId: line.moveId,
      })
      return { ok: true, id: line.id, moveId: line.moveId }
    },
  }),
  proposeAssetChange: defineFn({
    input: {
      id: 'id',
      assetId: 'id',
      action: 'text',
      accountingDate: 'date',
      newCost: 'decimal?',
      reason: 'text',
      actorId: 'text?',
    },
    effects: [
      'read:account.Asset',
      'read:account.AssetCategory',
      'read:account.AssetChange',
      'read:account.AssetScheduleLine',
      'read:account.Journal',
      'read:account.Account',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
      'write:account.AssetChange',
      'write:account.Move',
      'write:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('account.AssetChange', { id: args.id }))[0]
      if (existing) return { ok: true, id: existing.id, moveId: existing.moveId, duplicate: true }
      const asset = (await ctx.db.select('account.Asset', { id: args.assetId }))[0]
      const category = asset
        ? (await ctx.db.select('account.AssetCategory', { id: asset.categoryId }))[0]
        : null
      if (!asset || !category) return failure('assetId', 'assetMissing', 'asset does not exist')
      if (asset.state !== 'running' && asset.state !== 'paused')
        return failure('assetId', 'assetTransitionInvalid', 'asset must be running or paused')
      if (!['revalue', 'dispose'].includes(String(args.action)))
        return failure('action', 'assetChangeInvalid', 'asset change must be revalue or dispose')
      const conflicting = (await ctx.db.select('account.AssetScheduleLine', { assetId: asset.id })).find(
        (line) => line.state === 'draft',
      )
      if (conflicting)
        return failure('assetId', 'assetScheduleConflict', 'asset has an unposted schedule entry')
      const { scale } = await ledgerOf(ctx)
      const oldCost = moneyMinor(asset.originalCost, scale)
      const accumulated = moneyMinor(asset.accumulatedAmount, scale)
      const carrying = moneyMinor(asset.carryingValue, scale)
      let after: Row
      const postings: Array<{ suffix: string; accountId: unknown; debit: bigint; credit: bigint }> = []
      if (args.action === 'revalue') {
        if (args.newCost == null)
          return failure('newCost', 'assetChangeInvalid', 'revaluation requires a new cost')
        const newCost = moneyMinor(args.newCost, scale)
        if (newCost < accumulated + moneyMinor(asset.residualValue, scale))
          return failure(
            'newCost',
            'assetBasisInvalid',
            'new cost cannot fall below accumulated and residual',
          )
        const difference = newCost - oldCost
        if (difference === 0n)
          return failure('newCost', 'assetChangeInvalid', 'revaluation must change the asset cost')
        if (difference > 0n) {
          if (!category.disposalGainAccountId)
            return failure('categoryId', 'assetAccountMissing', 'revaluation gain account is required')
          postings.push(
            { suffix: 'asset', accountId: category.acquisitionAccountId, debit: difference, credit: 0n },
            { suffix: 'gain', accountId: category.disposalGainAccountId, debit: 0n, credit: difference },
          )
        } else {
          if (!category.disposalLossAccountId)
            return failure('categoryId', 'assetAccountMissing', 'revaluation loss account is required')
          postings.push(
            { suffix: 'loss', accountId: category.disposalLossAccountId, debit: -difference, credit: 0n },
            { suffix: 'asset', accountId: category.acquisitionAccountId, debit: 0n, credit: -difference },
          )
        }
        after = {
          ...snapshotOf(asset),
          originalCost: minorText(newCost, scale),
          carryingValue: minorText(newCost - accumulated, scale),
        }
      } else {
        if (!category.disposalLossAccountId)
          return failure('categoryId', 'assetAccountMissing', 'disposal loss account is required')
        if (accumulated > 0n)
          postings.push({
            suffix: 'accumulated',
            accountId: category.accumulatedAccountId,
            debit: accumulated,
            credit: 0n,
          })
        if (carrying > 0n)
          postings.push({
            suffix: 'loss',
            accountId: category.disposalLossAccountId,
            debit: carrying,
            credit: 0n,
          })
        postings.push({
          suffix: 'asset',
          accountId: category.acquisitionAccountId,
          debit: 0n,
          credit: oldCost,
        })
        after = { ...snapshotOf(asset), state: 'disposed', carryingValue: minorText(0n, scale) }
      }
      const moveId = `asset-change:${String(args.id)}`
      const move = await callCore('createMove', ctx, {
        id: moveId,
        journalId: category.journalId,
        moveType: 'entry',
        accountingDate: args.accountingDate,
        documentDate: args.accountingDate,
        ref: `${String(args.action)} · ${String(asset.name)}`,
      })
      if (move.ok !== true) return move
      for (const [index, posting] of postings.entries()) {
        const line = await callCore('addMoveLine', ctx, {
          id: `${moveId}:${posting.suffix}`,
          moveId,
          name: `${String(args.action)} · ${String(asset.name)}`,
          accountId: posting.accountId,
          debit: minorText(posting.debit, scale),
          credit: minorText(posting.credit, scale),
          sequence: (index + 1) * 10,
        })
        if (line.ok !== true) return line
      }
      await ctx.db.insert('account.AssetChange', {
        id: args.id,
        assetId: asset.id,
        action: args.action,
        before: snapshotOf(asset),
        after,
        accountingDate: args.accountingDate,
        state: 'draft',
        moveId,
        reason: args.reason,
        actorId: args.actorId ?? null,
        completedAt: null,
        createdAt: now(),
      })
      return { ok: true, id: args.id, moveId, duplicate: false }
    },
  }),
  completeAssetChange: defineFn({
    input: { id: 'id', expectedMoveRevision: 'int?' },
    effects: [
      'read:account.AssetChange',
      'read:account.Asset',
      'read:account.AssetCategory',
      'read:account.AssetScheduleLine',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Journal',
      'read:account.Account',
      'read:account.PeriodPolicy',
      'read:company.Company',
      'write:account.AssetChange',
      'write:account.Asset',
      'write:account.AssetEvent',
      'write:account.AssetScheduleLine',
      'write:account.Journal',
      'write:account.Move',
      'write:account.PeriodPolicy',
      'write:account.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const change = (await ctx.db.select('account.AssetChange', { id: args.id }))[0]
      if (!change) return failure('id', 'assetChangeMissing', 'asset change does not exist')
      if (change.state === 'completed') return { ok: true, id: change.id, duplicate: true }
      if (change.state !== 'draft')
        return failure('state', 'assetChangeInvalid', 'only a draft asset change can complete')
      const posted = await callCore('postMove', ctx, {
        id: change.moveId,
        expectedRevision: args.expectedMoveRevision,
      })
      if (posted.ok !== true) return posted
      const asset = (await ctx.db.select('account.Asset', { id: change.assetId }))[0]
      if (!asset) return failure('assetId', 'assetMissing', 'asset does not exist')
      const values = {
        ...(change.after as Record<string, unknown>),
        revision: Number(asset.revision ?? 0) + 1,
        disposedAt: change.action === 'dispose' ? now() : asset.disposedAt,
      }
      await ctx.db.update('account.Asset', { id: asset.id }, values)
      const planned = (await ctx.db.select('account.AssetScheduleLine', { assetId: asset.id })).filter(
        (line) => line.state === 'planned',
      )
      for (const line of planned)
        await ctx.db.update('account.AssetScheduleLine', { id: line.id }, { state: 'cancelled' })
      if (change.action === 'revalue') {
        const scheduled = await scheduleAsset(ctx, { ...asset, ...values })
        if (scheduled.ok !== true) return scheduled
      }
      await ctx.db.update(
        'account.AssetChange',
        { id: change.id },
        { state: 'completed', completedAt: now() },
      )
      await auditAsset(ctx, asset, String(change.action), change.before, change.after, {
        reason: change.reason,
        actorId: change.actorId,
        relatedId: change.moveId,
      })
      return { ok: true, id: change.id, moveId: change.moveId, duplicate: false }
    },
  }),
  assetReconciliation: defineFn({
    input: { cutoffDate: 'date' },
    effects: [
      'read:account.AssetCategory',
      'read:account.Asset',
      'read:account.AssetScheduleLine',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const { scale } = await ledgerOf(ctx)
      const assets = await ctx.db.select('account.Asset')
      const postedMoves = new Set(
        (await ctx.db.select('account.Move', { state: 'posted' }))
          .filter((move) => String(move.accountingDate) <= String(args.cutoffDate))
          .map((move) => String(move.id)),
      )
      const lines = (await ctx.db.select('account.MoveLine')).filter((line) =>
        postedMoves.has(String(line.moveId)),
      )
      const balance = (accountId: unknown): bigint =>
        lines
          .filter((line) => line.accountId === accountId)
          .reduce((sum, line) => sum + moneyMinor(line.balance, scale), 0n)
      const rows: Row[] = []
      for (const category of await ctx.db.select('account.AssetCategory')) {
        const held = assets.filter((asset) => asset.categoryId === category.id)
        const gross = held.reduce((sum, asset) => sum + moneyMinor(asset.originalCost, scale), 0n)
        const accumulated = held.reduce((sum, asset) => sum + moneyMinor(asset.accumulatedAmount, scale), 0n)
        const glGross = balance(category.acquisitionAccountId)
        const glAccumulated = -balance(category.accumulatedAccountId)
        const grossVariance = gross - glGross
        const accumulatedVariance = accumulated - glAccumulated
        const matched = grossVariance === 0n && accumulatedVariance === 0n
        rows.push({
          categoryId: category.id,
          categoryName: category.name,
          kind: category.kind,
          assetIds: held.map((asset) => asset.id),
          gross: minorText(gross, scale),
          accumulated: minorText(accumulated, scale),
          carrying: minorText(gross - accumulated, scale),
          glGross: minorText(glGross, scale),
          glAccumulated: minorText(glAccumulated, scale),
          grossVariance: minorText(grossVariance, scale),
          accumulatedVariance: minorText(accumulatedVariance, scale),
          classification: matched ? 'matched' : 'subledger_gl_mismatch',
          ownerId: matched ? null : 'asset-controller',
          action: matched ? 'none' : 'review_source_and_posting',
        })
      }
      return { cutoffDate: args.cutoffDate, rows }
    },
  }),
  saveCostPolicy: defineFn({
    input: {
      id: 'id',
      name: 'text',
      method: 'text',
      pools: 'json',
      drivers: 'json',
      tolerance: 'decimal?',
      version: 'int?',
      active: 'bool?',
    },
    effects: ['read:account.CostPolicy', 'write:account.CostPolicy'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!['standard', 'actual_pool'].includes(String(args.method)))
        return failure('method', 'costMethodInvalid', 'unsupported costing method')
      const values = {
        ...args,
        tolerance: args.tolerance ?? '0',
        version: args.version ?? 1,
        active: args.active ?? true,
      }
      const existing = (await ctx.db.select('account.CostPolicy', { id: args.id }))[0]
      if (existing) await ctx.db.update('account.CostPolicy', { id: args.id }, values)
      else await ctx.db.insert('account.CostPolicy', values)
      return { ok: true, id: args.id, existing: Boolean(existing) }
    },
  }),
  startCostRun: defineFn({
    input: { id: 'id', policyId: 'id', periodKey: 'text', version: 'int?', inputs: 'json' },
    effects: [
      'read:account.CostPolicy',
      'read:account.CostRun',
      'read:account.CostInput',
      'write:account.CostRun',
      'write:account.CostInput',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const policy = (await ctx.db.select('account.CostPolicy', { id: args.policyId }))[0]
      if (policy?.active !== true)
        return failure('policyId', 'costPolicyMissing', 'active cost policy does not exist')
      const inputs = rowsOf(args.inputs)
      if (inputs.length === 0)
        return failure('inputs', 'costInputsRequired', 'cost run requires frozen source inputs')
      for (const input of inputs)
        if (!['stock', 'manufacturing', 'accounting'].includes(String(input.source)) || !input.sourceId)
          return failure('inputs', 'costInputInvalid', 'cost input source and sourceId are required')
      const version = Number(args.version ?? 1)
      const inputChecksum = checksum(inputs)
      const identityChecksum = checksum({
        policyId: args.policyId,
        policyVersion: policy.version,
        periodKey: args.periodKey,
        version,
        inputChecksum,
      })
      const existing = (await ctx.db.select('account.CostRun', { identityChecksum }))[0]
      if (existing) return { ok: true, id: existing.id, duplicate: true, state: existing.state }
      const activeLockKey = `cost:${String(args.policyId)}:${String(args.periodKey)}`
      const inserted = await ctx.db.insertIfAbsent('account.CostRun', {
        id: args.id,
        policyId: args.policyId,
        periodKey: args.periodKey,
        version,
        identityChecksum,
        inputChecksum,
        outputChecksum: null,
        activeLockKey,
        state: 'running',
        snapshot: null,
        progress: 0,
        checkpoint: null,
        cancelRequested: false,
        createdAt: now(),
        finalizedAt: null,
      })
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const duplicate = (await ctx.db.select('account.CostRun', { identityChecksum }))[0]
        if (duplicate) return { ok: true, id: duplicate.id, duplicate: true, state: duplicate.state }
        return failure('periodKey', 'costRunLocked', 'another cost run owns this policy and period')
      }
      for (const [index, input] of inputs.entries()) {
        const facts = input.facts ?? {}
        await ctx.db.insert('account.CostInput', {
          id: `${String(args.id)}:${index + 1}`,
          runId: args.id,
          source: input.source,
          sourceId: input.sourceId,
          fingerprint: checksum(facts),
          facts,
          capturedAt: now(),
        })
      }
      return { ok: true, id: args.id, duplicate: false, inputChecksum }
    },
  }),
  finalizeCostRun: defineFn({
    input: { id: 'id' },
    effects: [
      'read:account.CostRun',
      'read:account.CostPolicy',
      'read:account.CostInput',
      'read:account.CostVariance',
      'read:company.Company',
      'write:account.CostRun',
      'write:account.CostVariance',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const run = (await ctx.db.select('account.CostRun', { id: args.id }))[0]
      if (!run) return failure('id', 'costRunMissing', 'cost run does not exist')
      if (run.state === 'finalized')
        return { ok: true, id: run.id, duplicate: true, outputChecksum: run.outputChecksum }
      if (run.state !== 'running')
        return failure('state', 'costRunStateInvalid', 'only a running cost run can be finalized')
      const policy = (await ctx.db.select('account.CostPolicy', { id: run.policyId }))[0]!
      const inputs = await ctx.db.select('account.CostInput', { runId: run.id })
      const { scale } = await ledgerOf(ctx)
      const tolerance = moneyMinor(policy.tolerance, scale)
      const variances: Row[] = []
      for (const input of inputs) {
        const facts = (input.facts ?? {}) as Record<string, unknown>
        if (facts.expected == null || facts.actual == null) continue
        const expected = moneyMinor(facts.expected, scale)
        const actual = moneyMinor(facts.actual, scale)
        const variance = actual - expected
        const row = {
          id: `${String(run.id)}:${String(input.id)}`,
          runId: run.id,
          kind: facts.kind ?? 'cutoff',
          sourceId: input.sourceId,
          expected: minorText(expected, scale),
          actual: minorText(actual, scale),
          variance: minorText(variance, scale),
          severity: variance < -tolerance || variance > tolerance ? 'action_required' : 'within_tolerance',
          ownerId: facts.ownerId ?? null,
          resolution: null,
        }
        await ctx.db.insertIfAbsent('account.CostVariance', row)
        variances.push(row)
      }
      const snapshot = {
        policy: { id: policy.id, version: policy.version, method: policy.method },
        periodKey: run.periodKey,
        version: run.version,
        inputs: inputs.map((input) => ({
          source: input.source,
          sourceId: input.sourceId,
          fingerprint: input.fingerprint,
          facts: input.facts,
        })),
        variances,
      }
      const outputChecksum = checksum(snapshot)
      await ctx.db.update(
        'account.CostRun',
        { id: run.id },
        {
          state: 'finalized',
          snapshot,
          outputChecksum,
          activeLockKey: null,
          progress: inputs.length,
          checkpoint: inputs.at(-1)?.id ?? null,
          finalizedAt: now(),
        },
      )
      return { ok: true, id: run.id, duplicate: false, outputChecksum, snapshot }
    },
  }),
  listCostRuns: defineFn({
    input: { periodKey: 'text?', state: 'text?' },
    effects: ['read:account.CostRun'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.CostRun'))
        .filter(
          (row) =>
            (!args.periodKey || row.periodKey === args.periodKey) &&
            (!args.state || row.state === args.state),
        )
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))),
  }),
  listCostVariances: defineFn({
    input: { runId: 'id' },
    effects: ['read:account.CostVariance'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.CostVariance', { runId: args.runId })).sort((left, right) =>
        String(left.id).localeCompare(String(right.id)),
      ),
  }),
  createCostAdjustmentProposal: defineFn({
    input: {
      id: 'id',
      runId: 'id',
      varianceId: 'id',
      journalId: 'id',
      debitAccountId: 'id',
      creditAccountId: 'id',
      amount: 'decimal',
      accountingDate: 'date',
    },
    effects: [
      'read:account.CostRun',
      'read:account.CostVariance',
      'read:account.CostAdjustmentProposal',
      'read:account.Journal',
      'read:account.Account',
      'read:company.Company',
      'write:account.CostAdjustmentProposal',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const run = (await ctx.db.select('account.CostRun', { id: args.runId }))[0]
      const variance = (await ctx.db.select('account.CostVariance', { id: args.varianceId }))[0]
      if (run?.state !== 'finalized' || !variance || variance.runId !== run.id)
        return failure('runId', 'costRunStateInvalid', 'proposal requires a finalized run variance')
      const { scale } = await ledgerOf(ctx)
      const amount = moneyMinor(args.amount, scale)
      if (amount <= 0n)
        return failure('amount', 'costAdjustmentInvalid', 'adjustment amount must be positive')
      const existing = (await ctx.db.select('account.CostAdjustmentProposal', { id: args.id }))[0]
      if (existing) return { ok: true, id: existing.id, duplicate: true }
      await ctx.db.insert('account.CostAdjustmentProposal', {
        ...args,
        amount: minorText(amount, scale),
        state: 'draft',
        moveId: null,
        approvedBy: null,
        approvedAt: null,
        createdAt: now(),
      })
      return { ok: true, id: args.id, duplicate: false }
    },
  }),
  approveCostAdjustmentProposal: defineFn({
    input: { id: 'id', actorId: 'text' },
    effects: [
      'read:account.CostAdjustmentProposal',
      'read:account.Journal',
      'read:account.Account',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
      'write:account.CostAdjustmentProposal',
      'write:account.Move',
      'write:account.MoveLine',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const proposal = (await ctx.db.select('account.CostAdjustmentProposal', { id: args.id }))[0]
      if (!proposal) return failure('id', 'costAdjustmentMissing', 'adjustment proposal does not exist')
      if (proposal.moveId) return { ok: true, id: proposal.id, moveId: proposal.moveId, duplicate: true }
      const moveId = `cost-adjustment:${String(proposal.id)}`
      const move = await callCore('createMove', ctx, {
        id: moveId,
        journalId: proposal.journalId,
        moveType: 'entry',
        accountingDate: proposal.accountingDate,
        documentDate: proposal.accountingDate,
        ref: `Cost adjustment proposal ${String(proposal.id)}`,
      })
      if (move.ok !== true) return move
      for (const [suffix, accountId, debit, credit, sequence] of [
        ['debit', proposal.debitAccountId, proposal.amount, '0', 10],
        ['credit', proposal.creditAccountId, '0', proposal.amount, 20],
      ] as const) {
        const line = await callCore('addMoveLine', ctx, {
          id: `${moveId}:${suffix}`,
          moveId,
          name: `Cost adjustment ${String(proposal.id)}`,
          accountId,
          debit,
          credit,
          sequence,
        })
        if (line.ok !== true) return line
      }
      await ctx.db.update(
        'account.CostAdjustmentProposal',
        { id: proposal.id },
        {
          state: 'approved_draft_entry',
          moveId,
          approvedBy: args.actorId,
          approvedAt: now(),
        },
      )
      return { ok: true, id: proposal.id, moveId, duplicate: false }
    },
  }),
  getFxPolicy: defineFn({
    input: {},
    effects: ['read:account.FxPolicy'],
    agent: true,
    handler: async (ctx) =>
      (await ctx.db.select('account.FxPolicy'))[0] ?? {
        id: 'default',
        state: 'disabled',
        rateSource: null,
        businessOwnerId: null,
        approvalRef: null,
        activatedAt: null,
      },
  }),
  configureFxPolicy: defineFn({
    input: {
      state: 'text',
      rateSource: 'text?',
      businessOwnerId: 'text?',
      approvalRef: 'text?',
    },
    effects: ['read:account.FxPolicy', 'write:account.FxPolicy'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!['disabled', 'approved'].includes(String(args.state)))
        return failure('state', 'fxGateInvalid', 'FX gate must be disabled or approved')
      if (args.state === 'approved' && (!args.rateSource || !args.businessOwnerId || !args.approvalRef))
        return failure(
          'approvalRef',
          'fxApprovalRequired',
          'approved FX requires source, owner, and approval',
        )
      const values = {
        id: 'default',
        state: args.state,
        rateSource: args.rateSource ?? null,
        businessOwnerId: args.businessOwnerId ?? null,
        approvalRef: args.approvalRef ?? null,
        activatedAt: args.state === 'approved' ? now() : null,
      }
      const existing = (await ctx.db.select('account.FxPolicy'))[0]
      if (existing) await ctx.db.update('account.FxPolicy', { id: existing.id }, values)
      else await ctx.db.insert('account.FxPolicy', values)
      return { ok: true, ...values }
    },
  }),
}

export const accountAssetCostingFunctions = Object.freeze(Object.keys(assetCostingFunctions).sort())
