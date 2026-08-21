import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  dataTable,
  emptyState,
  Framed,
  icon,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Column, FormOption, Frame } from '../../ui/index.ts'

export type PickingTypeListRow = {
  id: string
  name: string
  code: string
  warehouse: string
  source: string
  destination: string
  createBackorder: string
}

export type PickingTypesScreenOptions = {
  rows: PickingTypeListRow[]
  warehouses: FormOption[]
  locations: FormOption[]
  action: string
  errors?: string[]
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

const operationTone = (code: string): 'info' | 'positive' | 'neutral' => {
  if (code === 'incoming') return 'positive'
  if (code === 'outgoing') return 'info'
  return 'neutral'
}

const columns = (_: Translator): Array<Column<PickingTypeListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.pickingType.col.name'),
    cell: (row) => row.name,
    priority: 'primary',
  },
  {
    key: 'code',
    label: _('stock_backend.pickingType.col.code'),
    cell: (row) => badge(selectionLabel(_, 'pickingType', row.code), operationTone(row.code), row.code),
    kind: 'status',
    priority: 'secondary',
  },
  {
    key: 'warehouse',
    label: _('stock_backend.pickingType.col.warehouse'),
    cell: (row) => row.warehouse || '—',
    priority: 'secondary',
  },
  {
    key: 'route',
    label: _('stock_backend.pickingType.col.route'),
    cell: (row) => `${row.source || '—'} → ${row.destination || '—'}`,
  },
  {
    key: 'createBackorder',
    label: _('stock_backend.pickingType.col.backorder'),
    cell: (row) => badge(selectionLabel(_, 'backorder', row.createBackorder)),
    optional: true,
  },
]

const selectionOptions = (_: Translator, group: string, values: readonly string[]): FormOption[] =>
  values.map((value) => ({ value, label: selectionLabel(_, group, value) }))

const createForm = (_: Translator, options: PickingTypesScreenOptions): TemplateResult => (
  <RecordForm
    id="picking-type-create-form"
    scope="picking-type-create"
    action={options.action}
    submit={_('stock_backend.action.create')}
    submitVariant="primary"
    errors={options.errors}
    fields={[
      {
        name: 'name',
        label: _('stock_backend.pickingType.field.name'),
        placeholder: _('stock_backend.pickingType.field.name.placeholder'),
        required: true,
      },
      {
        name: 'code',
        label: _('stock_backend.pickingType.field.code'),
        type: 'radio',
        value: 'internal',
        options: selectionOptions(_, 'pickingType', ['incoming', 'outgoing', 'internal']),
        required: true,
        span: 'full',
      },
      {
        name: 'warehouseId',
        label: _('stock_backend.field.warehouse'),
        type: 'select',
        options: options.warehouses,
        required: true,
      },
      {
        name: 'createBackorder',
        label: _('stock_backend.field.backorder'),
        type: 'select',
        value: 'ask',
        options: selectionOptions(_, 'backorder', ['ask', 'always', 'never']),
        required: true,
        help: _('stock_backend.pickingType.field.backorder.help'),
      },
      {
        name: 'defaultLocationSrcId',
        label: _('stock_backend.field.sourceLocation'),
        type: 'select',
        options: options.locations,
        required: true,
      },
      {
        name: 'defaultLocationDestId',
        label: _('stock_backend.field.destinationLocation'),
        type: 'select',
        options: options.locations,
        required: true,
      },
    ]}
  />
)

export const pickingTypesScreen = (
  _: Translator,
  options: PickingTypesScreenOptions,
  frame: Frame,
): TemplateResult => {
  const incomingCount = options.rows.filter((row) => row.code === 'incoming').length
  const outgoingCount = options.rows.filter((row) => row.code === 'outgoing').length
  const internalCount = options.rows.filter((row) => row.code === 'internal').length
  const table = options.rows.length ? (
    dataTable(_, { columns: columns(_), rows: options.rows, id: (row) => row.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('stock_backend.pickingType.empty'), _('stock_backend.pickingType.emptyHint'), {
        icon: icon('truck'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('stock_backend.pickingTypes')}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('stock_backend.pickingType.kicker')}
          title={_('stock_backend.pickingType.title')}
          subtitle={_('stock_backend.pickingType.subtitle')}
          imageFallback={icon('truck')}
          summary={[
            { id: 'incoming', label: _('stock_backend.pickingType.summary.incoming'), value: incomingCount },
            { id: 'outgoing', label: _('stock_backend.pickingType.summary.outgoing'), value: outgoingCount },
            { id: 'internal', label: _('stock_backend.pickingType.summary.internal'), value: internalCount },
          ]}
          body={stack(
            [
              <Section
                title={_('stock_backend.pickingType.create.title')}
                description={_('stock_backend.pickingType.create.hint')}
                body={<Surface padding="compact" body={createForm(_, options)} />}
              />,
              <Section
                title={_('stock_backend.pickingType.configured.title')}
                description={_('stock_backend.pickingType.configured.hint')}
                body={table}
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
