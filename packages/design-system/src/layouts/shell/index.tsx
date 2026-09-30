import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { ModalSheet } from '../../patterns/modal-sheet/index.tsx'
import { pageIdentity, pageIdentityContent, type PageIdentityProps } from '../page-identity/index.tsx'

export const HOOKS = [
  'app-shell',
  'app-shell-topbar',
  'app-topbar',
  'app-location-bar',
  'app-location-context',
  'app-brand',
  'app-topbar-brand',
  'app-topbar-context',
  'global-search-trigger',
  'global-search-trigger-label',
  'global-search-shortcut',
  'global-search-dialog',
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
  location?: JSXChild
  sidebar: JSXChild
  main: JSXChild
  rightRail?: JSXChild
  mode?: 'viewport' | 'embedded'
}): TemplateResult => (
  <div
    data-ui="app-shell"
    data-has-right-rail={String(props.rightRail !== undefined)}
    data-has-location={props.location !== undefined ? 'true' : null}
    data-has-topbar={props.topbar !== undefined ? 'true' : null}
    data-mode={props.mode ?? 'viewport'}
  >
    {props.topbar !== undefined && <div data-ui="app-shell-topbar">{props.topbar}</div>}
    <aside data-ui="app-sidebar">{props.sidebar}</aside>
    {props.mode === 'embedded' ? (
      <div data-ui="app-main">
        {props.location}
        {props.main}
      </div>
    ) : (
      <main data-ui="app-main">
        {props.location}
        {props.main}
      </main>
    )}
    {props.rightRail !== undefined && <aside data-ui="app-right-rail">{props.rightRail}</aside>}
  </div>
)

const SearchIcon = (): TemplateResult => (
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
)

export const AppBrand = (props: {
  label: string
  href: string
  image?: string
  darkImage?: string
  imageFit?: 'contain' | 'cover'
}): TemplateResult => (
  <a data-ui="app-brand" data-image-fit={props.imageFit} href={props.href} aria-label={props.label}>
    {props.image ? (
      <img src={props.image} alt={props.label} data-appearance={props.darkImage ? 'light' : undefined} />
    ) : (
      props.label
    )}
    {props.darkImage && <img src={props.darkImage} alt={props.label} data-appearance="dark" />}
  </a>
)

/** Application identity and a compact launcher for a native GET search dialog. */
export const AppTopbar = (props: {
  brand?: { label: string; href: string; image?: string }
  /** A location strip stays inside the main column, beside the sidebar identity. */
  location?: JSXChild
  navigation?: JSXChild
  context?: JSXChild
  tools?: JSXChild
  search: {
    id?: string
    action: string
    label: string
    triggerLabel?: string
    closeLabel?: string
    placeholder: string
    submitLabel: string
    query?: string
    locale?: string
  }
}): TemplateResult => {
  const id = props.search.id ?? 'app-global-search'
  const href = `${props.search.action}${props.search.action.includes('?') ? '&' : '?'}${props.search.locale ? `lang=${encodeURIComponent(props.search.locale)}&` : ''}q=${encodeURIComponent(props.search.query ?? '')}`
  const form = (
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
        <SearchIcon />
      </button>
    </form>
  )
  return (
    <>
      <header data-ui={props.location !== undefined ? 'app-location-bar' : 'app-topbar'}>
        {props.navigation}
        {props.brand && (
          <a data-ui="app-topbar-brand" href={props.brand.href} aria-label={props.brand.label}>
            {props.brand.image ? <img src={props.brand.image} alt={props.brand.label} /> : props.brand.label}
          </a>
        )}
        {props.location !== undefined && <div data-ui="app-location-context">{props.location}</div>}
        {props.context != null && <div data-ui="app-topbar-context">{props.context}</div>}
        <a
          data-ui="global-search-trigger"
          href={href}
          aria-label={props.search.label}
          aria-haspopup="dialog"
          aria-controls={id}
          aria-expanded="false"
          title={props.search.label}
        >
          <SearchIcon />
          <span data-ui="global-search-trigger-label">{props.search.triggerLabel ?? props.search.label}</span>
          <kbd data-ui="global-search-shortcut" hidden>
            Ctrl K
          </kbd>
        </a>
        {props.tools}
      </header>
      <dialog data-ui="global-search-dialog" id={id} aria-labelledby={`${id}-sheet-title`}>
        {form}
        <template>
          <ModalSheet
            id={`${id}-sheet`}
            title={props.search.label}
            closeLabel={props.search.closeLabel ?? 'Close'}
            mode="client"
            presentation="dialog"
            dialogSemantics="parent"
            body={null}
          />
        </template>
      </dialog>
      <noscript>{form}</noscript>
    </>
  )
}

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
