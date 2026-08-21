import { randomUUID } from 'node:crypto'
import { asc, deleteFrom, eq, from, inArray, KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { ensureThread, followThread, postMessage } from '../mail/index.ts'
import {
  datePartsIn,
  expandRecurringEvent,
  validateRecurrence,
  validTimezone,
  zonedToUtc,
} from './recurrence.ts'
import { EVENT_PRIVACY, REMINDER_CHANNELS } from './types.ts'

const calendarError = (code: string, message: string, hint?: string): never => {
  throw new KetError({ code, module: 'calendar', message, ...(hint ? { hint } : {}) })
}

export const calendarActor = (ctx: Ctx): string => {
  const actor = ctx.actor
  if (!actor)
    return calendarError('E_CALENDAR_ACTOR_REQUIRED', 'calendar operations require a signed-in user')
  return actor
}

export type AttendeeInput = { id?: string; partnerId?: string; email?: string; name?: string }
export type ReminderInput = { id?: string; channel: string; offsetMinutes: number }
export type RecurrenceInput = {
  frequency: string
  interval: number
  weekdays?: string[]
  count?: number
  until?: string
}
export type SaveEventInput = {
  id: string
  name: string
  description?: string
  location?: string
  organizerUserId?: string
  allDay: boolean
  startAt?: string
  stopAt?: string
  startDate?: string
  stopDate?: string
  timezone: string
  privacy: string
  showAs?: string
  active?: boolean
  attendees?: AttendeeInput[]
  reminders?: ReminderInput[]
  tagIds?: string[]
  recurrence?: RecurrenceInput | null
  exceptionOfEventId?: string
  recurrenceDate?: string
}

const validateEvent = (input: SaveEventInput): void => {
  if (!input.name.trim()) calendarError('E_CALENDAR_NAME', 'event name cannot be empty')
  if (input.name.length > 500) calendarError('E_CALENDAR_NAME', 'event name exceeds 500 characters')
  if (!validTimezone(input.timezone))
    calendarError('E_CALENDAR_TIMEZONE', `invalid IANA timezone "${input.timezone}"`)
  if (!EVENT_PRIVACY.includes(input.privacy as never))
    calendarError('E_CALENDAR_PRIVACY', `unknown event privacy "${input.privacy}"`)
  if (input.allDay) {
    if (!input.startDate || !input.stopDate || input.startAt || input.stopAt)
      calendarError('E_CALENDAR_ALL_DAY', 'all-day events require date boundaries and no UTC instants')
    if (input.stopDate! <= input.startDate!)
      calendarError('E_CALENDAR_RANGE', 'all-day stop date is exclusive and must follow start date')
  } else {
    if (!input.startAt || !input.stopAt || input.startDate || input.stopDate)
      calendarError('E_CALENDAR_TIMED', 'timed events require UTC start/stop instants and no all-day dates')
    if (new Date(input.stopAt!).getTime() <= new Date(input.startAt!).getTime())
      calendarError('E_CALENDAR_RANGE', 'event stop must follow start')
  }
  if (input.exceptionOfEventId && !input.recurrenceDate)
    calendarError('E_CALENDAR_EXCEPTION', 'a recurrence exception must name its local occurrence date')
}

const activeUser = async (ctx: Ctx, id: string): Promise<Row> => {
  const U = ctx.table('user.User')
  const row = await ctx.db.one(from(U).where(eq(U.id, id), eq(U.active, true)))
  if (!row) return calendarError('E_CALENDAR_ORGANIZER', `no active organizer "${id}"`)
  return row
}

const eventStart = (event: Row): Date => {
  if (!event.allDay) return new Date(String(event.startAt))
  const [year, month, day] = String(event.startDate).split('-').map(Number)
  return zonedToUtc(
    { year: year!, month: month!, day: day!, hour: 0, minute: 0, second: 0 },
    String(event.timezone),
  )
}

export async function saveEvent(ctx: Ctx, input: SaveEventInput): Promise<Row> {
  validateEvent(input)
  const organizerUserId = input.organizerUserId ?? calendarActor(ctx)
  const organizer = await activeUser(ctx, organizerUserId)
  const E = ctx.table('calendar.Event')
  const existing = await ctx.db.one(from(E).where(eq(E.id, input.id)))
  if (existing && existing.organizerUserId !== calendarActor(ctx)) {
    const actor = await activeUser(ctx, calendarActor(ctx))
    if (actor.superuser !== true)
      calendarError('E_CALENDAR_AUTHORITY', 'only the organizer or a privileged manager may edit this event')
  }
  if (input.exceptionOfEventId) {
    const parent = await ctx.db.one(from(E).where(eq(E.id, input.exceptionOfEventId)))
    if (!parent?.recurrenceId)
      calendarError('E_CALENDAR_EXCEPTION', 'the exception parent is missing or is not recurring')
  }

  let recurrenceId: string | null = existing?.recurrenceId ? String(existing.recurrenceId) : null
  if (input.recurrence) {
    recurrenceId ??= `recurrence:${input.id}`
    const recurrence = {
      id: recurrenceId,
      frequency: input.recurrence.frequency,
      interval: input.recurrence.interval,
      ...(input.recurrence.weekdays?.length ? { weekdays: input.recurrence.weekdays } : {}),
      ...(input.recurrence.count ? { count: input.recurrence.count } : {}),
      ...(input.recurrence.until ? { until: input.recurrence.until } : {}),
      timezone: input.timezone,
      active: true,
    }
    validateRecurrence(recurrence)
    const R = ctx.table('calendar.Recurrence')
    if (await ctx.db.one(from(R).where(eq(R.id, recurrenceId))))
      await ctx.db.update('calendar.Recurrence', { id: recurrenceId }, recurrence)
    else await ctx.db.insert('calendar.Recurrence', recurrence)
  } else if (recurrenceId) {
    await ctx.db.update('calendar.Recurrence', { id: recurrenceId }, { active: false })
    recurrenceId = null
  }

  const now = new Date().toISOString()
  const version = Number(existing?.version ?? 0) + 1
  const thread = await ensureThread(ctx, {
    id: `thread:calendar.Event:${input.id}`,
    resModel: 'calendar.Event',
    resId: input.id,
    displayName: input.name.trim(),
  })
  const event: Row = {
    id: input.id,
    threadId: thread.id,
    organizerUserId,
    name: input.name.trim(),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.location?.trim() ? { location: input.location.trim() } : {}),
    allDay: input.allDay,
    ...(input.allDay
      ? { startDate: input.startDate, stopDate: input.stopDate }
      : { startAt: input.startAt, stopAt: input.stopAt }),
    timezone: input.timezone,
    privacy: input.privacy,
    showAs: input.showAs ?? 'busy',
    ...(recurrenceId ? { recurrenceId } : {}),
    ...(input.exceptionOfEventId ? { exceptionOfEventId: input.exceptionOfEventId } : {}),
    ...(input.recurrenceDate ? { recurrenceDate: input.recurrenceDate } : {}),
    active: input.active ?? true,
    version,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  if (existing) await ctx.db.update('calendar.Event', { id: input.id }, event)
  else await ctx.db.insert('calendar.Event', event)

  if (organizer.partnerId)
    await followThread(ctx, {
      id: `${String(thread.id)}:${String(organizer.partnerId)}`,
      threadId: String(thread.id),
      partnerId: String(organizer.partnerId),
    })

  const attendeeTable = ctx.table('calendar.Attendee')
  const oldAttendees = existing
    ? await ctx.db.all(from(attendeeTable).where(eq(attendeeTable.eventId, input.id)))
    : []
  const oldByKey = new Map(
    oldAttendees.map((row) => [row.partnerId ? `p:${String(row.partnerId)}` : `e:${String(row.email)}`, row]),
  )
  const attendees = input.attendees ?? []
  const partnerIds = [...new Set(attendees.flatMap((row) => (row.partnerId ? [row.partnerId] : [])))]
  if (partnerIds.length) {
    const P = ctx.table('partner.Partner')
    const found = await ctx.db.all(from(P).where(inArray(P.id, partnerIds), eq(P.active, true)))
    if (found.length !== partnerIds.length)
      calendarError('E_CALENDAR_ATTENDEE', 'one or more attendee partners are missing')
  }
  const keys = attendees.map((row) => (row.partnerId ? `p:${row.partnerId}` : `e:${row.email ?? ''}`))
  if (keys.some((key) => key === 'e:') || new Set(keys).size !== keys.length)
    calendarError('E_CALENDAR_ATTENDEE', 'attendees need one unique partner or email identity')
  const A = ctx.table('calendar.Attendee')
  await ctx.db.del(deleteFrom(A).where(eq(A.eventId, input.id)))
  for (const [index, attendee] of attendees.entries()) {
    const key = keys[index]!
    const previous = oldByKey.get(key)
    await ctx.db.insert('calendar.Attendee', {
      id: attendee.id ?? previous?.id ?? `${input.id}:attendee:${index + 1}`,
      eventId: input.id,
      ...(attendee.partnerId ? { partnerId: attendee.partnerId } : {}),
      ...(attendee.email ? { email: attendee.email } : {}),
      ...(attendee.name ? { name: attendee.name } : {}),
      state: previous?.state ?? 'needsAction',
      token: previous?.token ?? randomUUID(),
      ...(previous?.respondedAt ? { respondedAt: previous.respondedAt } : {}),
    })
  }

  const tagIds = [...new Set(input.tagIds ?? [])]
  if (tagIds.length) {
    const T = ctx.table('calendar.Tag')
    const found = await ctx.db.all(from(T).where(inArray(T.id, tagIds), eq(T.active, true)))
    if (found.length !== tagIds.length) calendarError('E_CALENDAR_TAG', 'one or more event tags are missing')
  }
  const ET = ctx.table('calendar.EventTag')
  await ctx.db.del(deleteFrom(ET).where(eq(ET.eventId, input.id)))
  for (const tagId of tagIds)
    await ctx.db.insert('calendar.EventTag', { id: `${input.id}:${tagId}`, eventId: input.id, tagId })

  const oldReminders = ctx.table('calendar.Reminder')
  await ctx.db.update('calendar.Reminder', { eventId: input.id }, { active: false })
  for (const [index, reminder] of (input.reminders ?? []).entries()) {
    if (!REMINDER_CHANNELS.includes(reminder.channel as never))
      calendarError('E_CALENDAR_REMINDER_CHANNEL', `unknown reminder channel "${reminder.channel}"`)
    if (!Number.isInteger(reminder.offsetMinutes) || reminder.offsetMinutes < 0)
      calendarError('E_CALENDAR_REMINDER_OFFSET', 'reminder offset must be a non-negative whole number')
    const id = reminder.id ?? `${input.id}:reminder:${index + 1}`
    const row = {
      id,
      eventId: input.id,
      channel: reminder.channel,
      offsetMinutes: reminder.offsetMinutes,
      version,
      active: true,
      sentAt: null,
    }
    const previous = await ctx.db.one(from(oldReminders).where(eq(oldReminders.id, id)))
    if (previous) await ctx.db.update('calendar.Reminder', { id }, row)
    else await ctx.db.insert('calendar.Reminder', row)
    await ctx.jobs.enqueue(
      'calendar.remind',
      { reminderId: id, version },
      {
        runAt: new Date(eventStart(event).getTime() - reminder.offsetMinutes * 60_000),
        uniqueKey: `${id}:v${version}`,
      },
    )
  }

  const invitePartnerIds = partnerIds.filter((id) => id !== organizer.partnerId)
  const M = ctx.table('mail.Message')
  const invitationId = `calendar:event:${input.id}:v${version}`
  if (!(await ctx.db.one(from(M).where(eq(M.id, invitationId)))))
    await postMessage(ctx, {
      id: invitationId,
      threadId: String(thread.id),
      authorUserId: organizerUserId,
      kind: 'system',
      body: `${existing ? 'Cập nhật lịch' : 'Lời mời lịch'}: ${input.name.trim()}`,
      mentionPartnerIds: invitePartnerIds,
    })
  return event
}

export const agenda = async (
  ctx: Ctx,
  rangeStart: string,
  rangeStop: string,
  timezone: string,
  limit = 366,
): Promise<Row[]> => {
  if (!validTimezone(timezone)) calendarError('E_CALENDAR_TIMEZONE', `invalid IANA timezone "${timezone}"`)
  if (rangeStop <= rangeStart) calendarError('E_CALENDAR_RANGE', 'agenda stop date must follow start date')
  const E = ctx.table('calendar.Event')
  const events = await ctx.db.all(from(E).orderBy(asc(E.createdAt)))
  const R = ctx.table('calendar.Recurrence')
  const recurrenceIds = [...new Set(events.flatMap((row) => (row.recurrenceId ? [row.recurrenceId] : [])))]
  const recurrences = recurrenceIds.length
    ? await ctx.db.all(from(R).where(inArray(R.id, recurrenceIds)))
    : []
  const recurrenceById = new Map(recurrences.map((row) => [String(row.id), row]))
  const exceptions = events.filter((row) => row.exceptionOfEventId && row.recurrenceDate)
  const suppressed = new Map<string, Set<string>>()
  for (const exception of exceptions) {
    const dates = suppressed.get(String(exception.exceptionOfEventId)) ?? new Set<string>()
    dates.add(String(exception.recurrenceDate))
    suppressed.set(String(exception.exceptionOfEventId), dates)
  }
  // Build UTC range boundaries explicitly; the small helper above is intentionally
  // not used for parsing dates so invalid date input stays at the function boundary.
  const parts = (date: string) => date.split('-').map(Number)
  const [sy, sm, sd] = parts(rangeStart)
  const [ey, em, ed] = parts(rangeStop)
  const utcStart = zonedToUtc({ year: sy!, month: sm!, day: sd!, hour: 0, minute: 0, second: 0 }, timezone)
  const utcStop = zonedToUtc({ year: ey!, month: em!, day: ed!, hour: 0, minute: 0, second: 0 }, timezone)
  const out: Row[] = []
  for (const event of events) {
    if (event.exceptionOfEventId) {
      if (!event.active) continue
    } else if (!event.active) continue
    if (event.recurrenceId && !event.exceptionOfEventId) {
      const recurrence = recurrenceById.get(String(event.recurrenceId))
      if (recurrence?.active)
        out.push(
          ...expandRecurringEvent(
            event,
            recurrence,
            rangeStart,
            rangeStop,
            suppressed.get(String(event.id)),
            limit - out.length,
          ),
        )
      continue
    }
    if (
      event.allDay
        ? String(event.startDate) < rangeStop && String(event.stopDate) > rangeStart
        : new Date(String(event.startAt)) < utcStop && new Date(String(event.stopAt)) > utcStart
    )
      out.push({
        ...event,
        occurrenceId: String(event.id),
        occurrenceDate:
          event.recurrenceDate ??
          (event.allDay
            ? event.startDate
            : (() => {
                const local = datePartsIn(String(event.startAt), timezone)
                return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`
              })()),
      })
    if (out.length > limit)
      calendarError('E_CALENDAR_EXPANSION_LIMIT', `agenda exceeds the ${limit} event query limit`)
  }
  return out.sort((a, b) => {
    const left = String(a.startDate ?? a.startAt)
    const right = String(b.startDate ?? b.startAt)
    return left.localeCompare(right) || String(a.id).localeCompare(String(b.id))
  })
}
