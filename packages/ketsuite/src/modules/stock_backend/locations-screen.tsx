import type { TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'
import {
  badge,
  dataTable,
  emptyState,
  framedPage as Framed,
  icon,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { Column, FormOption, Frame } from '../../ui/index.ts'

export type LocationListRow = {
  id: string
  completeName: string
  usage: string
  warehouse: string
}

export type LocationsScreenOptions = {
  rows: LocationListRow[]
  warehouses: FormOption[]
  parents: FormOption[]
  action: string
  errors?: string[]
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

const usageTone = (usage: string): 'info' | 'positive' | 'neutral' => {
  if (usage === 'internal') return 'positive'
  if (usage === 'view') return 'info'
  return 'neutral'
}

const columns = (_: Translator): Array<Column<LocationListRow>> => [
  {
    key: 'completeName',
    label: _('stock_backend.location.col.location'),
    cell: (row) => row.completeName,
    priority: 'primary',
  },
  {
    key: 'usage',
    label: _('stock_backend.location.col.usage'),
    cell: (row) => badge(selectionLabel(_, 'usage', row.usage), usageTone(row.usage), row.usage),
    kind: 'status',
    priority: 'secondary',
  },
  {
    key: 'warehouse',
    label: _('stock_backend.location.col.warehouse'),
    cell: (row) => row.warehouse || '—',
  },
]

const usageOptions = (_: Translator): FormOption[] =>
  ['internal', 'view', 'supplier', 'customer', 'inventory', 'production', 'transit'].map((value) => ({
    value,
    label: selectionLabel(_, 'usage', value),
  }))

const createForm = (_: Translator, options: LocationsScreenOptions): TemplateResult => (
  <RecordForm
    id="location-create-form"
    scope="location-create"
    action={options.action}
    submit={_('stock_backend.action.create')}
    submitVariant="primary"
    errors={options.errors}
    fields={[
      {
        name: 'name',
        label: _('stock_backend.location.field.name'),
        placeholder: _('stock_backend.location.field.name.placeholder'),
        required: true,
      },
      {
        name: 'parentId',
        label: _('stock_backend.field.parentLocation'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.parents],
      },
      {
        name: 'usage',
        label: _('stock_backend.field.usage'),
        type: 'select',
        value: 'internal',
        options: usageOptions(_),
        required: true,
        help: _('stock_backend.location.field.usage.help'),
      },
      {
        name: 'warehouseId',
        label: _('stock_backend.field.warehouse'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.warehouses],
        help: _('stock_backend.location.field.warehouse.help'),
      },
    ]}
  />
)

export const locationsScreen = (
  _: Translator,
  options: LocationsScreenOptions,
  frame: Frame,
): TemplateResult => {
  const internalCount = options.rows.filter((row) => row.usage === 'internal').length
  const viewCount = options.rows.filter((row) => row.usage === 'view').length
  const warehouseCount = new Set(options.rows.map((row) => row.warehouse).filter(Boolean)).size
  const table = options.rows.length ? (
    dataTable(_, { columns: columns(_), rows: options.rows, id: (row) => row.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('stock_backend.location.empty'), _('stock_backend.location.emptyHint'), {
        icon: icon('warehouse'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('stock_backend.locations')}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('stock_backend.location.kicker')}
          title={_('stock_backend.location.title')}
          subtitle={_('stock_backend.location.subtitle')}
          imageFallback={icon('warehouse')}
          summary={[
            {
              id: 'internal',
              label: _('stock_backend.location.summary.internal'),
              value: internalCount,
            },
            { id: 'views', label: _('stock_backend.location.summary.views'), value: viewCount },
            {
              id: 'warehouses',
              label: _('stock_backend.location.summary.warehouses'),
              value: warehouseCount,
            },
          ]}
          body={stack(
            [
              <Section
                title={_('stock_backend.location.create.title')}
                description={_('stock_backend.location.create.hint')}
                body={<Surface padding="compact" body={createForm(_, options)} />}
              />,
              <Section
                title={_('stock_backend.location.configured.title')}
                description={_('stock_backend.location.configured.hint')}
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
