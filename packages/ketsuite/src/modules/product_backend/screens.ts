import { each, html, when } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import type { MenuNode, Translator } from 'ketjs'
import { framed, emptyState, badge, dataTable } from '../backend/screens.ts'
import type { Column, DataTable, Frame } from '../backend/screens.ts'

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
  { key: 'name', label: _('product_backend.col.name'), cell: (r) => r.name },
  {
    key: 'type', label: _('product_backend.col.type'),
    cell: (r) => badge(_(`product_backend.type.${r.type}`), r.type === 'service' ? 'info' : 'neutral', r.type),
  },
  { key: 'uom', label: _('product_backend.col.uom'), cell: (r) => r.uomId ? html`<code>${r.uomId}</code>` : '—' },
  { key: 'variants', label: _('product_backend.col.variants'), cell: (r) => String(r.variants), align: 'end' },
  { key: 'category', label: _('product_backend.col.category'), cell: (r) => r.categoryId ?? '—', optional: true },
  { key: 'id', label: _('backend.table.id'), cell: (r) => html`<code>${r.id}</code>`, optional: true },
]

const kanban = (_: Translator, rows: readonly TemplateRow[]): TemplateResult => html`
  <div data-ui="kanban">${each(rows, r => r.id, r => html`
    <article data-ui="kanban-card" data-product=${r.id}>
      <h3 data-ui="kanban-title">${r.name}</h3>
      <div data-ui="kanban-meta">
        ${badge(_(`product_backend.type.${r.type}`), r.type === 'service' ? 'info' : 'neutral', r.type)}
        ${when(r.uomId !== null, () => html`<code data-ui="kanban-uom">${r.uomId}</code>`)}
      </div>
      <p data-ui="kanban-variants">${_('product_backend.col.variants')}: ${String(r.variants)}</p>
    </article>`)}
  </div>`

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
  framed(_, _('product_backend.screen.title'), frame, rows.length === 0
    ? emptyState(_('product_backend.screen.empty.message'), _('product_backend.screen.empty.hint'))
    : view === 'kanban'
      ? kanban(_, rows)
      : dataTable(_, { columns: templateColumns(_), rows, id: (r) => r.id, ...table }))

export type { MenuNode }
