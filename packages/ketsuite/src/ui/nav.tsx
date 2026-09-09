// The sidebar: permitted root sections, the active section's menu, operational indicators and viewer.

import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { MenuNode, Translator } from '@ketvietlab/ketjs'
import {
  AppNavigation,
  IconButton,
  NavigationGroup,
  type NavigationGroupData,
  type NavigationItemData,
} from '@ketvietlab/design-system'
import { hasIcon, icon } from './icons.ts'
import { initials } from './primitives.tsx'

export const HOOKS = [
  'sidebar',
  'sidebar-main',
  'sidebar-search',
  'sidebar-search-icon',
  'sidebar-search-input',
  'sidebar-empty',
  'app-monogram',
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

const NAVIGATION_ID = 'backend-navigation'
const NAVIGATION_DRAWER_ID = `${NAVIGATION_ID}-drawer`
const NAVIGATION_BRANCH_GROUP = `${NAVIGATION_DRAWER_ID}-branches`

const destination = (node: MenuNode): string => {
  if (node.path) return node.path
  for (const child of node.children) {
    const found = destination(child)
    if (found !== '#') return found
  }
  return '#'
}

const navigationLeading = (node: MenuNode, root: boolean): JSXChild | undefined => {
  if (node.icon && hasIcon(node.icon)) return icon(node.icon)
  if (root) return <span data-ui="app-monogram">{node.label.slice(0, 1)}</span>
  return undefined
}

const navigationItem = (node: MenuNode, root = false): NavigationItemData => {
  const leading = navigationLeading(node, root)
  if (node.children.length)
    return {
      id: node.id,
      label: node.label,
      ...(leading === undefined ? {} : { leading }),
      children: node.children.map((child) => navigationItem(child)),
      expanded: node.active,
    }
  return {
    id: node.id,
    label: node.label,
    ...(leading === undefined ? {} : { leading }),
    href: destination(node),
    active: node.active,
  }
}

const groupId = (label: string): string =>
  `extension-${label
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')}`

/**
 * A group of entries a module contributes through `backend:nav.items`.
 *
 * The shell draws the module accordion and its nested menu; a module with
 * navigation the menu tree cannot express — anything scoped to the record
 * currently open, whose path is only known at request time — fills that joint
 * instead. It gets the same rows the menu above it uses, because two sets of
 * sidebar markup drift, and the hooks are where the stylesheet and the shell
 * agree.
 */
export const navGroup = (o: { label: string; items: readonly MenuNode[] }): TemplateResult => (
  <NavigationGroup
    id={groupId(o.label)}
    label={o.label}
    items={o.items.map((item) => navigationItem(item))}
  />
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

const navigationModel = (
  _: Translator,
  options: SidebarOptions,
): { groups: NavigationGroupData[]; supplementary?: JSXChild } => {
  const menu = working(options.menu)
  const app = menu.find((item) => item.active) ?? menu[0] ?? null
  const rootList = options.rootList ?? 'auto'
  const showRoots = menu.length > 0 && (rootList === 'always' || (rootList === 'auto' && menu.length > 1))
  const items = showRoots
    ? menu.map((item) => navigationItem(item, true))
    : (app?.children.map((item) => navigationItem(item)) ?? (app ? [navigationItem(app, true)] : []))
  const supplementary =
    menu.length === 0 || options.navItems !== undefined ? (
      <>
        {menu.length === 0 && <p data-ui="sidebar-empty">{_('backend.nav.noMatch')}</p>}
        {options.navItems ?? ''}
      </>
    ) : undefined
  return { groups: [{ id: 'modules', items }], supplementary }
}

const sidebarSearch = (_: Translator, options: SidebarOptions): TemplateResult => (
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
)

/** The replaceable contents of the stable navigation scroll region. */
export const sidebarNavigationContent = (_: Translator, options: SidebarOptions): TemplateResult => {
  const model = navigationModel(_, options)
  return (
    <>
      {each(
        model.groups,
        (group) => group.id,
        (group) => (
          <NavigationGroup
            {...group}
            id={`${NAVIGATION_DRAWER_ID}-${group.id}`}
            branchGroup={NAVIGATION_BRANCH_GROUP}
          />
        ),
      )}
      {model.supplementary !== undefined && (
        <div data-ui="navigation-supplementary">{model.supplementary}</div>
      )}
    </>
  )
}

export const sidebarMain = (_: Translator, options: SidebarOptions): TemplateResult => {
  const model = navigationModel(_, options)
  return (
    <AppNavigation
      id={NAVIGATION_ID}
      label={_('backend.nav.sections')}
      identity={_('backend.brand')}
      context={sidebarSearch(_, options)}
      groups={model.groups}
      supplementary={model.supplementary}
      footer={sidebarFoot(_, options)}
      menuLabel={_('backend.nav.open')}
      closeLabel={_('backend.nav.close')}
      navigationSlot="backend.sidebar-main"
    />
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

        <IconButton
          name="theme"
          label={_('backend.theme.toggle')}
          variant="secondary"
          pressed={false}
          icon={
            <>
              <span data-theme-icon="dark">{icon('moon')}</span>
              <span data-theme-icon="light">{icon('sun')}</span>
            </>
          }
        />

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
      <div data-ui="sidebar-main">{sidebarMain(_, options)}</div>
    </aside>
  )
}
