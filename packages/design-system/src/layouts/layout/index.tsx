import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Tone } from '../../primitives/status.tsx'

export const HOOKS = [
  'stack',
  'inline',
  'grid',
  'card-grid',
  'surface',
  'surface-head',
  'surface-heading',
  'surface-title',
  'surface-description',
  'surface-actions',
  'disclosure',
  'disclosure-summary',
  'disclosure-body',
  'section',
  'section-head',
  'section-eyebrow',
  'section-title',
  'section-description',
  'section-actions',
  'section-body',
  'content-card',
  'card-media',
  'card-head',
  'card-leading',
  'card-heading',
  'card-eyebrow',
  'card-title',
  'card-summary',
  'card-status',
  'card-body',
  'card-meta',
  'card-actions',
  'kanban',
  'kanban-card',
  'kanban-media',
  'kanban-title',
  'kanban-meta',
  'kanban-note',
  'kanban-actions',
  'metric',
  'metric-icon',
  'metric-label',
  'metric-value',
  'metric-detail',
] as const

export { AppShell, Page, PageHeader, RecordCanvas, RecordSection } from '../shell.tsx'

const Items = (props: { items: readonly JSXChild[] }): TemplateResult => (
  <>
    {each(
      props.items,
      (_, index) => index,
      // biome-ignore lint/complexity/noUselessFragments: `each` requires a TemplateResult callback.
      (item) => (typeof item === 'string' || typeof item === 'number' ? <span>{item}</span> : <>{item}</>),
    )}
  </>
)

export const Stack = (props: {
  items: readonly JSXChild[]
  gap?: 'compact' | 'default' | 'loose'
}): TemplateResult => (
  <div data-ui="stack" data-pattern="stack" data-gap={props.gap ?? 'default'}>
    <Items items={props.items} />
  </div>
)

export const Inline = (props: { items: readonly JSXChild[] }): TemplateResult => (
  <div data-ui="inline">
    <Items items={props.items} />
  </div>
)

/**
 * Fixed columns. `align="stretch"` gives every block in a row the row's height,
 * so side-by-side dashboard cards end on one line instead of leaving a hole
 * under the shorter one.
 */
export const Grid = (props: {
  items: readonly JSXChild[]
  columns?: 2 | 3 | 4
  align?: 'start' | 'stretch'
}): TemplateResult => (
  <div
    data-ui="grid"
    data-columns={String(props.columns ?? 3)}
    data-align={props.align === 'stretch' ? 'stretch' : null}
  >
    <Items items={props.items} />
  </div>
)

export type CardGridProps<T> = {
  items: readonly T[]
  id: (item: T) => unknown
  card: (item: T) => TemplateResult
  minimum?: 'compact' | 'default' | 'wide'
}

/** An adaptive card collection; unlike `Grid`, column count follows available width. */
export const CardGrid = <T,>(props: CardGridProps<T>): TemplateResult => (
  <div data-ui="card-grid" data-minimum={props.minimum === 'default' ? null : props.minimum}>
    {each(props.items, props.id, (item) => props.card(item))}
  </div>
)

export const Surface = (props: {
  body: JSXChild
  title?: string
  /** One line under the title. A dashboard block keeps its heading, context and content in one card. */
  description?: string | null
  actions?: JSXChild
  tone?: 'default' | 'subtle' | 'raised'
  padding?: 'none' | 'compact' | 'default'
}): TemplateResult => (
  <div
    data-ui="surface"
    data-tone={props.tone ?? 'default'}
    data-padding={props.padding ?? 'default'}
    data-has-heading={props.title ? 'true' : null}
  >
    {props.title && (
      <header data-ui="surface-head">
        {props.description ? (
          <div data-ui="surface-heading">
            <h2 data-ui="surface-title">{props.title}</h2>
            <p data-ui="surface-description">{props.description}</p>
          </div>
        ) : (
          <h2 data-ui="surface-title">{props.title}</h2>
        )}
        {props.actions !== undefined && <div data-ui="surface-actions">{props.actions}</div>}
      </header>
    )}
    {props.body}
  </div>
)

/** Native, keyboard-accessible progressive disclosure for dense secondary detail. */
export const Disclosure = (props: { summary: string; body: JSXChild; open?: boolean }): TemplateResult => (
  <details data-ui="disclosure" open={props.open === true ? true : undefined}>
    <summary data-ui="disclosure-summary">{props.summary}</summary>
    <div data-ui="disclosure-body">{props.body}</div>
  </details>
)

export const Section = (props: {
  title: string
  body: JSXChild
  description?: string | null
  eyebrow?: string | null
  actions?: JSXChild
}): TemplateResult => (
  <section data-ui="section">
    <header data-ui="section-head">
      <div>
        {!!props.eyebrow && <p data-ui="section-eyebrow">{props.eyebrow}</p>}
        <h2 data-ui="section-title">{props.title}</h2>
        {!!props.description && <p data-ui="section-description">{props.description}</p>}
      </div>
      {props.actions !== undefined && <div data-ui="section-actions">{props.actions}</div>}
    </header>
    <div data-ui="section-body">{props.body}</div>
  </section>
)

