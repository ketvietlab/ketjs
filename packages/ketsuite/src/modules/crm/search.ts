import { defineListSearch, eq } from 'ketjs'
import type { ListState, Table } from 'ketjs'

export const emptyCaseListState = (): ListState => ({
  presets: [],
  filters: [],
  groupBy: [],
  sort: [{ key: 'updatedAt', dir: 'desc' }],
  openGroups: [],
  groupPages: {},
  page: 1,
  includeArchived: false,
})

export const caseListSearch = (T: Table) =>
  defineListSearch({
    key: 'crm.cases',
    searchable: [
      { key: 'name', col: T.name! },
      { key: 'contactName', col: T.contactName! },
      { key: 'email', col: T.email! },
      { key: 'phone', col: T.phone! },
    ],
    filterable: [
      { key: 'name', label: 'crm_backend.field.name', col: T.name!, type: 'text' },
      {
        key: 'kind',
        label: 'crm_backend.field.kind',
        col: T.kind!,
        type: 'selection',
        choices: ['lead', 'opportunity'],
      },
      { key: 'stageId', label: 'crm_backend.field.stage', col: T.stageId!, type: 'reference' },
      { key: 'teamId', label: 'crm_backend.field.team', col: T.teamId!, type: 'reference' },
      {
        key: 'assigneeUserId',
        label: 'crm_backend.field.assignee',
        col: T.assigneeUserId!,
        type: 'reference',
      },
      {
        key: 'terminalState',
        label: 'crm_backend.field.state',
        col: T.terminalState!,
        type: 'selection',
        choices: ['open', 'won', 'lost'],
      },
      {
        key: 'priority',
        label: 'crm_backend.field.priority',
        col: T.priority!,
        type: 'selection',
        choices: ['0', '1', '2', '3'],
      },
      { key: 'utmSource', label: 'crm_backend.field.utmSource', col: T.utmSource!, type: 'text' },
      { key: 'active', label: 'crm_backend.field.active', col: T.active!, type: 'boolean' },
      { key: 'createdAt', label: 'crm_backend.field.createdAt', col: T.createdAt!, type: 'datetime' },
      { key: 'updatedAt', label: 'crm_backend.field.updatedAt', col: T.updatedAt!, type: 'datetime' },
    ],
    groupable: [
      { key: 'kind', label: 'crm_backend.field.kind', col: T.kind! },
      { key: 'stageId', label: 'crm_backend.field.stage', col: T.stageId! },
      { key: 'teamId', label: 'crm_backend.field.team', col: T.teamId! },
      { key: 'assigneeUserId', label: 'crm_backend.field.assignee', col: T.assigneeUserId! },
      { key: 'terminalState', label: 'crm_backend.field.state', col: T.terminalState! },
      { key: 'priority', label: 'crm_backend.field.priority', col: T.priority! },
      {
        key: 'createdAt',
        label: 'crm_backend.field.createdAt',
        col: T.createdAt!,
        intervals: ['day', 'week', 'month', 'quarter', 'year'],
      },
      {
        key: 'updatedAt',
        label: 'crm_backend.field.updatedAt',
        col: T.updatedAt!,
        intervals: ['day', 'week', 'month', 'quarter', 'year'],
      },
    ],
    sortable: [
      { key: 'name', label: 'crm_backend.field.name', col: T.name! },
      { key: 'priority', label: 'crm_backend.field.priority', col: T.priority! },
      { key: 'createdAt', label: 'crm_backend.field.createdAt', col: T.createdAt! },
      { key: 'updatedAt', label: 'crm_backend.field.updatedAt', col: T.updatedAt! },
    ],
    presets: [
      { key: 'open', label: 'crm.terminal.open', group: 'state', expr: eq(T.terminalState!, 'open') },
      { key: 'won', label: 'crm.terminal.won', group: 'state', expr: eq(T.terminalState!, 'won') },
      { key: 'lost', label: 'crm.terminal.lost', group: 'state', expr: eq(T.terminalState!, 'lost') },
    ],
    defaultSort: [{ key: 'updatedAt', dir: 'desc' }],
  })
