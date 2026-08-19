import { each } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import { actionGroup, button, linkButton } from './actions.tsx'

export const HOOKS = [
  'record-form',
  'form-grid',
  'form-field',
  'form-label',
  'form-control',
  'form-help',
  'form-errors',
  'form-actions',
] as const

export type FormOption = { value: string; label: string }
export type FormField = {
  name: string
  label: string
  type?: 'text' | 'number' | 'decimal' | 'date' | 'datetime-local' | 'select' | 'checkbox' | 'textarea'
  value?: string | number | boolean | null
  placeholder?: string | null
  required?: boolean
  disabled?: boolean
  help?: string | null
  options?: readonly FormOption[]
  span?: 'full' | 'half'
  step?: string | null
}

const control = (field: FormField, id: string): TemplateResult => {
  if (field.type === 'textarea')
    return (
      <textarea
        data-ui="form-control"
        id={id}
        name={field.name}
        placeholder={field.placeholder ?? null}
        required={field.required === true}
        disabled={field.disabled === true}
      >
        {String(field.value ?? '')}
      </textarea>
    )
  if (field.type === 'select')
    return (
      <select
        data-ui="form-control"
        id={id}
        name={field.name}
        required={field.required === true}
        disabled={field.disabled === true}
      >
        {each(
          field.options ?? [],
          (option) => option.value,
          (option) => (
            <option value={option.value} selected={String(field.value ?? '') === option.value}>
              {option.label}
            </option>
          ),
        )}
      </select>
    )
  if (field.type === 'checkbox')
    return (
      <input
        data-ui="form-control"
        id={id}
        type="checkbox"
        name={field.name}
        value="1"
        checked={field.value === true || field.value === '1'}
        disabled={field.disabled === true}
      />
    )
  return (
    <input
      data-ui="form-control"
      id={id}
      type={field.type === 'decimal' ? 'number' : (field.type ?? 'text')}
      name={field.name}
      value={String(field.value ?? '')}
      placeholder={field.placeholder ?? null}
      required={field.required === true}
      disabled={field.disabled === true}
      step={field.type === 'decimal' ? (field.step ?? 'any') : (field.step ?? null)}
    />
  )
}

/** A native, server-rendered form. Domain modules provide data, never markup. */
export const recordForm = (o: {
  action: string
  fields: readonly FormField[]
  submit: string
  method?: 'get' | 'post'
  cancelHref?: string | null
  cancelLabel?: string | null
  errors?: readonly string[]
  hidden?: Record<string, string>
}): TemplateResult => (
  <form data-ui="record-form" method={o.method ?? 'post'} action={o.action}>
    {Object.entries(o.hidden ?? {}).map(([name, value]) => (
      <input type="hidden" name={name} value={value} />
    ))}
    {!!o.errors?.length && (
      <ul data-ui="form-errors">
        {each(
          o.errors,
          (error, index) => `${index}:${error}`,
          (error) => (
            <li>{error}</li>
          ),
        )}
      </ul>
    )}
    <div data-ui="form-grid">
      {each(
        o.fields,
        (field) => field.name,
        (field) => {
          const id = `field-${o.action}-${field.name}`.replace(/[^a-zA-Z0-9_-]/g, '-')
          return (
            <label data-ui="form-field" data-span={field.span ?? 'half'} for={id}>
              <span data-ui="form-label">{field.label}</span>
              {control(field, id)}
              {!!field.help && <small data-ui="form-help">{field.help}</small>}
            </label>
          )
        },
      )}
    </div>
    <div data-ui="form-actions">
      {actionGroup({
        actions: [
          button({ label: o.submit, type: 'submit', variant: 'primary' }),
          ...(o.cancelHref
            ? [linkButton({ label: o.cancelLabel ?? 'Cancel', href: o.cancelHref, variant: 'tertiary' })]
            : []),
        ],
      })}
    </div>
  </form>
)
