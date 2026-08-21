export const ACTIVITY_CATEGORIES = ['todo', 'call', 'email', 'meeting', 'upload'] as const
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]

export const CHAINING_POLICIES = ['none', 'suggest', 'trigger'] as const
export type ChainingPolicy = (typeof CHAINING_POLICIES)[number]

export const ACTIVITY_STATES = ['overdue', 'today', 'planned', 'done', 'canceled'] as const
export type ActivityState = (typeof ACTIVITY_STATES)[number]

export const ASSIGNEE_STRATEGIES = ['actor', 'specific'] as const
export type AssigneeStrategy = (typeof ASSIGNEE_STRATEGIES)[number]
