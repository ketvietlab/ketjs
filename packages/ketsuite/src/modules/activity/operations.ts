import { asc, eq, from, inArray, KetError } from 'ketjs'
import type { Ctx, Row } from 'ketjs'
import { postMessage } from '../mail/index.ts'
import { ACTIVITY_CATEGORIES, ASSIGNEE_STRATEGIES, CHAINING_POLICIES } from './types.ts'
import type { ActivityState } from './types.ts'

const activityError = (code: string, message: string, hint?: string): never => {
  throw new KetError({ code, module: 'activity', message, ...(hint ? { hint } : {}) })
}

export const actorId = (ctx: Ctx): string => {
  const actor = ctx.actor
  if (!actor)
    return activityError('E_ACTIVITY_ACTOR_REQUIRED', 'activity operations require a signed-in user')
  return actor
}

export const addDays = (date: string, days: number): string => {
  const instant = new Date(`${date}T00:00:00.000Z`)
  instant.setUTCDate(instant.getUTCDate() + days)
  return instant.toISOString().slice(0, 10)
}

export const stateOf = (activity: Row, today: string): ActivityState => {
  if (activity.doneAt) return 'done'
  if (activity.canceledAt) return 'canceled'
  if (String(activity.dueDate) < today) return 'overdue'
  if (String(activity.dueDate) === today) return 'today'
  return 'planned'
}

const activeUser = async (ctx: Ctx, id: string): Promise<Row> => {
  const U = ctx.table('user.User')
  const user = await ctx.db.one(from(U).where(eq(U.id, id), eq(U.active, true)))
  if (!user) return activityError('E_ACTIVITY_ASSIGNEE', `no active user "${id}"`)
  return user
}

const activeType = async (ctx: Ctx, id: string): Promise<Row> => {
  const T = ctx.table('activity.Type')
  const type = await ctx.db.one(from(T).where(eq(T.id, id), eq(T.active, true)))
  if (!type) return activityError('E_ACTIVITY_TYPE', `no active activity type "${id}"`)
  return type
}

const activeThread = async (ctx: Ctx, id: string): Promise<Row> => {
  const T = ctx.table('mail.Thread')
  const thread = await ctx.db.one(from(T).where(eq(T.id, id), eq(T.active, true)))
  if (!thread) return activityError('E_ACTIVITY_THREAD', `no active collaboration thread "${id}"`)
  return thread
}

const validText = (summary: string, note?: string): void => {
  if (!summary.trim()) activityError('E_ACTIVITY_SUMMARY', 'activity summary cannot be empty')
  if (summary.length > 500) activityError('E_ACTIVITY_SUMMARY', 'activity summary exceeds 500 characters')
  if ((note?.length ?? 0) > 100_000)
    activityError('E_ACTIVITY_NOTE', 'activity note exceeds 100000 characters')
}

export type ScheduleActivityInput = {
  id: string
  threadId: string
  typeId: string
  assigneeUserId: string
  summary: string
  note?: string
  dueDate: string
  attachmentIds?: string[]
  previousActivityId?: string
  createdAt?: string
}

