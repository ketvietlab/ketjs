export const PUNCH_KINDS = ['in', 'out'] as const
export const PUNCH_SOURCES = ['kiosk_pin', 'kiosk_qr', 'account', 'manager'] as const
export const REQUEST_STATES = ['requested', 'approved', 'rejected'] as const
export const PERIOD_STATES = ['open', 'locked'] as const

export type PunchKind = (typeof PUNCH_KINDS)[number]
export type PunchSource = (typeof PUNCH_SOURCES)[number]
export type RequestState = (typeof REQUEST_STATES)[number]
export type PeriodState = (typeof PERIOD_STATES)[number]
