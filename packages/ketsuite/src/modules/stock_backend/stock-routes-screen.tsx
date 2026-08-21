import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  emptyState,
  Framed,
  icon,
  linkButton,
  RecordForm,
  RecordWorkspace,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Column, Frame } from '../../ui/index.ts'

export type StockRouteListRow = {
  id: string
  name: string
  sequence: number
  ruleCount: number
  href: string
}

export type StockRoutesScreenOptions = {
  rows: StockRouteListRow[]
  action: string
  errors?: string[]
}

const columns = (_: Translator): Array<Column<StockRouteListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.stockRoute.list.col.name'),
    cell: (row) => linkButton({ label: row.name, href: row.href, variant: 'tertiary' }),
    priority: 'primary',
  },
  {
    key: 'sequence',
    label: _('stock_backend.stockRoute.list.col.sequence'),
    cell: (row) => String(row.sequence),
    kind: 'number',
  },
  {
    key: 'ruleCount',
    label: _('stock_backend.stockRoute.list.col.rules'),
    cell: (row) => String(row.ruleCount),
    kind: 'number',
    priority: 'secondary',
  },
]

const createForm = (_: Translator, options: StockRoutesScreenOptions): TemplateResult => (
  <RecordForm
    id="stock-route-create-form"
    scope="stock-route-create"
    action={options.action}
    submit={_('stock_backend.action.create')}
    submitVariant="primary"
    errors={options.errors}
    fields={[
      {
        name: 'name',
        label: _('stock_backend.stockRoute.field.name'),
        placeholder: _('stock_backend.stockRoute.field.name.placeholder'),
        required: true,
      },
      {
        name: 'sequence',
        label: _('stock_backend.field.sequence'),
        type: 'number',
        value: 10,
        help: _('stock_backend.stockRoute.field.sequence.help'),
      },
    ]}
  />
)

export const stockRoutesScreen = (
  _: Translator,
  options: StockRoutesScreenOptions,
  frame: Frame,
): TemplateResult => {
  const ruleCount = options.rows.reduce((total, row) => total + row.ruleCount, 0)
  const configuredCount = options.rows.filter((row) => row.ruleCount > 0).length
  const table = options.rows.length ? (
    dataTable(_, { columns: columns(_), rows: options.rows, id: (row) => row.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(
        _('stock_backend.stockRoute.list.empty'),
        _('stock_backend.stockRoute.list.emptyHint'),
        { icon: icon('sliders-horizontal') },
      )}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('stock_backend.routes')}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('stock_backend.stockRoute.list.kicker')}
          title={_('stock_backend.stockRoute.list.title')}
          subtitle={_('stock_backend.stockRoute.list.subtitle')}
          imageFallback={icon('sliders-horizontal')}
          summary={[
            {
              id: 'total',
              label: _('stock_backend.stockRoute.list.summary.total'),
              value: options.rows.length,
            },
            {
              id: 'configured',
              label: _('stock_backend.stockRoute.list.summary.configured'),
              value: configuredCount,
            },
            { id: 'rules', label: _('stock_backend.stockRoute.list.summary.rules'), value: ruleCount },
          ]}
          body={stack(
            [
              <Section
                title={_('stock_backend.stockRoute.create.title')}
                description={_('stock_backend.stockRoute.create.hint')}
                body={<Surface padding="compact" body={createForm(_, options)} />}
              />,
              <Section
                title={_('stock_backend.stockRoute.list.records.title')}
                description={_('stock_backend.stockRoute.list.records.hint')}
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
