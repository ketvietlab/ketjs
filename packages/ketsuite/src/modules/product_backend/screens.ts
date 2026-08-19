import { each, html, when } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import type { MenuNode, Translator } from 'ketjs'
import { framed, emptyState } from '../backend/screens.ts'
import type { Frame } from '../backend/screens.ts'

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

const table = (_: Translator, rows: TemplateRow[]): TemplateResult => html`
  <table data-ui="table">
    <thead><tr>
      <th>${_('product_backend.col.name')}</th>
      <th>${_('product_backend.col.type')}</th>
      <th>${_('product_backend.col.uom')}</th>
      <th data-align="end">${_('product_backend.col.variants')}</th>
    </tr></thead>
    <tbody>${each(rows, r => r.id, r => html`
      <tr data-ui="row" data-product=${r.id}>
        <td data-ui="cell-name">${r.name}</td>
        <td data-ui="cell-type"><span data-ui="badge" data-type=${r.type}>${_(`product_backend.type.${r.type}`)}</span></td>
        <td data-ui="cell-uom">${when(r.uomId !== null, () => html`<code>${r.uomId}</code>`)}</td>
        <td data-ui="cell-variants" data-align="end">${String(r.variants)}</td>
      </tr>`)}
    </tbody>
  </table>`

const kanban = (_: Translator, rows: TemplateRow[]): TemplateResult => html`
  <div data-ui="kanban">${each(rows, r => r.id, r => html`
    <article data-ui="kanban-card" data-product=${r.id}>
      <h3 data-ui="kanban-title">${r.name}</h3>
      <div data-ui="kanban-meta">
        <span data-ui="badge" data-type=${r.type}>${_(`product_backend.type.${r.type}`)}</span>
        ${when(r.uomId !== null, () => html`<code data-ui="kanban-uom">${r.uomId}</code>`)}
      </div>
      <p data-ui="kanban-variants">${_('product_backend.col.variants')}: ${String(r.variants)}</p>
    </article>`)}
  </div>`

/**
 * The catalogue, in the frame the backend already owns.
 *
 * It reuses `framed` rather than building its own: a second frame is a frame that
 * drifts, and the sidebar, topbar and list chrome are not this module's to
 * reinvent. What it does own is what goes in the middle — and the two views are
 * two renderings of the same rows, not two screens.
 */
export const productsScreen = (_: Translator, rows: TemplateRow[], view: View, frame: Frame = {}): TemplateResult =>
  framed(_, _('product_backend.screen.title'), frame, rows.length === 0
    ? emptyState(_('product_backend.screen.empty.message'), _('product_backend.screen.empty.hint'))
    : view === 'kanban' ? kanban(_, rows) : table(_, rows))

export type { MenuNode }
