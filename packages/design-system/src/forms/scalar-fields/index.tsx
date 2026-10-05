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

/** Shared field metadata. Each scalar exposes only the options it implements. */
export type ScalarFieldBase = Pick<
  CommonProps,
  | 'id'
  | 'name'
  | 'label'
  | 'size'
  | 'labelHidden'
  | 'help'
  | 'error'
  | 'issues'
  | 'required'
  | 'disabled'
  | 'span'
>
export type TextFieldProps = ScalarFieldBase &
  Pick<
    CommonProps,
    | 'value'
    | 'placeholder'
    | 'readOnly'
    | 'autocomplete'
    | 'appearance'
    | 'prefix'
    | 'suffix'
    | 'inputMode'
    | 'align'
    | 'maxLength'
    | 'minLength'
    | 'pattern'
  > & { type?: 'text' | 'email' | 'tel' | 'password' | 'url' }
export type TextAreaProps = ScalarFieldBase &
  Pick<
    CommonProps,
    'value' | 'placeholder' | 'readOnly' | 'appearance' | 'rows' | 'resize' | 'maxLength' | 'minLength'
  >
export type NumberFieldProps = ScalarFieldBase &
  Pick<
    CommonProps,
    | 'value'
    | 'placeholder'
    | 'readOnly'
    | 'appearance'
    | 'min'
    | 'max'
    | 'step'
    | 'prefix'
    | 'suffix'
    | 'align'
  >
export type MoneyFieldProps = NumberFieldProps & { currency?: string; precision?: number }
export type SearchFieldProps = Omit<TextFieldProps, 'type'> & { clearable?: boolean; clearLabel?: string }
export type CheckboxProps = ScalarFieldBase & {
  checked?: boolean | 'indeterminate'
  value?: string | boolean
  submitValue?: string
}
export type ChoiceGroupProps = ScalarFieldBase & Pick<CommonProps, 'options' | 'optionsOrientation' | 'value'>
export type SelectProps = ScalarFieldBase &
  Pick<CommonProps, 'value' | 'options' | 'placeholder' | 'selectionHidden' | 'appearance'>
export type SwitchProps = ScalarFieldBase & { checked?: boolean; value?: string }

const normalize = (props: CommonProps): FieldProps => ({
  ...props,
  error: props.error ?? issueFor(props.issues, props.name),
})

export const TextField = (props: TextFieldProps): TemplateResult => (
  <Field {...normalize(props)} type={props.type ?? 'text'} />
)
export const TextArea = (props: TextAreaProps): TemplateResult => (
  <Field {...normalize(props)} type="textarea" />
)
export const NumberField = (props: NumberFieldProps): TemplateResult => (
  <Field {...normalize(props)} type="number" inputMode="decimal" />
)
export const MoneyField = (props: MoneyFieldProps): TemplateResult => {
  const precision = Math.max(
    0,
    Math.min(6, Math.trunc(Number.isFinite(props.precision) ? (props.precision ?? 2) : 2)),
  )
  return (
    <Field
      {...normalize({ ...props, step: props.step ?? String(10 ** -precision) })}
      type="decimal"
      inputMode="decimal"
      align={props.align ?? 'end'}
      suffix={props.suffix ?? props.currency}
    />
  )
}
export const SearchField = (props: SearchFieldProps): TemplateResult => (
  <Field {...normalize(props)} type="search" inputMode="search" />
)
export const Checkbox = (props: CheckboxProps): TemplateResult => (
  <Field
    {...normalize(props)}
    type="checkbox"
    submitValue={
      props.submitValue ??
      (props.checked !== undefined && typeof props.value === 'string' ? props.value : undefined)
    }
  />
)
export const CheckboxGroup = (props: ChoiceGroupProps): TemplateResult => (
  <Field {...normalize(props)} type="checkbox-group" />
)
export const RadioGroup = (props: ChoiceGroupProps): TemplateResult => (
  <Field {...normalize(props)} type="radio" />
)
export const Select = (props: SelectProps): TemplateResult => <Field {...normalize(props)} type="select" />

export const Switch = (props: SwitchProps): TemplateResult => {
  const error = props.error ?? issueFor(props.issues, props.name)
  const checked = props.checked ?? props.value === '1'
  return (
    <FieldFrame
      id={props.id}
      label={props.label}
      help={props.help}
      error={error}
      required={props.required}
      labelHidden={props.labelHidden}
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
            checked={checked}
            aria-checked={String(checked)}
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
