import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'app-navigation',
  'navigation-trigger',
  'navigation-trigger-icon',
  'navigation-trigger-identity',
  'navigation-trigger-label',
  'navigation-layer',
  'navigation-backdrop',
  'navigation-drawer',
  'navigation-header',
  'navigation-identity',
  'navigation-context',
  'navigation-close',
  'navigation-groups',
  'navigation-group',
  'navigation-group-label',
  'navigation-items',
  'navigation-item',
  'navigation-item-leading',
  'navigation-item-copy',
  'navigation-item-label',
  'navigation-item-description',
  'navigation-item-count',
  'navigation-footer',
] as const

export type NavigationItemData = {
  id: string
  label: string
  href: string
  leading?: JSXChild
  description?: string
  count?: number
  active?: boolean
}

export type NavigationGroupData = {
  id: string
  label?: string
  items: readonly NavigationItemData[]
}

export type AppNavigationProps = {
  id: string
  label: string
  identity: JSXChild
  groups: readonly NavigationGroupData[]
  context?: JSXChild
  footer?: JSXChild
  menuLabel?: string
  closeLabel?: string
  open?: boolean
}

export const NavigationTrigger = (props: {
  controls: string
  label: string
  identity: JSXChild
  open?: boolean
}): TemplateResult => (
  <summary
    data-ui="navigation-trigger"
    aria-controls={props.controls}
    data-open={props.open === true ? 'true' : 'false'}
  >
    <span data-ui="navigation-trigger-icon" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
    <span data-ui="navigation-trigger-identity">{props.identity}</span>
    <span data-ui="navigation-trigger-label">{props.label}</span>
  </summary>
)

export const NavigationHeader = (props: {
  identity: JSXChild
  context?: JSXChild
  closeLabel: string
}): TemplateResult => (
  <header data-ui="navigation-header">
    <div>
      <div data-ui="navigation-identity">{props.identity}</div>
      {props.context !== undefined && <div data-ui="navigation-context">{props.context}</div>}
    </div>
    <button data-ui="navigation-close" type="button" aria-label={props.closeLabel}>
      <span aria-hidden="true" />
    </button>
  </header>
)

export const NavigationItem = (props: NavigationItemData): TemplateResult => (
  <a
    data-ui="navigation-item"
    data-active={props.active === true ? 'true' : null}
    href={props.href}
    aria-current={props.active === true ? 'page' : null}
  >
    {props.leading !== undefined && (
      <span data-ui="navigation-item-leading" aria-hidden="true">
        {props.leading}
      </span>
    )}
    <span data-ui="navigation-item-copy">
      <span data-ui="navigation-item-label">{props.label}</span>
      {props.description !== undefined && (
        <span data-ui="navigation-item-description">{props.description}</span>
      )}
    </span>
    {props.count !== undefined && <span data-ui="navigation-item-count">{String(props.count)}</span>}
  </a>
)

export const NavigationGroup = (props: NavigationGroupData): TemplateResult => (
  <section data-ui="navigation-group" aria-labelledby={props.label ? `${props.id}-label` : null}>
    {props.label !== undefined && (
      <h2 data-ui="navigation-group-label" id={`${props.id}-label`}>
        {props.label}
      </h2>
    )}
    <div data-ui="navigation-items">
      {each(
        props.items,
        (item) => item.id,
        (item) => (
          <NavigationItem {...item} />
        ),
      )}
    </div>
  </section>
)

export const NavigationDrawer = (props: {
  id: string
  label: string
  identity: JSXChild
  groups: readonly NavigationGroupData[]
  context?: JSXChild
  footer?: JSXChild
  closeLabel: string
}): TemplateResult => (
  <div data-ui="navigation-layer">
    <button data-ui="navigation-backdrop" type="button" aria-label={props.closeLabel} tabIndex={-1} />
    <div data-ui="navigation-drawer" id={props.id} data-navigation-label={props.label} tabIndex={-1}>
      <NavigationHeader identity={props.identity} context={props.context} closeLabel={props.closeLabel} />
      <nav data-ui="navigation-groups" aria-label={props.label}>
        {each(
          props.groups,
          (group) => group.id,
          (group) => (
            <NavigationGroup {...group} id={`${props.id}-${group.id}`} />
          ),
        )}
      </nav>
      {props.footer !== undefined && <footer data-ui="navigation-footer">{props.footer}</footer>}
    </div>
  </div>
)

export const AppNavigation = (props: AppNavigationProps): TemplateResult => {
  const drawerId = `${props.id}-drawer`
  const closeLabel = props.closeLabel ?? 'Close navigation'
  return (
    <details data-ui="app-navigation" data-navigation-id={props.id} open={props.open === true}>
      <NavigationTrigger
        controls={drawerId}
        label={props.menuLabel ?? 'Menu'}
        identity={props.identity}
        open={props.open}
      />
      <NavigationDrawer
        id={drawerId}
        label={props.label}
        identity={props.identity}
        groups={props.groups}
        context={props.context}
        footer={props.footer}
        closeLabel={closeLabel}
      />
    </details>
  )
}
