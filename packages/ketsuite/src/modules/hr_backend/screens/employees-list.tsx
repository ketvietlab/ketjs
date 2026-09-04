import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  inline,
  LinkButton,
  ListPage,
  RecordForm,
  shell,
} from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'

export type EmployeeListRow = {
  id: string
  code: string
  name: string
  branch: string
  timezone: string
  active: boolean
  editHref: string
}

export type EmployeesListScreenOptions = {
  rows: EmployeeListRow[]
  /** Locale-aware URL that opens the employee create modal. */
  createHref: string
  /** Locale-aware collection endpoint for archive and restore commands. */
  action: string
}

export const employeeListColumns = (_: Translator, action: string): Array<Column<EmployeeListRow>> => [
  {
    key: 'code',
    label: _('hr_backend.field.code'),
    cell: (row) => code(row.code, 'identifier'),
    kind: 'identifier',
    priority: 'primary',
  },
  {
    key: 'name',
    label: _('hr_backend.field.name'),
    cell: (row) => row.name,
    priority: 'secondary',
    width: 'wide',
  },
  {
    key: 'branch',
    label: _('hr_backend.field.branchId'),
    cell: (row) => row.branch,
  },
  {
    key: 'timezone',
    label: _('hr_backend.field.timezone'),
    cell: (row) => row.timezone,
  },
  {
    key: 'state',
    label: _('hr_backend.field.state'),
    cell: (row) =>
      row.active
        ? badge(_('hr_backend.state.active'), 'positive', 'active')
        : badge(_('hr_backend.state.archived'), 'neutral', 'archived'),
    kind: 'status',
  },
  {
    key: 'actions',
    label: _('hr_backend.field.actions'),
    cell: (row) => (
      <RecordForm
        action={action}
        layout="inline"
        hidden={{ id: row.id, action: row.active ? 'archive' : 'restore' }}
        fields={[]}
        submit={row.active ? _('hr_backend.action.archive') : _('hr_backend.action.restore')}
        submitVariant={row.active ? 'tertiary' : 'secondary'}
        submitSize="compact"
      />
    ),
  },
]

export const employeesListScreen = (
  _: Translator,
  options: EmployeesListScreenOptions,
  frame: Frame = {},
): TemplateResult =>
  shell(
    _,
    _('hr_backend.employees.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('hr_backend.employees.title')}
      actions={inline([
        <LinkButton label={_('hr_backend.employees.create')} href={options.createHref} variant="primary" />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      body={
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => row.id,
              rowHref: (row) => row.editHref,
              columns: employeeListColumns(_, options.action),
            })
          : emptyState(_('hr_backend.empty.employees'), _('hr_backend.empty.employeesHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
