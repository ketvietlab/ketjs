export const CASE_KINDS = ['lead', 'opportunity'] as const
export const TERMINAL_STATES = ['open', 'won', 'lost'] as const
export const CASE_PRIORITIES = ['0', '1', '2', '3'] as const
export const MESSAGE_VISIBILITIES = ['internal'] as const
export const ASSIGNMENT_MODES = ['manual', 'round_robin', 'capacity'] as const

export type CaseKind = (typeof CASE_KINDS)[number]
export type TerminalState = (typeof TERMINAL_STATES)[number]
export type MessageVisibility = (typeof MESSAGE_VISIBILITIES)[number]
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number]