export async function scheduleActivity(ctx: Ctx, input: ScheduleActivityInput): Promise<Row> {
  validText(input.summary, input.note)
  await activeThread(ctx, input.threadId)
  await activeType(ctx, input.typeId)
  await activeUser(ctx, input.assigneeUserId)
  const A = ctx.table('activity.Activity')
  const existing = await ctx.db.one(from(A).where(eq(A.id, input.id)))
  if (existing) {
    if (
      existing.threadId !== input.threadId ||
      existing.typeId !== input.typeId ||
      existing.assigneeUserId !== input.assigneeUserId ||
      existing.dueDate !== input.dueDate ||
      existing.summary !== input.summary
    )
      activityError(
        'E_ACTIVITY_IDEMPOTENCY_CONFLICT',
        `activity id "${input.id}" was already used for different content`,
      )
    return existing
  }
  if (input.previousActivityId) {
    const previous = await ctx.db.one(from(A).where(eq(A.id, input.previousActivityId)))
    if (!previous || previous.threadId !== input.threadId)
      activityError('E_ACTIVITY_PREVIOUS', 'the previous activity is missing or belongs to another thread')
  }
  const attachmentIds = [...new Set(input.attachmentIds ?? [])]
  if (attachmentIds.length) {
    const S = ctx.table('storage.Attachment')
    const found = await ctx.db.all(from(S).select(S.id).where(inArray(S.id, attachmentIds)))
    if (found.length !== attachmentIds.length)
      activityError('E_ACTIVITY_ATTACHMENT', 'one or more activity attachments are missing in this company')
  }
  const now = input.createdAt ?? new Date().toISOString()
  const activity: Row = {
    id: input.id,
    threadId: input.threadId,
    typeId: input.typeId,
    assigneeUserId: input.assigneeUserId,
    createdByUserId: actorId(ctx),
    summary: input.summary.trim(),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    dueDate: input.dueDate,
    active: true,
    ...(input.previousActivityId ? { previousActivityId: input.previousActivityId } : {}),
    createdAt: now,
    updatedAt: now,
  }
  await ctx.db.insert('activity.Activity', activity)
  for (const attachmentId of attachmentIds)
    await ctx.db.insert('activity.Attachment', {
      id: `${input.id}:${attachmentId}`,
      activityId: input.id,
      attachmentId,
    })
  return activity
}

const ownedActivity = async (ctx: Ctx, activityId: string, allowManager: boolean): Promise<Row> => {
  const A = ctx.table('activity.Activity')
  const activity = await ctx.db.one(from(A).where(eq(A.id, activityId)))
  if (!activity) return activityError('E_ACTIVITY_NOT_FOUND', `no activity "${activityId}" in this company`)
  const actor = actorId(ctx)
  if (activity.assigneeUserId !== actor) {
    const U = ctx.table('user.User')
    const user = await ctx.db.one(from(U).where(eq(U.id, actor), eq(U.active, true)))
    if (!allowManager || user?.superuser !== true)
      activityError(
        'E_ACTIVITY_AUTHORITY',
        'only the assignee or an explicitly privileged manager may change this activity',
      )
  }
  return activity
}

export async function rescheduleActivity(
  ctx: Ctx,
  activityId: string,
  dueDate: string,
  note?: string,
): Promise<Row> {
  const activity = await ownedActivity(ctx, activityId, true)
  if (!activity.active || activity.doneAt || activity.canceledAt)
    activityError('E_ACTIVITY_CLOSED', 'a completed or canceled activity cannot be rescheduled')
  if ((note?.length ?? 0) > 100_000)
    activityError('E_ACTIVITY_NOTE', 'activity note exceeds 100000 characters')
  const values = {
    dueDate,
    ...(note === undefined ? {} : { note: note.trim() || null }),
    updatedAt: new Date().toISOString(),
  }
  await ctx.db.update('activity.Activity', { id: activityId }, values)
  return { ...activity, ...values }
}

export async function cancelActivity(ctx: Ctx, activityId: string, feedback?: string): Promise<Row> {
  const activity = await ownedActivity(ctx, activityId, true)
  if (activity.doneAt) activityError('E_ACTIVITY_CLOSED', 'a completed activity cannot be canceled')
  if (activity.canceledAt) return activity
  const now = new Date().toISOString()
  const values = {
    active: false,
    canceledAt: now,
    ...(feedback?.trim() ? { feedback: feedback.trim() } : {}),
    updatedAt: now,
  }
  await ctx.db.update('activity.Activity', { id: activityId }, values)
  return { ...activity, ...values }
}

export type CompleteActivityResult = { activity: Row; messageId: string; nextActivity: Row | null }

