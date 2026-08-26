import { defineListSearch, isNull } from '@ketvietlab/ketjs'
import type { FilterFieldSpec, ListState, Row, Table } from '@ketvietlab/ketjs'

/** The prefix that marks a filter key as one project's own field rather than Flow's. */
export const FIELD_FILTER_PREFIX = 'field:'

/**
 * A project's custom fields, as things the filter menu can offer.
 *
 * `col` is the issue's own id, which is not a lie: the rule is rewritten into
 * an id set before it compiles (see `fieldFilterIds` in operations.ts), because
 * the value lives in another table and this query builder has no JOIN. What the
 * spec contributes is the menu entry, the vocabulary and the validation.
 *
 * Only operators that can be answered by a set of ids are offered. `notEquals`
 * and `isNotSet` are the complement of one, which is every other issue in the
 * system — a control that cannot answer honestly is worse than one that is not
 * there.
 */
export const fieldFilters = (T: Table, fields: Row[]): FilterFieldSpec[] =>
  fields.map((field) => ({
    key: `${FIELD_FILTER_PREFIX}${String(field.code)}`,
    label: String(field.name),
    col: T.id!,
    type: String(field.kind) === 'select' ? ('selection' as const) : ('text' as const),
    operators: ['equals', 'anyOf', 'isSet'] as const,
    ...(String(field.kind) === 'select'
      ? {
          choices: (
            ((field.config as { options?: Array<{ code?: unknown }> } | null)?.options ?? []) as Array<{
              code?: unknown
            }>
          ).map((option) => String(option?.code ?? '')),
        }
      : {}),
  }))

export const emptyIssueListState = (): ListState => ({
  presets: [],
  filters: [],
  groupBy: [],
  sort: [{ key: 'updatedAt', dir: 'desc' }],
  openGroups: [],
  groupPages: {},
  page: 1,
  includeArchived: false,
})

/**
 * `fields` are one project's custom fields. Absent on the cross-project lists,
 * where there is no single project whose vocabulary to offer.
 */
export const issueListSearch = (T: Table, fields: Row[] = []) =>
  defineListSearch({
    key: 'flow.issues',
    searchable: [
      { key: 'title', col: T.title! },
      { key: 'previewText', col: T.previewText! },
    ],
    filterable: [
      { key: 'title', label: 'flow.field.title', col: T.title!, type: 'text' },
      { key: 'projectId', label: 'flow.field.project', col: T.projectId!, type: 'reference' },
      { key: 'columnId', label: 'flow.field.column', col: T.columnId!, type: 'reference' },
      { key: 'epicId', label: 'flow.field.epic', col: T.epicId!, type: 'reference' },
      { key: 'sprintId', label: 'flow.field.sprint', col: T.sprintId!, type: 'reference' },
      {
        key: 'assigneeUserId',
        label: 'flow.field.assignee',
        col: T.assigneeUserId!,
        type: 'reference',
      },
      {
        key: 'priority',
        label: 'flow.field.priority',
        col: T.priority!,
        type: 'selection',
        choices: ['low', 'normal', 'high', 'urgent'],
      },
      { key: 'dueDate', label: 'flow.field.dueDate', col: T.dueDate!, type: 'date' },
      { key: 'active', label: 'flow.field.active', col: T.active!, type: 'boolean' },
      { key: 'createdAt', label: 'flow.field.createdAt', col: T.createdAt!, type: 'datetime' },
      { key: 'updatedAt', label: 'flow.field.updatedAt', col: T.updatedAt!, type: 'datetime' },
      ...fieldFilters(T, fields),
    ],
    groupable: [
      { key: 'columnId', label: 'flow.field.column', col: T.columnId! },
      { key: 'epicId', label: 'flow.field.epic', col: T.epicId! },
      { key: 'sprintId', label: 'flow.field.sprint', col: T.sprintId! },
      { key: 'assigneeUserId', label: 'flow.field.assignee', col: T.assigneeUserId! },
      { key: 'priority', label: 'flow.field.priority', col: T.priority! },
      {
        key: 'createdAt',
        label: 'flow.field.createdAt',
        col: T.createdAt!,
        intervals: ['day', 'week', 'month', 'quarter', 'year'],
      },
      {
        key: 'updatedAt',
        label: 'flow.field.updatedAt',
        col: T.updatedAt!,
        intervals: ['day', 'week', 'month', 'quarter', 'year'],
      },
    ],
    sortable: [
      { key: 'title', label: 'flow.field.title', col: T.title! },
      { key: 'priority', label: 'flow.field.priority', col: T.priority! },
      { key: 'dueDate', label: 'flow.field.dueDate', col: T.dueDate! },
      { key: 'createdAt', label: 'flow.field.createdAt', col: T.createdAt! },
      { key: 'updatedAt', label: 'flow.field.updatedAt', col: T.updatedAt! },
    ],
    presets: [
      {
        key: 'unassigned',
        label: 'flow.preset.unassigned',
        group: 'assignee',
        expr: isNull(T.assigneeUserId!),
      },
    ],
    defaultSort: [{ key: 'updatedAt', dir: 'desc' }],
  })
