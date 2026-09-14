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

export const Tabs = (props: {
  label: string
  items: readonly TabItem[]
  extension?: JSXChild
}): TemplateResult => (
  <nav data-ui="tabs" data-pattern="tabs" aria-label={props.label}>
    {each(
      props.items,
      (item) => item.id,
      (item) => (
        <a
          data-ui="tab"
          data-active={item.active === true ? 'true' : null}
          href={item.href}
          aria-current={item.active === true ? 'page' : null}
        >
          {item.label}
          {item.count !== undefined && <span data-ui="tab-count">{String(item.count)}</span>}
        </a>
      ),
    )}
    {props.extension}
  </nav>
)
