import { asc, defineFn, desc, eq, from, inArray } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { ensureThread } from '../mail/index.ts'
import type { TargetBridge } from '../mail/index.ts'
import { actorId, addDays, scheduleActivity, stateOf, validatePlanStep } from './operations.ts'

const threadFor = async (ctx: Ctx, bridge: TargetBridge, targetId: string): Promise<Row | null> => {
  const T = ctx.table('mail.Thread')
  return ctx.db.one(from(T).where(eq(T.resModel, bridge.resModel), eq(T.resId, targetId), eq(T.active, true)))
}

const ensureTargetThread = async (
  ctx: Ctx,
  bridge: TargetBridge,
  target: { id: string; displayName: string },
): Promise<Row> =>
  ensureThread(ctx, {
    id: `thread:${bridge.resModel}:${target.id}`,
    resModel: bridge.resModel,
    resId: target.id,
    displayName: target.displayName,
  })

const listForThread = async (ctx: Ctx, threadId: string, today: string): Promise<Row[]> => {
  const A = ctx.table('activity.Activity')
  const T = ctx.table('activity.Type')
  const U = ctx.table('user.User')
  const AA = ctx.table('activity.Attachment')
  const S = ctx.table('storage.Attachment')
  const rows = await ctx.db.all(
    from(A).where(eq(A.threadId, threadId)).orderBy(desc(A.active), asc(A.dueDate), asc(A.createdAt)),
  )
  const types = rows.length
    ? await ctx.db.all(from(T).where(inArray(T.id, [...new Set(rows.map((row) => row.typeId))])))
    : []
  const users = rows.length
    ? await ctx.db.all(from(U).where(inArray(U.id, [...new Set(rows.map((row) => row.assigneeUserId))])))
    : []
  const joins = rows.length
    ? await ctx.db.all(
        from(AA).where(
          inArray(
            AA.activityId,
            rows.map((row) => row.id),
          ),
        ),
      )
    : []
  const attachments = joins.length
    ? await ctx.db.all(from(S).where(inArray(S.id, [...new Set(joins.map((row) => row.attachmentId))])))
    : []
  const typeById = new Map(types.map((row) => [String(row.id), row]))
  const userById = new Map(users.map((row) => [String(row.id), row]))
  const attachmentById = new Map(attachments.map((row) => [String(row.id), row]))
  return rows.map((row) => ({
    ...row,
    state: stateOf(row, today),
    typeName: typeById.get(String(row.typeId))?.name ?? row.typeId,
    category: typeById.get(String(row.typeId))?.category ?? 'todo',
    assigneeName: userById.get(String(row.assigneeUserId))?.name ?? row.assigneeUserId,
    attachments: joins
      .filter((join) => join.activityId === row.id)
      .flatMap((join) => {
        const attachment = attachmentById.get(String(join.attachmentId))
        return attachment
          ? [{ id: attachment.id, name: attachment.name, href: `/files/${String(attachment.id)}` }]
          : []
      }),
  }))
}

const readEffects = (target: string): string[] => [
  target,
  'read:mail.Thread',
  'read:activity.Activity',
  'read:activity.Type',
  'read:activity.Attachment',
  'read:user.User',
  'read:storage.Attachment',
]

const scheduleEffects = (target: string): string[] => [
  ...readEffects(target),
  'write:mail.Thread',
  'write:activity.Activity',
  'write:activity.Attachment',
]

export function targetActivityFunctions(bridge: TargetBridge): Record<string, FnSpec> {
  return {
    list: defineFn({
      input: { targetId: 'id', today: 'date' },
      output: { activities: 'json', threadId: 'id?' },
      effects: readEffects(bridge.targetEffect),
      handler: async (ctx: Ctx, args) => {
        const target = await bridge.verify(ctx, String(args.targetId))
        const thread = await threadFor(ctx, bridge, target.id)
        return {
          threadId: thread?.id ?? null,
          activities: thread ? await listForThread(ctx, String(thread.id), String(args.today)) : [],
        }
      },
    }),

    schedule: defineFn({
      input: {
        id: 'id',
        targetId: 'id',
        typeId: 'id',
        assigneeUserId: 'id?',
        summary: 'text',
        note: 'text?',
        dueDate: 'date',
        attachmentIds: 'json?',
      },
      output: { activity: 'json' },
      effects: scheduleEffects(bridge.targetEffect),
      idempotent: true,
      handler: (ctx: Ctx, args) =>
        ctx.tx(async (tx) => {
          const target = await bridge.verify(tx, String(args.targetId))
          const thread = await ensureTargetThread(tx, bridge, target)
          return {
            activity: await scheduleActivity(tx, {
              id: String(args.id),
              threadId: String(thread.id),
              typeId: String(args.typeId),
              assigneeUserId: args.assigneeUserId ? String(args.assigneeUserId) : actorId(tx),
              summary: String(args.summary),
              note: args.note ? String(args.note) : undefined,
              dueDate: String(args.dueDate),
              attachmentIds: Array.isArray(args.attachmentIds) ? args.attachmentIds.map(String) : [],
            }),
          }
        }),
    }),

    applyPlan: defineFn({
      input: { targetId: 'id', planId: 'id', startDate: 'date', requestId: 'id' },
      output: { activities: 'json' },
      effects: [...scheduleEffects(bridge.targetEffect), 'read:activity.Plan', 'read:activity.PlanStep'],
      idempotent: true,
      handler: (ctx: Ctx, args) =>
        ctx.tx(async (tx) => {
          const target = await bridge.verify(tx, String(args.targetId))
          const thread = await ensureTargetThread(tx, bridge, target)
          const P = tx.table('activity.Plan')
          const plan = await tx.db.one(from(P).where(eq(P.id, args.planId), eq(P.active, true)))
          if (!plan) throw new Error(`activity plan "${String(args.planId)}" does not exist`)
          const S = tx.table('activity.PlanStep')
          const steps = await tx.db.all(
            from(S).where(eq(S.planId, args.planId)).orderBy(asc(S.sequence), asc(S.id)),
          )
          const activities: Row[] = []
          for (const step of steps) {
            validatePlanStep({
              assigneeStrategy: String(step.assigneeStrategy),
              assigneeUserId: step.assigneeUserId ? String(step.assigneeUserId) : null,
              offsetDays: Number(step.offsetDays),
            })
            activities.push(
              await scheduleActivity(tx, {
                id: `${String(args.requestId)}:${String(step.id)}`,
                threadId: String(thread.id),
                typeId: String(step.typeId),
                assigneeUserId:
                  step.assigneeStrategy === 'specific' ? String(step.assigneeUserId) : actorId(tx),
                summary: String(step.summary || plan.name),
                note: step.note ? String(step.note) : undefined,
                dueDate: addDays(String(args.startDate), Number(step.offsetDays)),
              }),
            )
          }
          return { activities }
        }),
    }),
  }
}