export type ContentCardProps = {
  title: string
  eyebrow?: string | null
  summary?: string | null
  leading?: JSXChild
  media?: JSXChild
  status?: JSXChild
  body?: JSXChild
  meta?: JSXChild
  actions?: JSXChild
  href?: string | null
  selected?: boolean
  tone?: 'default' | 'subtle' | 'raised'
  padding?: 'compact' | 'default'
}

export const ContentCard = (props: ContentCardProps): TemplateResult => (
  <article
    data-ui="content-card"
    data-interactive={String(!!props.href)}
    data-selected={String(props.selected === true)}
    data-tone={props.tone ?? 'default'}
    data-padding={props.padding ?? 'default'}
  >
    {props.media !== undefined && <div data-ui="card-media">{props.media}</div>}
    <header data-ui="card-head">
      {props.leading !== undefined && (
        <span data-ui="card-leading" aria-hidden="true">
          {props.leading}
        </span>
      )}
      <div data-ui="card-heading">
        {!!props.eyebrow && <p data-ui="card-eyebrow">{props.eyebrow}</p>}
        <h3 data-ui="card-title">{props.href ? <a href={props.href}>{props.title}</a> : props.title}</h3>
        {!!props.summary && <p data-ui="card-summary">{props.summary}</p>}
      </div>
      {props.status !== undefined && <div data-ui="card-status">{props.status}</div>}
    </header>
    {props.body !== undefined && <div data-ui="card-body">{props.body}</div>}
    {props.meta !== undefined && <div data-ui="card-meta">{props.meta}</div>}
    {props.actions !== undefined && <div data-ui="card-actions">{props.actions}</div>}
  </article>
)

export type KanbanCardProps = {
  id: string
  title: string
  href?: string | null
  media?: JSXChild
  meta?: JSXChild
  note?: string | null
  actions?: JSXChild
  selected?: boolean
}

export const KanbanCard = (props: KanbanCardProps): TemplateResult => (
  <article
    data-ui="kanban-card"
    data-key={props.id}
    data-interactive={String(!!props.href)}
    data-selected={String(props.selected === true)}
  >
    {props.media !== undefined && <div data-ui="kanban-media">{props.media}</div>}
    <h3 data-ui="kanban-title">{props.href ? <a href={props.href}>{props.title}</a> : props.title}</h3>
    {props.meta !== undefined && <div data-ui="kanban-meta">{props.meta}</div>}
    {!!props.note && <p data-ui="kanban-note">{props.note}</p>}
    {props.actions !== undefined && <div data-ui="kanban-actions">{props.actions}</div>}
  </article>
)

export type KanbanGridProps<T> = {
  rows: readonly T[]
  id: (row: T) => unknown
  card: (row: T) => TemplateResult
}

export const KanbanGrid = <T,>(props: KanbanGridProps<T>): TemplateResult => (
  <div data-ui="kanban">{each(props.rows, props.id, (row) => props.card(row))}</div>
)

/**
 * One number, with the context that makes it mean something.
 *
 * `tone` colours a dot beside the label and nothing else. The number itself stays
 * in the page's ink: a KPI row is read by comparing figures, and four differently
 * coloured figures are compared by colour instead. The dot is drawn only when a
 * tone is passed, so a metric that has no state to report does not grow a grey
 * bullet that means nothing.
 *
 * `href` makes the whole card the link rather than the label, because the card is
 * what the pointer is already over. There is nothing else inside a metric to
 * click, which is exactly why `ContentCard` does the opposite.
 */
export const Metric = (props: {
  label: string
  value: string | number
  detail?: string | null
  tone?: Tone
  /**
   * A glyph naming the quantity, in a tile beside it. Decorative: the label is
   * the name of the number, so this is hidden from assistive technology.
   */
  icon?: JSXChild
  href?: string | null
}): TemplateResult => {
  const attributes = {
    'data-ui': 'metric',
    'data-tone': props.tone ?? 'neutral',
    // One marker to a card, never two. The dot reports state for a metric that
    // has no glyph; where there is a glyph, the glyph is already the thing the
    // eye lands on, and a coloured bullet beside the label competes with it.
    'data-dot': String(props.tone !== undefined && props.icon === undefined),
  }
  const body = (
    <>
      {props.icon !== undefined && (
        <span data-ui="metric-icon" aria-hidden="true">
          {props.icon}
        </span>
      )}
      <p data-ui="metric-label">{props.label}</p>
      <p data-ui="metric-value">{String(props.value)}</p>
      {!!props.detail && <p data-ui="metric-detail">{props.detail}</p>}
    </>
  )
  return props.href ? (
    <a {...attributes} data-interactive="true" href={props.href}>
      {body}
    </a>
  ) : (
    <article {...attributes} data-interactive="false">
      {body}
    </article>
  )
}
