import type { TemplateResult } from 'ketjs-view'
import type { MenuNode, Translator } from 'ketjs'
import {
  framed,
  emptyState,
  badge,
  code,
  dataTable,
  inline,
  kanbanCard,
  kanbanGrid,
  mediaPanel,
  section,
  stack,
  surface,
} from '../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../ui/index.ts'

export type TemplateRow = {
  id: string
  name: string
  type: string
  categoryId: string | null
  uomId: string | null
  variants: number
}

/** The two ways to look at the same rows. More can be added; each is a real page. */
export const VIEWS = ['list', 'kanban'] as const
export type View = (typeof VIEWS)[number]

/**
 * The catalogue's columns, as data — so a module that adds a field to
 * `product.Template` has something to name when it wants a column for it.
 *
 * Goods and services are not a good/bad axis, so neither gets a judgemental tone.
 * The id and the category are off by default: useful to a specialist, noise to
 * everyone else.
 */
export const templateColumns = (_: Translator): Array<Column<TemplateRow>> => [
  { key: 'name', label: _('product_backend.col.name'), cell: (r) => r.name, priority: 'primary' },
  {
    key: 'type',
    label: _('product_backend.col.type'),
    kind: 'status',
    priority: 'secondary',
    cell: (r) =>
      badge(_(`product_backend.type.${r.type}`), r.type === 'service' ? 'info' : 'neutral', r.type),
  },
  {
    key: 'uom',
    label: _('product_backend.col.uom'),
    cell: (r) => (r.uomId ? code(r.uomId, 'unit') : '—'),
    kind: 'identifier',
  },
  {
    key: 'variants',
    label: _('product_backend.col.variants'),
    cell: (r) => String(r.variants),
    align: 'end',
    kind: 'number',
  },
  {
    key: 'category',
    label: _('product_backend.col.category'),
    cell: (r) => r.categoryId ?? '—',
    priority: 'tertiary',
    optional: true,
  },
  {
    key: 'id',
    label: _('backend.table.id'),
    cell: (r) => code(r.id, 'identifier'),
    kind: 'identifier',
    priority: 'tertiary',
    optional: true,
  },
]

const kanban = (_: Translator, rows: readonly TemplateRow[]): TemplateResult =>
  kanbanGrid({
    rows,
    id: (r) => r.id,
    card: (r) =>
      kanbanCard({
        key: r.id,
        title: r.name,
        meta: inline([
          badge(_(`product_backend.type.${r.type}`), r.type === 'service' ? 'info' : 'neutral', r.type),
          r.uomId ? code(r.uomId, 'unit') : '',
        ]),
        note: `${_('product_backend.col.variants')}: ${String(r.variants)}`,
      }),
  })

/**
 * The catalogue, in the frame the backend already owns.
 *
 * It reuses `framed` and `dataTable` rather than building its own: a second frame
 * is a frame that drifts, and the sidebar, chrome and row height are not this
 * module's to reinvent. The two views are two renderings of the same rows, not
 * two screens.
 */
export const productsScreen = (
  _: Translator,
  rows: TemplateRow[],
  view: View,
  frame: Frame = {},
  table: Partial<DataTable<TemplateRow>> = {},
): TemplateResult =>
  framed(
    _,
    _('product_backend.screen.title'),
    frame,
    rows.length === 0
      ? emptyState(_('product_backend.screen.empty.message'), _('product_backend.screen.empty.hint'))
      : view === 'kanban'
        ? kanban(_, rows)
        : dataTable(_, { columns: templateColumns(_), rows, id: (r) => r.id, ...table }),
  )

export type { MenuNode }

export const productDetailScreen = (
  _: Translator,
  row: { id: string; name: string; type: string; listPrice: number; uomId: string | null },
  mediaExtension: unknown,
  frame: Frame = {},
): TemplateResult =>
  framed(
    _,
    row.name,
    frame,
    stack([
      section({
        title: 'Hình ảnh',
        description: 'UI scaffold; dữ liệu và thao tác sẽ được nối với backend media sau.',
        body: mediaPanel({ status: 'unavailable', extension: mediaExtension }),
      }),
      section({
        title: 'Thông tin sản phẩm',
        body: surface({
          body: inline([
            badge(
              _(`product_backend.type.${row.type}`),
              row.type === 'service' ? 'info' : 'neutral',
              row.type,
            ),
            code(row.uomId, 'unit'),
            String(row.listPrice),
          ]),
        }),
      }),
    ]),
  )
