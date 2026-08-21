import { asc, defineFn, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import {
  actorId,
  cancelActivity,
  completeActivity,
  listTypes,
  rescheduleActivity,
  stateOf,
  validateActivityType,
  validatePlanStep,
} from './operations.ts'

const typeShape = {
  id: 'id',
  name: 'text',
  category: 'text',
  icon: 'text?',
  defaultDelayDays: 'int',
  chainingPolicy: 'text',
  nextTypeId: 'id?',
  sequence: 'int',
  active: 'bool',
}

const activityReadEffects = [
  'read:activity.Activity',
  'read:activity.Type',
  'read:mail.Thread',
  'read:user.User',
]

const mutationEffects = [
  ...activityReadEffects,
  'write:activity.Activity',
  'read:activity.Attachment',
  'read:storage.Attachment',
  'read:mail.Message',
  'read:mail.Follower',
  'read:mail.FollowerSubtype',
  'write:mail.Message',
  'write:mail.MessageAttachment',
  'write:mail.Notification',
]

const myActivities = async (ctx: Ctx, today: string, includeDone: boolean): Promise<Row[]> => {
  const A = ctx.table('activity.Activity')
  const T = ctx.table('activity.Type')
  const H = ctx.table('mail.Thread')
  const rows = await ctx.db.all(
    from(A)
      .where(eq(A.assigneeUserId, actorId(ctx)))
      .orderBy(asc(A.dueDate), asc(A.createdAt)),
  )
  const visible = includeDone ? rows : rows.filter((row) => row.active === true)
  const types = visible.length
    ? await ctx.db.all(from(T).where(inArray(T.id, [...new Set(visible.map((row) => row.typeId))])))
    : []
  const threads = visible.length
    ? await ctx.db.all(from(H).where(inArray(H.id, [...new Set(visible.map((row) => row.threadId))])))
    : []
  const typeById = new Map(types.map((row) => [String(row.id), row]))
  const threadById = new Map(threads.map((row) => [String(row.id), row]))
  return visible.map((row) => ({
    ...row,
    state: stateOf(row, today),
    typeName: typeById.get(String(row.typeId))?.name ?? row.typeId,
    category: typeById.get(String(row.typeId))?.category ?? 'todo',
    targetName: threadById.get(String(row.threadId))?.displayName ?? row.threadId,
    resModel: threadById.get(String(row.threadId))?.resModel ?? null,
    resId: threadById.get(String(row.threadId))?.resId ?? null,
  }))
}

export const functions: Record<string, FnSpec> = {
  listTypes: defineFn({
    output: typeShape,
    effects: ['read:activity.Type'],
    handler: listTypes,
  }),

  saveType: defineFn({
    input: typeShape,
    output: { ok: 'bool', id: 'id' },
    effects: ['read:activity.Type', 'write:activity.Type'],
    idempotent: true,
    agent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        validateActivityType({
          category: String(args.category),
          chainingPolicy: String(args.chainingPolicy),
          defaultDelayDays: Number(args.defaultDelayDays),
          nextTypeId: args.nextTypeId ? String(args.nextTypeId) : null,
        })
        const T = tx.table('activity.Type')
        const existing = await tx.db.one(from(T).where(eq(T.id, args.id)))
        if (args.nextTypeId) {
          if (args.nextTypeId === args.id) throw new Error('an activity type cannot chain directly to itself')
          if (!(await tx.db.one(from(T).where(eq(T.id, args.nextTypeId), eq(T.active, true)))))
            throw new Error(`next activity type "${String(args.nextTypeId)}" does not exist`)
        }
        const row = {
          id: args.id,
          name: String(args.name).trim(),
          category: args.category,
          ...(args.icon ? { icon: args.icon } : {}),
          defaultDelayDays: args.defaultDelayDays,
          chainingPolicy: args.chainingPolicy,
          ...(args.nextTypeId ? { nextTypeId: args.nextTypeId } : {}),
          sequence: args.sequence,
          active: args.active,
        }
        if (!row.name) throw new Error('activity type name cannot be empty')
        if (existing) await tx.db.update('activity.Type', { id: args.id }, row)
        else await tx.db.insert('activity.Type', row)
        return { ok: true, id: args.id }
      }),
  }),

  listMy: defineFn({
    input: { today: 'date', includeDone: 'bool?' },
    output: { activities: 'json' },
    effects: activityReadEffects,
    handler: async (ctx: Ctx, args) => ({
      activities: await myActivities(ctx, String(args.today), args.includeDone === true),
    }),
  }),

  countDue: defineFn({
    input: { today: 'date' },
    output: { count: 'int', overdue: 'int', today: 'int' },
    effects: ['read:activity.Activity'],
    handler: async (ctx: Ctx, args) => {
      const A = ctx.table('activity.Activity')
      const rows = await ctx.db.all(from(A).where(eq(A.assigneeUserId, actorId(ctx)), eq(A.active, true)))
      const overdue = rows.filter((row) => String(row.dueDate) < String(args.today)).length
      const today = rows.filter((row) => row.dueDate === args.today).length
      return { count: overdue + today, overdue, today }
    },
  }),

  reschedule: defineFn({
    input: { id: 'id', dueDate: 'date', note: 'text?' },
    output: { activity: 'json' },
    effects: ['read:activity.Activity', 'write:activity.Activity', 'read:user.User'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => ({
      activity: await ctx.tx((tx) =>
        rescheduleActivity(
          tx,
          String(args.id),
          String(args.dueDate),
          args.note ? String(args.note) : undefined,
        ),
      ),
    }),
  }),

  cancel: defineFn({
    input: { id: 'id', feedback: 'text?' },
    output: { activity: 'json' },
    effects: ['read:activity.Activity', 'write:activity.Activity', 'read:user.User'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => ({
      activity: await ctx.tx((tx) =>
        cancelActivity(tx, String(args.id), args.feedback ? String(args.feedback) : undefined),
      ),
    }),
  }),

  complete: defineFn({
    input: { id: 'id', feedback: 'text', completedDate: 'date' },
    output: { activity: 'json', messageId: 'id', nextActivity: 'json?' },
    effects: mutationEffects,
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx((tx) =>
        completeActivity(tx, String(args.id), String(args.feedback), String(args.completedDate)),
      ),
  }),

  listPlans: defineFn({
    output: { plans: 'json' },
    effects: ['read:activity.Plan', 'read:activity.PlanStep'],
    handler: async (ctx: Ctx) => {
      const P = ctx.table('activity.Plan')
      const S = ctx.table('activity.PlanStep')
      const plans = await ctx.db.all(from(P).where(eq(P.active, true)).orderBy(asc(P.name)))
      const steps = plans.length
        ? await ctx.db.all(
            from(S)
              .where(
                inArray(
                  S.planId,
                  plans.map((row) => row.id),
                ),
              )
              .orderBy(asc(S.sequence), asc(S.id)),
          )
        : []
      return {
        plans: plans.map((plan) => ({
          ...plan,
          steps: steps.filter((step) => step.planId === plan.id),
        })),
      }
    },
  }),

  savePlan: defineFn({
    input: { id: 'id', name: 'text', description: 'text?', active: 'bool', steps: 'json' },
    output: { ok: 'bool', id: 'id' },
    effects: [
      'read:activity.Plan',
      'write:activity.Plan',
      'read:activity.PlanStep',
      'write:activity.PlanStep',
      'read:activity.Type',
      'read:user.User',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const name = String(args.name).trim()
        if (!name) throw new Error('activity plan name cannot be empty')
        if (!Array.isArray(args.steps)) throw new Error('activity plan steps must be an array')
        const steps = args.steps.map((value, index) => {
          if (!value || typeof value !== 'object') throw new Error(`plan step ${index + 1} must be an object`)
          const step = value as Record<string, unknown>
          const row = {
            id: String(step.id ?? `${String(args.id)}:step:${index + 1}`),
            planId: String(args.id),
            typeId: String(step.typeId ?? ''),
            offsetDays: Number(step.offsetDays ?? 0),
            assigneeStrategy: String(step.assigneeStrategy ?? 'actor'),
            assigneeUserId: step.assigneeUserId ? String(step.assigneeUserId) : null,
            summary: step.summary ? String(step.summary) : null,
            note: step.note ? String(step.note) : null,
            sequence: Number(step.sequence ?? index + 1),
          }
          validatePlanStep(row)
          return row
        })
        if (new Set(steps.map((step) => step.id)).size !== steps.length)
          throw new Error('activity plan step ids must be unique')
        const typeIds = [...new Set(steps.map((step) => step.typeId))]
        const T = tx.table('activity.Type')
        const foundTypes = typeIds.length
          ? await tx.db.all(from(T).where(inArray(T.id, typeIds), eq(T.active, true)))
          : []
        if (foundTypes.length !== typeIds.length)
          throw new Error('one or more plan activity types are missing')
        const userIds = [
          ...new Set(steps.flatMap((step) => (step.assigneeUserId ? [step.assigneeUserId] : []))),
        ]
        const U = tx.table('user.User')
        const foundUsers = userIds.length
          ? await tx.db.all(from(U).where(inArray(U.id, userIds), eq(U.active, true)))
          : []
        if (foundUsers.length !== userIds.length) throw new Error('one or more plan assignees are missing')
        const P = tx.table('activity.Plan')
        const existing = await tx.db.one(from(P).where(eq(P.id, args.id)))
        const plan = {
          id: args.id,
          name,
          ...(args.description ? { description: String(args.description) } : {}),
          active: args.active,
        }
        if (existing) await tx.db.update('activity.Plan', { id: args.id }, plan)
        else await tx.db.insert('activity.Plan', plan)
        const S = tx.table('activity.PlanStep')
        await tx.db.del(deleteFrom(S).where(eq(S.planId, args.id)))
        for (const step of steps)
          await tx.db.insert('activity.PlanStep', {
            ...step,
            ...(step.assigneeUserId ? { assigneeUserId: step.assigneeUserId } : {}),
            ...(step.summary ? { summary: step.summary } : {}),
            ...(step.note ? { note: step.note } : {}),
          })
        return { ok: true, id: args.id }
      }),
  }),
}
