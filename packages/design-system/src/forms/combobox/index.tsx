import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { describedBy, FieldFrame, issueFor } from '../shared.tsx'
import type { FieldIssue } from '../shared.tsx'

export const HOOKS = [
  'combobox',
  'combobox-input-row',
  'combobox-toggle',
  'combobox-listbox',
  'combobox-option',
  'combobox-empty',
  'tag-picker',
] as const

export type ComboboxOption = { value: string; label: string; description?: string; disabled?: boolean }
export type ComboboxProps = {
  id: string
  name: string
  /** Name used for the human-readable search text; defaults to `${name}Query`. */
  queryName?: string
  label: string
  query: string
  value?: string | null
  options: readonly ComboboxOption[]
  open: boolean
  openHref: string
  closeHref: string
  help?: string | null
  error?: string | null
  issues?: readonly FieldIssue[]
  required?: boolean
  disabled?: boolean
  loading?: boolean
  loadingLabel?: string
  noResultsLabel?: string
  span?: 'half' | 'full'
}

const ComboControl = (
  props: ComboboxProps & { resolvedError: string | null; submitValue: boolean },
): TemplateResult => (
  <div data-ui="combobox" data-open={String(props.open)}>
    {props.submitValue && (
      <input type="hidden" name={props.name} value={props.value ?? ''} disabled={props.disabled === true} />
    )}
    <div data-ui="combobox-input-row">
      <input
        data-ui="field-control"
        id={props.id}
        name={props.queryName ?? `${props.name}Query`}
        value={props.query}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={String(props.open)}
        aria-controls={`${props.id}-listbox`}
        aria-invalid={props.resolvedError ? 'true' : null}
        aria-describedby={describedBy(props.id, props.help, props.resolvedError)}
        required={props.required === true}
        disabled={props.disabled === true}
        autocomplete="off"
      />
      <a
        data-ui="combobox-toggle"
        href={props.open ? props.closeHref : props.openHref}
        aria-label={props.open ? 'Close options' : 'Open options'}
      >
        ▾
      </a>
    </div>
    {props.open && (
      <div data-ui="combobox-listbox" id={`${props.id}-listbox`} role="listbox">
        {props.loading ? (
          <p data-ui="combobox-empty">{props.loadingLabel ?? 'Loading…'}</p>
        ) : props.options.length === 0 ? (
          <p data-ui="combobox-empty">{props.noResultsLabel ?? 'No results'}</p>
        ) : (
          each(
            props.options,
            (option) => option.value,
            (option) => (
              <a
                data-ui="combobox-option"
                href={
                  option.disabled
                    ? null
                    : `${props.closeHref}${props.closeHref.includes('?') ? '&' : '?'}${encodeURIComponent(props.name)}=${encodeURIComponent(option.value)}`
                }
                role="option"
                aria-selected={String(option.value === props.value)}
                aria-disabled={option.disabled ? 'true' : null}
              >
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </a>
            ),
          )
        )}
      </div>
    )}
  </div>
)

const ComboboxField = (props: ComboboxProps & { submitValue: boolean }): TemplateResult => {
  const error = props.error ?? issueFor(props.issues, props.name)
  return (
    <FieldFrame
      {...props}
      kind="combobox"
      error={error}
      control={<ComboControl {...props} resolvedError={error} />}
    />
  )
}

export const Combobox = (props: ComboboxProps): TemplateResult => <ComboboxField {...props} submitValue />

export type MultiComboboxProps = Omit<ComboboxProps, 'value'> & {
  values: readonly string[]
  removeHref: (value: string) => string
}

export const MultiCombobox = (props: MultiComboboxProps): TemplateResult => (
  <div data-ui="tag-picker">
    <ComboboxField {...props} value={null} submitValue={false} />
    {each(
      props.values,
      (value) => value,
      (value) => (
        <>
          <input type="hidden" name={props.name} value={value} disabled={props.disabled === true} />
          <a
            href={props.removeHref(value)}
            aria-label={`Remove ${props.options.find((option) => option.value === value)?.label ?? value}`}
          >
            {props.options.find((option) => option.value === value)?.label ?? value} ×
          </a>
        </>
      ),
    )}
  </div>
)

export const TagPicker = (props: MultiComboboxProps): TemplateResult => <MultiCombobox {...props} />
