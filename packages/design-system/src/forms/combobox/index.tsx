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

const ComboControl = (props: ComboboxProps & { resolvedError: string | null }): TemplateResult => (
  <div data-ui="combobox" data-open={String(props.open)}>
    <div data-ui="combobox-input-row">
      <input
        data-ui="field-control"
        id={props.id}
        name={props.name}
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

export const Combobox = (props: ComboboxProps): TemplateResult => {
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

export type MultiComboboxProps = Omit<ComboboxProps, 'value'> & {
  values: readonly string[]
  removeHref: (value: string) => string
}

export const MultiCombobox = (props: MultiComboboxProps): TemplateResult => (
  <div data-ui="tag-picker">
    <Combobox {...props} value={null} />
    {each(
      props.values,
      (value) => value,
      (value) => (
        <a
          href={props.removeHref(value)}
          aria-label={`Remove ${props.options.find((option) => option.value === value)?.label ?? value}`}
        >
          {props.options.find((option) => option.value === value)?.label ?? value} ×
        </a>
      ),
    )}
  </div>
)

export const TagPicker = (props: MultiComboboxProps): TemplateResult => <MultiCombobox {...props} />
