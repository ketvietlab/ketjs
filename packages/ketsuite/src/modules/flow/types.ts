export const ISSUE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const SPRINT_STATES = ['planned', 'active', 'closed'] as const
export const DEPENDENCY_RELATIONS = ['blocks', 'related'] as const

export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]
export type SprintState = (typeof SPRINT_STATES)[number]
export type DependencyRelation = (typeof DEPENDENCY_RELATIONS)[number]
