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
  'navigation-supplementary',
  'navigation-item',
  'navigation-branch',
  'navigation-branch-trigger',
  'navigation-children',
  'navigation-item-leading',
  'navigation-item-copy',
  'navigation-item-label',
  'navigation-item-description',
  'navigation-item-count',
  'navigation-footer',
] as const

type NavigationItemBase = {
  id: string
  label: string
  leading?: JSXChild
  description?: string
  count?: number
}

export type NavigationItemData = NavigationItemBase &
  (
    | { href: string; active?: boolean; children?: never; expanded?: never }
    | { href?: never; active?: never; children: readonly NavigationItemData[]; expanded?: boolean }
  )

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
  supplementary?: JSXChild
  footer?: JSXChild
  navigationSlot?: string
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

const NavigationItemContent = (props: { item: NavigationItemData }): TemplateResult => (
  <>
    {props.item.leading !== undefined && (
      <span data-ui="navigation-item-leading" aria-hidden="true">
        {props.item.leading}
      </span>
    )}
    <span data-ui="navigation-item-copy">
      <span data-ui="navigation-item-label">{props.item.label}</span>
      {props.item.description !== undefined && (
        <span data-ui="navigation-item-description">{props.item.description}</span>
      )}
    </span>
    {props.item.count !== undefined && (
      <span data-ui="navigation-item-count">{String(props.item.count)}</span>
    )}
  </>
)

const hasActiveItem = (item: NavigationItemData): boolean =>
  item.active === true || item.children?.some(hasActiveItem) === true

const renderNavigationItem = (
  props: NavigationItemData,
  branchGroup: string,
  level: number,
): TemplateResult => {
  if (props.children !== undefined) {
    const open = props.expanded === true || hasActiveItem(props)
    return (
      <details data-ui="navigation-branch" data-level={String(level)} name={branchGroup} open={open}>
        <summary data-ui="navigation-branch-trigger">
          <NavigationItemContent item={props} />
        </summary>
        <div data-ui="navigation-children" data-level={String(level + 1)}>
          {each(
            props.children,
            (item) => item.id,
            (item) => renderNavigationItem(item, `${props.id}-branches`, level + 1),
          )}
        </div>
      </details>
    )
  }
  return (
    <a
      data-ui="navigation-item"
      data-active={props.active === true ? 'true' : null}
      data-level={String(level)}
      href={props.href}
      aria-current={props.active === true ? 'page' : null}
    >
      <NavigationItemContent item={props} />
    </a>
  )
}

export const NavigationItem = (props: NavigationItemData): TemplateResult => (
  <>{renderNavigationItem(props, `${props.id}-root-branches`, 1)}</>
)

export const NavigationGroup = (props: NavigationGroupData & { branchGroup?: string }): TemplateResult => (
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
        (item) => renderNavigationItem(item, props.branchGroup ?? `${props.id}-branches`, 1),
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
  supplementary?: JSXChild
  footer?: JSXChild
  navigationSlot?: string
  closeLabel: string
}): TemplateResult => (
  <div data-ui="navigation-layer">
    <button data-ui="navigation-backdrop" type="button" aria-label={props.closeLabel} tabIndex={-1} />
    <div data-ui="navigation-drawer" id={props.id} data-navigation-label={props.label} tabIndex={-1}>
      <NavigationHeader identity={props.identity} context={props.context} closeLabel={props.closeLabel} />
      <nav data-ui="navigation-groups" aria-label={props.label} data-ket-slot={props.navigationSlot}>
        {each(
          props.groups,
          (group) => group.id,
          (group) => (
            <NavigationGroup {...group} id={`${props.id}-${group.id}`} branchGroup={`${props.id}-branches`} />
          ),
        )}
        {props.supplementary !== undefined && (
          <div data-ui="navigation-supplementary">{props.supplementary}</div>
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
        supplementary={props.supplementary}
        footer={props.footer}
        navigationSlot={props.navigationSlot}
        closeLabel={closeLabel}
      />
    </details>
  )
}
