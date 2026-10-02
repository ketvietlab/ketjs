import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { ActionGroup, Button, IconButton } from '../../primitives/actions/index.tsx'
import { Field } from '../../primitives/field/index.tsx'
import type { FieldProps } from '../../primitives/field/index.tsx'
import { describedBy, FieldFrame, issueFor } from '../shared.tsx'
import { NativeFieldControl } from '../../primitives/field/native-control.tsx'
import type { FieldIssue } from '../shared.tsx'
import { formatRange } from './date-math.js'

export const HOOKS = [
  'date-picker',
  'date-range',
  'date-inputs',
  'date-control-row',
  'date-tools',
  'date-range-error',
  'date-calendar',
  'date-calendar-head',
  'date-calendar-title',
  'date-calendar-body',
  'date-field-control',
  'date-range-preset',
  'date-boundary',
  'date-calendar-months',
  'date-month',
  'date-month-title',
  'date-grid',
  'date-weekday',
  'date-cell',
  'date-day',
  'date-calendar-footer',
  'date-calendar-status',
] as const

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'thisMonth'
  | 'lastMonth'
  | 'last30'
  | 'last90'
export type DatePickerLabels = {
  open: string
  title: string
  previous: string
  next: string
  apply: string
  cancel: string
  chooseStart: string
  chooseEnd: string
  chooseDate: string
  invalidRange: string
  presets: string
  customRange: string
  invalidSelection: string
  presetLabels: Record<DateRangePreset, string>
}
type CalendarOptions = {
  /** Native inputs retain the browser's date format. Calendar labels default to Vietnamese. */
  locale?: 'vi' | 'en'
  /** Business-timezone civil date; omit for the browser's local today at opening. */
  today?: string
  weekStartsOn?: 0 | 1
  calendarLabels?: Partial<Omit<DatePickerLabels, 'presetLabels'>> & {
    presetLabels?: Partial<DatePickerLabels['presetLabels']>
  }
}
export type TemporalProps = Omit<FieldProps, 'type' | 'fields' | 'control' | 'error'> & {
  issues?: readonly FieldIssue[]
  error?: string | null
}
export type DatePickerProps = TemporalProps & CalendarOptions
export type DateRangePickerProps = CalendarOptions & {
  id: string
  label: string
  start: Omit<TemporalProps, 'label' | 'span'>
  end: Omit<TemporalProps, 'label' | 'span'>
  startLabel: string
  endLabel: string
  span?: 'half' | 'full'
  /** All seven presets by default; false hides quick ranges. */
  presets?: readonly DateRangePreset[] | false
}
const temporal = (props: TemporalProps): FieldProps => ({
  ...props,
  error: props.error ?? issueFor(props.issues, props.name),
})
const presets: readonly DateRangePreset[] = [
  'today',
  'yesterday',
  'last7',
  'thisMonth',
  'lastMonth',
  'last30',
  'last90',
]
const labelsFor = (props: CalendarOptions, range: boolean): DatePickerLabels => {
  const defaults: DatePickerLabels =
    props.locale === 'en'
      ? {
          open: range ? 'Choose date range' : 'Choose date',
          title: range ? 'Date range' : 'Choose date',
          previous: 'Previous month',
          next: 'Next month',
          apply: 'Apply',
          cancel: 'Cancel',
          chooseStart: 'Choose a start date',
          chooseEnd: 'Choose an end date',
          chooseDate: 'Choose a date',
          invalidRange: 'The end date must be on or after the start date.',
          presets: 'Quick ranges',
          customRange: 'Custom',
          invalidSelection: 'Choose a valid date range.',
          presetLabels: {
            today: 'Today',
            yesterday: 'Yesterday',
            last7: 'Last 7 days',
            thisMonth: 'This month',
            lastMonth: 'Last month',
            last30: 'Last 30 days',
            last90: 'Last 90 days',
          },
        }
      : {
          open: range ? 'Chọn khoảng ngày' : 'Chọn ngày',
          title: range ? 'Khoảng ngày' : 'Chọn ngày',
          previous: 'Tháng trước',
          next: 'Tháng sau',
          apply: 'Áp dụng',
          cancel: 'Hủy',
          chooseStart: 'Chọn ngày bắt đầu',
          chooseEnd: 'Chọn ngày kết thúc',
          chooseDate: 'Chọn một ngày',
          invalidRange: 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.',
          presets: 'Khoảng thời gian',
          customRange: 'Tùy chỉnh',
          invalidSelection: 'Vui lòng chọn khoảng ngày hợp lệ.',
          presetLabels: {
            today: 'Hôm nay',
            yesterday: 'Hôm qua',
            last7: '7 ngày qua',
            thisMonth: 'Tháng này',
            lastMonth: 'Tháng trước',
            last30: '30 ngày qua',
            last90: '90 ngày qua',
          },
        }
  return {
    ...defaults,
    ...props.calendarLabels,
    presetLabels: { ...defaults.presetLabels, ...props.calendarLabels?.presetLabels },
  }
}
const CalendarIcon = (): TemplateResult => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 11h18" />
  </svg>
)
const CalendarPanel = (props: {
  id: string
  labels: DatePickerLabels
  presets?: readonly DateRangePreset[]
}): TemplateResult => (
  <div
    data-ui="date-calendar"
    id={`${props.id}-calendar`}
    popover="auto"
    role="dialog"
    aria-labelledby={`${props.id}-calendar-title`}
  >
    <header data-ui="date-calendar-head">
      <h3 data-ui="date-calendar-title" id={`${props.id}-calendar-title`}>
        {props.labels.title}
      </h3>
      {(props.presets ?? []).length > 0 && (
        <div data-ui="date-range-preset">
          <Field
            id={`${props.id}-preset`}
            name=""
            label={props.labels.presets}
            labelHidden
            type="select"
            disabled
            value="custom"
            options={[
              { value: 'custom', label: props.labels.customRange },
              ...(props.presets ?? []).map((value) => ({ value, label: props.labels.presetLabels[value] })),
            ]}
          />
        </div>
      )}
      <ActionGroup
        label={props.labels.title}
        actions={[
          <IconButton
            label={props.labels.previous}
            icon="‹"
            name="kv-date-command"
            value="previous"
            size="compact"
          />,
          <IconButton
            label={props.labels.next}
            icon="›"
            name="kv-date-command"
            value="next"
            size="compact"
          />,
        ]}
      />
    </header>
    <div data-ui="date-calendar-body">
      <div data-ui="date-calendar-months" />
    </div>
    <footer data-ui="date-calendar-footer">
      <p data-ui="date-calendar-status" role="status" aria-live="polite" aria-atomic="true" />
      <ActionGroup
        actions={[
          <Button label={props.labels.cancel} name="kv-date-command" value="cancel" />,
          <Button label={props.labels.apply} name="kv-date-command" value="apply" variant="primary" />,
        ]}
      />
    </footer>
  </div>
)
/** Civil dates submit unchanged. Native fields also provide the no-JavaScript fallback. */
export const DatePicker = (props: DatePickerProps): TemplateResult => {
  const labels = labelsFor(props, false)
  return (
    <div
      data-ui="date-picker"
      data-date-mode="single"
      data-span={props.span ?? 'half'}
      data-date-locale={props.locale ?? 'vi'}
      data-date-today={props.today}
      data-date-week-start={props.weekStartsOn ?? 1}
      data-date-labels={JSON.stringify(labels)}
    >
      <div data-ui="date-inputs">
        <FieldFrame
          {...temporal(props)}
          kind="date"
          control={
            <div data-ui="date-field-control">
              <div data-ui="date-control-row">
                {NativeFieldControl(
                  { ...temporal(props), type: 'date', appearance: 'embedded' },
                  describedBy(props.id, props.help, temporal(props).error),
                )}
                <div data-ui="date-tools">
                  <IconButton
                    label={`${labels.open}: ${props.label}`}
                    icon={<CalendarIcon />}
                    name="kv-date-open"
                    controls={`${props.id}-calendar`}
                    expanded={false}
                    disabled={props.disabled || props.readOnly}
                  />
                </div>
              </div>
            </div>
          }
        />
      </div>
      <CalendarPanel id={props.id} labels={labels} />
    </div>
  )
}
const DateBoundary = (props: TemporalProps): TemplateResult => (
  <input
    data-ui="date-boundary"
    type="hidden"
    id={props.id}
    name={props.name}
    value={String(props.value ?? '')}
    min={props.min}
    max={props.max}
    step={props.step}
    required={props.required === true}
    disabled={props.disabled === true}
    readonly={props.readOnly === true}
    autocomplete="off"
  />
)
/** One visible range field; the two named civil-date boundaries remain the form contract. */
export const DateRangePicker = (props: DateRangePickerProps): TemplateResult => {
  const labels = labelsFor(props, true)
  const ranges = props.presets === false ? [] : [...new Set(props.presets ?? presets)]
  const start = temporal({ ...props.start, label: props.startLabel })
  const end = temporal({ ...props.end, label: props.endLabel })
  const error =
    [
      start.error ? `${props.startLabel}: ${start.error}` : '',
      end.error ? `${props.endLabel}: ${end.error}` : '',
    ]
      .filter(Boolean)
      .join(' · ') || null
  const help = [start.help, end.help].filter(Boolean).join(' · ') || null
  const id = `${props.id}-input`
  const disabled = props.start.disabled || props.end.disabled
  const locked = disabled || props.start.readOnly || props.end.readOnly
  return (
    <div
      data-ui="date-range"
      id={props.id}
      data-date-mode="range"
      data-span={props.span ?? 'full'}
      data-date-locale={props.locale ?? 'vi'}
      data-date-today={props.today}
      data-date-week-start={props.weekStartsOn ?? 1}
      data-date-labels={JSON.stringify(labels)}
    >
      <FieldFrame
        id={id}
        label={props.label}
        kind="date-range"
        required={props.start.required || props.end.required}
        span={props.span ?? 'full'}
        help={help}
        error={error}
        control={
          <>
            <div data-ui="date-field-control">
              <div data-ui="date-control-row">
                {NativeFieldControl(
                  {
                    id,
                    name: '',
                    label: props.label,
                    type: 'text',
                    appearance: 'embedded',
                    readOnly: true,
                    disabled,
                    value: formatRange(String(props.start.value ?? ''), String(props.end.value ?? '')),
                    placeholder: labels.open,
                    error,
                  },
                  describedBy(id, help, error),
                )}
                <div data-ui="date-tools">
                  <IconButton
                    label={labels.open}
                    icon={<CalendarIcon />}
                    name="kv-date-open"
                    controls={`${props.id}-calendar`}
                    expanded={false}
                    disabled={locked}
                  />
                </div>
              </div>
            </div>
            <p data-ui="date-range-error" id={`${props.id}-range-error`} role="alert" hidden>
              {labels.invalidSelection}
            </p>
          </>
        }
      />
      <DateBoundary {...props.start} label={props.startLabel} />
      <DateBoundary {...props.end} label={props.endLabel} />
      <CalendarPanel id={props.id} labels={labels} presets={ranges} />
    </div>
  )
}
/** Local date-time text is submitted unchanged; the app adapter owns timezone interpretation. */
export const DateTimePicker = (props: TemporalProps): TemplateResult => (
  <Field {...temporal(props)} type="datetime-local" />
)
export const TimePicker = (props: TemporalProps): TemplateResult => <Field {...temporal(props)} type="time" />
