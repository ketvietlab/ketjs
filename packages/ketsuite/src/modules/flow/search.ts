import { defineListSearch, isNull } from '@ketvietlab/ketjs'
import type { ListState, Table } from '@ketvietlab/ketjs'

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

export const issueListSearch = (T: Table) =>
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
