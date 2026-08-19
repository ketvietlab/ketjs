import { each, html, when } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import type { MenuNode, Translator } from 'ketjs'
import { badge, dataTable } from './table.ts'
import type { Column, DataTable } from './table.ts'
export { badge, dataTable, visibleColumns, avatar, person, initials } from './table.ts'
export type { Cell, Column, DataTable, Tone } from './table.ts'

/**
 * The backend screens.
 *
 * Markup lives here because it is wired to real data; the look lives entirely in
 * design/admin.css. The contract between the two is the `data-ui` attribute on every
 * meaningful element — those are the selectors the stylesheet is written against, and
 * they will not change without a note in HANDOFF.md.
 *
 * Every screen takes a translator, bound to `_` after gettext. It is a parameter
 * rather than a module-level import because the locale is a fact about the request:
 * a screen that reached for a global would answer the wrong language the moment two
 * requests overlapped.
 *
 * Classes are deliberately absent: a class means someone has already decided how a
 * thing looks, and that decision belongs to the design team.
 *
 * Note the String() around every boolean state. An attribute whose value is `false`
 * is dropped from the HTML — correct for `disabled`, wrong for `data-published`,
 * because it would leave the stylesheet with no selector for the negative case.
 */

export type AppRow = {
  name: string; title: string; summary: string; category: string
  state: 'installed' | 'available'; depends: string[]; dependents: string[]
}
export type PageRow = { id: string; path: string; title: string; published: boolean }

export type Screen = 'apps' | 'pages' | 'settings'

/**
 * An app's name, summary and category are declared as plain strings so a module
 * stays readable without a catalogue. A module that wants them translated adds
 * `app.title`, `app.summary` or `app.category` to its own messages, and this picks
 * the translation up when it exists.
 *
 * The convention beats a second declaration syntax: no module has to change, and
 * the pseudo-locale shows immediately which ones have not been translated yet.
 */
const label = (_: Translator, module: string, field: 'title' | 'summary' | 'category', literal: string): string => {
  const key = `${module}.app.${field}`
  return _.resolves(key) ? _(key) : literal
}

/** Who the screen is being shown to. Absent only while nothing is signed in. */
export type Viewer = { name: string; company: string | null; companies: string[] }

/**
 * What other modules contributed to this screen, already rendered.
 *
 * Passed in rather than fetched: a screen stays a pure function of its data, and
 * reaching for a runtime here is how it stops being testable — the catalogue
 * renders every one of these with no server at all.
 */
export type Extras = {
  'topbar.end'?: unknown
  'apps.footer'?: unknown
  /** Rendered per card, keyed by app name — the joint takes the app as a prop. */
  'nav.items'?: unknown
  'app-card.actions'?: Record<string, unknown>
}

/**
 * The frame every backend screen sits in.
 *
 * Two levels, as an enterprise admin needs: the apps this deployment has, then the
 * menu inside the one you are in. A single flat list stops working at about six
 * entries, and a business system has forty.
 *
 * The tree arrives already filtered — installed, and permitted. The shell does not
 * decide what you may see; it draws what you may see.
 */
/** Where an entry goes: its own path, or the first one under it. */
const destination = (node: MenuNode): string => {
  if (node.path) return node.path
  for (const child of node.children) {
    const found = destination(child)
    if (found !== '#') return found
  }
  return '#'
}

const menuLink = (item: MenuNode): TemplateResult => html`
  <a data-ui="menu-item" data-active=${String(item.active)} href=${destination(item)}>${item.label}</a>`

// <details> rather than a button: a section collapses with no script at all, which
// means it still collapses on the first paint and on a page with a broken bundle.
const menuSection = (section: MenuNode): TemplateResult => html`
  <details data-ui="menu-section" open=${true}>
    <summary data-ui="menu-section-title">${section.label}</summary>
    ${each(section.children, c => c.id, c => c.children.length ? menuSection(c) : menuLink(c))}
  </details>`

/**
 * Everything around the data, in one argument.
 *
 * These grew one positional parameter at a time — viewer, then extras, then the
 * menu, then the chrome — and `f(_, rows, null, {}, MENU)` is a call nobody can
 * read. A screen takes its data, and then its frame.
 */
