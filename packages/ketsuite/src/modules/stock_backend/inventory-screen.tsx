import type { TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
import {
  badge,
  code,
  dataTable,
  emptyState,
  framedPage as Framed,
  icon,
  linkButton,
  notice,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { Column, FormOption, Frame } from '../../ui/index.ts'

export type InventoryBalanceRow = {
  id: string
  product: string
  reference: string
  location: string
  lot: string
  quantity: string
  reserved: string
  available: string
}

export type InventoryScreenOptions = {
  rows: InventoryBalanceRow[]
  products: FormOption[]
  locations: FormOption[]
  inventoryLocations: FormOption[]
  units: FormOption[]
  lots: FormOption[]
  action: string
  locationsHref: string
  applied?: boolean
  errors?: string[]
}

const columns = (_: Translator): Array<Column<InventoryBalanceRow>> => [
  {
    key: 'product',
    label: _('stock_backend.inventory.col.product'),
    cell: (row) => row.product,
    priority: 'primary',
  },
  {
    key: 'reference',
    label: _('stock_backend.inventory.col.reference'),
    cell: (row) => (row.reference ? code(row.reference, 'identifier') : '—'),
    priority: 'secondary',
  },
  {
    key: 'location',
    label: _('stock_backend.inventory.col.location'),
    cell: (row) => row.location,
    priority: 'secondary',
  },
  {
    key: 'lot',
    label: _('stock_backend.inventory.col.lot'),
    cell: (row) => row.lot || '—',
  },
  {
    key: 'quantity',
    label: _('stock_backend.inventory.col.onHand'),
    cell: (row) => row.quantity,
    kind: 'number',
    align: 'end',
  },
  {
    key: 'reserved',
    label: _('stock_backend.inventory.col.reserved'),
    cell: (row) => row.reserved,
    kind: 'number',
    align: 'end',
  },
  {
    key: 'available',
    label: _('stock_backend.inventory.col.available'),
    cell: (row) =>
      badge(
        row.available,
        Number(row.available) > 0 ? 'positive' : Number(row.available) < 0 ? 'danger' : 'neutral',
      ),
    kind: 'number',
    align: 'end',
  },
]

const adjustmentForm = (_: Translator, options: InventoryScreenOptions): TemplateResult => (
  <RecordForm
    id="inventory-adjustment-form"
    scope="inventory-adjustment"
    action={options.action}
    submit={_('stock_backend.action.apply')}
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
        name: 'locationId',
        label: _('stock_backend.field.location'),
        type: 'select',
        options: options.locations,
        required: true,
      },
      {
        name: 'countedQuantity',
        label: _('stock_backend.field.counted'),
        type: 'decimal',
        required: true,
      },
      {
        name: 'productUomId',
        label: _('stock_backend.field.uom'),
        type: 'select',
        options: options.units,
        required: true,
      },
      {
        name: 'lotId',
        label: _('stock_backend.field.lot'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.lots],
      },
      {
        name: 'inventoryLocationId',
        label: _('stock_backend.field.inventoryLocation'),
        type: 'select',
        options: options.inventoryLocations,
        required: true,
        help: _('stock_backend.inventory.adjustmentLocation.help'),
      },
    ]}
  />
)

export const inventoryScreen = (
  _: Translator,
  options: InventoryScreenOptions,
  frame: Frame,
): TemplateResult => {
  const configured =
    options.products.length > 0 &&
    options.locations.length > 0 &&
    options.inventoryLocations.length > 0 &&
    options.units.length > 0
  const totalOnHand = options.rows.reduce((sum, row) => sum + Number(row.quantity), 0)
  const locationCount = new Set(options.rows.map((row) => row.location)).size
  const balances = options.rows.length ? (
    dataTable(_, { columns: columns(_), rows: options.rows, id: (row) => row.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('stock_backend.inventory.empty'), _('stock_backend.inventory.emptyHint'), {
        icon: icon('warehouse'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('stock_backend.inventory')}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('stock_backend.inventory.kicker')}
          title={_('stock_backend.inventory.workspace.title')}
          subtitle={_('stock_backend.inventory.workspace.subtitle')}
          imageFallback={icon('warehouse')}
          summary={[
            {
              id: 'on-hand',
              label: _('stock_backend.inventory.summary.onHand'),
              value: String(totalOnHand),
            },
            {
              id: 'balances',
              label: _('stock_backend.inventory.summary.balances'),
              value: options.rows.length,
            },
            {
              id: 'locations',
              label: _('stock_backend.inventory.summary.locations'),
              value: locationCount,
            },
          ]}
          body={stack(
            [
              options.applied
                ? notice({
                    tone: 'positive',
                    title: _('stock_backend.inventory.applied.title'),
                    message: _('stock_backend.inventory.applied.message'),
                    icon: icon('check-circle'),
                  })
                : null,
              <Section
                title={_('stock_backend.adjustment.title')}
                description={_('stock_backend.adjustment.hint')}
                body={
                  configured ? (
                    <Surface padding="compact" body={adjustmentForm(_, options)} />
                  ) : (
                    notice({
                      tone: 'warning',
                      title: _('stock_backend.inventory.configuration.title'),
                      message: _('stock_backend.inventory.configuration.message'),
                      icon: icon('alert-triangle'),
                      actions: linkButton({
                        label: _('stock_backend.inventory.configuration.action'),
                        href: options.locationsHref,
                        variant: 'secondary',
                      }),
                    })
                  )
                }
              />,
              <Section
                title={_('stock_backend.inventory.balances.title')}
                description={_('stock_backend.inventory.balances.hint')}
                body={balances}
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
