import { asc, defineFn, desc, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { CLEANING_TASK_PRIORITIES, CLEANING_TASK_STATES, CLEANING_TASK_TYPES } from './types.ts'

type Issue = { field: string; code: string; messageKey: string }
const issue = (field: string, code: string): Issue => ({
  field,
  code,
  messageKey: `hospitality_core.validation.${code}`,
})
const success = (id: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true,
  id: String(id),
  errors: [],
  ...extra,
})
const failure = (...errors: Issue[]): { ok: false; errors: Issue[] } => ({ ok: false, errors })
const includes = (values: readonly string[], value: unknown) => values.includes(String(value))
const record = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> => {
  const table = ctx.table(model)
  return ctx.db.one(from(table).where(eq(table.id, id)))
}

class TransitionConflict extends Error {
  readonly problem: Issue

  constructor(problem: Issue) {
    super(problem.code)
    this.problem = problem
  }
}

const transition = async <T>(run: () => Promise<T>): Promise<T | { ok: false; errors: Issue[] }> => {
  try {
    return await run()
  } catch (error) {
    if (error instanceof TransitionConflict) return failure(error.problem)
    throw error
  }
}

const taskEffects = [
  'read:hospitality_core.CleaningTask',
  'read:hospitality_core.Room',
  'write:hospitality_core.CleaningTask',
  'write:hospitality_core.Room',
]

const taskOutput = {
  id: 'id',
  code: 'text',
  propertyId: 'id',
  roomId: 'id',
  stayId: 'id?',
  taskType: 'text',
  priority: 'text',
  state: 'text',
  assigneeId: 'id?',
  requestedAt: 'datetime',
  startedAt: 'datetime?',
  doneAt: 'datetime?',
  notes: 'text?',
  room: 'json?',
}

const taskDetailOutput = {
  ...taskOutput,
  property: 'json?',
  stay: 'json?',
}

