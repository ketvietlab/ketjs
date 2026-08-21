import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { actionGroup, button, linkButton } from './actions.tsx'
import { icon } from './icons.ts'

export const HOOKS = [
  'date-picker',
  'date-picker-label',
  'date-picker-fields',
  'date-picker-field',
  'date-picker-field-label',
  'date-picker-required',
  'date-picker-control-wrap',
  'date-picker-icon',
  'date-picker-control',
  'date-picker-help',
  'date-picker-error',
  'date-picker-actions',
] as const

export type DatePickerField = {
  name: string
  label: string
  value?: string | null
  min?: string | null
  max?: string | null
  required?: boolean
  disabled?: boolean
  help?: string | null
  error?: string | null
}

export type DatePickerOptions = {
  action: string
  label: string
  fields: readonly [DatePickerField] | readonly [DatePickerField, DatePickerField]
  submit: string
  method?: 'get' | 'post'
  hidden?: Readonly<Record<string, string>>
} & (
  | { clearHref: string; clearLabel: string }
  | { clearHref?: null | undefined; clearLabel?: null | undefined }
)

/**
 * A compact, server-driven single date or date range picker.
 *
 * Native date controls preserve the browser's locale, keyboard and mobile picker.
 * The component owns the GET/POST form so a screen never needs private markup or
 * client state just to filter an operational calendar.
 */
export const datePicker = (options: DatePickerOptions): TemplateResult => (
  <form
    data-ui="date-picker"
    method={options.method ?? 'get'}
    action={options.action}
    data-range={String(options.fields.length === 2)}
  >
    {each(
      Object.entries(options.hidden ?? {}),
      ([name]) => name,
      ([name, value]) => (
        <input type="hidden" name={name} value={value} />
      ),
    )}
    <fieldset>
      <legend data-ui="date-picker-label">{options.label}</legend>
      <div data-ui="date-picker-fields">
        {each(
          options.fields,
          (field) => field.name,
          (field) => {
            const id = `date-picker-${options.action}-${field.name}`.replace(/[^a-zA-Z0-9_-]/g, '-')
            const helpId = field.help ? `${id}-help` : null
            const errorId = field.error ? `${id}-error` : null
            const describedBy = [helpId, errorId].filter(Boolean).join(' ') || null
            return (
              <label data-ui="date-picker-field" data-invalid={String(!!field.error)} for={id}>
                <span data-ui="date-picker-field-label">
                  {field.label}
                  {field.required && (
                    <span data-ui="date-picker-required" aria-hidden="true">
                      {' *'}
                    </span>
                  )}
                </span>
                <span data-ui="date-picker-control-wrap">
                  <span data-ui="date-picker-icon" aria-hidden="true">
                    {icon('calendar')}
                  </span>
                  <input
                    data-ui="date-picker-control"
                    id={id}
                    type="date"
                    name={field.name}
                    value={field.value ?? ''}
                    min={field.min ?? null}
                    max={field.max ?? null}
                    required={field.required === true}
                    disabled={field.disabled === true}
                    aria-invalid={field.error ? 'true' : null}
                    aria-describedby={describedBy}
                  />
                </span>
                {!!field.help && (
                  <small data-ui="date-picker-help" id={helpId ?? undefined}>
                    {field.help}
                  </small>
                )}
                {!!field.error && (
                  <small data-ui="date-picker-error" id={errorId ?? undefined}>
                    {field.error}
                  </small>
                )}
              </label>
            )
          },
        )}
      </div>
    </fieldset>
    <div data-ui="date-picker-actions">
      {actionGroup({
        actions: [
          button({ label: options.submit, type: 'submit', variant: 'secondary' }),
          ...(options.clearHref
            ? [linkButton({ label: options.clearLabel, href: options.clearHref, variant: 'tertiary' })]
            : []),
        ],
      })}
    </div>
  </form>
)
