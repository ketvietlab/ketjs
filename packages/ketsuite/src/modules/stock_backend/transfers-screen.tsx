import type { TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
import {
  badge,
  dataTable,
  emptyState,
  framed,
  icon,
  linkButton,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { Column, FormOption, Frame } from '../../ui/index.ts'

export type TransferListRow = {
  id: string
  name: string
  operationType: string
  source: string
  destination: string
  scheduledDate: string
  state: string
  href: string
}

export type TransfersScreenOptions = {
  rows: TransferListRow[]
  pickingTypes: FormOption[]
  action: string
  errors?: string[]
}

const stateTone = (state: string): 'positive' | 'danger' | 'neutral' => {
  if (state === 'done') return 'positive'
  if (state === 'cancel') return 'danger'
  return 'neutral'
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

const columns = (_: Translator): Array<Column<TransferListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.transfer.list.col.reference'),
    cell: (row) => linkButton({ label: row.name, href: row.href, variant: 'tertiary' }),
    priority: 'primary',
  },
  {
    key: 'source',
    label: _('stock_backend.transfer.list.col.source'),
    cell: (row) => row.source,
    priority: 'secondary',
  },
  {
    key: 'destination',
    label: _('stock_backend.transfer.list.col.destination'),
    cell: (row) => row.destination,
    priority: 'secondary',
  },
  {
    key: 'scheduledDate',
    label: _('stock_backend.transfer.list.col.scheduledDate'),
    cell: (row) => row.scheduledDate || '—',
    kind: 'date',
  },
  {
    key: 'operationType',
    label: _('stock_backend.transfer.list.col.operationType'),
    cell: (row) => row.operationType,
    optional: true,
  },
  {
    key: 'state',
    label: _('stock_backend.transfer.list.col.state'),
    cell: (row) => badge(selectionLabel(_, 'state', row.state), stateTone(row.state), row.state),
    kind: 'status',
  },
]

const createForm = (_: Translator, options: TransfersScreenOptions): TemplateResult => (
  <RecordForm
    id="transfer-create-form"
    scope="transfer-create"
    action={options.action}
    submit={_('stock_backend.action.create')}
    submitVariant="primary"
    errors={options.errors}
    fields={[
      {
        name: 'name',
        label: _('stock_backend.field.reference'),
        required: true,
        help: _('stock_backend.transfer.create.reference.help'),
      },
      {
        name: 'pickingTypeId',
        label: _('stock_backend.field.operationType'),
        type: 'select',
        options: options.pickingTypes,
        required: true,
      },
      {
        name: 'scheduledDate',
        label: _('stock_backend.field.scheduledDate'),
        type: 'datetime-local',
      },
    ]}
  />
)

export const transfersScreen = (
  _: Translator,
  options: TransfersScreenOptions,
  frame: Frame,
): TemplateResult => {
  const openCount = options.rows.filter((row) => !['done', 'cancel'].includes(row.state)).length
  const readyCount = options.rows.filter((row) => ['assigned', 'reserved'].includes(row.state)).length
  const doneCount = options.rows.filter((row) => row.state === 'done').length
  const transferTable = options.rows.length ? (
    dataTable(_, { columns: columns(_), rows: options.rows, id: (row) => row.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('stock_backend.transfer.list.empty'), _('stock_backend.transfer.list.emptyHint'), {
        icon: icon('truck'),
      })}
    />
  )

  return framed(
    _,
    _('stock_backend.transfers'),
    frame,
    <RecordWorkspace
      kicker={_('stock_backend.transfer.list.kicker')}
      title={_('stock_backend.transfer.list.title')}
      subtitle={_('stock_backend.transfer.list.subtitle')}
      imageFallback={icon('truck')}
      summary={[
        { id: 'open', label: _('stock_backend.transfer.list.summary.open'), value: openCount },
        { id: 'ready', label: _('stock_backend.transfer.list.summary.ready'), value: readyCount },
        { id: 'done', label: _('stock_backend.transfer.list.summary.done'), value: doneCount },
      ]}
      body={stack(
        [
          <Section
            title={_('stock_backend.transfer.create.title')}
            description={_('stock_backend.transfer.create.hint')}
            body={<Surface padding="compact" body={createForm(_, options)} />}
          />,
          <Section
            title={_('stock_backend.transfer.list.records.title')}
            description={_('stock_backend.transfer.list.records.hint')}
            body={transferTable}
          />,
        ],
        'loose',
      )}
    />,
  )
}
