import { each, html, signal } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import { createCalendarView } from './client/calendar-view.mjs'

export const HOOKS = [
  'calendar-board',
  'calendar-head',
  'calendar-heading',
  'calendar-title',
  'calendar-range',
  'calendar-navigation',
  'calendar-views',
  'calendar-create',
  'calendar-create-title',
  'calendar-field',
  'calendar-all-day',
  'calendar-submit',
  'calendar-error',
  'calendar-loading',
  'calendar-empty',
  'calendar-agenda',
  'calendar-week',
  'calendar-month',
  'calendar-day',
  'calendar-day-label',
  'calendar-day-events',
  'calendar-event',
  'calendar-event-title',
  'calendar-event-time',
  'calendar-event-location',
  'calendar-event-organizer',
] as const

const runtime = { each, html, signal }
const event = {
  id: 'event',
  occurrenceId: 'event:2026-08-20',
  occurrenceDate: '2026-08-20',
  name: 'Review',
  allDay: false,
  startAt: '2026-08-20T02:00:00.000Z',
  stopAt: '2026-08-20T03:00:00.000Z',
  location: 'Room A',
  organizerName: 'Author',
}
export const calendarContractCases = (): TemplateResult[] => [
  createCalendarView(runtime, { lang: 'en', view: 'agenda' }).view(),
  createCalendarView(runtime, { lang: 'en' }, { status: 'error', error: 'Failed' }).view(),
  createCalendarView(runtime, { lang: 'en' }, { status: 'ready', events: [] }).view(),
  createCalendarView(
    runtime,
    { lang: 'en' },
    { status: 'ready', view: 'agenda', cursor: '2026-08-20', events: [event] },
  ).view(),
  createCalendarView(
    runtime,
    { lang: 'en' },
    { status: 'ready', view: 'week', cursor: '2026-08-20', events: [event] },
  ).view(),
  createCalendarView(
    runtime,
    { lang: 'en' },
    { status: 'ready', view: 'month', cursor: '2026-08-20', events: [event] },
  ).view(),
]
