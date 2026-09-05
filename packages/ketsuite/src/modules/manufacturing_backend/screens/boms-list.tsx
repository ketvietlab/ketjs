import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { code, dataTable, emptyState, inline, LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'

export type BomListRow = {
  id: string
  code: string
  product: string
  quantity: string
}

export type BomsListScreenOptions = {
  rows: BomListRow[]
  /** Locale-aware URL that opens the create modal over this collection. */
  createHref: string
}

export const bomListColumns = (_: Translator): Array<Column<BomListRow>> => [
  {
    key: 'code',
    label: _('manufacturing_backend.field.code'),
    cell: (row) => code(row.code, 'identifier'),
    kind: 'identifier',
    priority: 'primary',
  },
  {
    key: 'product',
    label: _('manufacturing_backend.field.product'),
    cell: (row) => row.product,
    priority: 'secondary',
    width: 'wide',
  },
  {
    key: 'quantity',
    label: _('manufacturing_backend.field.quantity'),
    cell: (row) => row.quantity,
    align: 'end',
  },
]

/** List-only BOM collection. Creation is a URL-owned modal layered by the route. */
export const bomsListScreen = (
  _: Translator,
  options: BomsListScreenOptions,
  frame: Frame = {},
): TemplateResult =>
  shell(
    _,
    _('manufacturing_backend.boms.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('manufacturing_backend.boms.title')}
      actions={inline([
        <LinkButton
          label={_('manufacturing_backend.boms.create')}
          href={options.createHref}
          variant="primary"
        />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      body={
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => row.id,
              columns: bomListColumns(_),
            })
          : emptyState(_('manufacturing_backend.empty.boms'), _('manufacturing_backend.empty.bomsHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
