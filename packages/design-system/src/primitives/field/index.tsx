import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Disclosure } from '../../layouts/index.tsx'
import { FieldFrame, FieldMessages, describedBy } from './frame.tsx'
import { ChoiceControls } from './choices.tsx'
import { NativeFieldControl } from './native-control.tsx'

export const HOOKS = [
  'field',
  'field-label',
  'field-required',
  'field-control',
  'field-input',
  'field-affix',
  'field-clear',
  'field-options',
  'field-option',
  'field-option-input',
  'field-help',
  'field-error',
] as const

export type FieldOption = {
  value: string
  label: string
  name?: string
  checked?: boolean
  disabled?: boolean
}
export type FieldProps = {
  /** Nested fields for a collapsible group inside a larger record form. */
  fields?: readonly FieldProps[]
  open?: boolean

  id: string
  name: string
  label: string
  /** A trusted, progressively enhanced control such as a relation selector. */
  control?: JSXChild
  type?:
    | 'text'
    | 'search'
    | 'url'
    | 'email'
    | 'tel'
    | 'number'
    | 'decimal'
    | 'password'
    | 'time'
    | 'color'
    | 'date'
    | 'datetime-local'
    | 'month'
    | 'week'
    | 'select'
    | 'textarea'
    | 'checkbox'
    | 'checkbox-group'
    | 'radio'
  value?: string | number | boolean | null
  checked?: boolean | 'indeterminate'
  /** Legacy checkbox value used checked state; submitValue opts into separate form data. */
  submitValue?: string
  prefix?: JSXChild
  suffix?: JSXChild
  clearable?: boolean
  clearLabel?: string
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url'
  align?: 'start' | 'center' | 'end'
  rows?: number
  resize?: 'vertical' | 'none'
  maxLength?: number
  minLength?: number
  pattern?: string
  /** Embedded controls share the frame of a compound field. */
  labelHidden?: boolean
  /** Keep the selected value accessible while showing only the select chevron. */
  selectionHidden?: boolean
  appearance?: 'default' | 'embedded'
  placeholder?: string | null
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
  min?: string | number
  max?: string | number
  help?: string | null
  error?: string | null
  options?: readonly FieldOption[]
  /**
   * How checkbox-group and radio options flow. `horizontal` (default) wraps them on a line; `vertical` lists
   * one option per line under the shared label, for choices whose labels should scan as a column.
   */
  optionsOrientation?: 'horizontal' | 'vertical'
  span?: 'half' | 'full'
  step?: string | null
  autocomplete?: string | null
}

const hasError = (props: FieldProps): boolean => !!props.error || (props.fields?.some(hasError) ?? false)

/** Compatibility dispatcher: all controls share FieldFrame and their own control contract. */
export const Field = (props: FieldProps): TemplateResult => {
  if (props.fields)
    return (
      <div data-ui="field" data-kind="group" data-span="full" data-invalid={String(!!props.error)}>
        <Disclosure
          summary={props.label}
          open={props.open || hasError(props)}
          body={
            <div data-ui="form-grid">
              {each(
                props.fields.map((field) => ({
                  ...field,
                  disabled: props.disabled || field.disabled,
                  readOnly: props.readOnly || field.readOnly,
                })),
                (field) => field.id,
                (field) => (
                  <Field {...field} />
                ),
              )}
            </div>
          }
        />
        <FieldMessages {...props} />
      </div>
    )
  const group = props.type === 'radio' || props.type === 'checkbox-group'
  return (
    <FieldFrame
      {...props}
      kind={props.type ?? 'text'}
      group={group}
      control={
        group ? (
          <ChoiceControls {...props} />
        ) : (
          NativeFieldControl(props, describedBy(props.id, props.help, props.error))
        )
      }
    />
  )
}
