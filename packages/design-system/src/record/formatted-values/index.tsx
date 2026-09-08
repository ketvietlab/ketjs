import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['formatted-date', 'formatted-number', 'formatted-money'] as const

export const FormattedDate = (props: {
  value: string
  locale?: string
  emptyLabel?: string
}): TemplateResult => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(props.value)
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null
  const valid =
    !!match &&
    !!date &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  const formatted = valid
    ? new Intl.DateTimeFormat(props.locale ?? 'vi-VN', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
    : (props.emptyLabel ?? '—')
  return (
    <time data-ui="formatted-date" datetime={valid ? props.value : null}>
      {formatted}
    </time>
  )
}

export const FormattedNumber = (props: {
  value: number
  locale?: string
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}): TemplateResult => (
  <data data-ui="formatted-number" value={String(props.value)}>
    {new Intl.NumberFormat(props.locale ?? 'vi-VN', {
      minimumFractionDigits: props.minimumFractionDigits,
      maximumFractionDigits: props.maximumFractionDigits,
    }).format(props.value)}
  </data>
)

export const FormattedMoney = (props: {
  value: number
  currency: string
  locale?: string
}): TemplateResult => (
  <data data-ui="formatted-money" value={String(props.value)} data-currency={props.currency}>
    {new Intl.NumberFormat(props.locale ?? 'vi-VN', { style: 'currency', currency: props.currency }).format(
      props.value,
    )}
  </data>
)
