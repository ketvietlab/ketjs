import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Field } from '../../primitives/field/index.tsx'
import type { FieldProps } from '../../primitives/field/index.tsx'
import { issueFor } from '../shared.tsx'
import type { FieldIssue } from '../shared.tsx'

export const HOOKS = ['date-range'] as const

type TemporalProps = Omit<FieldProps, 'type' | 'fields' | 'control' | 'error'> & {
  issues?: readonly FieldIssue[]
  error?: string | null
}

const temporal = (props: TemporalProps): FieldProps => ({
  ...props,
  error: props.error ?? issueFor(props.issues, props.name),
})

/** Civil dates are passed through as YYYY-MM-DD text and are never converted through UTC. */
export const DatePicker = (props: TemporalProps): TemplateResult => <Field {...temporal(props)} type="date" />

export type DateRangePickerProps = {
  id: string
  label: string
  start: Omit<TemporalProps, 'label' | 'span'>
  end: Omit<TemporalProps, 'label' | 'span'>
  startLabel: string
  endLabel: string
  span?: 'half' | 'full'
}

export const DateRangePicker = (props: DateRangePickerProps): TemplateResult => (
  <fieldset data-ui="date-range" data-span={props.span ?? 'full'}>
    <legend>{props.label}</legend>
    <Field {...temporal({ ...props.start, label: props.startLabel })} type="date" />
    <Field {...temporal({ ...props.end, label: props.endLabel })} type="date" />
  </fieldset>
)

/** Local date-time text is submitted unchanged; the app adapter owns timezone interpretation. */
export const DateTimePicker = (props: TemporalProps): TemplateResult => (
  <Field {...temporal(props)} type="datetime-local" />
)

export const TimePicker = (props: TemporalProps): TemplateResult => <Field {...temporal(props)} type="time" />

export type { TemporalProps }
