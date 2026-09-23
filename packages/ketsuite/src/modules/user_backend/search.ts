// What the search-filter bar offers on the identity lists.
//
// Both lists read a bounded collection the route already holds, so each spec
// covers exactly the columns its table renders. People declare `active`, which
// is what gives the bar its archived toggle; the same `?archived=1` also tells
// `user.listUsers` to include archived accounts, so the toggle stays one
// control over one URL.
import { defineRowList } from '../backend/row-list.ts'

const ACCESS_KINDS = ['internal', 'portal', 'public'] as const

export const userListSearch = defineRowList({
  key: 'user.users',
  searchable: [{ key: 'name' }, { key: 'login' }, { key: 'email' }, { key: 'accessKind' }],
  filterable: [
    { key: 'name', label: 'user_backend.field.name', type: 'text' },
    { key: 'login', label: 'user_backend.field.login', type: 'text' },
    { key: 'email', label: 'user_backend.field.email', type: 'text' },
    {
      key: 'accessKind',
      label: 'user_backend.field.accessKind',
      type: 'selection',
      choices: ACCESS_KINDS,
    },
    { key: 'passwordReady', label: 'user_backend.field.credential', type: 'boolean' },
    { key: 'active', label: 'user_backend.field.state', type: 'boolean' },
  ],
  groupable: [
    { key: 'accessKind', label: 'user_backend.field.accessKind' },
    { key: 'passwordReady', label: 'user_backend.field.credential' },
  ],
  sortable: [
    { key: 'name', label: 'user_backend.field.name' },
    { key: 'login', label: 'user_backend.field.login' },
  ],
  presets: [
    ...ACCESS_KINDS.map((kind) => ({
      key: kind,
      label: `user_backend.access.${kind}`,
      group: 'accessKind',
      match: (row: Record<string, unknown>) => row.accessKind === kind,
    })),
    {
      key: 'invitationPending',
      label: 'user_backend.state.invitationPending',
      group: 'credential',
      match: (row) => row.passwordReady !== true,
    },
  ],
  defaultSort: [{ key: 'name', dir: 'asc' }],
})

const ROLE_MODES = ['managed', 'custom'] as const

export const roleListSearch = defineRowList({
  key: 'user.roles',
  searchable: [{ key: 'name' }, { key: 'description' }, { key: 'mode' }],
  filterable: [
    { key: 'name', label: 'user_backend.field.name', type: 'text' },
    { key: 'description', label: 'user_backend.field.description', type: 'text' },
    { key: 'mode', label: 'user_backend.field.roleMode', type: 'selection', choices: ROLE_MODES },
    { key: 'assignmentCount', label: 'user_backend.access.assignments', type: 'number' },
  ],
  groupable: [{ key: 'mode', label: 'user_backend.field.roleMode' }],
  sortable: [
    { key: 'name', label: 'user_backend.field.name' },
    { key: 'assignmentCount', label: 'user_backend.access.assignments' },
  ],
  presets: [
    ...ROLE_MODES.map((mode) => ({
      key: mode,
      label: `user_backend.role.${mode}`,
      group: 'mode',
      match: (row: Record<string, unknown>) => (row.mode ?? 'custom') === mode,
    })),
    {
      // The list exists to answer which roles need attention, so its health
      // column is a filter of its own.
      key: 'unhealthy',
      label: 'user_backend.access.health',
      group: 'health',
      match: (row) => ((row.healthIssues as unknown[] | undefined)?.length ?? 0) > 0,
    },
    {
      key: 'unassigned',
      label: 'user_backend.filter.unassigned',
      group: 'health',
      match: (row) => Number(row.assignmentCount ?? 0) === 0,
    },
  ],
  defaultSort: [{ key: 'name', dir: 'asc' }],
})
