import type { JSXChild, TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
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

export type LotInventoryRow = {
  id: string
  location: string
  quantity: string
  reserved: string
  available: string
  countsAsOnHand: boolean
}

export type LotDetailOptions = {
  lot: {
    id: string
    name: string
    productId: string
    productLabel: string
    ref: string
    note: string
    active: boolean
  }
  rows: LotInventoryRow[]
  products: FormOption[]
  action: string
  collaboration: JSXChild
  editor: JSXChild
  errors?: string[]
}

const columns = (_: Translator): Array<Column<LotInventoryRow>> => [
  {
    key: 'location',
    label: _('stock_backend.lot.col.location'),
    cell: (row) => row.location,
    priority: 'primary',
  },
  {
    key: 'quantity',
    label: _('stock_backend.lot.col.onHand'),
    cell: (row) => row.quantity,
    kind: 'number',
    align: 'end',
    priority: 'secondary',
  },
  {
    key: 'reserved',
    label: _('stock_backend.lot.col.reserved'),
    cell: (row) => row.reserved,
    kind: 'number',
    align: 'end',
  },
  {
    key: 'available',
    label: _('stock_backend.lot.col.available'),
    cell: (row) =>
      badge(
        row.available,
        Number(row.available) > 0 ? 'positive' : Number(row.available) < 0 ? 'danger' : 'neutral',
      ),
    kind: 'number',
    align: 'end',
  },
]

const lotForm = (_: Translator, options: LotDetailOptions): TemplateResult => (
  <RecordForm
    id="lot-detail-form"
    scope="stock-lot"
    action={options.action}
    submit={_('stock_backend.action.save')}
    submitVariant="primary"
    errors={options.errors}
    fields={[
      {
        name: 'productId',
        label: _('stock_backend.field.product'),
        type: 'select',
        value: options.lot.productId,
        options: options.products,
        required: true,
      },
      {
        name: 'name',
        label: _('stock_backend.field.lotSerial'),
        value: options.lot.name,
        required: true,
      },
      {
        name: 'ref',
        label: _('stock_backend.lot.field.reference'),
        value: options.lot.ref,
        help: _('stock_backend.lot.field.reference.help'),
      },
      {
        name: 'note',
        label: _('stock_backend.lot.field.description'),
        type: 'textarea',
        value: options.lot.note,
        span: 'full',
      },
    ]}
  />
)

export const lotDetailScreen = (_: Translator, options: LotDetailOptions, frame: Frame): TemplateResult => {
  const onHandRows = options.rows.filter((row) => row.countsAsOnHand)
  const totalOnHand = onHandRows.reduce((sum, row) => sum + Number(row.quantity), 0)
  const totalAvailable = onHandRows.reduce((sum, row) => sum + Number(row.available), 0)
  const inventory = options.rows.length ? (
    dataTable(_, { columns: columns(_), rows: options.rows, id: (row) => row.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('stock_backend.lot.empty'), _('stock_backend.lot.emptyHint'), {
        icon: icon('warehouse'),
      })}
    />
  )

  return framed(
    _,
    _('stock_backend.lot.kicker'),
    frame,
    <RecordWorkspace
      kicker={_('stock_backend.lot.kicker')}
      title={options.lot.name}
      subtitle={`${options.lot.productLabel}${options.lot.ref ? ` · ${options.lot.ref}` : ''}`}
      imageFallback={icon('package')}
      badges={[
        badge(
          options.lot.active ? _('stock_backend.lot.status.active') : _('stock_backend.lot.status.archived'),
          options.lot.active ? 'positive' : 'danger',
        ),
      ]}
      summary={[
        { id: 'on-hand', label: _('stock_backend.lot.summary.onHand'), value: totalOnHand },
        { id: 'available', label: _('stock_backend.lot.summary.available'), value: totalAvailable },
        {
          id: 'locations',
          label: _('stock_backend.lot.summary.locations'),
          value: options.rows.length,
        },
      ]}
      controller={options.editor}
      body={stack(
        [
          <Section
            title={_('stock_backend.lot.information.title')}
            description={_('stock_backend.lot.information.hint')}
            body={<Surface padding="compact" body={lotForm(_, options)} />}
          />,
          <Section
            title={_('stock_backend.lot.inventory.title')}
            description={_('stock_backend.lot.inventory.hint')}
            body={inventory}
          />,
        ],
        'loose',
      )}
      aside={options.collaboration}
      asideLabel={_('stock_backend.lot.collaboration.label')}
    />,
  )
}
