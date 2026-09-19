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
  body?: JSXChild
  /** Structural edits and retained drafts remain dirty after a view-state render. */
  dirty?: boolean
  actions?: readonly JSXChild[]
  command?: string | null
  /** Lets a button outside this form submit it via the HTML `form` attribute. */
  id?: string
}): TemplateResult => (
  <form
    data-ui="record-form"
    method="post"
    action=""
    data-record-kind={props.kind}
    id={props.id}
    data-record-dirty={props.dirty === true ? 'true' : null}
  >
    {props.command ? (
      // autocomplete="off" like every other input the kit writes: the ui contract
      // holds for a hidden field too, and a browser restoring one would submit a
      // command the reader never chose.
      <input type="hidden" name={RECORD_COMMAND_FIELD} value={props.command} autocomplete="off" />
    ) : (
      ''
    )}
    <div data-ui="form-grid">{props.fields.map((item) => Field(item))}</div>
    {props.body}
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

/**
 * A bare form for an action that names no field of its own — generate, remove.
 * `data-layout="actions"` opts the form out of the record-form grid (built for a
 * field/label pair), which would otherwise stretch a lone submit button to fill it.
 */
export const RecordActionForm = (props: {
  kind: string
  command: string
  hidden?: Record<string, string>
  children: JSXChild
}): TemplateResult => (
  <form data-ui="record-form" data-layout="actions" method="post" action="" data-record-kind={props.kind}>
    <input type="hidden" name={RECORD_COMMAND_FIELD} value={props.command} autocomplete="off" />
    {Object.entries(props.hidden ?? {}).map(([name, value]) => (
      <input type="hidden" name={name} value={value} autocomplete="off" />
    ))}
    {props.children}
  </form>
)

/**
 * A form with no field or button of its own, submitted only through the HTML
 * `form` attribute on buttons placed elsewhere — a menu whose every item names
 * its own command on itself, so one empty form serves the whole menu.
 */
export const RecordCommandForm = (props: { kind: string; id: string }): TemplateResult => (
  <form id={props.id} data-record-kind={props.kind} method="post" action="" hidden />
)

/**
 * Marks its child as a labeled close control the runtime's own click handler
 * recognizes from anywhere in the record's body — distinct from
 * `data-ui="modal-close"`, the icon-only corner control's own styling hook.
 */
export const RecordCloseTrigger = (props: { children: JSXChild }): TemplateResult => (
  <span data-record-close="true">{props.children}</span>
)

/**
 * A record's main image beside the first rows of its form: the viewer (a
 * thumbnail opening the image set), and under it the controls that change it.
 *
 * The whole block is one dropzone form: dropping a photo on the thumbnail, or
 * picking one, submits `uploadCommand` straight away (`data-record-submit`). Remove
 * is a button of that same form naming its own command, so it never carries the
 * file input with it.
 */
export const RecordImageField = (props: {
  kind: string
  id: string
  /** The viewer island (`backend.lightbox`), or null when there is no image yet. */
  viewer: JSXChild | null
  uploadCommand?: string | null
  removeCommand?: string | null
  labels: { empty: string; upload: string; replace: string; remove: string; drop: string }
  busy?: boolean
}): TemplateResult => {
  const hasImage = props.viewer != null
  const editable = Boolean(props.uploadCommand)
  return (
    <form
      data-ui="record-image"
      id={props.id}
      method="post"
      action=""
      enctype="multipart/form-data"
      data-record-kind={props.kind}
      data-record-dropzone={editable ? 'true' : null}
      data-busy={props.busy ? 'true' : 'false'}
    >
      {editable ? (
        <input type="hidden" name={RECORD_COMMAND_FIELD} value={props.uploadCommand} autocomplete="off" />
      ) : (
        ''
      )}
      <div data-ui="record-image-frame" title={editable ? props.labels.drop : undefined}>
        {hasImage ? props.viewer : <span data-ui="record-image-empty">{props.labels.empty}</span>}
      </div>
      {editable || (hasImage && props.removeCommand) ? (
        <div data-ui="record-image-actions">
          {editable ? (
            <label data-ui="record-image-upload" data-variant="tertiary">
              <input
                type="file"
                autocomplete="off"
                name="file"
                accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
                data-record-submit="true"
                disabled={props.busy === true}
              />
              <span>{hasImage ? props.labels.replace : props.labels.upload}</span>
            </label>
          ) : (
            ''
          )}
          {hasImage && props.removeCommand ? (
            <button
              type="submit"
              data-ui="action"
              data-variant="tertiary"
              data-size="compact"
              name={RECORD_COMMAND_FIELD}
              value={props.removeCommand}
              formnovalidate
              disabled={props.busy === true}
            >
              {props.labels.remove}
            </button>
          ) : (
            ''
          )}
        </div>
      ) : (
        ''
      )}
    </form>
  )
}

/** A form with an independent image column; narrow surfaces stack the image above it. */
export const RecordFormWithImage = (props: { form: JSXChild; image: JSXChild }): TemplateResult => (
  <div data-ui="record-form-with-image">
    {props.form}
    {props.image}
  </div>
)
