import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  framed,
  icon,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { Column, FormOption, Frame } from '../../ui/index.ts'

export type ReplenishmentRow = {
  id: string
  product: string
  warehouse: string
  location: string
  trigger: string
  triggerLabel: string
  minQuantity: string
  maxQuantity: string
  forecasted: string
  toOrder: string
  replenishmentUom: string
  runAction: string
}

export type ReplenishmentScreenOptions = {
  rows: ReplenishmentRow[]
  products: FormOption[]
  warehouses: FormOption[]
  locations: FormOption[]
  units: FormOption[]
  routes: FormOption[]
  action: string
  errors?: string[]
}

const columns = (_: Translator): Array<Column<ReplenishmentRow>> => [
  {
    key: 'product',
    label: _('stock_backend.replenishment.col.product'),
    cell: (row) => row.product,
    priority: 'primary',
  },
  {
    key: 'location',
    label: _('stock_backend.field.location'),
    cell: (row) => `${row.warehouse} · ${row.location}`,
    priority: 'secondary',
  },
  {
    key: 'forecasted',
    label: _('stock_backend.replenishment.col.forecasted'),
    cell: (row) => row.forecasted,
    kind: 'number',
  },
  {
    key: 'minimum',
    label: _('stock_backend.field.minQuantity'),
    cell: (row) => row.minQuantity,
    kind: 'number',
  },
  {
    key: 'maximum',
    label: _('stock_backend.field.maxQuantity'),
    cell: (row) => row.maxQuantity,
    kind: 'number',
  },
  {
    key: 'toOrder',
    label: _('stock_backend.replenishment.col.toOrder'),
    cell: (row) => badge(row.toOrder, Number(row.toOrder) > 0 ? 'warning' : 'neutral'),
    kind: 'number',
  },
  {
    key: 'uom',
    label: _('stock_backend.field.replenishmentUom'),
    cell: (row) => row.replenishmentUom,
  },
  {
    key: 'trigger',
    label: _('stock_backend.field.trigger'),
    cell: (row) => badge(row.triggerLabel, row.trigger === 'auto' ? 'positive' : 'info'),
  },
  {
    key: 'action',
    label: _('stock_backend.replenishment.col.action'),
    cell: (row) => (
      <RecordForm
        action={row.runAction}
        submit={_('stock_backend.action.run')}
        submitVariant="secondary"
        submitSize="compact"
        layout="inline"
        fields={[]}
      />
    ),
  },
]

const createForm = (_: Translator, options: ReplenishmentScreenOptions): TemplateResult => (
  <RecordForm
    id="replenishment-create-form"
    scope="stock-replenishment-create"
    action={options.action}
    submit={_('stock_backend.action.create')}
    submitVariant="primary"
    errors={options.errors}
    fields={[
      {
        name: 'productId',
        label: _('stock_backend.field.product'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.products],
        required: true,
      },
      {
        name: 'warehouseId',
        label: _('stock_backend.field.warehouse'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.warehouses],
        required: true,
      },
      {
        name: 'locationId',
        label: _('stock_backend.field.location'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.locations],
        required: true,
      },
      {
        name: 'trigger',
        label: _('stock_backend.field.trigger'),
        type: 'select',
        options: [
          { value: 'auto', label: _('stock_backend.trigger.auto') },
          { value: 'manual', label: _('stock_backend.trigger.manual') },
        ],
      },
      {
        name: 'minQuantity',
        label: _('stock_backend.field.minQuantity'),
        type: 'decimal',
        value: 0,
      },
      {
        name: 'maxQuantity',
        label: _('stock_backend.field.maxQuantity'),
        type: 'decimal',
        value: 0,
      },
      {
        name: 'replenishmentUomId',
        label: _('stock_backend.field.replenishmentUom'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.units],
      },
      {
        name: 'routeId',
        label: _('stock_backend.field.route'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.routes],
      },
    ]}
  />
)

export const replenishmentScreen = (
  _: Translator,
  options: ReplenishmentScreenOptions,
  frame: Frame,
): TemplateResult => {
  const toOrder = options.rows.filter((row) => Number(row.toOrder) > 0).length
  const automatic = options.rows.filter((row) => row.trigger === 'auto').length
  const table = options.rows.length ? (
    dataTable(_, { columns: columns(_), rows: options.rows, id: (row) => row.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('stock_backend.replenishment.empty'), _('stock_backend.replenishment.emptyHint'), {
        icon: icon('warehouse'),
      })}
    />
  )

  return framed(
    _,
    _('stock_backend.replenishment'),
    frame,
    <RecordWorkspace
      kicker={_('stock_backend.replenishment.kicker')}
      title={_('stock_backend.replenishment.title')}
      subtitle={_('stock_backend.replenishment.subtitle')}
      imageFallback={icon('warehouse')}
      summary={[
        { id: 'rules', label: _('stock_backend.replenishment.summary.rules'), value: options.rows.length },
        { id: 'automatic', label: _('stock_backend.replenishment.summary.automatic'), value: automatic },
        { id: 'to-order', label: _('stock_backend.replenishment.summary.toOrder'), value: toOrder },
      ]}
      body={stack(
        [
          <Section
            title={_('stock_backend.replenishment.create.title')}
            description={_('stock_backend.replenishment.create.hint')}
            body={<Surface padding="compact" body={createForm(_, options)} />}
          />,
          <Section
            title={_('stock_backend.replenishment.rules.title')}
            description={_('stock_backend.replenishment.rules.hint')}
            body={table}
          />,
        ],
        'loose',
      )}
    />,
  )
}
