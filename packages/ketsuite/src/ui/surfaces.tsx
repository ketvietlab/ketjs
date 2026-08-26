// Reusable operational surfaces. These own hierarchy and spacing; a module owns
// only the content and the business meaning placed inside them.

import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'stack',
  'columns',
  'section',
  'section-head',
  'section-eyebrow',
  'section-title',
  'section-description',
  'section-actions',
  'section-body',
  'surface',
  'card-grid',
  'content-card',
  'card-head',
  'card-title',
  'card-summary',
  'card-body',
  'card-meta',
  'card-actions',
  'metric',
  'metric-label',
  'metric-value',
  'metric-detail',
  'metric-trend',
] as const

export const stack = (
  items: readonly JSXChild[],
  gap: 'compact' | 'default' | 'loose' = 'default',
): TemplateResult => (
  <div data-ui="stack" data-gap={gap}>
    {each(
      items,
      (_, i) => i,
      (item) => (
        <>{item}</>
      ),
    )}
  </div>
)

/**
 * Things read against each other, side by side.
 *
 * Equal columns rather than content-sized: a revenue mix and the expense
 * breakdown beside it are compared, and a ring that took the width it wanted
 * left the bars in a gutter. Collapses to one column when there is not room for
 * two — a width question rather than a device one, so the stylesheet asks it
 * with a container-relative minimum and not with a device breakpoint.
 *
 * Positional, like `stack`, and for the same reason: it takes a list, which is
 * not what JSX hands a component.
 */
export const columns = (items: readonly JSXChild[], gap: 'default' | 'loose' = 'default'): TemplateResult => (
  <div data-ui="columns" data-gap={gap}>
    {each(
      items,
      (_, i) => i,
      (item) => (
        <>{item}</>
      ),
    )}
  </div>
)

export const section = (o: {
  title: string
  body: JSXChild
  description?: string | null
  eyebrow?: string | null
  actions?: JSXChild
}): TemplateResult => (
  <section data-ui="section">
    <header data-ui="section-head">
      <div>
        {!!o.eyebrow && <p data-ui="section-eyebrow">{o.eyebrow}</p>}
        <h2 data-ui="section-title">{o.title}</h2>
        {!!o.description && <p data-ui="section-description">{o.description}</p>}
      </div>
      {o.actions !== undefined && <div data-ui="section-actions">{o.actions}</div>}
    </header>
    <div data-ui="section-body">{o.body}</div>
  </section>
)

export const surface = (o: {
  body: JSXChild
  tone?: 'default' | 'subtle'
  padding?: 'compact' | 'default' | 'none'
}): TemplateResult => (
  <div data-ui="surface" data-tone={o.tone ?? 'default'} data-padding={o.padding ?? 'default'}>
    {o.body}
  </div>
)

export const cardGrid = <T,>(o: {
  items: readonly T[]
  id: (item: T) => unknown
  card: (item: T) => TemplateResult
}): TemplateResult => <div data-ui="card-grid">{each(o.items, o.id, (item) => o.card(item))}</div>

/** A content card. Only its title becomes a link, so nested actions remain valid. */
export const contentCard = (o: {
  title: string
  summary?: string | null
  body?: JSXChild
  meta?: JSXChild
  actions?: JSXChild
  href?: string | null
  selected?: boolean
}): TemplateResult => (
  <article
    data-ui="content-card"
    data-interactive={String(!!o.href)}
    data-selected={String(o.selected === true)}
  >
    <header data-ui="card-head">
      <h3 data-ui="card-title">{o.href ? <a href={o.href}>{o.title}</a> : o.title}</h3>
      {!!o.summary && <p data-ui="card-summary">{o.summary}</p>}
    </header>
    {o.body !== undefined && <div data-ui="card-body">{o.body}</div>}
    {o.meta !== undefined && <div data-ui="card-meta">{o.meta}</div>}
    {o.actions !== undefined && <div data-ui="card-actions">{o.actions}</div>}
  </article>
)

/**
 * One operational fact, with context rather than colour carrying its meaning.
 *
 * `trend` is a node rather than more text because the one thing that legitimately
 * carries colour here is a change against a previous period, and whether a change
 * is good news depends on the metric — see `delta` in `charts.tsx`. Everything
 * else on the card stays in the ink the rest of the page uses.
 */
export const metric = (o: {
  label: string
  value: string
  detail?: string | null
  trend?: JSXChild
  tone?: string
}): TemplateResult => (
  <article data-ui="metric" data-tone={o.tone ?? 'neutral'}>
    <p data-ui="metric-label">{o.label}</p>
    <p data-ui="metric-value">{o.value}</p>
    {o.trend !== undefined && <p data-ui="metric-trend">{o.trend}</p>}
    {!!o.detail && <p data-ui="metric-detail">{o.detail}</p>}
  </article>
)
