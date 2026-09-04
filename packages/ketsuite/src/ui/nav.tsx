// The sidebar: permitted root sections, the active section's menu, operational indicators and viewer.

import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { MenuNode, Translator } from '@ketvietlab/ketjs'
import { hasIcon, icon } from './icons.ts'
import { initials } from './primitives.tsx'

export const HOOKS = [
  'sidebar',
  'sidebar-main',
  'sidebar-header',
  'sidebar-brand',
  'sidebar-brand-name',
  'sidebar-brand-chevron',
  'sidebar-search',
  'sidebar-search-icon',
  'sidebar-search-input',
  'sidebar-nav',
  'sidebar-section-label',
  'sidebar-empty',
  'app-list',
  'app-entry',
  'app-icon',
  'app-monogram',
  'app-name',
  'menu',
  'menu-item-wrap',
  'menu-item',
  'menu-icon',
  'menu-label',
  'menu-dot',
  'menu-section',
  'menu-section-title',
  'menu-section-text',
  'menu-section-children',
  'sidebar-foot',
  'sidebar-tools',
  'indicators',
  'indicator',
  'indicator-icon',
  'indicator-count',
  'viewer',
  'viewer-trigger',
  'viewer-presence',
  'viewer-menu',
  'viewer-who',
  'viewer-name',
  'viewer-context-switcher',
  'viewer-context-icon',
  'viewer-context-copy',
  'viewer-context-label',
  'viewer-company',
  'signout',
  'signout-button',
  'signout-label',
] as const

export type Viewer = {
  name: string
  company: string | null
  companies: string[]
  companyName?: string | null
  branch?: string | null
  branches?: string[] | null
  branchName?: string | null
  contextPath?: string | null
  profilePath?: string | null
  timezone?: string
}

export type Indicator = {
  id: string
  icon: string
  label: string
  count: number
  path: string
}

export type SidebarOptions = {
  menu: MenuNode[]
  /**
   * Whether to offer the list of root sections. `auto` shows it only when this
   * viewer has more than one root to move between; a chooser with one choice is
   * furniture that costs a row of every sidebar.
   */
  rootList?: 'auto' | 'always' | 'never'
  viewer?: Viewer | null
  indicators?: Indicator[]
  menuFilter?: string | null
  navItems?: JSXChild
  footItems?: JSXChild
}

const destination = (node: MenuNode): string => {
  if (node.path) return node.path
  for (const child of node.children) {
    const found = destination(child)
    if (found !== '#') return found
  }
  return '#'
}

/**
 * A group is a label. Nothing in the sidebar folds any more.
 *
 * Collapsing existed because the sidebar carried every screen a person could
 * read, and that list was long enough to need hiding. Once it carries the work
 * they actually do, folding costs a click to reveal six rows — and a group that
 * starts closed is a group nobody finds.
 *
 * Deeper nesting still renders, as labels within labels. No shipped menu goes
 * that deep, and a tree that did would be telling us something about itself.
 */
const menuItem = (node: MenuNode, depth: number): TemplateResult =>
  node.children.length ? (
    <li data-ui="menu-item-wrap" data-depth={String(depth)}>
      <div data-ui="menu-section">
        <p data-ui="menu-section-title">
          {node.icon && hasIcon(node.icon) ? <span data-ui="menu-icon">{icon(node.icon)}</span> : ''}
          <span data-ui="menu-section-text">{node.label}</span>
        </p>
        <ul data-ui="menu-section-children">
          {each(
            node.children,
            (child) => child.id,
            (child) => menuItem(child, depth + 1),
          )}
        </ul>
      </div>
    </li>
  ) : (
    <li data-ui="menu-item-wrap" data-depth={String(depth)}>
      <a data-ui="menu-item" data-active={String(node.active)} href={destination(node)}>
        {node.icon && hasIcon(node.icon) ? (
          <span data-ui="menu-icon">{icon(node.icon)}</span>
        ) : (
          <span data-ui="menu-dot" aria-hidden="true" />
        )}
        <span data-ui="menu-label">{node.label}</span>
      </a>
    </li>
  )

/**
 * A group of entries a module contributes through `backend:nav.items`.
 *
 * The shell draws the app list and the active app's menu; a module with
 * navigation the menu tree cannot express — anything scoped to the record
 * currently open, whose path is only known at request time — fills that joint
 * instead. It gets the same rows the menu above it uses, because two sets of
 * sidebar markup drift, and the hooks are where the stylesheet and the shell
 * agree.
 */
export const navGroup = (o: { label: string; items: readonly MenuNode[] }): TemplateResult => (
  <>
    <p data-ui="sidebar-section-label" data-scope="app">
      {o.label}
    </p>
    <ul data-ui="menu" aria-label={o.label}>
      {each(
        o.items,
        (item) => item.id,
        (item) => menuItem(item, 0),
      )}
    </ul>
  </>
)

/**
 * The main list carries the work; everything else stays one search away.
 *
 * A surface a viewer may open but does not work on is still theirs to reach —
 * by search, by link, by a button on the screen that needs it. Leaving it in the
 * sidebar is what turns a receptionist's navigation into a table of contents for
 * the whole product.
 */
const working = (nodes: readonly MenuNode[]): MenuNode[] =>
  nodes.filter((node) => !node.secondary).map((node) => ({ ...node, children: working(node.children) }))

