import { Stack } from '@ketvietlab/design-system'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  code,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  icon,
  LinkButton,
  ListPage,
  Notice,
  prepareCollectionTable,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, FormOption, Frame } from '../../../ui/index.ts'
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
  createHref?: string | null
  table?: Partial<DataTable<InventoryBalanceRow>>
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

export const inventoryScreen = (
  _: Translator,
  options: InventoryScreenOptions,
  frame: Frame,
): TemplateResult => {
  // A count needs something to count, somewhere to count it and a unit; until
  // then the screen points at the setup instead of offering a count that fails.
  const configured =
    options.products.length > 0 &&
    options.locations.length > 0 &&
    options.inventoryLocations.length > 0 &&
    options.units.length > 0
  const collection = prepareCollectionTable(
    _,
    frame,
    { columns: columns(_), rows: options.rows, id: (row) => row.id, ...options.table },
    { paginate: !options.table?.groups },
  )
  return shell(
    _,
    _('stock_backend.inventory'),
    <ListPage
      variant="operational"
      frame={collection.frame}
      title={_('stock_backend.inventory.workspace.title')}
      headerActions={
        configured && options.createHref ? (
          <LinkButton
            href={options.createHref}
            label={_('stock_backend.adjustment.title')}
            variant="primary"
          />
        ) : null
      }
      actions={collectionActions(_, collection.frame)}
      controls={collectionControls(_, _('stock_backend.inventory'), collection.frame)}
      body={
        <Stack
          items={[
            ...(configured
              ? []
              : [
                  <Notice
                    tone="warning"
                    title={_('stock_backend.inventory.configuration.title')}
                    message={_('stock_backend.inventory.configuration.message')}
                    actions={
                      <LinkButton
                        href={options.locationsHref}
                        label={_('stock_backend.inventory.configuration.action')}
                        variant="secondary"
                      />
                    }
                  />,
                ]),
            ...(options.applied
              ? [
                  <Notice
                    tone="positive"
                    title={_('stock_backend.inventory.applied.title')}
                    message={_('stock_backend.inventory.applied.message')}
                  />,
                ]
              : []),
            ...(options.errors?.length
              ? [
                  <Notice
                    tone="danger"
                    title={_('stock_backend.invalid')}
                    message={options.errors.join(' ')}
                  />,
                ]
              : []),
            options.rows.length || options.table?.groups?.length
              ? collectionTable(_, collection.table)
              : emptyState(_('stock_backend.inventory.empty'), _('stock_backend.inventory.emptyHint'), {
                  icon: icon('warehouse'),
                }),
          ]}
        />
      }
    />,
    { ...collection.frame, chrome: null, topbar: false },
  )
}
