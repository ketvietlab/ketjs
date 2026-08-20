// The sidebar: permitted apps, the open app's menu, operational indicators and viewer.

import { each } from 'ketjs-view'
import type { JSXChild, TemplateResult } from 'ketjs-view'
import type { MenuNode, Translator } from 'ketjs'
import { hasIcon, icon } from './icons.ts'
import { initials } from './primitives.tsx'

export const HOOKS = [
  'sidebar',
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
  'menu-label',
  'menu-dot',
  'menu-section',
  'menu-section-title',
  'menu-section-chevron',
  'menu-section-text',
  'menu-section-children',
  'sidebar-foot',
  'indicators',
  'indicator',
  'indicator-icon',
  'indicator-count',
  'viewer',
  'viewer-who',
  'viewer-name',
  'viewer-company',
  'signout',
  'signout-button',
] as const

export type Viewer = { name: string; company: string | null; companies: string[] }

export type Indicator = {
  id: string
  icon: string
  label: string
  count: number
  path: string
}

const destination = (node: MenuNode): string => {
  if (node.path) return node.path
  for (const child of node.children) {
    const found = destination(child)
    if (found !== '#') return found
  }
  return '#'
}

const menuItem = (node: MenuNode, depth: number): TemplateResult =>
  node.children.length ? (
    <li data-ui="menu-item-wrap" data-depth={String(depth)}>
      <details data-ui="menu-section" open={node.active || depth === 0}>
        <summary data-ui="menu-section-title">
          <span data-ui="menu-section-chevron">{icon('chevron-right')}</span>
          <span data-ui="menu-section-text">{node.label}</span>
        </summary>
        <ul data-ui="menu-section-children">
          {each(
            node.children,
            (child) => child.id,
            (child) => menuItem(child, depth + 1),
          )}
        </ul>
      </details>
    </li>
  ) : (
    <li data-ui="menu-item-wrap" data-depth={String(depth)}>
      <a data-ui="menu-item" data-active={String(node.active)} href={destination(node)}>
        <span data-ui="menu-dot" aria-hidden="true" />
        <span data-ui="menu-label">{node.label}</span>
      </a>
    </li>
  )

export const sidebar = (
  _: Translator,
  options: {
    menu: MenuNode[]
    viewer?: Viewer | null
    indicators?: Indicator[]
    menuFilter?: string | null
    navItems?: JSXChild
    footItems?: JSXChild
  },
): TemplateResult => {
  const { menu, viewer = null, indicators = [], navItems, footItems } = options
  const app = menu.find((item) => item.active) ?? menu[0] ?? null
  return (
    <aside data-ui="sidebar">
      <div data-ui="sidebar-header">
        <a data-ui="sidebar-brand" href="/admin" title={_('backend.nav.apps')}>
          <span data-ui="sidebar-brand-name">{app ? app.label : _('backend.nav.apps')}</span>
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
        {menu.length > 0 && <p data-ui="sidebar-section-label">{_('backend.nav.apps')}</p>}
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

      <div data-ui="sidebar-foot">
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
          <div data-ui="viewer">
            <span data-ui="avatar" aria-hidden="true">
              {initials(viewer.name)}
            </span>
            <span data-ui="viewer-who">
              <span data-ui="viewer-name">{viewer.name}</span>
              {viewer.companies.length > 1 && <span data-ui="viewer-company">{viewer.company}</span>}
            </span>
            <form data-ui="signout" method="post" action="/logout">
              <button
                data-ui="signout-button"
                type="submit"
                title={_('backend.signOut')}
                aria-label={_('backend.signOut')}
              >
                {icon('log-out')}
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  )
}
