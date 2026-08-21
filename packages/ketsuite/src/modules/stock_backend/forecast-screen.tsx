import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
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

export type ForecastRow = {
  id: string
  onHand: string
  reserved: string
  available: string
  incoming: string
  outgoing: string
  forecasted: string
  uom: string
}

export type ForecastScreenOptions = {
  products: FormOption[]
  warehouses: FormOption[]
  locations: FormOption[]
  productId: string
  warehouseId: string
  locationId: string
  productLabel?: string
  scopeLabel?: string
  row?: ForecastRow
  action: string
  lang: string
}

const columns = (_: Translator): Array<Column<ForecastRow>> => [
  {
    key: 'onHand',
    label: _('stock_backend.forecast.onHand'),
    cell: (row) => row.onHand,
    kind: 'number',
  },
  {
    key: 'reserved',
    label: _('stock_backend.forecast.reserved'),
    cell: (row) => row.reserved,
    kind: 'number',
  },
  {
    key: 'available',
    label: _('stock_backend.forecast.available'),
    cell: (row) => badge(row.available, Number(row.available) < 0 ? 'danger' : 'positive'),
    kind: 'number',
  },
  {
    key: 'incoming',
    label: _('stock_backend.forecast.incoming'),
    cell: (row) => row.incoming,
    kind: 'number',
  },
  {
    key: 'outgoing',
    label: _('stock_backend.forecast.outgoing'),
    cell: (row) => row.outgoing,
    kind: 'number',
  },
  {
    key: 'forecasted',
    label: _('stock_backend.forecast.value'),
    cell: (row) => badge(row.forecasted, Number(row.forecasted) < 0 ? 'danger' : 'info'),
    kind: 'number',
  },
  {
    key: 'uom',
    label: _('stock_backend.field.uom'),
    cell: (row) => row.uom,
  },
]

const filterForm = (_: Translator, options: ForecastScreenOptions): TemplateResult => (
  <RecordForm
    id="forecast-filter-form"
    scope="stock-forecast"
    action={options.action}
    method="get"
    submit={_('stock_backend.action.calculate')}
    submitVariant="primary"
    hidden={{ lang: options.lang }}
    fields={[
      {
        name: 'productId',
        label: _('stock_backend.field.product'),
        type: 'select',
        value: options.productId,
        options: [{ value: '', label: '—' }, ...options.products],
        required: true,
      },
      {
        name: 'warehouseId',
        label: _('stock_backend.field.warehouse'),
        type: 'select',
        value: options.warehouseId,
        options: [{ value: '', label: '—' }, ...options.warehouses],
      },
      {
        name: 'locationId',
        label: _('stock_backend.field.location'),
        type: 'select',
        value: options.locationId,
        options: [{ value: '', label: '—' }, ...options.locations],
        help: _('stock_backend.forecast.location.help'),
      },
    ]}
  />
)

export const forecastScreen = (
  _: Translator,
  options: ForecastScreenOptions,
  frame: Frame,
): TemplateResult => {
  const row = options.row
  const result = row ? (
    dataTable(_, { columns: columns(_), rows: [row], id: (entry) => entry.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('stock_backend.forecast.empty'), _('stock_backend.forecast.emptyHint'), {
        icon: icon('warehouse'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('stock_backend.forecast')}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('stock_backend.forecast.kicker')}
          title={options.productLabel ?? _('stock_backend.forecast.title')}
          subtitle={options.scopeLabel ?? _('stock_backend.forecast.subtitle')}
          imageFallback={icon('warehouse')}
          summary={
            row
              ? [
                  { id: 'on-hand', label: _('stock_backend.forecast.onHand'), value: row.onHand },
                  { id: 'incoming', label: _('stock_backend.forecast.incoming'), value: `+ ${row.incoming}` },
                  { id: 'outgoing', label: _('stock_backend.forecast.outgoing'), value: `− ${row.outgoing}` },
                  {
                    id: 'forecasted',
                    label: _('stock_backend.forecast.value'),
                    value: `= ${row.forecasted}`,
                  },
                ]
              : [
                  {
                    id: 'products',
                    label: _('stock_backend.forecast.summary.products'),
                    value: options.products.length,
                  },
                  {
                    id: 'warehouses',
                    label: _('stock_backend.forecast.summary.warehouses'),
                    value: options.warehouses.length,
                  },
                  {
                    id: 'locations',
                    label: _('stock_backend.forecast.summary.locations'),
                    value: options.locations.length,
                  },
                ]
          }
          body={stack(
            [
              <Section
                title={_('stock_backend.forecast.filter.title')}
                description={_('stock_backend.forecast.filter.hint')}
                body={<Surface padding="compact" body={filterForm(_, options)} />}
              />,
              <Section
                title={_('stock_backend.forecast.result.title')}
                description={_('stock_backend.forecast.result.hint')}
                body={result}
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