export const sidebarMain = (_: Translator, options: SidebarOptions): TemplateResult => {
  const { navItems } = options
  const menu = working(options.menu)
  const app = menu.find((item) => item.active) ?? menu[0] ?? null
  const rootList = options.rootList ?? 'auto'
  const showRoots = menu.length > 0 && (rootList === 'always' || (rootList === 'auto' && menu.length > 1))
  return (
    <>
      <div data-ui="sidebar-header">
        <a data-ui="sidebar-brand" href="/admin" title={_('backend.nav.sections')}>
          <span data-ui="sidebar-brand-name">{app ? app.label : _('backend.nav.sections')}</span>
          <span data-ui="sidebar-brand-chevron">{icon('chevron-down')}</span>
        </a>
      </div>

      <form data-ui="sidebar-search" method="get" role="search">
        <span data-ui="sidebar-search-icon">{icon('search')}</span>
        <input
          data-ui="sidebar-search-input"
          type="search"
          name="menu"
          value={options.menuFilter ?? ''}
          placeholder={_('backend.nav.search')}
          aria-label={_('backend.nav.search')}
          autocomplete="off"
        />
      </form>

      <nav data-ui="sidebar-nav">
        {menu.length === 0 && <p data-ui="sidebar-empty">{_('backend.nav.noMatch')}</p>}
        {showRoots && <p data-ui="sidebar-section-label">{_('backend.nav.sections')}</p>}
        {showRoots && (
          <ul data-ui="app-list">
            {each(
              menu,
              (item) => item.id,
              (item) => (
                <li>
                  <a
                    data-ui="app-entry"
                    data-active={String(item.active)}
                    href={destination(item)}
                    title={item.label}
                  >
                    <span data-ui="app-icon">
                      {item.icon && hasIcon(item.icon) ? (
                        icon(item.icon)
                      ) : (
                        <span data-ui="app-monogram">{item.label.slice(0, 1)}</span>
                      )}
                    </span>
                    <span data-ui="app-name">{item.label}</span>
                  </a>
                </li>
              ),
            )}
          </ul>
        )}

        {!!app && app.children.length > 0 && (
          <>
            <p data-ui="sidebar-section-label" data-scope="app">
              {app.label}
            </p>
            <ul data-ui="menu" aria-label={app.label}>
              {each(
                app.children,
                (child) => child.id,
                (child) => menuItem(child, 0),
              )}
            </ul>
          </>
        )}
        {navItems ?? ''}
      </nav>
    </>
  )
}

export const sidebarFoot = (_: Translator, options: SidebarOptions): TemplateResult => {
  const { viewer = null, indicators = [], footItems } = options
  return (
    <div data-ui="sidebar-foot">
      <div data-ui="sidebar-tools">
        {(indicators.length > 0 || !!footItems) && (
          <div data-ui="indicators">
            {each(
              indicators,
              (indicator) => indicator.id,
              (indicator) => (
                <a
                  data-ui="indicator"
                  data-kind={indicator.id}
                  href={indicator.path}
                  title={indicator.label}
                  aria-label={indicator.label}
                >
                  <span data-ui="indicator-icon">{icon(indicator.icon)}</span>
                  {indicator.count > 0 && <span data-ui="indicator-count">{String(indicator.count)}</span>}
                </a>
              ),
            )}
            {footItems ?? ''}
          </div>
        )}

        {!!viewer && (
          <details data-ui="viewer">
            <summary data-ui="viewer-trigger" title={viewer.name} aria-label={viewer.name}>
              <span data-ui="avatar" aria-hidden="true">
                {initials(viewer.name)}
              </span>
              <span data-ui="viewer-presence" aria-hidden="true" />
            </summary>
            <div data-ui="viewer-menu">
              <span data-ui="viewer-who">
                <span data-ui="viewer-name">
                  {viewer.profilePath ? <a href={viewer.profilePath}>{viewer.name}</a> : viewer.name}
                </span>
                {(viewer.companies.length > 1 || !!viewer.branchName) && (
                  <span data-ui="viewer-company">
                    {viewer.companyName ?? viewer.company}
                    {viewer.branchName ? ` · ${viewer.branchName}` : ''}
                  </span>
                )}
              </span>
              {!!viewer.contextPath && (
                <a data-ui="viewer-context-switcher" href={viewer.contextPath}>
                  <span data-ui="viewer-context-icon">{icon('building-2')}</span>
                  <span data-ui="viewer-context-copy">
                    <span data-ui="viewer-context-label">{_('backend.switchCompany')}</span>
                    <span data-ui="viewer-company">
                      {viewer.companyName ?? viewer.company}
                      {viewer.branchName ? ` · ${viewer.branchName}` : ''}
                    </span>
                  </span>
                </a>
              )}
              <form data-ui="signout" method="post" action="/logout">
                <button data-ui="signout-button" type="submit">
                  {icon('log-out')}
                  <span data-ui="signout-label">{_('backend.signOut')}</span>
                </button>
              </form>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

export const sidebar = (_: Translator, options: SidebarOptions): TemplateResult => {
  return (
    <aside data-ui="sidebar">
      <div data-ui="sidebar-main" data-ket-slot="backend.sidebar-main">
        {sidebarMain(_, options)}
      </div>
      {sidebarFoot(_, options)}
    </aside>
  )
}
