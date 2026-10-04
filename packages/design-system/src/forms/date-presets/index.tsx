import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Menu } from '../../interactions/menu/index.tsx'
import { Inline } from '../../layouts/index.tsx'
import { Icon } from '../../primitives/icon/index.tsx'
import { addDays, dateText, monthEnd, monthStart, moveMonth, parseDate } from '../date-time/date-math.js'

/** Fixed choices, in display order. No arbitrary date or custom-range entry. */
export const datePresetIds = [
  'today',
  'yesterday',
  'last_7_days',
  'this_week',
  'last_week',
  'last_30_days',
  'this_month',
  'last_month',
  'last_90_days',
  'this_year',
  'last_year',
] as const
export type DatePreset = (typeof datePresetIds)[number]
export type DatePresetRange = { start: string; end: string }

const labels = {
  vi: [
    'Hôm nay',
    'Hôm qua',
    '7 ngày qua',
    'Tuần này',
    'Tuần trước',
    '30 ngày qua',
    'Tháng này',
    'Tháng trước',
    '90 ngày qua',
    'Năm nay',
    'Năm trước',
  ],
  en: [
    'Today',
    'Yesterday',
    'Last 7 days',
    'This week',
    'Last week',
    'Last 30 days',
    'This month',
    'Last month',
    'Last 90 days',
    'This year',
    'Last year',
  ],
} as const

export const datePresetLabel = (preset: DatePreset, locale: 'vi' | 'en' = 'vi'): string =>
  labels[locale][datePresetIds.indexOf(preset)] ?? ''

/** Inclusive civil dates in the caller's business timezone. Weeks start Monday;
 * current week/month/year cover the entire calendar period. Rolling ranges include today. */
export const resolveDatePreset = (preset: DatePreset, today: string): DatePresetRange => {
  const date = parseDate(today)
  if (!date || !datePresetIds.includes(preset)) throw new RangeError('Invalid date preset or business date')
  let start = today
  let end = today
  if (preset === 'yesterday') start = end = addDays(today, -1)
  if (preset === 'last_7_days' || preset === 'last_30_days' || preset === 'last_90_days') {
    start = addDays(today, 1 - Number(preset.split('_')[1]))
  }
  if (preset === 'this_week' || preset === 'last_week') {
    start = addDays(today, -((date.getUTCDay() + 6) % 7) - (preset === 'last_week' ? 7 : 0))
    end = addDays(start, 6)
  }
  if (preset === 'this_month' || preset === 'last_month') {
    const anchor = preset === 'last_month' ? moveMonth(today, -1) : today
    start = monthStart(anchor)
    end = monthEnd(anchor)
  }
  if (preset === 'this_year' || preset === 'last_year') {
    date.setUTCFullYear(date.getUTCFullYear() - (preset === 'last_year' ? 1 : 0), 0, 1)
    start = dateText(date)
    date.setUTCMonth(11, 31)
    end = dateText(date)
  }
  if (!parseDate(start) || !parseDate(end)) throw new RangeError('Date preset exceeds supported dates')
  return { start, end }
}

export type DatePresetPickerProps = {
  id: string
  /** Accessible label only; the trigger displays the selected preset. */
  label: string
  value: DatePreset
  /** Explicit YYYY-MM-DD in the business timezone, keeping server rendering pure. */
  today: string
  locale?: 'vi' | 'en'
  /** Native links apply immediately and retain navigation without client JavaScript. */
  href: (preset: DatePreset, range: DatePresetRange) => string
  align?: 'start' | 'end'
}

/** Dashboard period filter. Menu owns control geometry, popup, keyboard and selected state. */
export const DatePresetPicker = (props: DatePresetPickerProps): TemplateResult => (
  <Menu
    id={props.id}
    label={`${props.label}: ${datePresetLabel(props.value, props.locale)}`}
    trigger={
      <Inline
        gap="compact"
        items={[datePresetLabel(props.value, props.locale), <Icon name="chevron-down" />]}
      />
    }
    align={props.align ?? 'end'}
    mobileAlign="start"
    selectionMode="single"
    items={datePresetIds.map((preset) => ({
      id: preset,
      label: datePresetLabel(preset, props.locale),
      href: props.href(preset, resolveDatePreset(preset, props.today)),
      checked: preset === props.value,
    }))}
  />
)
