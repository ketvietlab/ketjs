// Record-modal form markup, owned by the kit.
//
// A record modal's views are module code; markup belongs to `ketsuite/ui`. These
// are the pieces a view needs beyond the design system's fields and buttons: the
// form the runtime submits (optionally naming its command), a select whose choice
// feeds view state before anything is submitted, and a trigger that opens a dialog
// of the same record.

import { ActionGroup, Field } from '@ketvietlab/design-system'
import type { FieldOption, FieldProps } from '@ketvietlab/design-system'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { RECORD_COMMAND_FIELD } from './record-modal.tsx'

/**
 * The form a record modal's runtime submits. A `command` becomes the hidden
 * `__command` field; without one, the submitting button names it.
 */
export const RecordModalForm = (props: {
  kind: string
  fields: readonly FieldProps[]
  actions?: readonly JSXChild[]
  command?: string | null
}): TemplateResult => (
  <form data-ui="record-form" method="post" action="" data-record-kind={props.kind}>
    {props.command ? (
      <input type="hidden" name={RECORD_COMMAND_FIELD} value={props.command} autocomplete="off" />
    ) : (
      ''
    )}
    <div data-ui="form-grid">{props.fields.map((item) => Field(item))}</div>
    {props.actions?.length ? <div data-ui="form-actions">{ActionGroup({ actions: props.actions })}</div> : ''}
  </form>
)

/**
 * The control of a select whose choice changes what the rest of the form offers.
 * Use it as a design-system field's `control`; `data-record-state` makes the
 * runtime re-render the view with the new choice.
 */
export const recordStateSelectControl = (props: {
  id: string
  name: string
  state: string
  value: string
  options: readonly FieldOption[]
  required?: boolean
  disabled?: boolean
  invalid?: boolean
}): TemplateResult => (
  <select
    data-ui="field-control"
    data-record-state={props.state}
    id={props.id}
    name={props.name}
    required={props.required === true}
    disabled={props.disabled === true}
    aria-invalid={props.invalid ? 'true' : null}
  >
    {props.options.map((option) => (
      <option value={option.value} selected={option.value === props.value}>
        {option.label}
      </option>
    ))}
  </select>
)

/**
 * Opens a dialog of the open record. `id` reaches the dialog as `params.id`;
 * without it the dialog opens for a new child (for example a new team member).
 */
export const RecordDialogTrigger = (props: {
  dialog: string
  id?: string | null
  children: JSXChild
}): TemplateResult => (
  <span data-record-dialog={props.dialog} data-record-param-id={props.id ?? null}>
    {props.children}
  </span>
)
