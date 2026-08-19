import { each, html, when } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import type { MenuNode, Translator } from 'ketjs'
import { shell, emptyState } from '../backend/screens.ts'
import type { Extras, Viewer } from '../backend/screens.ts'

export type TemplateRow = {
  id: string
  name: string
  type: string
  categoryId: string | null
  uomId: string | null
  variants: number
}

/**
 * The catalogue, in the frame the backend already owns.
 *
 * It reuses `shell` rather than building its own: a second frame is a frame that
 * drifts, and the sidebar, topbar and identity strip are not this module's to
 * reinvent. Markup only, as everywhere in the backend — the look is the design
 * team's and the selectors are the data-ui attributes.
 */
export const productsScreen = (_: Translator, rows: TemplateRow[], viewer?: Viewer | null, extras: Extras = {}, menu: MenuNode[] = []): TemplateResult =>
  shell(_, _('product_backend.screen.title'), rows.length === 0
    ? emptyState(_('product_backend.screen.empty.message'), _('product_backend.screen.empty.hint'))
    : html`<table data-ui="table">
        <thead><tr>
          <th>${_('product_backend.col.name')}</th>
          <th>${_('product_backend.col.type')}</th>
          <th>${_('product_backend.col.uom')}</th>
          <th>${_('product_backend.col.variants')}</th>
        </tr></thead>
        <tbody>${each(rows, r => r.id, r => html`
          <tr data-ui="row" data-product=${r.id}>
            <td data-ui="cell-name">${r.name}</td>
            <td data-ui="cell-type"><span data-ui="badge" data-type=${r.type}>${_(`product_backend.type.${r.type}`)}</span></td>
            <td data-ui="cell-uom">${when(r.uomId !== null, () => html`<code>${r.uomId}</code>`)}</td>
            <td data-ui="cell-variants">${String(r.variants)}</td>
          </tr>`)}
        </tbody>
      </table>`, viewer, extras, menu)
