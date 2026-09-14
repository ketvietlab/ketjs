import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { pageIdentity, pageIdentityContent, type PageIdentityProps } from '../page-identity/index.tsx'

export const HOOKS = [
  'app-shell',
  'app-sidebar',
  'app-main',
  'app-right-rail',
  'page',
  'page-context',
  'page-header',
  'page-heading',
  'page-eyebrow',
  'page-title-row',
  'page-title',
  'page-description',
  'page-subline',
  'page-status',
  'page-actions',
  'page-meta',
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
    {props.mode === 'embedded' ? (
      <div data-ui="app-main">{props.main}</div>
    ) : (
      <main data-ui="app-main">{props.main}</main>
    )}
    {props.rightRail !== undefined && <aside data-ui="app-right-rail">{props.rightRail}</aside>}
  </div>
)

export type PageHeaderProps = Omit<PageIdentityProps, 'context'>

export const PageHeader = (props: PageHeaderProps): TemplateResult => (
  <header data-ui="page-header" data-kv-page-identity="header">
    {pageIdentityContent('page', props)}
  </header>
)

export type PageProps = PageIdentityProps & {
  body: JSXChild
}

export const Page = (props: PageProps): TemplateResult => {
  const { body, ...identity } = props
  return (
    <section data-ui="page">
      {pageIdentity('page', identity)}
      <div data-ui="page-body">{body}</div>
    </section>
  )
}

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
