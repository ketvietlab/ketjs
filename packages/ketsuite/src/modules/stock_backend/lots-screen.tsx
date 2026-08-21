import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  framedPage as Framed,
  icon,
  linkButton,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { Column, FormOption, Frame } from '../../ui/index.ts'

export type LotListRow = {
  id: string
  name: string
  product: string
  reference: string
  onHand: string
  onHandValue: number
  active: boolean
  href: string
}

export type LotsScreenOptions = {
  rows: LotListRow[]
  products: FormOption[]
  action: string
  errors?: string[]
}

const columns = (_: Translator): Array<Column<LotListRow>> => [
  {
    key: 'name',
    label: _('stock_backend.lot.list.col.name'),
    cell: (row) => linkButton({ label: row.name, href: row.href, variant: 'tertiary' }),
    priority: 'primary',
  },
  {
    key: 'product',
    label: _('stock_backend.lot.list.col.product'),
    cell: (row) => row.product,
    priority: 'secondary',
  },
  {
    key: 'reference',
    label: _('stock_backend.lot.list.col.reference'),
    cell: (row) => row.reference || '—',
  },
  {
    key: 'onHand',
    label: _('stock_backend.lot.list.col.onHand'),
    cell: (row) => row.onHand,
    kind: 'number',
  },
  {
    key: 'active',
    label: _('stock_backend.lot.list.col.status'),
    cell: (row) =>
      badge(
        row.active ? _('stock_backend.lot.status.active') : _('stock_backend.lot.status.archived'),
        row.active ? 'positive' : 'neutral',
        row.active ? 'active' : 'archived',
      ),
    kind: 'status',
  },
]

const createForm = (_: Translator, options: LotsScreenOptions): TemplateResult => (
  <RecordForm
    id="lot-create-form"
    scope="lot-create"
    action={options.action}
    submit={_('stock_backend.action.create')}
    submitVariant="primary"
    errors={options.errors}
    fields={[
      {
        name: 'productId',
        label: _('stock_backend.lot.field.product'),
        type: 'select',
        options: options.products,
        required: true,
        help: _('stock_backend.lot.create.product.help'),
      },
      {
        name: 'name',
        label: _('stock_backend.field.lotSerial'),
        placeholder: _('stock_backend.lot.create.name.placeholder'),
        required: true,
      },
      {
        name: 'ref',
        label: _('stock_backend.lot.field.reference'),
      },
      {
        name: 'note',
        label: _('stock_backend.lot.field.description'),
        type: 'textarea',
        span: 'full',
      },
    ]}
  />
)

export const lotsScreen = (_: Translator, options: LotsScreenOptions, frame: Frame): TemplateResult => {
  const activeCount = options.rows.filter((row) => row.active).length
  const withStockCount = options.rows.filter((row) => row.onHandValue > 0).length
  const table = options.rows.length ? (
    dataTable(_, { columns: columns(_), rows: options.rows, id: (row) => row.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(_('stock_backend.lot.list.empty'), _('stock_backend.lot.list.emptyHint'), {
        icon: icon('package'),
      })}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('stock_backend.lots')}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('stock_backend.lot.list.kicker')}
          title={_('stock_backend.lot.list.title')}
          subtitle={_('stock_backend.lot.list.subtitle')}
          imageFallback={icon('package')}
          summary={[
            { id: 'total', label: _('stock_backend.lot.list.summary.total'), value: options.rows.length },
            { id: 'active', label: _('stock_backend.lot.list.summary.active'), value: activeCount },
            {
              id: 'with-stock',
              label: _('stock_backend.lot.list.summary.withStock'),
              value: withStockCount,
            },
          ]}
          body={stack(
            [
              <Section
                title={_('stock_backend.lot.create.title')}
                description={_('stock_backend.lot.create.hint')}
                body={<Surface padding="compact" body={createForm(_, options)} />}
              />,
              <Section
                title={_('stock_backend.lot.list.records.title')}
                description={_('stock_backend.lot.list.records.hint')}
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
