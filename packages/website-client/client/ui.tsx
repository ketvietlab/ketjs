import { jsx } from '@ketvietlab/ketjs-view/jsx-runtime'
import type { JSXChild, JSXComponent } from '@ketvietlab/ketjs-view/jsx-runtime'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Button } from '@ketvietlab/design-system'
import type { ActionSize, ActionVariant } from '@ketvietlab/design-system'
import { icon as ketIcon } from '@ketvietlab/ketsuite/ui/icons'
import type { CommandArgs } from './types.ts'

/**
 * `h(Surface, { title, body })` — props in, TemplateResult out. Children go through `body`,
 * `items` or `children` exactly as the component declares them. For callers outside JSX
 * (extensions written in plain JavaScript).
 */
export const h = <P extends object>(component: JSXComponent<P>, props: P = {} as P): TemplateResult =>
  jsx(component as unknown as JSXComponent, props as Record<string, unknown>)

export const icon = (name: string) => ketIcon(name)

/** `page.move?id=home&to=1`: the command name plus string arguments, carried in a button value. */
export const commandValue = (name: string, args: CommandArgs = {}) => {
  const search = new URLSearchParams(args).toString()
  return search ? `${name}?${search}` : name
}

export const parseCommand = (value: string): { name: string; args: CommandArgs } => {
  const at = value.indexOf('?')
  if (at < 0) return { name: value, args: {} }
  return { name: value.slice(0, at), args: Object.fromEntries(new URLSearchParams(value.slice(at + 1))) }
}

export type CommandButtonProps = {
  label: string
  command: string
  args?: CommandArgs
  variant?: ActionVariant
  /** `compact` for a command inside a table row, so the row keeps its baseline height. */
  size?: ActionSize
  disabled?: boolean
  type?: 'button' | 'submit'
  form?: string | null
}

/**
 * A Design System button that runs a Studio command. The island delegates `button[name=command]`,
 * so a command never closes over render-time state. `type: 'submit'` sends its form with it.
 */
export const CommandButton = (p: CommandButtonProps) => (
  <Button
    label={p.label}
    variant={p.variant ?? 'secondary'}
    size={p.size ?? 'default'}
    disabled={p.disabled ?? false}
    type={p.type ?? 'button'}
    form={p.form ?? null}
    name="command"
    value={commandValue(p.command, p.args)}
  />
)

/** Join template results without coercing them to object strings. */
export const fragments = (items: readonly JSXChild[]): TemplateResult =>
  items.reduce<TemplateResult>(
    (result, item) => (
      <>
        {result}
        {item}
      </>
    ),
    <></>,
  )
