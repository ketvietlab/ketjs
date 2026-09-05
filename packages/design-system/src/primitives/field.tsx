import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'field',
  'field-label',
  'field-required',
  'field-control',
  'field-options',
  'field-option',
  'field-help',
  'field-error',
] as const

export type FieldOption = { value: string; label: string }
export type FieldProps = {
  id: string
  name: string
  label: string
  type?:
    | 'text'
    | 'email'
    | 'tel'
    | 'number'
    | 'password'
    | 'date'
    | 'select'
    | 'textarea'
    | 'checkbox'
    | 'radio'
  value?: string | number | boolean | null
  placeholder?: string | null
  required?: boolean
  disabled?: boolean
  help?: string | null
  error?: string | null
  options?: readonly FieldOption[]
  span?: 'half' | 'full'
}

const Control = (props: FieldProps, describedBy: string | null): TemplateResult => {
  if (props.type === 'textarea')
    return (
      <textarea
        data-ui="field-control"
        id={props.id}
        name={props.name}
        placeholder={props.placeholder ?? null}
        required={props.required === true}
        disabled={props.disabled === true}
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
            <option value={option.value} selected={String(props.value ?? '') === option.value}>
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
      type={props.type ?? 'text'}
      name={props.name}
      value={props.type === 'checkbox' ? '1' : String(props.value ?? '')}
      checked={props.type === 'checkbox' && (props.value === true || props.value === '1')}
      placeholder={props.placeholder ?? null}
      required={props.required === true}
      disabled={props.disabled === true}
      aria-invalid={props.error ? 'true' : null}
      aria-describedby={describedBy}
      autocomplete="off"
    />
  )
}

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

  if (props.type === 'radio')
    return (
      <fieldset data-ui="field" data-kind="radio" data-span={props.span ?? 'half'}>
        <legend data-ui="field-label">{props.label}</legend>
        <div data-ui="field-options">
          {each(
            props.options ?? [],
            (option) => option.value,
            (option) => (
              <label data-ui="field-option">
                <input
                  type="radio"
                  name={props.name}
                  value={option.value}
                  checked={String(props.value ?? '') === option.value}
                  disabled={props.disabled === true}
                />
                <span>{option.label}</span>
              </label>
            ),
          )}
        </div>
      </fieldset>
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
