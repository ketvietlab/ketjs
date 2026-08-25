// Data views other than a table. Their shape is shared; rows and business labels
// remain module data.

import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'kanban',
  'kanban-card',
  'kanban-media',
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
  'progress',
  'progress-track',
  'progress-fill',
  'progress-label',
] as const

/**
 * How far along something is: a bar and the number beside it.
 *
 * `value` is a percentage, and `null` is not zero — it means the question does
 * not apply to this record, and the bar is not drawn at all. An empty bar
 * against a record nobody has broken down reports "none of it is done" while
 * meaning "there is nothing to count", and a column full of those reads as a
 * team that has stopped working.
 *
 * `<progress>` would have been the honest element, but it cannot be styled to
 * a consistent height and radius across browsers without being rebuilt anyway,
 * so this carries the ARIA the native one would have given.
 */
export const progressBar = (o: {
  value: number | null
  label?: string | null
  /** Shown in the label instead of the percentage, e.g. "3/5". */
  text?: string | null
}): TemplateResult => {
  if (o.value == null) return <span data-ui="progress" data-empty="true" />
  const value = Math.max(0, Math.min(100, Math.round(o.value)))
  return (
    <span
      data-ui="progress"
      role="progressbar"
      aria-valuenow={String(value)}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label={o.label ?? undefined}
      data-complete={String(value === 100)}
    >
      <span data-ui="progress-label">{o.text ?? `${value}%`}</span>
      <span data-ui="progress-track">
        <span data-ui="progress-fill" style={`inline-size:${value}%`} />
      </span>
    </span>
  )
}

export const kanbanCard = (o: {
  key: string
  title: string
  href?: string | null
  /** A picture of the record, above its title. Cards are scanned by eye first. */
  media?: JSXChild
  meta?: JSXChild
  note?: string | null
  actions?: JSXChild
}): TemplateResult => (
  <article data-ui="kanban-card" data-key={o.key} data-interactive={String(!!o.href)}>
    {o.media !== undefined && <div data-ui="kanban-media">{o.media}</div>}
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
