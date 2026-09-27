import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { pageIdentity, pageIdentityContent, type PageIdentityProps } from '../page-identity/index.tsx'

export const HOOKS = [
  'app-shell',
  'app-shell-topbar',
  'app-topbar',
  'app-topbar-brand',
  'app-topbar-context',
  'global-search',
  'global-search-input',
  'global-search-submit',
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
  topbar?: JSXChild
  sidebar: JSXChild
  main: JSXChild
  rightRail?: JSXChild
  mode?: 'viewport' | 'embedded'
}): TemplateResult => (
  <div
    data-ui="app-shell"
    data-has-right-rail={String(props.rightRail !== undefined)}
    data-has-topbar={props.topbar !== undefined ? 'true' : null}
    data-mode={props.mode ?? 'viewport'}
  >
    {props.topbar !== undefined && <div data-ui="app-shell-topbar">{props.topbar}</div>}
    <aside data-ui="app-sidebar">{props.sidebar}</aside>
    {props.mode === 'embedded' ? (
      <div data-ui="app-main">{props.main}</div>
    ) : (
      <main data-ui="app-main">{props.main}</main>
    )}
    {props.rightRail !== undefined && <aside data-ui="app-right-rail">{props.rightRail}</aside>}
  </div>
)

/** Application identity and a native global search, independent from page headings. */
export const AppTopbar = (props: {
  brand: { label: string; href: string; image?: string }
  navigation?: JSXChild
  context?: JSXChild
  search: {
    action: string
    label: string
    placeholder: string
    submitLabel: string
    query?: string
    locale?: string
  }
}): TemplateResult => (
  <header data-ui="app-topbar">
    {props.navigation}
    <a data-ui="app-topbar-brand" href={props.brand.href} aria-label={props.brand.label}>
      {props.brand.image ? <img src={props.brand.image} alt={props.brand.label} /> : props.brand.label}
    </a>
    <form
      data-ui="global-search"
      role="search"
      aria-label={props.search.label}
      action={props.search.action}
      method="get"
    >
      {props.search.locale ? <input type="hidden" name="lang" value={props.search.locale} /> : null}
      <input
        data-ui="global-search-input"
        type="search"
        name="q"
        value={props.search.query ?? ''}
        placeholder={props.search.placeholder}
        aria-label={props.search.label}
        autocomplete="off"
        maxlength={200}
      />
      <button
        data-ui="global-search-submit"
        type="submit"
        aria-label={props.search.submitLabel}
        title={props.search.submitLabel}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      </button>
    </form>
    {props.context != null && <div data-ui="app-topbar-context">{props.context}</div>}
  </header>
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
