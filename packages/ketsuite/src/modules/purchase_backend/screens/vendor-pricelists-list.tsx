import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  emptyState,
  formatMoney,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { Column, DataTable, FormField, Frame } from '../../../ui/index.ts'
import { missingSetup, rejection } from './shared.tsx'

export type VendorPricelistRow = {
  id: string
  partnerId: string
  partnerName?: string | null
  productTemplateId: string
  productNameDisplay?: string | null
  minQty: string | number
  price: string | number
  discount: string | number
  delay: string | number
}

export type VendorPricelistsListScreenOptions = {
  frame: Frame
  rows: VendorPricelistRow[]
  methodFields: FormField[]
  /** Locale-aware list and policy POST endpoint. */
  action: string
  /** Locale-aware `/admin/purchase/vendor-pricelists/new` URL. */
  createHref: string
  currency?: unknown
  invalid?: string | null
  setup?: { pickingTypes: number; vendors: number }
  table?: Partial<DataTable<VendorPricelistRow>>
}

export const vendorPricelistColumns = (
  _: Translator,
  currency?: unknown,
): Array<Column<VendorPricelistRow>> => [
  {
    key: 'vendor',
    label: _('purchase_backend.field.vendor'),
    cell: (row) => String(row.partnerName ?? row.partnerId),
    priority: 'primary',
    width: 'wide',
  },
  {
    key: 'product',
    label: _('purchase_backend.field.product'),
    cell: (row) => String(row.productNameDisplay ?? row.productTemplateId),
    priority: 'secondary',
  },
  {
    key: 'min',
    label: _('purchase_backend.field.minQty'),
    cell: (row) => String(row.minQty),
    kind: 'number',
  },
  {
    key: 'price',
    label: _('purchase_backend.field.priceUnit'),
    cell: (row) => formatMoney(_, row.price, currency),
    align: 'end',
    kind: 'currency',
  },
  {
    key: 'discount',
    label: _('purchase_backend.field.discount'),
    cell: (row) => `${String(row.discount)}%`,
    kind: 'number',
  },
  {
    key: 'delay',
    label: _('purchase_backend.field.delay'),
    cell: (row) => String(row.delay),
    kind: 'number',
  },
]

export const vendorPricelistsListScreen = (
  _: Translator,
  options: VendorPricelistsListScreenOptions,
): TemplateResult => {
  const table =
    options.rows.length || options.table?.groups?.length
      ? dataTable(_, {
          rows: options.rows,
          id: (row) => row.id,
          columns: vendorPricelistColumns(_, options.currency),
          ...options.table,
        })
      : options.setup && (!options.setup.vendors || !options.setup.pickingTypes)
        ? null
        : emptyState(_('purchase_backend.empty'), _('purchase_backend.emptyHint'))

  return shell(
    _,
    _('purchase_backend.pricelists.title'),
    <ListPage
      variant="operational"
      frame={options.frame}
      title={_('purchase_backend.pricelists.title')}
      actions={inline([
        <LinkButton
          label={_('purchase_backend.action.addVendorPrice')}
          href={options.createHref}
          variant="primary"
        />,
        options.frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        options.frame.chrome
          ? listChrome(
              _,
              _('purchase_backend.pricelists.title'),
              {
                ...options.frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={`${_('purchase_backend.dashboard.records')}: ${String(options.rows.length)}`}
      body={stack(
        [
          rejection(_, options.invalid),
          options.setup ? missingSetup(_, options.setup) : null,
          <Section
            title={_('purchase_backend.method.title')}
            body={
              <Surface
                body={
                  <RecordForm
                    action={options.action}
                    submit={_('purchase_backend.action.saveMethod')}
                    submitVariant="primary"
                    hidden={{ action: 'method' }}
                    fields={options.methodFields}
                  />
                }
              />
            }
          />,
          table,
        ],
        'loose',
      )}
    />,
    { ...options.frame, chrome: null, topbar: false },
  )
}
