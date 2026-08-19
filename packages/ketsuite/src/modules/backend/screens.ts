import { each, html, when } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'

/**
 * The backend screens.
 *
 * Markup lives here because it is wired to real data; the look lives entirely in
 * design/admin.css. The contract between the two is the `data-ui` attribute on every
 * meaningful element — those are the selectors the stylesheet is written against, and
 * they will not change without a note in HANDOFF.md.
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

const shell = (active: Screen, title: string, body: TemplateResult): TemplateResult => html`
<div data-ui="shell">
  <aside data-ui="sidebar">
    <div data-ui="brand">KetSuite</div>
    <nav data-ui="nav">
      <a data-ui="nav-item" data-active=${String(active === 'apps')} href="/admin/apps">Ứng dụng</a>
      <a data-ui="nav-item" data-active=${String(active === 'pages')} href="/admin/pages">Trang</a>
      <a data-ui="nav-item" data-active=${String(active === 'settings')} href="/admin/settings">Cài đặt</a>
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

const appCard = (app: AppRow): TemplateResult => html`
<article data-ui="app-card" data-state=${app.state} data-app=${app.name}>
  <h3 data-ui="app-title">${app.title}</h3>
  <p data-ui="app-summary">${app.summary}</p>
  <dl data-ui="app-meta">
    <dt>Phụ thuộc</dt><dd data-ui="app-depends">${app.depends.join(', ') || '—'}</dd>
    ${when(app.dependents.length > 0, () => html`<dt>Đang được dùng bởi</dt><dd data-ui="app-dependents">${app.dependents.join(', ')}</dd>`)}
  </dl>
  <div data-ui="app-actions">
    <button data-ui="app-action" data-action=${app.state === 'installed' ? 'uninstall' : 'install'}
            disabled=${app.state === 'installed' && app.dependents.length > 0}>
      ${app.state === 'installed' ? 'Gỡ' : 'Cài đặt'}
    </button>
  </div>
</article>`

export const appsScreen = (apps: AppRow[]): TemplateResult => {
  const categories = [...new Set(apps.map(a => a.category))].sort()
  return shell('apps', 'Ứng dụng', apps.length === 0
    ? emptyState('Bản triển khai này chưa có ứng dụng nào.', 'Ứng dụng phải được đưa vào lúc build trước khi cài được.')
    : html`<div data-ui="app-groups">${each(categories, c => c, category => html`
        <section data-ui="app-group" data-category=${category}>
          <h2 data-ui="group-title">${category}</h2>
          <div data-ui="app-grid">${each(apps.filter(a => a.category === category), a => a.name, appCard)}</div>
        </section>`)}</div>`)
}

export const pagesScreen = (pages: PageRow[]): TemplateResult =>
  shell('pages', 'Trang', pages.length === 0
    ? emptyState('Chưa có trang nào.', 'Tạo trang đầu tiên để bắt đầu.')
    : html`<table data-ui="table">
        <thead><tr><th>Đường dẫn</th><th>Tiêu đề</th><th>Trạng thái</th></tr></thead>
        <tbody>${each(pages, p => p.id, p => html`
          <tr data-ui="row" data-page=${p.id}>
            <td data-ui="cell-path"><code>${p.path}</code></td>
            <td data-ui="cell-title">${p.title}</td>
            <td data-ui="cell-state"><span data-ui="badge" data-published=${String(p.published)}>${p.published ? 'Đã đăng' : 'Nháp'}</span></td>
          </tr>`)}
        </tbody>
      </table>`)

export const settingsScreen = (tokens: Record<string, string>): TemplateResult =>
  shell('settings', 'Cài đặt', html`
    <section data-ui="tokens">
      <h2 data-ui="group-title">Design token đang áp dụng</h2>
      <dl data-ui="token-list">${each(Object.entries(tokens), ([k]) => k, ([k, v]) => html`
        <div data-ui="token"><dt data-ui="token-name">--ket-${k}</dt><dd data-ui="token-value">${v}</dd></div>`)}
      </dl>
    </section>`)

export const screens = { appsScreen, pagesScreen, settingsScreen, emptyState, errorState }
