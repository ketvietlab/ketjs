import { each, html, when } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'

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

const shell = (_: Translator, active: Screen, title: string, body: TemplateResult): TemplateResult => html`
<div data-ui="shell">
  <aside data-ui="sidebar">
    <div data-ui="brand">${_('backend.brand')}</div>
    <nav data-ui="nav">
      <a data-ui="nav-item" data-active=${String(active === 'apps')} href="/admin/apps">${_('backend.nav.apps')}</a>
      <a data-ui="nav-item" data-active=${String(active === 'pages')} href="/admin/pages">${_('backend.nav.pages')}</a>
      <a data-ui="nav-item" data-active=${String(active === 'settings')} href="/admin/settings">${_('backend.nav.settings')}</a>
    </nav>
  </aside>
  <main data-ui="main">
    <header data-ui="topbar"><h1 data-ui="title">${title}</h1></header>
    <div data-ui="content">${body}</div>
  </main>
</div>`

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

const appCard = (_: Translator, app: AppRow): TemplateResult => html`
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
  </div>
</article>`

export const appsScreen = (_: Translator, apps: AppRow[]): TemplateResult => {
  const categories = [...new Set(apps.map(a => a.category))].sort()
  const categoryLabel = (c: string): string => {
    const owner = apps.find(a => a.category === c)
    return owner ? label(_, owner.name, 'category', c) : c
  }
  return shell(_, 'apps', _('backend.apps.title'), apps.length === 0
    ? emptyState(_('backend.apps.empty.message'), _('backend.apps.empty.hint'))
    : html`<div data-ui="app-groups">${each(categories, c => c, category => html`
        <section data-ui="app-group" data-category=${category}>
          <h2 data-ui="group-title">${categoryLabel(category)}</h2>
          <div data-ui="app-grid">${each(apps.filter(a => a.category === category), a => a.name, a => appCard(_, a))}</div>
        </section>`)}</div>`)
}

export const pagesScreen = (_: Translator, pages: PageRow[]): TemplateResult =>
  shell(_, 'pages', _('backend.pages.title'), pages.length === 0
    ? emptyState(_('backend.pages.empty.message'), _('backend.pages.empty.hint'))
    : html`<table data-ui="table">
        <thead><tr><th>${_('backend.pages.col.path')}</th><th>${_('backend.pages.col.title')}</th><th>${_('backend.pages.col.state')}</th></tr></thead>
        <tbody>${each(pages, p => p.id, p => html`
          <tr data-ui="row" data-page=${p.id}>
            <td data-ui="cell-path"><code>${p.path}</code></td>
            <td data-ui="cell-title">${p.title}</td>
            <td data-ui="cell-state"><span data-ui="badge" data-published=${String(p.published)}>${p.published ? _('backend.pages.published') : _('backend.pages.draft')}</span></td>
          </tr>`)}
        </tbody>
      </table>`)

export const settingsScreen = (_: Translator, tokens: Record<string, string>): TemplateResult =>
  shell(_, 'settings', _('backend.settings.title'), html`
    <section data-ui="tokens">
      <h2 data-ui="group-title">${_('backend.settings.tokens')}</h2>
      <dl data-ui="token-list">${each(Object.entries(tokens), ([k]) => k, ([k, v]) => html`
        <div data-ui="token"><dt data-ui="token-name">--ket-${k}</dt><dd data-ui="token-value">${v}</dd></div>`)}
      </dl>
    </section>`)

export const screens = { appsScreen, pagesScreen, settingsScreen, emptyState, errorState }
