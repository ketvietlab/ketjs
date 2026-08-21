import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Event: {
    scope: 'company',
    fields: {
      id: 'id',
      threadId: 'ref:mail.Thread',
      organizerUserId: 'ref:user.User',
      name: 'text',
      description: 'text?',
      location: 'text?',
      allDay: 'bool',
      startAt: 'datetime?',
      stopAt: 'datetime?',
      startDate: 'date?',
      stopDate: 'date?',
      timezone: 'text',
      privacy: 'text',
      showAs: 'text',
      recurrenceId: 'ref:calendar.Recurrence?',
      exceptionOfEventId: 'ref:calendar.Event?',
      recurrenceDate: 'date?',
      active: 'bool',
      version: 'int',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      timed_range: { fields: ['companyId', 'active', 'startAt', 'stopAt'] },
      all_day_range: { fields: ['companyId', 'active', 'startDate', 'stopDate'] },
      organizer: { fields: ['companyId', 'organizerUserId', 'active', 'startAt'] },
      exception: { fields: ['companyId', 'exceptionOfEventId', 'recurrenceDate'], unique: true },
    },
  },

  Attendee: {
    scope: 'company',
    fields: {
      id: 'id',
      eventId: 'ref:calendar.Event',
      partnerId: 'ref:partner.Partner?',
      email: 'text?',
      name: 'text?',
      state: 'text',
      token: 'text',
      respondedAt: 'datetime?',
    },
    indexes: {
      event_partner: { fields: ['companyId', 'eventId', 'partnerId'], unique: true },
      token: { fields: ['companyId', 'token'], unique: true },
    },
  },

  Reminder: {
    scope: 'company',
    fields: {
      id: 'id',
      eventId: 'ref:calendar.Event',
      channel: 'text',
      offsetMinutes: 'int',
      version: 'int',
      active: 'bool',
      sentAt: 'datetime?',
    },
    indexes: {
      event_version: { fields: ['companyId', 'eventId', 'version', 'active'] },
    },
  },

  Recurrence: {
    scope: 'company',
    fields: {
      id: 'id',
      frequency: 'text',
      interval: 'int',
      weekdays: 'json?',
      count: 'int?',
      until: 'date?',
      timezone: 'text',
      active: 'bool',
    },
  },

  Tag: {
    scope: 'company',
    fields: { id: 'id', name: 'text', color: 'text?', active: 'bool' },
    indexes: { name: { fields: ['companyId', 'name'], unique: true } },
  },

  EventTag: {
    scope: 'company',
    fields: { id: 'id', eventId: 'ref:calendar.Event', tagId: 'ref:calendar.Tag' },
    indexes: { identity: { fields: ['companyId', 'eventId', 'tagId'], unique: true } },
  },
}
