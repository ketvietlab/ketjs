export const ISSUE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const SPRINT_STATES = ['planned', 'active', 'closed'] as const
export const DEPENDENCY_RELATIONS = ['blocks', 'related'] as const

/**
 * What a custom field can hold.
 *
 * Fixed, unlike the fields themselves: `saveIssue` branches on these to decide
 * whether a value is well-formed, so a kind nobody wrote a check for would be
 * a field that accepts anything. Adding one is a code change, which is the
 * honest signal that it is.
 */
export const FIELD_KINDS = ['text', 'number', 'date', 'bool', 'select', 'url'] as const

export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]
export type SprintState = (typeof SPRINT_STATES)[number]
export type DependencyRelation = (typeof DEPENDENCY_RELATIONS)[number]
export type FieldKind = (typeof FIELD_KINDS)[number]
