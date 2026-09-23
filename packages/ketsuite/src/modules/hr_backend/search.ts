// What the search-filter bar offers on the HR lists.
//
// Both lists read a bounded collection the route already holds, so each spec
// covers exactly the columns its table renders. Employees declare `active` so
// the bar carries the archived toggle; the roster is a week grid rather than a
// list, so it keeps its own branch and week controls.
import { defineRowList } from '../backend/row-list.ts'

export const employeeListSearch = defineRowList({
  key: 'hr.employees',
  searchable: [{ key: 'code' }, { key: 'name' }, { key: 'branch' }, { key: 'timezone' }],
  filterable: [
    { key: 'code', label: 'hr_backend.field.code', type: 'text' },
    { key: 'name', label: 'hr_backend.field.name', type: 'text' },
    { key: 'branch', label: 'hr_backend.field.branchId', type: 'text' },
    { key: 'timezone', label: 'hr_backend.field.timezone', type: 'text' },
    // Declaring this is what gives the bar its archived toggle, which
    // supersedes a preset over the same field.
    { key: 'active', label: 'hr_backend.field.state', type: 'boolean' },
  ],
  groupable: [
    { key: 'branch', label: 'hr_backend.field.branchId' },
    { key: 'timezone', label: 'hr_backend.field.timezone' },
  ],
  sortable: [
    { key: 'code', label: 'hr_backend.field.code' },
    { key: 'name', label: 'hr_backend.field.name' },
    { key: 'branch', label: 'hr_backend.field.branchId' },
  ],
  defaultSort: [{ key: 'code', dir: 'asc' }],
})

const LEAVE_STATES = ['requested', 'approved', 'rejected', 'cancelled'] as const

export const leaveListSearch = defineRowList({
  key: 'hr.leaves',
  searchable: [
    { key: 'id' },
    { key: 'employee' },
    { key: 'leaveType' },
    { key: 'dateFrom' },
    { key: 'dateTo' },
    { key: 'reason' },
  ],
  filterable: [
    { key: 'employee', label: 'hr_backend.field.employee', type: 'text' },
    { key: 'leaveType', label: 'hr_backend.field.leaveType', type: 'text' },
    { key: 'dateFrom', label: 'hr_backend.field.startAt', type: 'date' },
    { key: 'dateTo', label: 'hr_backend.field.stopAt', type: 'date' },
    { key: 'requestedDays', label: 'hr_backend.field.days', type: 'number' },
    { key: 'state', label: 'hr_backend.field.state', type: 'selection', choices: LEAVE_STATES },
  ],
  groupable: [
    { key: 'state', label: 'hr_backend.field.state' },
    { key: 'employee', label: 'hr_backend.field.employee' },
    { key: 'leaveType', label: 'hr_backend.field.leaveType' },
  ],
  sortable: [
    { key: 'dateFrom', label: 'hr_backend.field.startAt' },
    { key: 'employee', label: 'hr_backend.field.employee' },
  ],
  presets: LEAVE_STATES.map((state) => ({
    key: state,
    label: `hr_backend.state.${state}`,
    group: 'state',
    match: (row: Record<string, unknown>) => row.state === state,
  })),
  defaultSort: [{ key: 'dateFrom', dir: 'asc' }],
})
