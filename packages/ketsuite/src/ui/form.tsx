import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { actionGroup, button, linkButton } from './actions.tsx'
import type { ActionSize, ActionVariant } from './actions.tsx'

export const HOOKS = [
  'record-form',
  'form-grid',
  'form-field',
  'form-label',
  'form-control',
  'form-options',
  'form-option',
  'form-option-input',
  'form-help',
  'form-required',
  'form-error',
  'form-errors',
  'form-actions',
  'form-cluster',
] as const

export type FormOption = {
  value: string
  label: string
  /** Checkbox groups may submit independent boolean fields from one visual control. */
  name?: string
  checked?: boolean
}
export type FormField = {
  name: string
  label: string
  /** A trusted control such as a progressively enhanced relational selector. */
  control?: JSXChild
  type?:
    | 'text'
    | 'email'
    | 'tel'
    | 'password'
    | 'number'
    | 'decimal'
    | 'time'
    | 'color'
    | 'date'
    | 'datetime-local'
    | 'month'
    | 'week'
    | 'select'
    | 'radio'
    | 'checkbox'
    | 'checkbox-group'
    | 'textarea'
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
  if (field.control !== undefined) return <>{field.control}</>
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
        autocomplete="off"
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
      autocomplete="off"
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
export type RecordFormOptions = {
  /** Optional DOM id lets controls in a dense record header belong to this form. */
  id?: string | null
  action: string
  fields: readonly FormField[]
  submit: string
  /** Every submit declares its business hierarchy; there is no accidental primary. */
  submitVariant: ActionVariant
  submitSize?: ActionSize
  /** Keep the form submit in a record-level action bar instead of duplicating it here. */
  submitPlacement?: 'inside' | 'external'
  layout?: 'default' | 'inline'
  method?: 'get' | 'post'
  /** Optional behavior scope for a progressively enhanced form. */
  scope?: string | null
  errors?: readonly string[]
  hidden?: Record<string, string>
} & (
  | { cancelHref: string; cancelLabel: string }
  | { cancelHref?: null | undefined; cancelLabel?: null | undefined }
)

export const recordForm = (o: RecordFormOptions): TemplateResult => (
  <form
    id={o.id ?? undefined}
    data-ui="record-form"
    data-layout={o.layout ?? 'default'}
    data-has-fields={String(o.fields.length > 0)}
    data-submit-variant={o.submitVariant}
    data-scope={o.scope ?? null}
    method={o.method ?? 'post'}
    action={o.action}
  >
    {Object.entries(o.hidden ?? {}).map(([name, value]) => (
      <input type="hidden" name={name} value={value} autocomplete="off" />
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
          const scope = [o.action, o.hidden?.id, o.hidden?.action, field.name].filter(Boolean).join('-')
          const id = `field-${scope}`.replace(/[^a-zA-Z0-9_-]/g, '-')
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
          if (field.type === 'checkbox-group')
            return (
              <div
                data-ui="form-field"
                data-span={field.span ?? 'half'}
                data-kind="checkbox-group"
                data-invalid={String(!!field.error)}
              >
                <span data-ui="form-label" id={`${id}-label`}>
                  {field.label}
                  {field.required && (
                    <span data-ui="form-required" aria-hidden="true">
                      {' *'}
                    </span>
                  )}
                </span>
                <div data-ui="form-options" role="group" aria-labelledby={`${id}-label`}>
                  {each(
                    field.options ?? [],
                    (option) => option.name ?? option.value,
                    (option) => (
                      <label data-ui="form-option">
                        <input
                          data-ui="form-option-input"
                          type="checkbox"
                          name={option.name ?? `${field.name}[]`}
                          autocomplete="off"
                          value={option.value}
                          checked={option.checked === true}
                          disabled={field.disabled === true}
                          aria-invalid={field.error ? 'true' : null}
                          aria-describedby={describedBy}
                        />
                        <span>{option.label}</span>
                      </label>
                    ),
                  )}
                </div>
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
              </div>
            )
          if (field.type === 'radio')
            return (
              <div
                data-ui="form-field"
                data-span={field.span ?? 'half'}
                data-kind="radio"
                data-invalid={String(!!field.error)}
              >
                <span data-ui="form-label" id={`${id}-label`}>
                  {field.label}
                  {field.required && (
                    <span data-ui="form-required" aria-hidden="true">
                      {' *'}
                    </span>
                  )}
                </span>
                <div data-ui="form-options" role="radiogroup" aria-labelledby={`${id}-label`}>
                  {each(
                    field.options ?? [],
                    (option) => option.value,
                    (option) => (
                      <label data-ui="form-option">
                        <input
                          data-ui="form-option-input"
                          type="radio"
                          name={field.name}
                          autocomplete="off"
                          value={option.value}
                          checked={String(field.value ?? '') === option.value}
                          required={field.required === true}
                          disabled={field.disabled === true}
                          aria-invalid={field.error ? 'true' : null}
                          aria-describedby={describedBy}
                        />
                        <span>{option.label}</span>
                      </label>
                    ),
                  )}
                </div>
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
              </div>
            )
          if (field.control !== undefined)
            return (
              <div
                data-ui="form-field"
                data-span={field.span ?? 'half'}
                data-kind="relation"
                data-invalid={String(!!field.error)}
              >
                {fieldLabel}
                {field.control}
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
              </div>
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
    {o.submitPlacement !== 'external' && (
      <div data-ui="form-actions">
        {actionGroup({
          actions: [
            button({
              label: o.submit,
              type: 'submit',
              variant: o.submitVariant,
              size: o.submitSize,
            }),
            ...(o.cancelHref
              ? [linkButton({ label: o.cancelLabel, href: o.cancelHref, variant: 'tertiary' })]
              : []),
          ],
        })}
      </div>
    )}
  </form>
)

/** Valid block-level grouping for related forms and their external controls. */
export const formCluster = (o: { forms: readonly JSXChild[]; label?: string | null }): TemplateResult => (
  <div data-ui="form-cluster" role="group" aria-label={o.label ?? null}>
    {each(
      o.forms,
      (_, index) => index,
      (form) => (
        <>{form}</>
      ),
    )}
  </div>
)

/** Several POST actions for one record, kept in one compact native form. */
export const recordActions = (o: {
  action: string
  label?: string | null
  hidden?: Record<string, string>
  actions: ReadonlyArray<{
    value: string
    label: string
    variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive'
    disabled?: boolean
  }>
}): TemplateResult => {
  const primaryCount = o.actions.filter((action) => action.variant === 'primary').length
  if (primaryCount > 1)
    throw new Error(
      `recordActions(${o.action}) declares ${primaryCount} primary actions; keep one decision per group`,
    )

  return (
    <form data-ui="record-form" data-layout="actions" method="post" action={o.action}>
      {Object.entries(o.hidden ?? {}).map(([name, value]) => (
        <input type="hidden" name={name} value={value} autocomplete="off" />
      ))}
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
}
