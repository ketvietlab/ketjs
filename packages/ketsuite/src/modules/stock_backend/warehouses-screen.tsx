import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  code,
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
import type { Column, Frame } from '../../ui/index.ts'

export type WarehouseListRow = {
  id: string
  name: string
  code: string
  receptionSteps: string
  deliverySteps: string
}

export type WarehousesScreenOptions = {
  rows: WarehouseListRow[]
  action: string
  errors?: string[]
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

const columns = (_: Translator): Array<Column<WarehouseListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.warehouse.col.name'),
    cell: (row) => row.name,
    priority: 'primary',
  },
  {
    key: 'code',
    label: _('stock_backend.warehouse.col.code'),
    cell: (row) => code(row.code, 'identifier'),
    kind: 'identifier',
    priority: 'secondary',
  },
  {
    key: 'receptionSteps',
    label: _('stock_backend.warehouse.col.reception'),
    cell: (row) => badge(selectionLabel(_, 'receptionSteps', row.receptionSteps)),
  },
  {
    key: 'deliverySteps',
    label: _('stock_backend.warehouse.col.delivery'),
    cell: (row) => badge(selectionLabel(_, 'deliverySteps', row.deliverySteps)),
  },
]

const createForm = (_: Translator, options: WarehousesScreenOptions): TemplateResult => (
  <RecordForm
    id="warehouse-create-form"
    scope="warehouse-create"
    action={options.action}
    submit={_('stock_backend.action.create')}
    submitVariant="primary"
    errors={options.errors}
    fields={[
      {
        name: 'name',
        label: _('stock_backend.warehouse.field.name'),
        placeholder: _('stock_backend.warehouse.field.name.placeholder'),
        required: true,
      },
      {
        name: 'code',
        label: _('stock_backend.warehouse.field.code'),
        placeholder: _('stock_backend.warehouse.field.code.placeholder'),
        help: _('stock_backend.warehouse.field.code.help'),
        required: true,
      },
      {
        name: 'receptionSteps',
        label: _('stock_backend.field.receptionSteps'),
        type: 'radio',
        value: 'one_step',
        options: ['one_step', 'two_steps', 'three_steps'].map((value) => ({
          value,
          label: selectionLabel(_, 'receptionSteps', value),
        })),
        span: 'full',
      },
      {
        name: 'deliverySteps',
        label: _('stock_backend.field.deliverySteps'),
        type: 'radio',
        value: 'ship_only',
        options: ['ship_only', 'pick_ship', 'pick_pack_ship'].map((value) => ({
          value,
          label: selectionLabel(_, 'deliverySteps', value),
        })),
        span: 'full',
      },
    ]}
  />
)

export const warehousesScreen = (
  _: Translator,
  options: WarehousesScreenOptions,
  frame: Frame,
): TemplateResult => {
  const multiStepReceipts = options.rows.filter((row) => row.receptionSteps !== 'one_step').length
  const multiStepDeliveries = options.rows.filter((row) => row.deliverySteps !== 'ship_only').length
  const table = options.rows.length ? (
    dataTable(_, { columns: columns(_), rows: options.rows, id: (row) => row.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('stock_backend.warehouse.empty'), _('stock_backend.warehouse.emptyHint'), {
        icon: icon('warehouse'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('stock_backend.warehouses')}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('stock_backend.warehouse.kicker')}
          title={_('stock_backend.warehouse.title')}
          subtitle={_('stock_backend.warehouse.subtitle')}
          imageFallback={icon('warehouse')}
          summary={[
            {
              id: 'warehouses',
              label: _('stock_backend.warehouse.summary.total'),
              value: options.rows.length,
            },
            {
              id: 'receipts',
              label: _('stock_backend.warehouse.summary.receipts'),
              value: multiStepReceipts,
            },
            {
              id: 'deliveries',
              label: _('stock_backend.warehouse.summary.deliveries'),
              value: multiStepDeliveries,
            },
          ]}
          body={stack(
            [
              <Section
                title={_('stock_backend.warehouse.create.title')}
                description={_('stock_backend.warehouse.create.hint')}
                body={<Surface padding="compact" body={createForm(_, options)} />}
              />,
              <Section
                title={_('stock_backend.warehouse.configured.title')}
                description={_('stock_backend.warehouse.configured.hint')}
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