export async function completeActivity(
  ctx: Ctx,
  activityId: string,
  feedback: string,
  completedDate: string,
): Promise<CompleteActivityResult> {
  const activity = await ownedActivity(ctx, activityId, true)
  const messageId = `activity:${activityId}:done`
  if (activity.doneAt) {
    const A = ctx.table('activity.Activity')
    const next = await ctx.db.one(from(A).where(eq(A.previousActivityId, activityId)))
    return { activity, messageId, nextActivity: next }
  }
  if (activity.canceledAt) activityError('E_ACTIVITY_CLOSED', 'a canceled activity cannot be completed')
  const type = await activeType(ctx, String(activity.typeId))
  const AA = ctx.table('activity.Attachment')
  const joins = await ctx.db.all(from(AA).where(eq(AA.activityId, activityId)))
  const attachmentIds = joins.map((row) => String(row.attachmentId))
  const body = feedback.trim()
    ? `Hoàn tất: ${String(activity.summary)}\n${feedback.trim()}`
    : `Hoàn tất: ${String(activity.summary)}`
  await postMessage(ctx, {
    id: messageId,
    threadId: String(activity.threadId),
    authorUserId: actorId(ctx),
    kind: 'system',
    body,
    attachmentIds,
  })
  const now = new Date().toISOString()
  const values = {
    active: false,
    doneAt: now,
    feedback: feedback.trim() || null,
    updatedAt: now,
  }
  await ctx.db.update('activity.Activity', { id: activityId }, values)
  const completed = { ...activity, ...values }
  let nextActivity: Row | null = null
  if (type.chainingPolicy === 'trigger' && type.nextTypeId) {
    const nextType = await activeType(ctx, String(type.nextTypeId))
    nextActivity = await scheduleActivity(ctx, {
      id: `activity:${activityId}:next:${String(nextType.id)}`,
      threadId: String(activity.threadId),
      typeId: String(nextType.id),
      assigneeUserId: String(activity.assigneeUserId),
      summary: String(nextType.name),
      dueDate: addDays(completedDate, Number(nextType.defaultDelayDays)),
      previousActivityId: activityId,
      createdAt: now,
    })
  }
  return { activity: completed, messageId, nextActivity }
}

export const validateActivityType = (row: {
  category: string
  chainingPolicy: string
  defaultDelayDays: number
  nextTypeId?: string | null
}): void => {
  if (!ACTIVITY_CATEGORIES.includes(row.category as never))
    activityError('E_ACTIVITY_CATEGORY', `unknown activity category "${row.category}"`)
  if (!CHAINING_POLICIES.includes(row.chainingPolicy as never))
    activityError('E_ACTIVITY_CHAINING', `unknown chaining policy "${row.chainingPolicy}"`)
  if (!Number.isInteger(row.defaultDelayDays) || row.defaultDelayDays < 0)
    activityError('E_ACTIVITY_DELAY', 'default delay must be a non-negative whole number')
  if (row.chainingPolicy === 'none' && row.nextTypeId)
    activityError('E_ACTIVITY_CHAINING', 'a non-chaining type cannot name a next type')
}

export const validatePlanStep = (row: {
  assigneeStrategy: string
  assigneeUserId?: string | null
  offsetDays: number
}): void => {
  if (!ASSIGNEE_STRATEGIES.includes(row.assigneeStrategy as never))
    activityError('E_ACTIVITY_ASSIGNEE_STRATEGY', `unknown assignee strategy "${row.assigneeStrategy}"`)
  if (row.assigneeStrategy === 'specific' && !row.assigneeUserId)
    activityError('E_ACTIVITY_ASSIGNEE_STRATEGY', 'a specific plan step requires an assignee')
  if (!Number.isInteger(row.offsetDays))
    activityError('E_ACTIVITY_PLAN_OFFSET', 'plan offset must be a whole number')
}

export const listTypes = async (ctx: Ctx): Promise<Row[]> => {
  const T = ctx.table('activity.Type')
  return ctx.db.all(from(T).where(eq(T.active, true)).orderBy(asc(T.sequence), asc(T.name)))
}
