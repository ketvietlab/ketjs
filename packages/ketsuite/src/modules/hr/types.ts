export const ROSTER_STATES = ['draft', 'published'] as const
export const SHIFT_STATES = ['draft', 'published', 'cancelled'] as const
export const LEAVE_STATES = ['requested', 'approved', 'rejected', 'cancelled'] as const
export const LEAVE_PORTIONS = ['full', 'morning', 'afternoon'] as const

export type RosterState = (typeof ROSTER_STATES)[number]
export type ShiftState = (typeof SHIFT_STATES)[number]
export type LeaveState = (typeof LEAVE_STATES)[number]
export type LeavePortion = (typeof LEAVE_PORTIONS)[number]
