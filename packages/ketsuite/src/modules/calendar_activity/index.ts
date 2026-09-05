import { defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, RelationDef, Row } from '@ketvietlab/ketjs'
import { cancelActivity } from '../activity/index.ts'
import { saveEvent } from '../calendar/index.ts'
import { datePartsIn } from '../calendar/index.ts'

const eventEffects = [
  'read:calendar.Event',
  'write:calendar.Event',
  'read:calendar.Recurrence',
  'write:calendar.Recurrence',
  'read:calendar.Attendee',
  'write:calendar.Attendee',
  'read:calendar.Reminder',
  'write:calendar.Reminder',
  'read:calendar.Tag',
  'read:calendar.EventTag',
  'write:calendar.EventTag',
  'read:user.User',
  'read:partner.Partner',
  'read:mail.Thread',
  'write:mail.Thread',
  'read:mail.Message',
  'write:mail.Message',
  'read:mail.Subtype',
  'read:mail.Follower',
  'write:mail.Follower',
  'write:mail.FollowerSubtype',
  'read:mail.FollowerSubtype',
  'write:mail.Mention',
  'read:storage.Attachment',
  'write:mail.MessageAttachment',
  'write:mail.TrackingValue',
  'write:mail.Notification',
  'enqueue:calendar.remind',
]

const activityFor = async (ctx: Ctx, id: string): Promise<Row> => {
  const A = ctx.table('activity.Activity')
  const activity = await ctx.db.one(from(A).where(eq(A.id, id)))
  if (!activity)
    throw new KetError({
      code: 'E_CALENDAR_ACTIVITY',
      module: 'calendar_activity',
      message: 'activity is missing',
    })
  if (!activity.active)
    throw new KetError({
      code: 'E_CALENDAR_ACTIVITY_CLOSED',
      module: 'calendar_activity',
      message: 'activity is closed',
    })
  return activity
}

