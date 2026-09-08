import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Field } from '../../primitives/field/index.tsx'
import type { FieldOption, FieldProps } from '../../primitives/field/index.tsx'
import { describedBy, FieldFrame, issueFor } from '../shared.tsx'
import type { FieldIssue } from '../shared.tsx'

export const HOOKS = ['switch-control', 'switch-track'] as const

type CommonProps = Omit<FieldProps, 'type' | 'fields' | 'control' | 'error'> & {
  issues?: readonly FieldIssue[]
  error?: string | null
}

const normalize = (props: CommonProps): FieldProps => ({
  ...props,
  error: props.error ?? issueFor(props.issues, props.name),
})

export const TextField = (props: CommonProps): TemplateResult => <Field {...normalize(props)} type="text" />
export const TextArea = (props: CommonProps): TemplateResult => (
  <Field {...normalize(props)} type="textarea" />
)
export const NumberField = (props: CommonProps): TemplateResult => (
  <Field {...normalize(props)} type="number" />
)
export const MoneyField = (props: CommonProps): TemplateResult => (
  <Field {...normalize({ ...props, step: props.step ?? '0.01' })} type="decimal" />
)
export const SearchField = (props: CommonProps): TemplateResult => <Field {...normalize(props)} type="text" />
export const Checkbox = (props: CommonProps): TemplateResult => (
  <Field {...normalize(props)} type="checkbox" />
)
export const CheckboxGroup = (props: CommonProps): TemplateResult => (
  <Field {...normalize(props)} type="checkbox-group" />
)
export const RadioGroup = (props: CommonProps): TemplateResult => <Field {...normalize(props)} type="radio" />
export const Select = (props: CommonProps): TemplateResult => <Field {...normalize(props)} type="select" />

export type SwitchProps = Omit<CommonProps, 'options' | 'placeholder' | 'step' | 'min' | 'max'> & {
  checked?: boolean
  value?: string
}

export const Switch = (props: SwitchProps): TemplateResult => {
  const error = props.error ?? issueFor(props.issues, props.name)
  return (
    <FieldFrame
      id={props.id}
      label={props.label}
      help={props.help}
      error={error}
      required={props.required}
      span={props.span}
      kind="switch"
      control={
        <label data-ui="switch-control">
          <input
            id={props.id}
            type="checkbox"
            role="switch"
            name={props.name}
            value={props.value ?? '1'}
            checked={props.checked ?? props.value === '1'}
            disabled={props.disabled === true}
            required={props.required === true}
            aria-invalid={error ? 'true' : null}
            aria-describedby={describedBy(props.id, props.help, error)}
          />
          <span data-ui="switch-track" aria-hidden="true" />
        </label>
      }
    />
  )
}

export type { CommonProps as ScalarFieldProps, FieldIssue, FieldOption }
