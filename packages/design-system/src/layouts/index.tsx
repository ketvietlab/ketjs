import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { Tone } from '../primitives/status.tsx'

export const HOOKS = [
  'stack',
  'inline',
  'grid',
  'surface',
  'section',
  'section-head',
  'section-eyebrow',
  'section-title',
  'section-description',
  'section-actions',
  'section-body',
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
] as const

export { AppShell, Page, PageHeader, RecordPage, RecordSection } from './shell.tsx'

const Items = (props: { items: readonly JSXChild[] }): TemplateResult => (
  <>
    {each(
      props.items,
      (_, index) => index,
      (item) => (
        <>{item}</>
      ),
    )}
  </>
)

export const Stack = (props: {
  items: readonly JSXChild[]
  gap?: 'compact' | 'default' | 'loose'
}): TemplateResult => (
  <div data-ui="stack" data-gap={props.gap ?? 'default'}>
    <Items items={props.items} />
  </div>
)

export const Inline = (props: { items: readonly JSXChild[] }): TemplateResult => (
  <div data-ui="inline">
    <Items items={props.items} />
  </div>
)

export const Grid = (props: { items: readonly JSXChild[]; columns?: 2 | 3 | 4 }): TemplateResult => (
  <div data-ui="grid" data-columns={String(props.columns ?? 3)}>
    <Items items={props.items} />
  </div>
)

export const Surface = (props: {
  body: JSXChild
  tone?: 'default' | 'subtle' | 'raised'
  padding?: 'none' | 'compact' | 'default'
}): TemplateResult => (
  <div data-ui="surface" data-tone={props.tone ?? 'default'} data-padding={props.padding ?? 'default'}>
    {props.body}
  </div>
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

export const ContentCard = (props: {
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
    data-interactive={String(!!props.href)}
    data-selected={String(props.selected === true)}
  >
    <header data-ui="card-head">
      <h3 data-ui="card-title">{props.href ? <a href={props.href}>{props.title}</a> : props.title}</h3>
      {!!props.summary && <p data-ui="card-summary">{props.summary}</p>}
    </header>
    {props.body !== undefined && <div data-ui="card-body">{props.body}</div>}
    {props.meta !== undefined && <div data-ui="card-meta">{props.meta}</div>}
    {props.actions !== undefined && <div data-ui="card-actions">{props.actions}</div>}
  </article>
)

export const Metric = (props: {
  label: string
  value: string | number
  detail?: string | null
  tone?: Tone
}): TemplateResult => (
  <article data-ui="metric" data-tone={props.tone ?? 'neutral'}>
    <p data-ui="metric-label">{props.label}</p>
    <p data-ui="metric-value">{String(props.value)}</p>
    {!!props.detail && <p data-ui="metric-detail">{props.detail}</p>}
  </article>
)
