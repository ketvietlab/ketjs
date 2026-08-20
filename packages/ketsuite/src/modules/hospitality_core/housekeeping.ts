import { asc, defineFn, desc, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import {
  CLEANING_TASK_PRIORITIES,
  CLEANING_TASK_STATES,
  CLEANING_TASK_TYPES,
  ROOM_STATUSES,
} from './types.ts'

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

const housekeepingRoomOutput = {
  id: 'id',
  propertyId: 'id',
  roomTypeId: 'id',
  buildingId: 'id?',
  floorId: 'id?',
  code: 'text',
  name: 'text',
  capacity: 'int',
  status: 'text',
  note: 'text?',
  active: 'bool',
  property: 'json?',
  roomType: 'json?',
  building: 'json?',
  floor: 'json?',
  currentStay: 'json?',
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
      if (!includes(CLEANING_TASK_TYPES, args.taskType)) return failure(issue('taskType', 'cleaning_type'))
      const priority = args.priority ?? 'normal'
      if (!includes(CLEANING_TASK_PRIORITIES, priority))
        return failure(issue('priority', 'cleaning_priority'))
      return ctx.tx(async (tx) => {
        const existing = await record(tx, 'hospitality_core.CleaningTask', args.id)
        if (existing) return success(existing.id, { state: existing.state })
        const room = await record(tx, 'hospitality_core.Room', args.roomId)
        if (!room) return failure(issue('roomId', 'room_missing'))
        const locked = await tx.db.compareAndSet(
          'hospitality_core.Room',
          { id: room.id },
          { status: room.status },
          { status: room.status },
        )
        if (!('matched' in locked) || !locked.matched) return failure(issue('roomId', 'transition_conflict'))
        const outOfService = room.status === 'maintenance' || room.status === 'out_of_order'
        if ((args.taskType === 'maintenance') !== outOfService)
          return failure(issue('taskType', 'cleaning_room_status'))
        if (args.stayId) {
          const stay = await record(tx, 'hospitality_core.Stay', args.stayId)
          if (!stay) return failure(issue('stayId', 'stay_missing'))
          if (stay.propertyId !== room.propertyId) return failure(issue('stayId', 'property_mismatch'))
        }
        await tx.db.insert('hospitality_core.CleaningTask', {
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
      })
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

  getHousekeepingRoom: defineFn({
    input: { id: 'id' },
    output: housekeepingRoomOutput,
    effects: [
      'read:hospitality_core.Room',
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
      'read:hospitality_core.Stay',
      'read:partner.Partner',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const R = ctx.table('hospitality_core.Room')
      const room = await ctx.db.one(
        from(R).where(eq(R.id, args.id)).preload('property', 'roomType', 'building', 'floor'),
      )
      if (!room) return null
      const S = ctx.table('hospitality_core.Stay')
      const currentStay = await ctx.db.one(
        from(S).where(eq(S.currentRoomId, args.id), eq(S.state, 'checked_in')).preload('partner').limit(1),
      )
      return { ...room, currentStay }
    },
  }),

  roomStatusSummary: defineFn({
    input: { propertyId: 'id' },
    output: {
      available: 'int',
      occupied: 'int',
      dirty: 'int',
      cleaning: 'int',
      maintenance: 'int',
      outOfOrder: 'int',
    },
    effects: ['read:hospitality_core.Room'],
    agent: true,
    handler: async (ctx, args) => {
      const R = ctx.table('hospitality_core.Room')
      const grouped = await ctx.db.group(
        from(R).where(eq(R.propertyId, args.propertyId), eq(R.active, true)).groupBy({ col: R.status }),
      )
      const counts = Object.fromEntries(ROOM_STATUSES.map((status) => [status, 0])) as Record<string, number>
      for (const row of grouped) counts[String(row.key[0])] = row.count
      return {
        available: counts.available ?? 0,
        occupied: counts.occupied ?? 0,
        dirty: counts.dirty ?? 0,
        cleaning: counts.cleaning ?? 0,
        maintenance: counts.maintenance ?? 0,
        outOfOrder: counts.out_of_order ?? 0,
      }
    },
  }),

  listCleaningTasks: defineFn({
    input: { propertyId: 'id?', roomId: 'id?', state: 'text?', assigneeId: 'id?', limit: 'int?' },
    output: taskOutput,
    effects: ['read:hospitality_core.CleaningTask', 'read:hospitality_core.Room'],
    agent: true,
    handler: async (ctx, args) => {
      const T = ctx.table('hospitality_core.CleaningTask')
      let query = from(T).preload('room')
      if (args.propertyId) query = query.where(eq(T.propertyId, args.propertyId))
      if (args.roomId) query = query.where(eq(T.roomId, args.roomId))
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
