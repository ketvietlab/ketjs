import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Disclosure } from '../../layouts/index.tsx'

export const HOOKS = [
  'field',
  'field-label',
  'field-required',
  'field-control',
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
  placeholder?: string | null
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
  min?: string | number
  max?: string | number
  help?: string | null
  error?: string | null
  options?: readonly FieldOption[]
  span?: 'half' | 'full'
  step?: string | null
  autocomplete?: string | null
}

const Control = (props: FieldProps, describedBy: string | null): TemplateResult => {
  if (props.control !== undefined) return <>{props.control}</>
  if (props.type === 'textarea')
    return (
      <textarea
        data-ui="field-control"
        id={props.id}
        name={props.name}
        placeholder={props.placeholder ?? null}
        required={props.required === true}
        disabled={props.disabled === true}
        readonly={props.readOnly === true}
        aria-invalid={props.error ? 'true' : null}
        aria-describedby={describedBy}
      >
        {String(props.value ?? '')}
      </textarea>
    )
  if (props.type === 'select')
    return (
      <select
        data-ui="field-control"
        id={props.id}
        name={props.name}
        required={props.required === true}
        disabled={props.disabled === true}
        aria-invalid={props.error ? 'true' : null}
        aria-describedby={describedBy}
      >
        {each(
          props.options ?? [],
          (option) => option.value,
          (option) => (
            <option
              value={option.value}
              selected={String(props.value ?? '') === option.value}
              disabled={option.disabled === true}
            >
              {option.label}
            </option>
          ),
        )}
      </select>
    )
  return (
    <input
      data-ui="field-control"
      id={props.id}
      type={props.type === 'decimal' ? 'number' : (props.type ?? 'text')}
      name={props.name}
      value={props.type === 'checkbox' ? '1' : String(props.value ?? '')}
      checked={props.type === 'checkbox' && (props.value === true || props.value === '1')}
      placeholder={props.placeholder ?? null}
      required={props.required === true}
      disabled={props.disabled === true}
      readonly={props.readOnly === true}
      min={props.min}
      max={props.max}
      aria-invalid={props.error ? 'true' : null}
      aria-describedby={describedBy}
      autocomplete={props.autocomplete ?? 'off'}
      step={props.type === 'decimal' ? (props.step ?? 'any') : (props.step ?? null)}
    />
  )
}

const hasError = (props: FieldProps): boolean => !!props.error || (props.fields?.some(hasError) ?? false)

export const Field = (props: FieldProps): TemplateResult => {
  const helpId = props.help ? `${props.id}-help` : null
  const errorId = props.error ? `${props.id}-error` : null
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || null
  const label = (
    <span data-ui="field-label">
      {props.label}
      {props.required && (
        <span data-ui="field-required" aria-hidden="true">
          {' *'}
        </span>
      )}
    </span>
  )

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
        {!!props.help && (
          <small data-ui="field-help" id={helpId ?? undefined}>
            {props.help}
          </small>
        )}
        {!!props.error && (
          <small data-ui="field-error" id={errorId ?? undefined}>
            {props.error}
          </small>
        )}
      </div>
    )

  if (props.type === 'checkbox-group')
    return (
      <div
        data-ui="field"
        data-kind="checkbox-group"
        data-span={props.span ?? 'half'}
        data-invalid={String(!!props.error)}
      >
        <span data-ui="field-label" id={`${props.id}-label`}>
          {props.label}
          {props.required && (
            <span data-ui="field-required" aria-hidden="true">
              {' *'}
            </span>
          )}
        </span>
        <div data-ui="field-options" role="group" aria-labelledby={`${props.id}-label`}>
          {each(
            props.options ?? [],
            (option) => option.name ?? option.value,
            (option) => (
              <label data-ui="field-option">
                <input
                  data-ui="field-option-input"
                  type="checkbox"
                  name={option.name ?? `${props.name}[]`}
                  value={option.value}
                  checked={option.checked === true}
                  disabled={props.disabled === true || option.disabled === true}
                  aria-invalid={props.error ? 'true' : null}
                  aria-describedby={describedBy}
                  autocomplete="off"
                />
                <span>{option.label}</span>
              </label>
            ),
          )}
        </div>
        {!!props.help && (
          <small data-ui="field-help" id={helpId ?? undefined}>
            {props.help}
          </small>
        )}
        {!!props.error && (
          <small data-ui="field-error" id={errorId ?? undefined}>
            {props.error}
          </small>
        )}
      </div>
    )

  if (props.type === 'radio')
    return (
      <div
        data-ui="field"
        data-kind="radio"
        data-span={props.span ?? 'half'}
        data-invalid={String(!!props.error)}
      >
        <span data-ui="field-label" id={`${props.id}-label`}>
          {props.label}
          {props.required && (
            <span data-ui="field-required" aria-hidden="true">
              {' *'}
            </span>
          )}
        </span>
        <div data-ui="field-options" role="radiogroup" aria-labelledby={`${props.id}-label`}>
          {each(
            props.options ?? [],
            (option) => option.value,
            (option) => (
              <label data-ui="field-option">
                <input
                  data-ui="field-option-input"
                  type="radio"
                  name={props.name}
                  value={option.value}
                  checked={String(props.value ?? '') === option.value}
                  required={props.required === true}
                  disabled={props.disabled === true || option.disabled === true}
                  aria-invalid={props.error ? 'true' : null}
                  aria-describedby={describedBy}
                  autocomplete="off"
                />
                <span>{option.label}</span>
              </label>
            ),
          )}
        </div>
        {!!props.help && (
          <small data-ui="field-help" id={helpId ?? undefined}>
            {props.help}
          </small>
        )}
        {!!props.error && (
          <small data-ui="field-error" id={errorId ?? undefined}>
            {props.error}
          </small>
        )}
      </div>
    )

  return (
    <label
      data-ui="field"
      data-kind={props.type ?? 'text'}
      data-span={props.span ?? 'half'}
      data-invalid={String(!!props.error)}
      for={props.id}
    >
      {props.type === 'checkbox' && Control(props, describedBy)}
      {label}
      {props.type !== 'checkbox' && Control(props, describedBy)}
      {!!props.help && (
        <small data-ui="field-help" id={helpId ?? undefined}>
          {props.help}
        </small>
      )}
      {!!props.error && (
        <small data-ui="field-error" id={errorId ?? undefined}>
          {props.error}
        </small>
      )}
    </label>
  )
}
