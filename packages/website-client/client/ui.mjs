// Composition helpers. Screens call public Design System components through `h`; they never copy
// component markup or style a `data-ui`/`data-pattern` element (layout rules L2 and L8).
import { html } from '@ketvietlab/ketjs-view'
import { jsx } from '@ketvietlab/ketjs-view/jsx-runtime'
import { Button } from '@ketvietlab/design-system'
import { icon as ketIcon } from '@ketvietlab/ketsuite/ui/icons'

/**
 * `h(Surface, { title, body })` — props in, TemplateResult out. Children go through `body`,
 * `items` or `children` exactly as the component declares them.
 * @param {(props: any) => any} component
 * @param {Record<string, unknown>} [props]
 */
export const h = (component, props = {}) => jsx(component, props)

export const icon = (name) => ketIcon(name)

/** `page.move?id=home&to=1`: the command name plus string arguments, carried in a button value. */
export const commandValue = (name, args = {}) => {
  const search = new URLSearchParams(args).toString()
  return search ? `${name}?${search}` : name
}

/** @param {string} value */
export const parseCommand = (value) => {
  const at = value.indexOf('?')
  if (at < 0) return { name: value, args: {} }
  return { name: value.slice(0, at), args: Object.fromEntries(new URLSearchParams(value.slice(at + 1))) }
}

/**
 * A Design System button that runs a Studio command. The island delegates `button[name=command]`,
 * so a command never closes over render-time state. `type: 'submit'` sends its form with it.
 * @param {{ label: string, command: string, args?: Record<string, string>,
 *   variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive', disabled?: boolean,
 *   type?: 'button' | 'submit', form?: string }} p
 */
export const CommandButton = (p) =>
  h(Button, {
    label: p.label,
    variant: p.variant ?? 'secondary',
    disabled: p.disabled ?? false,
    type: p.type ?? 'button',
    form: p.form ?? null,
    name: 'command',
    value: commandValue(p.command, p.args),
  })

/** Join template results without coercing them to object strings. */
export const fragments = (items) => items.reduce((result, item) => html`${result}${item}`, html``)
