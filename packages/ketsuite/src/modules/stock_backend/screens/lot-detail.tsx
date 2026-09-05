import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  dataTable,
  emptyState,
  FormCluster,
  FormPage,
  icon,
  RecordForm,
  Section,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { Column, FormOption, Frame } from '../../../ui/index.ts'

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
    submitPlacement="external"
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

export const lotDetailScreen = (
  _: Translator,
  options: LotDetailOptions,
  frame: Frame,
  partial = false,
): TemplateResult => {
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
  const description = `${options.lot.productLabel}${options.lot.ref ? ` · ${options.lot.ref}` : ''}`
  const page = (
    <FormPage
      variant="operational"
      frame={frame}
      scope="stock-lot-form-page"
      title={options.lot.name}
      description={description}
      status={badge(
        options.lot.active ? _('stock_backend.lot.status.active') : _('stock_backend.lot.status.archived'),
        options.lot.active ? 'positive' : 'neutral',
      )}
      actions={
        <FormCluster
          label={_('stock_backend.action.save')}
          forms={[
            button({
              label: _('stock_backend.action.save'),
              type: 'submit',
              form: 'lot-detail-form',
              variant: 'primary',
            }),
          ]}
        />
      }
      controller={options.editor}
      body={stack(
        [
          <Section
            title={_('stock_backend.lot.information.title')}
            description={_('stock_backend.lot.information.hint')}
            body={<Surface body={lotForm(_, options)} />}
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
      slots={{
        header: 'stock.lot-header',
        body: 'stock.lot-body',
        ...(partial ? { fragmentTitle: options.lot.name } : {}),
      }}
    />
  )

  return partial ? page : shell(_, options.lot.name, page, { ...frame, topbar: false, titled: false })
}
