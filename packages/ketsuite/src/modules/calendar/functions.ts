import { asc, defineFn, eq, from, inArray, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { agenda, calendarActor, saveEvent } from './operations.ts'
import type { AttendeeInput, RecurrenceInput, ReminderInput } from './operations.ts'
import { datePartsIn, validTimezone } from './recurrence.ts'
import { ATTENDEE_STATES } from './types.ts'

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

const readEffects = [
  'read:calendar.Event',
  'read:calendar.Recurrence',
  'read:calendar.Attendee',
  'read:calendar.EventTag',
  'read:calendar.Tag',
  'read:user.User',
]

const parsed = <T>(value: unknown, name: string): T[] => {
  if (value == null) return []
  if (!Array.isArray(value))
    throw new KetError({ code: 'E_CALENDAR_INPUT', module: 'calendar', message: `${name} must be an array` })
  return value as T[]
}

const enrichedAgenda = async (
  ctx: Ctx,
  rangeStart: string,
  rangeStop: string,
  timezone: string,
  limit: number,
): Promise<Row[]> => {
  const rows = await agenda(ctx, rangeStart, rangeStop, timezone, limit)
  const eventIds = [...new Set(rows.map((row) => String(row.id)))]
  if (!eventIds.length) return []
  const A = ctx.table('calendar.Attendee')
  const attendees = await ctx.db.all(from(A).where(inArray(A.eventId, eventIds)).orderBy(asc(A.id)))
  const ET = ctx.table('calendar.EventTag')
  const joins = await ctx.db.all(from(ET).where(inArray(ET.eventId, eventIds)))
  const tagIds = [...new Set(joins.map((row) => row.tagId))]
  const T = ctx.table('calendar.Tag')
  const tags = tagIds.length ? await ctx.db.all(from(T).where(inArray(T.id, tagIds))) : []
  const U = ctx.table('user.User')
  const organizerIds = [...new Set(rows.map((row) => row.organizerUserId))]
  const users = await ctx.db.all(from(U).where(inArray(U.id, organizerIds)))
  const userById = new Map(users.map((row) => [String(row.id), row]))
  const tagById = new Map(tags.map((row) => [String(row.id), row]))
  return rows.map((row) => ({
    ...row,
    organizerName: userById.get(String(row.organizerUserId))?.name ?? row.organizerUserId,
    attendees: attendees.filter((attendee) => attendee.eventId === row.id),
    tags: joins
      .filter((join) => join.eventId === row.id)
      .flatMap((join) => {
        const tag = tagById.get(String(join.tagId))
        return tag ? [tag] : []
      }),
  }))
}

export const functions: Record<string, FnSpec> = {
  saveEvent: defineFn({
    input: {
      id: 'id',
      name: 'text',
      description: 'text?',
      location: 'text?',
      organizerUserId: 'id?',
      allDay: 'bool',
      startAt: 'datetime?',
      stopAt: 'datetime?',
      startDate: 'date?',
      stopDate: 'date?',
      timezone: 'text',
      privacy: 'text',
      showAs: 'text?',
      active: 'bool?',
      attendees: 'json?',
      reminders: 'json?',
      tagIds: 'json?',
      recurrence: 'json?',
      exceptionOfEventId: 'id?',
      recurrenceDate: 'date?',
    },
    output: { event: 'json' },
    effects: eventEffects,
    idempotent: true,
    agent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => ({
        event: await saveEvent(tx, {
          id: String(args.id),
          name: String(args.name),
          description: args.description ? String(args.description) : undefined,
          location: args.location ? String(args.location) : undefined,
          organizerUserId: args.organizerUserId ? String(args.organizerUserId) : undefined,
          allDay: args.allDay === true,
          startAt: args.startAt ? String(args.startAt) : undefined,
          stopAt: args.stopAt ? String(args.stopAt) : undefined,
          startDate: args.startDate ? String(args.startDate) : undefined,
          stopDate: args.stopDate ? String(args.stopDate) : undefined,
          timezone: String(args.timezone),
          privacy: String(args.privacy),
          showAs: args.showAs ? String(args.showAs) : undefined,
          active: args.active === undefined ? undefined : args.active === true,
          attendees: parsed<AttendeeInput>(args.attendees, 'attendees'),
          reminders: parsed<ReminderInput>(args.reminders, 'reminders'),
          tagIds: parsed<unknown>(args.tagIds, 'tagIds').map(String),
          recurrence:
            args.recurrence && typeof args.recurrence === 'object'
              ? (args.recurrence as RecurrenceInput)
              : null,
          exceptionOfEventId: args.exceptionOfEventId ? String(args.exceptionOfEventId) : undefined,
          recurrenceDate: args.recurrenceDate ? String(args.recurrenceDate) : undefined,
        }),
      })),
  }),

  listAgenda: defineFn({
    input: { rangeStart: 'date', rangeStop: 'date', timezone: 'text', limit: 'int?' },
    output: { events: 'json' },
    effects: readEffects,
    handler: async (ctx: Ctx, args) => ({
      events: await enrichedAgenda(
        ctx,
        String(args.rangeStart),
        String(args.rangeStop),
        String(args.timezone),
        Math.max(1, Math.min(1000, Number(args.limit ?? 366))),
      ),
    }),
  }),

  availability: defineFn({
    input: { userIds: 'json', startAt: 'datetime', stopAt: 'datetime', timezone: 'text' },
    output: { conflicts: 'json' },
    effects: readEffects,
    handler: async (ctx: Ctx, args) => {
      const userIds = [...new Set(parsed<unknown>(args.userIds, 'userIds').map(String))]
      if (!validTimezone(String(args.timezone))) throw new Error('invalid availability timezone')
      const start = new Date(String(args.startAt))
      const stop = new Date(String(args.stopAt))
      if (stop <= start) throw new Error('availability stop must follow start')
      const localStart = datePartsIn(start, String(args.timezone))
      const localStop = datePartsIn(new Date(stop.getTime() + 86_400_000), String(args.timezone))
      const date = (value: typeof localStart) =>
        `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
      const rows = await enrichedAgenda(ctx, date(localStart), date(localStop), String(args.timezone), 1000)
      const U = ctx.table('user.User')
      const users = userIds.length ? await ctx.db.all(from(U).where(inArray(U.id, userIds))) : []
      const partnerByUser = new Map(users.map((row) => [String(row.id), String(row.partnerId ?? '')]))
      return {
        conflicts: rows.flatMap((event) => {
          const attendeePartners = new Set(
            (event.attendees as Row[]).flatMap((row) =>
              row.state !== 'declined' && row.partnerId ? [String(row.partnerId)] : [],
            ),
          )
          const matching = userIds.filter(
            (id) =>
              event.organizerUserId === id ||
              (partnerByUser.get(id) ? attendeePartners.has(partnerByUser.get(id)!) : false),
          )
          if (!matching.length || event.showAs === 'free') return []
          const eventStart = new Date(String(event.startAt ?? `${String(event.startDate)}T00:00:00.000Z`))
          const eventStop = new Date(String(event.stopAt ?? `${String(event.stopDate)}T00:00:00.000Z`))
          if (eventStop <= start || eventStart >= stop) return []
          return [
            {
              eventId: event.id,
              occurrenceId: event.occurrenceId,
              userIds: matching,
              startAt: event.startAt ?? event.startDate,
              stopAt: event.stopAt ?? event.stopDate,
              name: event.privacy === 'public' ? event.name : 'Busy',
            },
          ]
        }),
      }
    },
  }),

  rsvp: defineFn({
    input: { token: 'text', state: 'text' },
    output: { eventId: 'id', state: 'text', respondedAt: 'datetime' },
    effects: ['read:calendar.Attendee', 'write:calendar.Attendee'],
    anonymous: true,
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      if (!ATTENDEE_STATES.includes(String(args.state) as never) || args.state === 'needsAction')
        throw new KetError({
          code: 'E_CALENDAR_RSVP',
          module: 'calendar',
          message: 'RSVP must accept, decline or mark tentative',
        })
      const A = ctx.table('calendar.Attendee')
      const attendee = await ctx.db.one(from(A).where(eq(A.token, args.token)))
      if (!attendee)
        throw new KetError({
          code: 'E_CALENDAR_RSVP_TOKEN',
          module: 'calendar',
          message: 'invitation token is invalid',
        })
      const respondedAt = new Date().toISOString()
      await ctx.db.update('calendar.Attendee', { id: attendee.id }, { state: args.state, respondedAt })
      return { eventId: attendee.eventId, state: args.state, respondedAt }
    },
  }),

  cancelEvent: defineFn({
    input: { id: 'id' },
    output: { id: 'id', active: 'bool', version: 'int' },
    effects: ['read:calendar.Event', 'write:calendar.Event', 'write:calendar.Reminder', 'read:user.User'],
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        const E = tx.table('calendar.Event')
        const event = await tx.db.one(from(E).where(eq(E.id, args.id)))
        if (!event) throw new Error(`calendar event "${String(args.id)}" does not exist`)
        if (event.organizerUserId !== calendarActor(tx)) {
          const U = tx.table('user.User')
          const actor = await tx.db.one(from(U).where(eq(U.id, calendarActor(tx))))
          if (actor?.superuser !== true) throw new Error('only the organizer may cancel this event')
        }
        if (!event.active) return { id: event.id, active: false, version: event.version }
        const version = Number(event.version) + 1
        await tx.db.update(
          'calendar.Event',
          { id: event.id },
          { active: false, version, updatedAt: new Date().toISOString() },
        )
        await tx.db.update('calendar.Reminder', { eventId: event.id }, { active: false })
        return { id: event.id, active: false, version }
      }),
  }),

  saveTag: defineFn({
    input: { id: 'id', name: 'text', color: 'text?', active: 'bool' },
    output: { id: 'id' },
    effects: ['read:calendar.Tag', 'write:calendar.Tag'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const T = ctx.table('calendar.Tag')
      const row = {
        id: args.id,
        name: String(args.name).trim(),
        ...(args.color ? { color: args.color } : {}),
        active: args.active,
      }
      if (!row.name) throw new Error('calendar tag name cannot be empty')
      if (await ctx.db.one(from(T).where(eq(T.id, args.id))))
        await ctx.db.update('calendar.Tag', { id: args.id }, row)
      else await ctx.db.insert('calendar.Tag', row)
      return { id: args.id }
    },
  }),
}
