import { defineFn, isDateText } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'

export const PERIOD_LOCK_SCOPES = ['sales', 'purchases', 'tax', 'all', 'hard'] as const
export type PeriodLockScope = (typeof PERIOD_LOCK_SCOPES)[number]

const fieldOf: Record<PeriodLockScope, string> = {
  sales: 'salesThrough',
  purchases: 'purchasesThrough',
  tax: 'taxThrough',
  all: 'allThrough',
  hard: 'hardThrough',
}

const now = (): string => new Date().toISOString()
const revisionOf = (row: Row): number => Number(row.revision ?? 0)
const issue = (field: string, code: string, message: string, params?: Record<string, unknown>) => ({
  field,
  code: `account.error.${code}`,
  message,
  params,
})
const failure = (...errors: ReturnType<typeof issue>[]) => ({ ok: false as const, errors })

async function policyOf(ctx: Ctx): Promise<Row> {
  await ctx.db.insertIfAbsent('account.PeriodPolicy', {
    id: 'policy',
    salesThrough: null,
    purchasesThrough: null,
    taxThrough: null,
    allThrough: null,
    hardThrough: null,
    revision: 0,
    updatedAt: now(),
    updatedBy: null,
  })
  const row = (await ctx.db.select('account.PeriodPolicy', { id: 'policy' }))[0]
  if (!row) throw new Error('accounting period policy could not be initialized')
  return row
}

/**
 * Claim the lock-policy snapshot and return the fence that rejects this post.
 *
 * The no-op CAS is intentional: on PostgreSQL it serializes against a lock
 * change. Whichever transaction reaches the policy row first defines whether
 * the post happened before or after the close command.
 */
export async function claimPostingPeriod(
  ctx: Ctx,
  input: { accountingDate: string; moveType: unknown; journalType: unknown; hasTax: boolean },
): Promise<{ scope: PeriodLockScope; through: string } | null> {
  const policy = await policyOf(ctx)
  const revision = revisionOf(policy)
  const claimed = await ctx.db.compareAndSet(
    'account.PeriodPolicy',
    { id: policy.id },
    { revision: policy.revision },
    { revision },
  )
  if (!('dryRun' in claimed) && !claimed.matched) throw new Error('accounting period policy changed')

  const scopes: PeriodLockScope[] = ['hard', 'all']
  const moveType = String(input.moveType)
  const journalType = String(input.journalType)
  if (journalType === 'sale' || moveType.startsWith('out_')) scopes.push('sales')
  if (journalType === 'purchase' || moveType.startsWith('in_')) scopes.push('purchases')
  if (input.hasTax) scopes.push('tax')
  for (const scope of scopes) {
    const through = policy[fieldOf[scope]]
    if (through && input.accountingDate <= String(through)) return { scope, through: String(through) }
  }
  return null
}

export const periodFunctions: Record<string, FnSpec> = {
  getPeriodPolicy: defineFn({
    input: {},
    effects: ['read:account.PeriodPolicy', 'write:account.PeriodPolicy'],
    agent: true,
    handler: policyOf,
  }),
  listPeriodLockEvents: defineFn({
    input: { scope: 'text?' },
    effects: ['read:account.PeriodLockEvent'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = args.scope
        ? await ctx.db.select('account.PeriodLockEvent', { scope: args.scope })
        : await ctx.db.select('account.PeriodLockEvent')
      return rows.sort(
        (a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)),
      )
    },
  }),
  changePeriodLock: defineFn({
    input: {
      id: 'id',
      scope: 'text',
      through: 'date?',
      reason: 'text',
      expectedRevision: 'int?',
    },
    output: { ok: 'bool', revision: 'int?', errors: 'json?' },
    effects: [
      'read:account.PeriodPolicy',
      'read:account.PeriodLockEvent',
      'write:account.PeriodPolicy',
      'write:account.PeriodLockEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!PERIOD_LOCK_SCOPES.includes(args.scope as PeriodLockScope))
        return failure(issue('scope', 'periodScopeUnsupported', 'unsupported accounting lock scope'))
      if (args.through != null && !isDateText(args.through))
        return failure(issue('through', 'accountingDateInvalid', 'lock date must be a real civil date'))
      const reason = String(args.reason).trim()
      if (!reason)
        return failure(issue('reason', 'periodReasonRequired', 'a reason is required for every lock change'))
      const scope = args.scope as PeriodLockScope
      const field = fieldOf[scope]
      const existingEvent = (await ctx.db.select('account.PeriodLockEvent', { id: args.id }))[0]
      if (existingEvent) {
        const same =
          String(existingEvent.scope) === scope &&
          String(existingEvent.afterThrough ?? '') === String(args.through ?? '') &&
          String(existingEvent.reason) === reason
        return same
          ? { ok: true, revision: Number(existingEvent.policyRevision) }
          : failure(issue('id', 'periodCommandIdReused', 'this command id belongs to another lock change'))
      }
      try {
        return await ctx.tx(async (tx) => {
          const policy = await policyOf(tx)
          const revision = revisionOf(policy)
          if (args.expectedRevision != null && Number(args.expectedRevision) !== revision)
            return failure(
              issue('expectedRevision', 'periodConcurrent', 'the period policy changed; review and retry'),
            )
          const before = policy[field] == null ? null : String(policy[field])
          const after = args.through == null ? null : String(args.through)
          if (scope === 'hard' && before && (!after || after < before))
            return failure(
              issue('through', 'hardLockPermanent', 'a hard lock can only stay in place or move forward', {
                through: before,
              }),
            )
          const nextRevision = revision + 1
          const changed = await tx.db.compareAndSet(
            'account.PeriodPolicy',
            { id: policy.id },
            { revision: policy.revision },
            { [field]: after, revision: nextRevision, updatedAt: now(), updatedBy: tx.actor ?? null },
          )
          if (!('dryRun' in changed) && !changed.matched)
            return failure(
              issue('expectedRevision', 'periodConcurrent', 'the period policy changed; review and retry'),
            )
          await tx.db.insert('account.PeriodLockEvent', {
            id: args.id,
            scope,
            action: after == null || (before != null && after < before) ? 'reopen' : 'lock',
            beforeThrough: before,
            afterThrough: after,
            reason,
            actorId: tx.actor ?? null,
            policyRevision: nextRevision,
            createdAt: now(),
          })
          return { ok: true, revision: nextRevision }
        })
      } catch (error) {
        return failure(
          issue('id', 'periodConcurrent', error instanceof Error ? error.message : String(error)),
        )
      }
    },
  }),
}
