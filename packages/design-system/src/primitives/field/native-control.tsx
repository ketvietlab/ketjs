import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { FieldProps } from './index.tsx'

export const NativeFieldControl = (props: FieldProps, describedBy: string | null): TemplateResult => {
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