const localDate = (startAt: string, timezone: string): string => {
  const local = datePartsIn(startAt, timezone)
  return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`
}

const stringArray = (value: unknown): string[] | undefined => {
  if (value == null) return undefined
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : undefined
  } catch {
    return undefined
  }
}

const functions: Record<string, FnSpec> = {
  createMeeting: {
    input: {
      activityId: 'id',
      eventId: 'id',
      name: 'text',
      startAt: 'datetime',
      stopAt: 'datetime',
      timezone: 'text',
      location: 'text?',
      attendees: 'json?',
      reminders: 'json?',
    },
    output: { activityId: 'id', eventId: 'id', dueDate: 'date' },
    effects: ['read:activity.Activity', 'read:activity.Type', 'write:activity.Activity', ...eventEffects],
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const activity = await activityFor(tx, String(args.activityId))
        const T = tx.table('activity.Type')
        const type = await tx.db.one(from(T).where(eq(T.id, activity.typeId)))
        if (type?.category !== 'meeting')
          throw new KetError({
            code: 'E_CALENDAR_ACTIVITY_TYPE',
            module: 'calendar_activity',
            message: 'only a Meeting activity can create a calendar event',
          })
        if (activity.calendarEventId && activity.calendarEventId !== args.eventId)
          throw new KetError({
            code: 'E_CALENDAR_ACTIVITY_LINK',
            module: 'calendar_activity',
            message: 'activity is already linked to another event',
          })
        await saveEvent(tx, {
          id: String(args.eventId),
          name: String(args.name),
          location: args.location ? String(args.location) : undefined,
          allDay: false,
          startAt: String(args.startAt),
          stopAt: String(args.stopAt),
          timezone: String(args.timezone),
          privacy: 'public',
          attendees: Array.isArray(args.attendees) ? args.attendees : [],
          reminders: Array.isArray(args.reminders) ? args.reminders : [],
        })
        const dueDate = localDate(String(args.startAt), String(args.timezone))
        await tx.db.update(
          'activity.Activity',
          { id: args.activityId },
          { calendarEventId: args.eventId, dueDate, updatedAt: new Date().toISOString() },
        )
        return { activityId: args.activityId, eventId: args.eventId, dueDate }
      }),
  },

  rescheduleMeeting: {
    input: { activityId: 'id', startAt: 'datetime', stopAt: 'datetime', timezone: 'text' },
    output: { activityId: 'id', eventId: 'id', dueDate: 'date', version: 'int' },
    effects: ['read:activity.Activity', 'write:activity.Activity', ...eventEffects],
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const activity = await activityFor(tx, String(args.activityId))
        if (!activity.calendarEventId)
          throw new KetError({
            code: 'E_CALENDAR_ACTIVITY_LINK',
            module: 'calendar_activity',
            message: 'activity has no meeting event',
          })
        const E = tx.table('calendar.Event')
        const event = await tx.db.one(from(E).where(eq(E.id, activity.calendarEventId)))
        if (!event) throw new Error('linked calendar event is missing')
        const A = tx.table('calendar.Attendee')
        const attendees = await tx.db.all(from(A).where(eq(A.eventId, event.id)))
        const R = tx.table('calendar.Reminder')
        const reminders = await tx.db.all(from(R).where(eq(R.eventId, event.id), eq(R.active, true)))
        const ET = tx.table('calendar.EventTag')
        const tags = await tx.db.all(from(ET).where(eq(ET.eventId, event.id)))
        const recurrence = event.recurrenceId
          ? await tx.db.one(
              from(tx.table('calendar.Recurrence')).where(
                eq(tx.table('calendar.Recurrence').id, event.recurrenceId),
              ),
            )
          : null
        const updated = await saveEvent(tx, {
          id: String(event.id),
          name: String(event.name),
          description: event.description ? String(event.description) : undefined,
          location: event.location ? String(event.location) : undefined,
          organizerUserId: String(event.organizerUserId),
          allDay: false,
          startAt: String(args.startAt),
          stopAt: String(args.stopAt),
          timezone: String(args.timezone),
          privacy: String(event.privacy),
          showAs: String(event.showAs),
          attendees: attendees.map((row) => ({
            id: String(row.id),
            ...(row.partnerId ? { partnerId: String(row.partnerId) } : {}),
            ...(row.email ? { email: String(row.email) } : {}),
            ...(row.name ? { name: String(row.name) } : {}),
          })),
          reminders: reminders.map((row) => ({
            id: String(row.id),
            channel: String(row.channel),
            offsetMinutes: Number(row.offsetMinutes),
          })),
          tagIds: tags.map((row) => String(row.tagId)),
          recurrence: recurrence
            ? {
                frequency: String(recurrence.frequency),
                interval: Number(recurrence.interval),
                weekdays: stringArray(recurrence.weekdays),
                count: recurrence.count ? Number(recurrence.count) : undefined,
                until: recurrence.until ? String(recurrence.until) : undefined,
              }
            : null,
        })
        const dueDate = localDate(String(args.startAt), String(args.timezone))
        await tx.db.update(
          'activity.Activity',
          { id: args.activityId },
          { dueDate, updatedAt: new Date().toISOString() },
        )
        return { activityId: args.activityId, eventId: event.id, dueDate, version: updated.version }
      }),
  },

  cancelMeeting: {
    input: { activityId: 'id', feedback: 'text?' },
    output: { activityId: 'id', eventId: 'id', canceled: 'bool' },
    effects: [
      'read:activity.Activity',
      'write:activity.Activity',
      'read:user.User',
      'read:calendar.Event',
      'write:calendar.Event',
      'write:calendar.Reminder',
    ],
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const activity = await activityFor(tx, String(args.activityId))
        if (!activity.calendarEventId)
          throw new KetError({
            code: 'E_CALENDAR_ACTIVITY_LINK',
            module: 'calendar_activity',
            message: 'activity has no meeting event',
          })
        const eventId = String(activity.calendarEventId)
        await cancelActivity(tx, String(activity.id), args.feedback ? String(args.feedback) : undefined)
        const E = tx.table('calendar.Event')
        const event = await tx.db.one(from(E).where(eq(E.id, eventId)))
        if (event?.active) {
          await tx.db.update(
            'calendar.Event',
            { id: eventId },
            {
              active: false,
              version: Number(event.version) + 1,
              updatedAt: new Date().toISOString(),
            },
          )
          await tx.db.update('calendar.Reminder', { eventId }, { active: false })
        }
        return { activityId: activity.id, eventId, canceled: true }
      }),
  },
}

const relations: Record<string, Record<string, RelationDef>> = {
  'activity.Activity': { calendarEvent: { belongsTo: 'calendar.Event', by: 'calendarEventId' } },
}

export default defineModule({
  name: 'calendar_activity',
  version: '0.1.0',
  depends: ['activity', 'calendar', 'user', 'partner', 'storage', 'mail'],
  title: 'Cuộc họp từ hoạt động',
  summary: 'Đồng bộ tường minh giữa Meeting Activity và Calendar Event.',
  category: 'Năng suất',
  extend: { 'activity.Activity': { calendarEventId: 'ref:calendar.Event?' } },
  relations,
  functions,
  messages: {
    vi: {
      'app.title': 'Cuộc họp từ hoạt động',
      'app.summary': 'Đồng bộ tường minh giữa Meeting Activity và Calendar Event.',
      'app.category': 'Năng suất',
    },
    en: {
      'app.title': 'Meeting activities',
      'app.summary': 'Explicit synchronization between Meeting Activities and Calendar Events.',
      'app.category': 'Productivity',
    },
  },
})

export { functions }
