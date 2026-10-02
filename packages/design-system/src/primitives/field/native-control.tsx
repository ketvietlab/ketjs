import { Icon } from '../icon/index.tsx'
import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { FieldProps } from './index.tsx'

const NativeInput = (props: FieldProps, describedBy: string | null): TemplateResult => {
  if (props.control !== undefined) return <>{props.control}</>
  if (props.type === 'textarea')
    return (
      <textarea
        data-ui="field-control"
        data-appearance={props.appearance === 'embedded' ? 'embedded' : null}
        id={props.id}
        name={props.name}
        rows={props.rows}
        data-resize={props.resize ?? null}
        maxlength={props.maxLength}
        minlength={props.minLength}
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
        data-appearance={props.appearance === 'embedded' ? 'embedded' : null}
        id={props.id}
        name={props.name}
        required={props.required === true}
        disabled={props.disabled === true}
        aria-invalid={props.error ? 'true' : null}
        aria-describedby={describedBy}
      >
        {props.placeholder && (
          <option
            value=""
            disabled={props.required === true}
            selected={props.value == null || props.value === ''}
          >
            {props.placeholder}
          </option>
        )}
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
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is emitted only for the checkbox branch.
    <input
      data-ui="field-control"
      data-appearance={props.appearance === 'embedded' ? 'embedded' : null}
      id={props.id}
      type={props.type === 'decimal' ? 'number' : (props.type ?? 'text')}
      name={props.name}
      value={props.type === 'checkbox' ? (props.submitValue ?? '1') : String(props.value ?? '')}
      checked={
        props.type === 'checkbox' &&
        (props.checked === undefined ? props.value === true || props.value === '1' : props.checked === true)
      }
      data-indeterminate={props.type === 'checkbox' && props.checked === 'indeterminate' ? 'true' : null}
      aria-checked={props.type === 'checkbox' && props.checked === 'indeterminate' ? 'mixed' : null}
      inputmode={props.inputMode ?? null}
      data-align={props.align ?? null}
      maxlength={props.maxLength}
      minlength={props.minLength}
      pattern={props.pattern ?? null}
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

export const NativeFieldControl = (props: FieldProps, description: string | null): TemplateResult => {
  if (props.control !== undefined) return <>{props.control}</>
  const input = NativeInput(props, description)
  if (
    props.type === 'select' ||
    props.type === 'checkbox' ||
    props.type === 'textarea' ||
    (!props.prefix && !props.suffix && !props.clearable)
  )
    return input
  return (
    <span
      data-ui="field-input"
      data-disabled={props.disabled ? 'true' : null}
      data-invalid={props.error ? 'true' : null}
    >
      {props.prefix && <span data-ui="field-affix">{props.prefix}</span>}
      {input}
      {props.suffix && <span data-ui="field-affix">{props.suffix}</span>}
      {props.clearable && (
        <button
          data-ui="field-clear"
          type="button"
          aria-controls={props.id}
          aria-label={props.clearLabel ?? `Clear ${props.label}`}
          disabled={props.disabled === true || props.readOnly === true}
        >
          <Icon name="x" size="small" />
        </button>
      )}
    </span>
  )
}
