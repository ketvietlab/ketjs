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
  'form-required',
  'form-error',
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
  error?: string | null
  options?: readonly FormOption[]
  span?: 'full' | 'half'
  step?: string | null
}

const control = (field: FormField, id: string, describedBy: string | null): TemplateResult => {
  if (field.type === 'textarea')
    return (
      <textarea
        data-ui="form-control"
        id={id}
        name={field.name}
        placeholder={field.placeholder ?? null}
        required={field.required === true}
        disabled={field.disabled === true}
        aria-invalid={field.error ? 'true' : null}
        aria-describedby={describedBy}
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
        aria-invalid={field.error ? 'true' : null}
        aria-describedby={describedBy}
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
        aria-invalid={field.error ? 'true' : null}
        aria-describedby={describedBy}
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
      aria-invalid={field.error ? 'true' : null}
      aria-describedby={describedBy}
      step={field.type === 'decimal' ? (field.step ?? 'any') : (field.step ?? null)}
    />
  )
}

/** A native, server-rendered form. Domain modules provide data, never markup. */
type RecordFormOptions = {
  action: string
  fields: readonly FormField[]
  submit: string
  method?: 'get' | 'post'
  errors?: readonly string[]
  hidden?: Record<string, string>
} & (
  | { cancelHref: string; cancelLabel: string }
  | { cancelHref?: null | undefined; cancelLabel?: null | undefined }
)

export const recordForm = (o: RecordFormOptions): TemplateResult => (
  <form data-ui="record-form" method={o.method ?? 'post'} action={o.action}>
    {Object.entries(o.hidden ?? {}).map(([name, value]) => (
      <input type="hidden" name={name} value={value} />
    ))}
    {!!o.errors?.length && (
      <ul data-ui="form-errors" role="alert">
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
          const helpId = field.help ? `${id}-help` : null
          const errorId = field.error ? `${id}-error` : null
          const describedBy = [helpId, errorId].filter(Boolean).join(' ') || null
          const fieldLabel = (
            <span data-ui="form-label">
              {field.label}
              {field.required && (
                <span data-ui="form-required" aria-hidden="true">
                  {' *'}
                </span>
              )}
            </span>
          )
          return (
            <label
              data-ui="form-field"
              data-span={field.span ?? 'half'}
              data-kind={field.type ?? 'text'}
              data-invalid={String(!!field.error)}
              for={id}
            >
              {field.type === 'checkbox' && control(field, id, describedBy)}
              {fieldLabel}
              {field.type !== 'checkbox' && control(field, id, describedBy)}
              {!!field.help && (
                <small data-ui="form-help" id={helpId ?? undefined}>
                  {field.help}
                </small>
              )}
              {!!field.error && (
                <small data-ui="form-error" id={errorId ?? undefined}>
                  {field.error}
                </small>
              )}
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
            ? [linkButton({ label: o.cancelLabel, href: o.cancelHref, variant: 'tertiary' })]
            : []),
        ],
      })}
    </div>
  </form>
)

/** Several POST actions for one record, kept in one compact native form. */
export const recordActions = (o: {
  action: string
  label?: string | null
  actions: ReadonlyArray<{
    value: string
    label: string
    variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive'
    disabled?: boolean
  }>
}): TemplateResult => (
  <form data-ui="record-form" data-layout="actions" method="post" action={o.action}>
    {actionGroup({
      label: o.label,
      actions: o.actions.map((action) =>
        button({
          label: action.label,
          type: 'submit',
          name: 'action',
          value: action.value,
          variant: action.variant,
          disabled: action.disabled,
        }),
      ),
    })}
  </form>
)
