import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  inline,
  ListPage,
  listChrome,
  Notice,
  RecordActions,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'

export type LeaveListRow = {
  id: string
  employee: string
  leaveType: string
  dateFrom: string
  dateTo: string
  requestedDays: string
  reason?: string
  state: string
  action: string
}

export type LeavesListScreenOptions = {
  errors?: readonly string[]
  rows: LeaveListRow[]
  total: number
}

const stateBadge = (_: Translator, state: string) =>
  badge(
    _(`hr_backend.state.${state}`),
    state === 'approved'
      ? 'positive'
      : state === 'rejected'
        ? 'danger'
        : state === 'requested'
          ? 'warning'
          : 'neutral',
    state,
  )

export const leaveListColumns = (_: Translator): Array<Column<LeaveListRow>> => [
  {
    key: 'request',
    label: _('hr_backend.field.requestId'),
    cell: (row) => code(row.id, 'identifier'),
    kind: 'identifier',
  },
  {
    key: 'employee',
    label: _('hr_backend.field.employee'),
    cell: (row) => row.employee,
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'leaveType',
    label: _('hr_backend.field.leaveType'),
    cell: (row) => row.leaveType,
  },
  {
    key: 'range',
    label: _('hr_backend.field.date'),
    cell: (row) => `${row.dateFrom} – ${row.dateTo}`,
  },
  {
    key: 'days',
    label: _('hr_backend.field.days'),
    cell: (row) => row.requestedDays,
    align: 'end',
  },
  {
    key: 'reason',
    label: _('hr_backend.field.reason'),
    cell: (row) => row.reason || '—',
  },
  {
    key: 'state',
    label: _('hr_backend.field.state'),
    cell: (row) => stateBadge(_, row.state),
    kind: 'status',
  },
  {
    key: 'actions',
    label: _('hr_backend.field.actions'),
    cell: (row) =>
      row.state === 'requested' ? (
        <RecordActions
          action={row.action}
          actions={[
            { value: 'approved', label: _('hr_backend.action.approve'), variant: 'primary' },
            { value: 'rejected', label: _('hr_backend.action.reject'), variant: 'destructive' },
          ]}
        />
      ) : (
        ''
      ),
  },
]

export const leavesListScreen = (
  _: Translator,
  frame: Frame,
  options: LeavesListScreenOptions,
): TemplateResult => {
  const table = options.rows.length
    ? dataTable(_, {
        rows: options.rows,
        id: (row) => row.id,
        columns: leaveListColumns(_),
      })
    : emptyState(_('hr_backend.empty.leaves'), _('hr_backend.empty.leavesHint'))
  const body = options.errors?.length
    ? stack([
        <Notice
          tone="danger"
          title={_('hr_backend.leaves.decisionFailed')}
          message={options.errors.join(' ')}
        />,
        table,
      ])
    : table

  return shell(
    _,
    _('hr_backend.leaves.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('hr_backend.leaves.title')}
      description={_('hr_backend.leaves.subtitle')}
      actions={frame.extras?.['topbar.end'] !== undefined ? inline([frame.extras['topbar.end']]) : undefined}
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('hr_backend.leaves.title'),
              { ...frame.chrome, layout: 'command', section: undefined, create: null, selection: null },
              false,
            )
          : undefined
      }
      status={`${_('hr_backend.leaves.title')}: ${String(options.total)}`}
      body={body}
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
