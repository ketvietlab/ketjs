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
  'doc-tree',
  'doc-branch',
  'doc-entry',
  'doc-title',
  'doc-summary',
  'doc-count',
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
/**
 * A hierarchy of documents, nested the way it reads.
 *
 * Real nesting rather than one flat list with an indent baked into each label:
 * a `<ol>` inside its parent `<li>` is what says "these belong under that one"
 * to a screen reader, to a keyboard, and to anything that reformats the page.
 * A padded string only says it to someone looking at it.
 *
 * Rows arrive flat — the query builder has no recursive read — and are grouped
 * here by their parent. Every row is drawn exactly once, wherever it ends up:
 * one whose parent is not in the list (archived, or filtered away by a search)
 * is shown at the root, and so is one caught in a parent cycle. Both used to
 * be handled by the same test — "is the parent present?" — which covers the
 * first and not the second: two rows pointing at each other are both present,
 * so neither reached the root and both vanished from the screen entirely.
 * Stored data should never be shaped that way, but a view that silently drops
 * records is the wrong way to find out that it is.
 */
export const docTree = <T,>(o: {
  rows: readonly T[]
  id: (row: T) => string
  parent: (row: T) => string | null
  title: (row: T) => string
  href: (row: T) => string
  summary?: (row: T) => string | null
  count?: (row: T) => string | null
  /** How deep the nesting may go before it stops. */
  maxDepth?: number
}): TemplateResult => {
  const parentOf = new Map(o.rows.map((row) => [o.id(row), o.parent(row) ?? '']))
  /** Whether this row can reach the root by following parents, without repeating one. */
  const rooted = (id: string): boolean => {
    const seen = new Set<string>()
    let at = id
    while (at) {
      if (seen.has(at)) return false
      seen.add(at)
      const next = parentOf.get(at)
      if (next === undefined) return true // its parent is not in the list
      at = next
    }
    return true
  }
  const byParent = new Map<string, T[]>()
  for (const row of o.rows) {
    const parent = o.parent(row) ?? ''
    const key = parent && parentOf.has(parent) && rooted(o.id(row)) ? parent : ''
    byParent.set(key, [...(byParent.get(key) ?? []), row])
  }
  const limit = o.maxDepth ?? 12
  /**
   * A row already open further up this branch is not opened again.
   *
   * Depth alone only bounds the damage: a row that is its own parent, or a pair
   * that point at each other, would otherwise draw the same entries over and
   * over down to the limit. Stored data should never be shaped that way — the
   * writers that produce it refuse a cycle — but a view is the wrong place to
   * find out that something else went wrong.
   */
  const branch = (parent: string, depth: number, open: readonly string[]): TemplateResult => (
    <ol data-ui={depth === 0 ? 'doc-tree' : 'doc-branch'}>
      {each(byParent.get(parent) ?? [], o.id, (row) => (
        <li>
          <a data-ui="doc-entry" href={o.href(row)}>
            <span data-ui="doc-title">{o.title(row)}</span>
            {!!o.summary?.(row) && <span data-ui="doc-summary">{o.summary!(row)}</span>}
            {!!o.count?.(row) && <span data-ui="doc-count">{o.count!(row)}</span>}
          </a>
          {depth < limit && !open.includes(o.id(row)) && (byParent.get(o.id(row)) ?? []).length > 0
            ? branch(o.id(row), depth + 1, [...open, o.id(row)])
            : null}
        </li>
      ))}
    </ol>
  )
  return branch('', 0, [])
}

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
