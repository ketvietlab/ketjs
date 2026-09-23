import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'breadcrumbs',
  'breadcrumb',
  'breadcrumb-overflow',
  'breadcrumb-overflow-trigger',
  'breadcrumb-overflow-list',
  'nav-list',
  'nav-item',
  'nav-item-leading',
  'nav-item-label',
  'nav-item-count',
  'tabs',
  'tab',
  'tab-count',
  'tabbed-view',
  'tabbed-view-context',
  'tab-panel',
] as const

export type BreadcrumbItem = {
  id?: string
  label: string
  href?: string
}

type BreadcrumbOverflow = {
  id: '__breadcrumb-overflow'
  kind: 'overflow'
  items: readonly BreadcrumbItem[]
}

export type BreadcrumbsProps = {
  label: string
  items: readonly BreadcrumbItem[]
  /** Keep the first and current locations visible; put intermediate ancestors in a native disclosure. */
  maxItems?: number
  /** Accessible label for the collapsed ancestor trigger, supplied in the application's locale. */
  overflowLabel?: string
}

export const Breadcrumbs = (props: BreadcrumbsProps): TemplateResult => {
  const limit = Math.max(3, Math.floor(props.maxItems ?? props.items.length))
  const overflow = props.items.length > limit
  const omitted = overflow ? props.items.slice(1, props.items.length - (limit - 2)) : []
  const visible: readonly (BreadcrumbItem | BreadcrumbOverflow)[] = overflow
    ? [
        props.items[0]!,
        { id: '__breadcrumb-overflow', kind: 'overflow', items: omitted },
        ...props.items.slice(props.items.length - (limit - 2)),
      ]
    : props.items

  return (
    <nav data-ui="breadcrumbs" data-pattern="breadcrumbs" aria-label={props.label}>
      <ol>
        {each(
          visible,
          (item, index) => item.id ?? `${index}:${'label' in item ? item.label : 'overflow'}`,
          (item, index) =>
            'kind' in item ? (
              <li data-ui="breadcrumb-overflow">
                <details>
                  <summary
                    data-ui="breadcrumb-overflow-trigger"
                    aria-label={props.overflowLabel ?? props.label}
                  >
                    …
                  </summary>
                  <ol data-ui="breadcrumb-overflow-list">
                    {each(
                      item.items,
                      (ancestor, ancestorIndex) => ancestor.id ?? `${ancestorIndex}:${ancestor.label}`,
                      (ancestor) => (
                        <li>
                          {ancestor.href ? (
                            <a href={ancestor.href}>{ancestor.label}</a>
                          ) : (
                            <span>{ancestor.label}</span>
                          )}
                        </li>
                      ),
                    )}
                  </ol>
                </details>
              </li>
            ) : (
              <li data-ui="breadcrumb">
                {item.href !== undefined && index < visible.length - 1 ? (
                  <a href={item.href}>{item.label}</a>
                ) : (
                  <span aria-current={index === visible.length - 1 ? 'page' : null}>{item.label}</span>
                )}
              </li>
            ),
        )}
      </ol>
    </nav>
  )
}

export type NavItemProps = {
  label: string
  href: string
  leading?: JSXChild
  count?: number | string
  active?: boolean
}

export const NavItem = (props: NavItemProps): TemplateResult => (
  <a
    data-ui="nav-item"
    data-active={props.active === true ? 'true' : null}
    href={props.href}
    aria-current={props.active === true ? 'page' : null}
  >
    {props.leading !== undefined && (
      <span data-ui="nav-item-leading" aria-hidden="true">
        {props.leading}
      </span>
    )}
    <span data-ui="nav-item-label">{props.label}</span>
    {props.count !== undefined && <span data-ui="nav-item-count">{String(props.count)}</span>}
  </a>
)

export const NavList = (props: { label: string; items: readonly NavItemProps[] }): TemplateResult => (
  <nav data-ui="nav-list" aria-label={props.label}>
    {each(
      props.items,
      (item) => `${item.href}:${item.label}`,
      (item) => (
        <NavItem {...item} />
      ),
    )}
  </nav>
)

export type TabItem = {
  id: string
  label: string
  href: string
  /** A number, or a bounded label such as "10.000+" when the exact total is not counted. */
  count?: number | string
  active?: boolean
}

export type TabProps = TabItem & {
  /** DOM id used to associate this navigation item with the active panel. */
  elementId?: string
  /** Id of the panel this navigation item opens. */
  controls?: string
}

export const Tab = (props: TabProps): TemplateResult => (
  <a
    data-ui="tab"
    data-active={props.active === true ? 'true' : null}
    id={props.elementId}
    href={props.href}
    aria-current={props.active === true ? 'page' : null}
    aria-controls={props.controls}
  >
    {props.label}
    {props.count !== undefined && <span data-ui="tab-count">{String(props.count)}</span>}
  </a>
)

export type TabsProps = {
  /** Stable id used to associate the active tab with a TabPanel. */
  id?: string
  label: string
  items: readonly TabItem[]
  extension?: JSXChild
  /** Panel controlled by these route-navigation tabs. */
  panelId?: string
}

const tabElementId = (tabsId: string, itemId: string): string =>
  `${tabsId}-${itemId.replace(/[^a-zA-Z0-9_-]+/gu, '-')}-tab`

export const Tabs = (props: TabsProps): TemplateResult => (
  <nav data-ui="tabs" data-pattern="tabs" aria-label={props.label}>
    {each(
      props.items,
      (item) => item.id,
      (item) => (
        <Tab
          {...item}
          elementId={props.id ? tabElementId(props.id, item.id) : undefined}
          controls={props.panelId}
        />
      ),
    )}
    {props.extension}
  </nav>
)

export type TabPanelProps = {
  id?: string
  labelledBy?: string
  body: JSXChild
}

/**
 * Content associated with route-navigation tabs. It owns scrolling and vertical
 * rhythm, but deliberately adds no left or right padding.
 */
export const TabPanel = (props: TabPanelProps): TemplateResult => (
  <section data-ui="tab-panel" id={props.id} aria-labelledby={props.labelledBy} tabindex="-1">
    {props.body}
  </section>
)

export type TabbedViewProps = {
  id: string
  label: string
  items: readonly TabItem[]
  body: JSXChild
  /** Stable content above the tab bar, such as a record summary or issues. */
  context?: JSXChild
  extension?: JSXChild
}

/** A complete tabbed region with one stable navigation bar and one scrolling panel. */
export const TabbedView = (props: TabbedViewProps): TemplateResult => {
  const tabsId = `${props.id}-tabs`
  const panelId = `${props.id}-panel`
  const active = props.items.find((item) => item.active === true)
  return (
    <div data-ui="tabbed-view">
      {props.context !== undefined && props.context !== '' ? (
        <div data-ui="tabbed-view-context">{props.context}</div>
      ) : (
        ''
      )}
      <Tabs
        id={tabsId}
        label={props.label}
        items={props.items}
        extension={props.extension}
        panelId={panelId}
      />
      <TabPanel
        id={panelId}
        labelledBy={active ? tabElementId(tabsId, active.id) : undefined}
        body={props.body}
      />
    </div>
  )
}
