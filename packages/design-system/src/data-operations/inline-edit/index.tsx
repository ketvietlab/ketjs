import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Button, LinkButton } from '../../primitives/actions/index.tsx'

export const HOOKS = ['inline-edit', 'inline-edit-value', 'inline-edit-form', 'inline-edit-actions'] as const

export type InlineEditProps = {
  id: string
  label: string
  value: JSXChild
  editing: boolean
  editHref: string
  cancelHref: string
  action: string
  name: string
  inputValue: string
  version?: string
  error?: string | null
  saveLabel?: string
  cancelLabel?: string
}

export const InlineEdit = (props: InlineEditProps): TemplateResult => (
  <section data-ui="inline-edit" aria-labelledby={`${props.id}-label`}>
    <strong id={`${props.id}-label`}>{props.label}</strong>
    {!props.editing ? (
      <span data-ui="inline-edit-value">
        {props.value}
        <LinkButton href={props.editHref} label={`Edit ${props.label}`} size="compact" />
      </span>
    ) : (
      <form data-ui="inline-edit-form" action={props.action} method="post">
        {props.version && <input type="hidden" name="version" value={props.version} />}
        <input
          id={`${props.id}-input`}
          name={props.name}
          value={props.inputValue}
          aria-label={props.label}
          aria-invalid={props.error ? 'true' : null}
          aria-describedby={props.error ? `${props.id}-error` : null}
        />
        {props.error && <small id={`${props.id}-error`}>{props.error}</small>}
        <span data-ui="inline-edit-actions">
          <Button type="submit" label={props.saveLabel ?? 'Save'} size="compact" />
          <LinkButton href={props.cancelHref} label={props.cancelLabel ?? 'Cancel'} size="compact" />
        </span>
      </form>
    )}
  </section>
)
