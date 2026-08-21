export const MESSAGE_KINDS = ['comment', 'note', 'system', 'email'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export const NOTIFICATION_CHANNELS = ['inbox', 'email'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const NOTIFICATION_STATES = ['ready', 'sent', 'failed', 'cancelled'] as const
export type NotificationState = (typeof NOTIFICATION_STATES)[number]