export type Frame = {
  viewer?: Viewer | null
  extras?: Extras
  menu?: MenuNode[]
  chrome?: ListChrome | null
}

export const shell = (
  _: Translator,
  title: string,
  body: TemplateResult,
  frame: Frame = {},
): TemplateResult => {
  const { viewer = null, extras = {}, menu = [] } = frame
  const app = menu.find(a => a.active) ?? menu[0] ?? null
  return html`
<div data-ui="shell">
  <aside data-ui="sidebar">
    <div data-ui="app-switch">
      <span data-ui="app-current">${app ? app.label : _('backend.brand')}</span>
    </div>

    <div data-ui="app-list" role="navigation">
      <div data-ui="app-list-title">${_('backend.nav.apps')}</div>
      ${each(menu, a => a.id, a => html`
        <a data-ui="app-entry" data-active=${String(a.active)} href=${destination(a)}>
          <span data-ui="app-icon">${a.icon ?? a.label.slice(0, 1)}</span>
          <span data-ui="app-name">${a.label}</span>
        </a>`)}
    </div>

    ${when(!!app && app.children.length > 0, () => html`
      <nav data-ui="menu" aria-label=${app!.label}>
        <div data-ui="menu-app">${app!.label}</div>
        ${each(app!.children, c => c.id, c => c.children.length ? menuSection(c) : menuLink(c))}
      </nav>`)}

    ${extras['nav.items'] ?? ''}
  </aside>

  <main data-ui="main">
    <header data-ui="topbar">
      ${frame.chrome
        ? listChrome(_, frame.chrome)
        : html`<h1 data-ui="title">${title}</h1>`}
      ${extras['topbar.end'] ?? ''}
      ${when(!!viewer, () => html`
      <div data-ui="viewer">
        <span data-ui="viewer-name">${viewer!.name}</span>
        ${when((viewer!.companies.length) > 1, () => html`<span data-ui="viewer-company">${viewer!.company}</span>`)}
        <form data-ui="signout" method="post" action="/logout"><button data-ui="signout-button" type="submit">${_('backend.signOut')}</button></form>
      </div>`)}
    </header>
    <div data-ui="content">${body}</div>
  </main>
</div>`
}


export const emptyState = (message: string, hint: string): TemplateResult => html`
<div data-ui="empty">
  <p data-ui="empty-message">${message}</p>
  <p data-ui="empty-hint">${hint}</p>
</div>`

export const errorState = (code: string, message: string, hint: string): TemplateResult => html`
<div data-ui="error" role="alert">
  <p data-ui="error-code">${code}</p>
  <p data-ui="error-message">${message}</p>
  ${when(!!hint, () => html`<p data-ui="error-hint">${hint}</p>`)}
</div>`

const appCard = (_: Translator, app: AppRow, extras: Extras = {}): TemplateResult => html`
<article data-ui="app-card" data-state=${app.state} data-app=${app.name}>
  <h3 data-ui="app-title">${label(_, app.name, 'title', app.title)}</h3>
  <p data-ui="app-summary">${label(_, app.name, 'summary', app.summary)}</p>
  <dl data-ui="app-meta">
    <dt>${_('backend.apps.depends')}</dt><dd data-ui="app-depends">${app.depends.join(', ') || _('backend.apps.none')}</dd>
    ${when(app.dependents.length > 0, () => html`<dt>${_('backend.apps.dependents')}</dt><dd data-ui="app-dependents">${app.dependents.join(', ')}</dd>`)}
  </dl>
  <div data-ui="app-actions">
    <button data-ui="app-action" data-action=${app.state === 'installed' ? 'uninstall' : 'install'}
            disabled=${app.state === 'installed' && app.dependents.length > 0}>
      ${app.state === 'installed' ? _('backend.apps.uninstall') : _('backend.apps.install')}
    </button>
    ${extras['app-card.actions']?.[app.name] ?? ''}
  </div>
</article>`

