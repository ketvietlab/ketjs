import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['menu', 'menu-trigger', 'menu-panel', 'menu-item', 'menu-item-copy'] as const

export type MenuItem = {
  id: string
  label: string
  href?: string
  name?: string
  value?: string
  form?: string
  leading?: JSXChild
  description?: string
  disabled?: boolean
  destructive?: boolean
}

export type MenuProps = {
  id: string
  label: string
  items: readonly MenuItem[]
  trigger?: JSXChild
  open?: boolean
  align?: 'start' | 'end'
}

export const Menu = (props: MenuProps): TemplateResult => (
  <details data-ui="menu" data-align={props.align ?? 'start'} open={props.open === true ? true : undefined}>
    <summary
      data-ui="menu-trigger"
      aria-haspopup="menu"
      aria-controls={`${props.id}-panel`}
      aria-expanded={props.open === true ? 'true' : 'false'}
    >
      {props.trigger ?? props.label}
    </summary>
    <div data-ui="menu-panel" id={`${props.id}-panel`} role="menu" aria-label={props.label}>
      {each(
        props.items,
        (item) => item.id,
        (item) => {
          const content = (
            <>
              {item.leading !== undefined && <span aria-hidden="true">{item.leading}</span>}
              <span data-ui="menu-item-copy">
                <span>{item.label}</span>
                {item.description && <small>{item.description}</small>}
              </span>
            </>
          )
          if (item.disabled)
            return (
              <span data-ui="menu-item" role="menuitem" aria-disabled="true">
                {content}
              </span>
            )
          if (item.href)
            return (
              <a
                data-ui="menu-item"
                data-destructive={item.destructive ? 'true' : null}
                role="menuitem"
                href={item.href}
              >
                {content}
              </a>
            )
          return (
            <button
              data-ui="menu-item"
              data-destructive={item.destructive ? 'true' : null}
              role="menuitem"
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
