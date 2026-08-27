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

export type WorkCenterListRow = {
  id: string
  code: string
  name: string
  capacity: string
  timeEfficiency: string
  costPerHour: string
  active: boolean
  editHref: string
}

export type WorkCentersListScreenOptions = {
  rows: WorkCenterListRow[]
  /** Locale-aware URL that opens the create modal. */
  createHref: string
  /** Locale-aware collection endpoint for archive and restore commands. */
  action: string
}

export const workCenterListColumns = (_: Translator, action: string): Array<Column<WorkCenterListRow>> => [
  {
    key: 'code',
    label: _('manufacturing_backend.field.code'),
    cell: (row) => code(row.code, 'identifier'),
    kind: 'identifier',
    priority: 'primary',
  },
  {
    key: 'name',
    label: _('manufacturing_backend.field.name'),
    cell: (row) => row.name,
    priority: 'secondary',
    width: 'wide',
  },
  {
    key: 'capacity',
    label: _('manufacturing_backend.field.capacity'),
    cell: (row) => row.capacity,
    align: 'end',
  },
  {
    key: 'timeEfficiency',
    label: _('manufacturing_backend.field.efficiency'),
    cell: (row) => row.timeEfficiency,
    align: 'end',
  },
  {
    key: 'costPerHour',
    label: _('manufacturing_backend.field.cost'),
    cell: (row) => row.costPerHour,
    align: 'end',
  },
  {
    key: 'active',
    label: _('manufacturing_backend.field.state'),
    cell: (row) =>
      row.active
        ? badge(_('manufacturing_backend.state.active'), 'positive', 'active')
        : badge(_('manufacturing_backend.state.archived'), 'neutral', 'archived'),
    kind: 'status',
  },
  {
    key: 'actions',
    label: _('manufacturing_backend.field.actions'),
    cell: (row) => (
      <RecordForm
        action={action}
        layout="inline"
        hidden={{ id: row.id, action: row.active ? 'archive' : 'restore' }}
        fields={[]}
        submit={
          row.active ? _('manufacturing_backend.action.archive') : _('manufacturing_backend.action.restore')
        }
        submitVariant={row.active ? 'tertiary' : 'secondary'}
        submitSize="compact"
      />
    ),
  },
]

export const workCentersListScreen = (
  _: Translator,
  options: WorkCentersListScreenOptions,
  frame: Frame = {},
): TemplateResult =>
  shell(
    _,
    _('manufacturing_backend.workCenters.title'),
    <ListPage
      title={_('manufacturing_backend.workCenters.title')}
      actions={inline([
        <LinkButton
          label={_('manufacturing_backend.workCenters.create')}
          href={options.createHref}
          variant="primary"
        />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      body={
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => row.id,
              rowHref: (row) => row.editHref,
              columns: workCenterListColumns(_, options.action),
            })
          : emptyState(
              _('manufacturing_backend.empty.workCenters'),
              _('manufacturing_backend.empty.workCentersHint'),
            )
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
