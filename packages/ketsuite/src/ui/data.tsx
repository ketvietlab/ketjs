// Data views other than a table. Their shape is shared; rows and business labels
// remain module data.

import { each } from 'ketjs-view'
import type { JSXChild, TemplateResult } from 'ketjs-view'

export const HOOKS = [
  'kanban',
  'kanban-card',
  'kanban-title',
  'kanban-meta',
  'kanban-note',
  'kanban-actions',
  'record-list',
  'record-row',
  'record-copy',
  'record-title',
  'record-summary',
  'record-value',
] as const

export const kanbanCard = (o: {
  key: string
  title: string
  href?: string | null
  meta?: JSXChild
  note?: string | null
  actions?: JSXChild
}): TemplateResult => (
  <article data-ui="kanban-card" data-key={o.key} data-interactive={String(!!o.href)}>
    <h3 data-ui="kanban-title">{o.href ? <a href={o.href}>{o.title}</a> : o.title}</h3>
    {o.meta !== undefined && <div data-ui="kanban-meta">{o.meta}</div>}
    {!!o.note && <p data-ui="kanban-note">{o.note}</p>}
    {o.actions !== undefined && <div data-ui="kanban-actions">{o.actions}</div>}
  </article>
)

export const kanbanGrid = <T,>(o: {
  rows: readonly T[]
  id: (row: T) => unknown
  card: (row: T) => TemplateResult
}): TemplateResult => <div data-ui="kanban">{each(o.rows, o.id, (row) => o.card(row))}</div>

/** Compact/mobile operational rows: values stay aligned and the row has one destination. */
export const recordList = <T,>(o: {
  rows: readonly T[]
  id: (row: T) => unknown
  title: (row: T) => string
  href: (row: T) => string
  summary?: (row: T) => string | null
  value?: (row: T) => JSXChild
}): TemplateResult => (
  <ol data-ui="record-list">
    {each(o.rows, o.id, (row) => (
      <li data-ui="record-row">
        <a href={o.href(row)}>
          <span data-ui="record-copy">
            <strong data-ui="record-title">{o.title(row)}</strong>
            {!!o.summary?.(row) && <span data-ui="record-summary">{o.summary!(row)}</span>}
          </span>
          {o.value !== undefined && <span data-ui="record-value">{o.value!(row)}</span>}
        </a>
      </li>
    ))}
  </ol>
)
