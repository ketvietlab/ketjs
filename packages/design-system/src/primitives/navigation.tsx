import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'nav-list',
  'nav-item',
  'nav-item-leading',
  'nav-item-label',
  'nav-item-count',
  'tabs',
  'tab',
  'tab-count',
] as const

export type NavItemProps = {
  label: string
  href: string
  leading?: JSXChild
  count?: number
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
  count?: number
  active?: boolean
}

export const Tabs = (props: { label: string; items: readonly TabItem[] }): TemplateResult => (
  <nav data-ui="tabs" aria-label={props.label}>
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
  </nav>
)
