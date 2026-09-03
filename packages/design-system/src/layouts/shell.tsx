import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'app-shell',
  'app-sidebar',
  'app-main',
  'app-right-rail',
  'page',
  'page-header',
  'page-heading',
  'page-title',
  'page-description',
  'page-actions',
  'page-body',
  'record-canvas',
  'record-content',
  'record-section',
  'record-section-title',
] as const

export const AppShell = (props: {
  sidebar: JSXChild
  main: JSXChild
  rightRail?: JSXChild
  mode?: 'viewport' | 'embedded'
}): TemplateResult => (
  <div
    data-ui="app-shell"
    data-has-right-rail={String(props.rightRail !== undefined)}
    data-mode={props.mode ?? 'viewport'}
  >
    <aside data-ui="app-sidebar">{props.sidebar}</aside>
    <main data-ui="app-main">{props.main}</main>
    {props.rightRail !== undefined && <aside data-ui="app-right-rail">{props.rightRail}</aside>}
  </div>
)

export const PageHeader = (props: {
  title: string
  description?: string | null
  actions?: JSXChild
}): TemplateResult => (
  <header data-ui="page-header">
    <div data-ui="page-heading">
      <h1 data-ui="page-title">{props.title}</h1>
      {!!props.description && <p data-ui="page-description">{props.description}</p>}
    </div>
    {props.actions !== undefined && <div data-ui="page-actions">{props.actions}</div>}
  </header>
)

export const Page = (props: {
  title: string
  body: JSXChild
  description?: string | null
  actions?: JSXChild
}): TemplateResult => (
  <section data-ui="page">
    <PageHeader title={props.title} description={props.description} actions={props.actions} />
    <div data-ui="page-body">{props.body}</div>
  </section>
)

export const RecordCanvas = (props: { body: JSXChild }): TemplateResult => (
  <div data-ui="record-canvas">
    <div data-ui="record-content">{props.body}</div>
  </div>
)

export const RecordSection = (props: { body: JSXChild; title?: string | null }): TemplateResult => (
  <section data-ui="record-section">
    {!!props.title && <h2 data-ui="record-section-title">{props.title}</h2>}
    {props.body}
  </section>
)
