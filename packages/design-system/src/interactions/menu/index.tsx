import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'menu',
  'menu-trigger',
  'menu-trigger-count',
  'menu-panel',
  'menu-search',
  'menu-search-input',
  'menu-label',
  'menu-separator',
  'menu-item',
  'menu-item-leading',
  'menu-item-copy',
  'menu-item-check',
  'menu-item-shortcut',
] as const

export type MenuItem = {
  id: string
  kind?: 'item'
  label: string
  href?: string
  name?: string
  value?: string
  form?: string
  leading?: JSXChild
  description?: string
  disabled?: boolean
  destructive?: boolean
  /** Turns the command into a menuitemcheckbox while preserving server-owned state. */
  checked?: boolean
  /** Visible keyboard hint; the browser interaction remains owned by the application. */
  shortcut?: string
}

export type MenuLabel = { id: string; kind: 'label'; label: string }
export type MenuSeparator = { id: string; kind: 'separator' }
export type MenuEntry = MenuItem | MenuLabel | MenuSeparator

/**
 * A search field at the top of the panel, for a menu that picks from more choices
 * than fit at once — people, tags. It is a GET form: the server narrows the items
 * and renders the menu open again, so the list and what is picked stay server-owned.
 */
export type MenuSearch = {
  action: string
  name: string
  value?: string
  label: string
  placeholder?: string
  /** Query parameters the search keeps, so narrowing the list does not drop a filter. */
  hidden?: Readonly<Record<string, string>>
}

export type MenuProps = {
  id: string
  label: string
  items: readonly MenuEntry[]
  /** Replaces the label inside the trigger — an icon, say. The label still names it. */
  trigger?: JSXChild
  open?: boolean
  align?: 'start' | 'end'
  /** `compact` sits in a row of list facets at their height. */
  size?: 'default' | 'compact'
  /** How many choices are in effect, shown on the trigger. Zero shows nothing. */
  count?: number
  search?: MenuSearch
}

export const Menu = (props: MenuProps): TemplateResult => (
  <details
    data-ui="menu"
    data-align={props.align ?? 'start'}
    data-size={props.size === 'compact' ? 'compact' : null}
    data-active={props.count ? 'true' : null}
    open={props.open === true ? true : undefined}
  >
    {/* `details` exposes the open state natively; the runtime mirrors it into aria-expanded on toggle. */}
    <summary
      data-ui="menu-trigger"
      aria-haspopup="menu"
      aria-controls={`${props.id}-panel`}
      // A trigger that is only an icon still needs a name, and a pointer needs a hint.
      aria-label={props.trigger !== undefined ? props.label : undefined}
      title={props.trigger !== undefined ? props.label : undefined}
    >
      {props.trigger ?? props.label}
      {!!props.count && <span data-ui="menu-trigger-count">{String(props.count)}</span>}
    </summary>
    <div data-ui="menu-panel" id={`${props.id}-panel`} role="menu" aria-label={props.label}>
      {props.search && (
        <form data-ui="menu-search" role="search" method="get" action={props.search.action}>
          {each(
            Object.entries(props.search.hidden ?? {}),
            ([name]) => name,
            ([name, value]) => (
              <input type="hidden" name={name} value={value} />
            ),
          )}
          <input
            data-ui="menu-search-input"
            type="search"
            name={props.search.name}
            value={props.search.value ?? ''}
            placeholder={props.search.placeholder ?? props.search.label}
            aria-label={props.search.label}
            autocomplete="off"
          />
        </form>
      )}
      {each(
        props.items,
        (item) => item.id,
        (item) => {
          if (item.kind === 'separator') return <hr data-ui="menu-separator" />
          if (item.kind === 'label')
            return (
              <span data-ui="menu-label" role="presentation">
                {item.label}
              </span>
            )
          const role = item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'
          const content = (
            <>
              {item.checked !== undefined && (
                <span data-ui="menu-item-check" aria-hidden="true">
                  {item.checked ? '✓' : ''}
                </span>
              )}
              {item.leading !== undefined && (
                <span data-ui="menu-item-leading" aria-hidden="true">
                  {item.leading}
                </span>
              )}
              <span data-ui="menu-item-copy">
                <span>{item.label}</span>
                {item.description && <small>{item.description}</small>}
              </span>
              {item.shortcut && <kbd data-ui="menu-item-shortcut">{item.shortcut}</kbd>}
            </>
          )
          if (item.disabled)
            return (
              // biome-ignore lint/a11y/useAriaPropsSupportedByRole: `role` is menuitemcheckbox whenever aria-checked is set; otherwise aria-checked is null and not rendered.
              <span
                data-ui="menu-item"
                role={role}
                aria-checked={item.checked === undefined ? null : String(item.checked)}
                aria-disabled="true"
                tabIndex="-1"
              >
                {content}
              </span>
            )
          if (item.href)
            return (
              // biome-ignore lint/a11y/useAriaPropsSupportedByRole: `role` is menuitemcheckbox whenever aria-checked is set; otherwise aria-checked is null and not rendered.
              <a
                data-ui="menu-item"
                data-destructive={item.destructive ? 'true' : null}
                role={role}
                aria-checked={item.checked === undefined ? null : String(item.checked)}
                href={item.href}
              >
                {content}
              </a>
            )
          return (
            // biome-ignore lint/a11y/useAriaPropsSupportedByRole: `role` is menuitemcheckbox whenever aria-checked is set; otherwise aria-checked is null and not rendered.
            <button
              data-ui="menu-item"
              data-destructive={item.destructive ? 'true' : null}
              role={role}
              aria-checked={item.checked === undefined ? null : String(item.checked)}
              type="submit"
              name={item.name ?? 'intent'}
              value={item.value ?? item.id}
              form={item.form ?? null}
            >
              {content}
            </button>
          )
        },
      )}
    </div>
  </details>
)

export const ActionMenu = (props: Omit<MenuProps, 'trigger'> & { triggerLabel?: string }): TemplateResult => (
  <Menu
    {...props}
    trigger={<span>{props.triggerLabel ?? props.label} ···</span>}
    align={props.align ?? 'end'}
  />
)
