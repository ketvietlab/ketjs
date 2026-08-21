import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'calendar.Event': {
    thread: { belongsTo: 'mail.Thread', by: 'threadId' },
    organizer: { belongsTo: 'user.User', by: 'organizerUserId' },
    attendees: { hasMany: 'calendar.Attendee', by: 'eventId' },
    reminders: { hasMany: 'calendar.Reminder', by: 'eventId' },
    recurrence: { belongsTo: 'calendar.Recurrence', by: 'recurrenceId' },
    exceptionOf: { belongsTo: 'calendar.Event', by: 'exceptionOfEventId' },
    tags: { hasMany: 'calendar.EventTag', by: 'eventId' },
  },
  'calendar.Attendee': {
    event: { belongsTo: 'calendar.Event', by: 'eventId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
  },
  'calendar.Reminder': { event: { belongsTo: 'calendar.Event', by: 'eventId' } },
  'calendar.EventTag': {
    event: { belongsTo: 'calendar.Event', by: 'eventId' },
    tag: { belongsTo: 'calendar.Tag', by: 'tagId' },
  },
  'calendar.Tag': { events: { hasMany: 'calendar.EventTag', by: 'tagId' } },
}