/**
 * The chrome above a list.
 *
 * Every control here is a link or a form — no client state, no fetch, no view
 * layer that has to be told what the server already knows. Page four is a URL you
 * can send someone; so is a search, and so is a filter. That is not nostalgia: it
 * is what makes the back button, a bookmark and a shared link all work without
 * anyone writing code for them.
 *
 * It is data, not markup, so a module hands over what its list can actually do
 * rather than re-implementing a toolbar. A field left out is a control that does
 * not appear — a screen with no second page has no pager at all.
 */
export type Crumb = { label: string; path?: string }

export type Facet = {
  /** What it says: "Loại: Hàng hoá". */
  label: string
  /** Where the × goes — the same list without this filter. */
  without: string
}

export type Pager = {
  /** 1-based, inclusive, as shown: "1-30 / 84". */
  from: number
  to: number
  total: number
  /** Absent means the arrow is there but dead, which is the honest state. */
  prev?: string | null
  next?: string | null
}

export type ViewKind = { id: string; label: string; icon: string; path: string; active: boolean }

export type ListChrome = {
  crumbs: Crumb[]
  /** The primary action. Absent when this list cannot be added to. */
  create?: { label: string; path: string } | null
  search?: {
    name: string
    value?: string
    placeholder: string
    facets?: Facet[]
    /**
     * The rest of the URL's state, as hidden fields. A GET form replaces the whole
     * query string, so without this, searching while looking at the cards throws
     * you back to the list — which is exactly the bug this found.
     */
    keep?: Record<string, string>
  } | null
  pager?: Pager | null
  views?: ViewKind[]
}

const pagerLabel = (p: Pager): string => (p.total === 0 ? '0' : `${p.from}-${p.to} / ${p.total}`)

/**
 * The search, in the middle of the topbar.
 *
 * Not in the row above the table: it searches the screen, and putting it with the
 * breadcrumb makes it look like it searches the breadcrumb. The facets live with
 * it, because a filter you cannot see next to the box that set it is a list lying
 * about how much it has.
 */
export const topbarSearch = (_: Translator, c: ListChrome): TemplateResult => html`
  <form data-ui="chrome-search" method="get" role="search">
    ${each(Object.entries(c.search!.keep ?? {}), ([k]) => k, ([k, v]) => html`<input type="hidden" name=${k} value=${v}>`)}
    ${each(c.search!.facets ?? [], f => f.label, f => html`
      <span data-ui="facet">
        <span data-ui="facet-label">${f.label}</span>
        <a data-ui="facet-remove" href=${f.without} aria-label=${_('backend.chrome.removeFilter')}>×</a>
      </span>`)}
    <input data-ui="chrome-search-input" type="search" name=${c.search!.name}
           value=${c.search!.value ?? ''} placeholder=${c.search!.placeholder}
           aria-label=${c.search!.placeholder}>
  </form>`

/**
 * The chrome, and it lives in the topbar — there is no second bar.
 *
 * It was one at first: a breadcrumb row under the topbar, the way a lot of admin
 * UIs do it. Two bars cost 3rem of every screen to say what fits in one, and the
 * title in the upper bar and the breadcrumb in the lower one were the same
 * sentence twice. So the breadcrumb IS the title, the search takes the middle,
 * and the pager and view switcher sit at the end beside the identity strip.
 */
export const listChrome = (_: Translator, c: ListChrome): TemplateResult => html`
  ${chromeLead(_, c)}${when(!!c.search, () => topbarSearch(_, c))}${chromeTail(_, c)}`

const chromeLead = (_: Translator, c: ListChrome): TemplateResult => html`
  <div data-ui="chrome-lead">
    ${when(!!c.create, () => html`<a data-ui="chrome-create" href=${c.create!.path}>${c.create!.label}</a>`)}
    <nav data-ui="crumbs" aria-label=${_('backend.chrome.breadcrumb')}>
      ${each(c.crumbs, (b, i) => `${i}:${b.label}`, (b) => b.path
        ? html`<a data-ui="crumb" href=${b.path}>${b.label}</a>`
        : html`<span data-ui="crumb" aria-current="page">${b.label}</span>`)}
    </nav>
  </div>`

