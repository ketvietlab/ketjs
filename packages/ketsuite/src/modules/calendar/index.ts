import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { jobs } from './jobs.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'calendar',
  version: '0.1.0',
  depends: ['mail', 'user', 'partner', 'storage'],
  app: true,
  title: 'Lịch',
  summary: 'Sự kiện, người tham dự, RSVP, nhắc lịch và lịch lặp theo múi giờ.',
  category: 'Năng suất',
  models,
  relations,
  functions,
  jobs,
  messages: {
    vi: {
      'app.title': 'Lịch',
      'app.summary': 'Sự kiện, người tham dự, RSVP, nhắc lịch và lịch lặp theo múi giờ.',
      'app.category': 'Năng suất',
    },
    en: {
      'app.title': 'Calendar',
      'app.summary': 'Timezone-aware events, attendees, RSVP, reminders and recurrence.',
      'app.category': 'Productivity',
    },
  },
})

export { functions } from './functions.ts'
export { jobs } from './jobs.ts'
export { agenda, calendarActor, saveEvent } from './operations.ts'
export type { AttendeeInput, RecurrenceInput, ReminderInput, SaveEventInput } from './operations.ts'
export {
  datePartsIn,
  expandRecurringEvent,
  validTimezone,
  validateRecurrence,
  zonedToUtc,
} from './recurrence.ts'
export {
  ATTENDEE_STATES,
  EVENT_PRIVACY,
  RECURRENCE_FREQUENCIES,
  REMINDER_CHANNELS,
  WEEKDAYS,
} from './types.ts'
