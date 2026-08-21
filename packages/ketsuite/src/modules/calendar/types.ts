export const EVENT_PRIVACY = ['public', 'private', 'confidential'] as const
export const ATTENDEE_STATES = ['needsAction', 'accepted', 'declined', 'tentative'] as const
export const REMINDER_CHANNELS = ['inbox', 'email'] as const
export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

export type EventPrivacy = (typeof EVENT_PRIVACY)[number]
export type AttendeeState = (typeof ATTENDEE_STATES)[number]
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number]
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number]