const chromeTail = (_: Translator, c: ListChrome): TemplateResult => html`
  <div data-ui="chrome-tail">
    ${when(!!c.pager, () => html`
    <div data-ui="pager">
      <span data-ui="pager-range">${pagerLabel(c.pager!)}</span>
      ${c.pager!.prev
        ? html`<a data-ui="pager-step" data-dir="prev" href=${c.pager!.prev} aria-label=${_('backend.chrome.previous')}>‹</a>`
        : html`<span data-ui="pager-step" data-dir="prev" aria-disabled="true">‹</span>`}
      ${c.pager!.next
        ? html`<a data-ui="pager-step" data-dir="next" href=${c.pager!.next} aria-label=${_('backend.chrome.next')}>›</a>`
        : html`<span data-ui="pager-step" data-dir="next" aria-disabled="true">›</span>`}
    </div>`)}

    ${when((c.views ?? []).length > 1, () => html`
    <div data-ui="view-switch" role="group" aria-label=${_('backend.chrome.views')}>
      ${each(c.views!, v => v.id, v => html`
        <a data-ui="view-kind" data-kind=${v.id} data-active=${String(v.active)} href=${v.path} title=${v.label} aria-label=${v.label}>${v.icon}</a>`)}
    </div>`)}
  </div>`

/** The shell. The chrome is drawn by the topbar, so the body is only the data. */
export const framed = (_: Translator, title: string, frame: Frame, body: TemplateResult): TemplateResult =>
  shell(_, title, body, frame)

export const appsScreen = (_: Translator, apps: AppRow[], frame: Frame = {}): TemplateResult => {
  const extras = frame.extras ?? {}
  const categories = [...new Set(apps.map(a => a.category))].sort()
  const categoryLabel = (c: string): string => {
    const owner = apps.find(a => a.category === c)
    return owner ? label(_, owner.name, 'category', c) : c
  }
  return shell(_, _('backend.apps.title'), apps.length === 0
    ? emptyState(_('backend.apps.empty.message'), _('backend.apps.empty.hint'))
    : html`<div data-ui="app-groups">${each(categories, c => c, category => html`
        <section data-ui="app-group" data-category=${category}>
          <h2 data-ui="group-title">${categoryLabel(category)}</h2>
          <div data-ui="app-grid">${each(apps.filter(a => a.category === category), a => a.name, a => appCard(_, a, extras))}</div>
        </section>`)}${extras['apps.footer'] ?? ''}</div>`, frame)
}

/**
 * The columns of the pages list, as data.
 *
 * Exported because a module that extends this list needs something to name. The
 * id is optional: useful when you are debugging a route, noise the rest of the time.
 */
export const pageColumns = (_: Translator): Array<Column<PageRow>> => [
  { key: 'path', label: _('backend.pages.col.path'), cell: (p) => html`<code>${p.path}</code>` },
  { key: 'title', label: _('backend.pages.col.title'), cell: (p) => p.title },
  {
    key: 'state', label: _('backend.pages.col.state'),
    cell: (p) => p.published
      ? badge(_('backend.pages.published'), 'positive', 'published')
      : badge(_('backend.pages.draft'), 'neutral', 'draft'),
  },
  { key: 'id', label: _('backend.table.id'), cell: (p) => html`<code>${p.id}</code>`, optional: true },
]

export const pagesScreen = (
  _: Translator,
  pages: PageRow[],
  frame: Frame = {},
  table: Partial<DataTable<PageRow>> = {},
): TemplateResult =>
  framed(_, _('backend.pages.title'), frame, pages.length === 0
    ? emptyState(_('backend.pages.empty.message'), _('backend.pages.empty.hint'))
    : dataTable(_, { columns: pageColumns(_), rows: pages, id: (p) => p.id, ...table }))

export const settingsScreen = (_: Translator, tokens: Record<string, string>, frame: Frame = {}): TemplateResult =>
  framed(_, _('backend.settings.title'), frame, html`
    <section data-ui="tokens">
      <h2 data-ui="group-title">${_('backend.settings.tokens')}</h2>
      <dl data-ui="token-list">${each(Object.entries(tokens), ([k]) => k, ([k, v]) => html`
        <div data-ui="token"><dt data-ui="token-name">--ket-${k}</dt><dd data-ui="token-value">${v}</dd></div>`)}
      </dl>
    </section>`)

export const screens = { appsScreen, pagesScreen, settingsScreen, emptyState, errorState }