export const housekeeping: Record<string, FnSpec> = {
  createCleaningTask: defineFn({
    input: {
      id: 'id',
      code: 'text',
      roomId: 'id',
      stayId: 'id?',
      taskType: 'text',
      priority: 'text?',
      assigneeId: 'id?',
      requestedAt: 'datetime?',
      notes: 'text?',
    },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: [...taskEffects, 'read:hospitality_core.Stay'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = await record(ctx, 'hospitality_core.CleaningTask', args.id)
      if (existing) return success(existing.id, { state: existing.state })
      const room = await record(ctx, 'hospitality_core.Room', args.roomId)
      if (!room) return failure(issue('roomId', 'room_missing'))
      if (!includes(CLEANING_TASK_TYPES, args.taskType)) return failure(issue('taskType', 'cleaning_type'))
      const priority = args.priority ?? 'normal'
      if (!includes(CLEANING_TASK_PRIORITIES, priority))
        return failure(issue('priority', 'cleaning_priority'))
      if (args.stayId) {
        const stay = await record(ctx, 'hospitality_core.Stay', args.stayId)
        if (!stay) return failure(issue('stayId', 'stay_missing'))
        if (stay.propertyId !== room.propertyId) return failure(issue('stayId', 'property_mismatch'))
      }
      await ctx.db.insert('hospitality_core.CleaningTask', {
        id: args.id,
        code: args.code,
        propertyId: room.propertyId,
        roomId: room.id,
        stayId: args.stayId,
        taskType: args.taskType,
        priority,
        state: 'todo',
        assigneeId: args.assigneeId,
        requestedAt: args.requestedAt ?? new Date().toISOString(),
        notes: args.notes,
      })
      return success(args.id, { state: 'todo' })
    },
  }),

  getCleaningTask: defineFn({
    input: { id: 'id' },
    output: taskDetailOutput,
    effects: [
      'read:hospitality_core.CleaningTask',
      'read:hospitality_core.Property',
      'read:hospitality_core.Room',
      'read:hospitality_core.Stay',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const T = ctx.table('hospitality_core.CleaningTask')
      return ctx.db.one(from(T).where(eq(T.id, args.id)).preload('property').preload('room').preload('stay'))
    },
  }),

  cleaningTaskSummary: defineFn({
    input: { propertyId: 'id' },
    output: { todo: 'int', inProgress: 'int', done: 'int', cancelled: 'int' },
    effects: ['read:hospitality_core.CleaningTask'],
    agent: true,
    handler: async (ctx, args) => {
      const T = ctx.table('hospitality_core.CleaningTask')
      const count = (state: string) =>
        ctx.db.count(from(T).where(eq(T.propertyId, args.propertyId), eq(T.state, state)))
      const [todo, inProgress, done, cancelled] = await Promise.all([
        count('todo'),
        count('in_progress'),
        count('done'),
        count('cancelled'),
      ])
      return { todo, inProgress, done, cancelled }
    },
  }),

  listCleaningTasks: defineFn({
    input: { propertyId: 'id?', state: 'text?', assigneeId: 'id?', limit: 'int?' },
    output: taskOutput,
    effects: ['read:hospitality_core.CleaningTask', 'read:hospitality_core.Room'],
    agent: true,
    handler: async (ctx, args) => {
      const T = ctx.table('hospitality_core.CleaningTask')
      let query = from(T).preload('room')
      if (args.propertyId) query = query.where(eq(T.propertyId, args.propertyId))
      if (args.state) query = query.where(eq(T.state, args.state))
      if (args.assigneeId) query = query.where(eq(T.assigneeId, args.assigneeId))
      query =
        args.state === 'todo' || args.state === 'in_progress'
          ? query.orderBy(desc(T.priority), asc(T.requestedAt))
          : query.orderBy(desc(T.requestedAt))
      return ctx.db.all(query.limit(Math.max(1, Math.min(500, Number(args.limit ?? 100)))))
    },
  }),

  startCleaningTask: defineFn({
    input: { id: 'id', assigneeId: 'id?', at: 'datetime?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: taskEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const task = await record(ctx, 'hospitality_core.CleaningTask', args.id)
      if (!task) return failure(issue('id', 'cleaning_task_missing'))
      if (task.state === 'in_progress') return success(task.id, { state: task.state })
      if (task.state !== 'todo') return failure(issue('state', 'cleaning_cannot_start'))
      const room = await record(ctx, 'hospitality_core.Room', task.roomId)
      if (!room) return failure(issue('roomId', 'room_missing'))
      const at = args.at ?? new Date().toISOString()
      return transition(() =>
        ctx.tx(async (tx) => {
          if (room.status === 'dirty' || room.status === 'available' || room.status === 'cleaning') {
            const roomClaim = await tx.db.compareAndSet(
              'hospitality_core.Room',
              { id: room.id },
              { status: room.status },
              { status: 'cleaning' },
            )
            if (!('matched' in roomClaim) || !roomClaim.matched)
              throw new TransitionConflict(issue('roomId', 'transition_conflict'))
          }
          const claimed = await tx.db.compareAndSet(
            'hospitality_core.CleaningTask',
            { id: task.id },
            { state: 'todo' },
            { state: 'in_progress', startedAt: at, assigneeId: args.assigneeId ?? task.assigneeId },
          )
          if (!('matched' in claimed) || !claimed.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))
          return success(task.id, { state: 'in_progress' })
        }),
      )
    },
  }),

  completeCleaningTask: defineFn({
    input: { id: 'id', at: 'datetime?' },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: taskEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const task = await record(ctx, 'hospitality_core.CleaningTask', args.id)
      if (!task) return failure(issue('id', 'cleaning_task_missing'))
      if (task.state === 'done') return success(task.id, { state: task.state })
      if (task.state !== 'in_progress') return failure(issue('state', 'cleaning_cannot_complete'))
      return transition(() =>
        ctx.tx(async (tx) => {
          const room = await record(tx, 'hospitality_core.Room', task.roomId)
          if (room?.status === 'cleaning') {
            const roomClaim = await tx.db.compareAndSet(
              'hospitality_core.Room',
              { id: task.roomId },
              { status: 'cleaning' },
              { status: 'cleaning' },
            )
            if (!('matched' in roomClaim) || !roomClaim.matched)
              throw new TransitionConflict(issue('roomId', 'transition_conflict'))
          }
          const claimed = await tx.db.compareAndSet(
            'hospitality_core.CleaningTask',
            { id: task.id },
            { state: 'in_progress' },
            { state: 'done', doneAt: args.at ?? new Date().toISOString() },
          )
          if (!('matched' in claimed) || !claimed.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))
          if (room?.status === 'cleaning') {
            const T = tx.table('hospitality_core.CleaningTask')
            const active = await tx.db.all(
              from(T).where(eq(T.roomId, task.roomId), eq(T.state, 'in_progress')),
            )
            if (!active.length)
              await tx.db.update('hospitality_core.Room', { id: task.roomId }, { status: 'available' })
          }
          return success(task.id, { state: 'done' })
        }),
      )
    },
  }),

  cancelCleaningTask: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', state: 'text?', errors: 'json?' },
    effects: taskEffects,
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const task = await record(ctx, 'hospitality_core.CleaningTask', args.id)
      if (!task) return failure(issue('id', 'cleaning_task_missing'))
      if (task.state === 'cancelled') return success(task.id, { state: task.state })
      if (!CLEANING_TASK_STATES.slice(0, 2).includes(task.state as 'todo' | 'in_progress'))
        return failure(issue('state', 'cleaning_cannot_cancel'))
      return transition(() =>
        ctx.tx(async (tx) => {
          const room = await record(tx, 'hospitality_core.Room', task.roomId)
          if (room?.status === 'cleaning') {
            const roomClaim = await tx.db.compareAndSet(
              'hospitality_core.Room',
              { id: task.roomId },
              { status: 'cleaning' },
              { status: 'cleaning' },
            )
            if (!('matched' in roomClaim) || !roomClaim.matched)
              throw new TransitionConflict(issue('roomId', 'transition_conflict'))
          }
          const claimed = await tx.db.compareAndSet(
            'hospitality_core.CleaningTask',
            { id: task.id },
            { state: task.state },
            { state: 'cancelled' },
          )
          if (!('matched' in claimed) || !claimed.matched)
            throw new TransitionConflict(issue('state', 'transition_conflict'))
          if (room?.status === 'cleaning') {
            const T = tx.table('hospitality_core.CleaningTask')
            const active = await tx.db.all(
              from(T).where(eq(T.roomId, task.roomId), eq(T.state, 'in_progress')),
            )
            if (!active.length)
              await tx.db.update('hospitality_core.Room', { id: task.roomId }, { status: 'dirty' })
          }
          return success(task.id, { state: 'cancelled' })
        }),
      )
    },
  }),
}
