/**
 * Turning the ledger's aggregates into what the overview screen draws.
 *
 * Kept out of `index.ts` because it is the one place in this module that does
 * arithmetic on dates and shapes for a browser bundle, and both are easier to
 * test and to read away from four hundred lines of route dispatch.
 *
 * Everything here that will reach the chart island is finished here: amounts
 * formatted in the company's currency, labels translated, axis units named from
 * the catalogue. The island is handed props and nothing else — no context, no
 * translator — so anything it would otherwise have to work out has to arrive
 * already worked out, or it will disagree with the tables printed beside it.
 */

import { isDateText } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { formatMoney } from '../../ui/index.ts'
import type { ChartKey } from '../../ui/index.ts'
import { addCivilDays, civilDateAt, DEFAULT_ACCOUNTING_TIMEZONE, periodKey } from '../account/date.ts'
import {
  compareDecimals,
  minorText,
  moneyMinor,
  roundedQuotient,
  scaleOf,
  sumMoneyMinor,
} from '../account/money.ts'
import { axisScale, chartControl, peakOf } from '../backend/chart.ts'
import type { ChartDataset } from '../backend/chart.ts'

type Row = Record<string, unknown>
type Req = Parameters<Route>[1]
type Translator = ReturnType<ServeContext['translate']>

const DAY = 86_400_000
const n = (value: unknown): number => Number(value ?? 0)

/**
 * The named windows the screen offers, in the order they are shown.
 *
 * A relative window is stored by its name, not by the dates it resolves to: a
 * bookmark of `period=last7` is still the last seven days tomorrow, while a
 * bookmark of the dates it happened to mean today is a frozen week that quietly
 * stops being what it says.
 */
export const PERIOD_PRESETS = [
  'today',
  'yesterday',
  'last7',
  'last14',
  'last30',
  'month',
  'lastMonth',
  'last90',
] as const

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

/** The window the screen is reporting on, and the one it compares against. */
export type Period = {
  from: string
  to: string
  previousFrom: string
  previousTo: string
  /** What the date inputs show: a day, not an instant. */
  fromDay: string
  toDay: string
  /**
   * Which choice produced it: a preset name, a four-digit year, or `custom` for
   * a window typed into the date fields. The screen marks it, and nothing else
   * decides which chip is current.
   */
  preset: string
}

const isDay = (value: string): boolean => isDateText(value)
const shift = (from: string, days: number): string => addCivilDays(from, days)

/**
 * What a named window means today.
 *
 * A "last N days" window ends today and counts today as one of them, which is
 * what a reader checking in at noon means by it — a window that stopped
 * yesterday would answer a question about the past while claiming to be current.
 */
const presetWindow = (name: string, now: Date, timezone: string): { from: string; to: string } | null => {
  const today = civilDateAt(now, timezone)
  const monthStart = `${periodKey(today)}-01`
  switch (name) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: shift(today, -1), to: shift(today, -1) }
    case 'last7':
      return { from: shift(today, -6), to: today }
    case 'last14':
      return { from: shift(today, -13), to: today }
    case 'last30':
      return { from: shift(today, -29), to: today }
    case 'last90':
      return { from: shift(today, -89), to: today }
    case 'month':
      return { from: monthStart, to: today }
    case 'lastMonth': {
      const end = shift(monthStart, -1)
      return { from: `${end.slice(0, 7)}-01`, to: end }
    }
    default:
      // A year, which is the one window a reader names by a number.
      return /^\d{4}$/.test(name) ? { from: `${name}-01-01`, to: `${name}-12-31` } : null
  }
}

/**
 * The window from the URL, defaulting to the month in progress.
 *
 * Dates typed into the fields win over a named preset, because they are the more
 * specific thing the reader just did — and they arrive together, so a half-typed
 * range never silently narrows the screen.
 *
 * The comparison window is the same number of days ending the day before this
 * one opens, rather than "the previous calendar month". A user who asked for the
 * 1st to the 10th is comparing ten days, and answering with a thirty-one day
 * month would have made every figure on the screen look like a collapse.
 */
export const periodOf = (
  url: URL,
  now: Date = new Date(),
  timezone: string = DEFAULT_ACCOUNTING_TIMEZONE,
): Period => {
  const typed = {
    from: url.searchParams.get('dateFrom') ?? '',
    to: url.searchParams.get('dateTo') ?? '',
  }
  const named = url.searchParams.get('period') ?? ''
  const resolved = presetWindow(named, now, timezone)
  // A name nobody offers falls back to the month rather than to nothing: the
  // screen has to report on some window, and an empty one is not a period.
  const chosen =
    isDay(typed.from) && isDay(typed.to) && typed.to >= typed.from
      ? { from: typed.from, to: typed.to, preset: 'custom' }
      : resolved
        ? { ...resolved, preset: named }
        : { ...presetWindow('month', now, timezone)!, preset: 'month' }
  const span = Math.max(
    1,
    Math.round((new Date(chosen.to).getTime() - new Date(chosen.from).getTime()) / DAY) + 1,
  )
  const previousEnd = shift(chosen.from, -1)
  const previousStart = shift(previousEnd, -(span - 1))
  return {
    from: chosen.from,
    to: chosen.to,
    previousFrom: previousStart,
    previousTo: previousEnd,
    fromDay: chosen.from,
    toDay: chosen.to,
    preset: chosen.preset,
  }
}

/**
 * The years a reader can ask for: the ones the ledger actually covers.
 *
 * Newest first and capped, because a chip row is read at a glance and a company
 * ten years into its books does not want ten of them across the filter. The
 * years past the cap are still reachable by typing the dates.
 */
export const YEAR_CHOICES = 6

export const yearsOf = (
  earliest: string,
  now: Date = new Date(),
  timezone: string = DEFAULT_ACCOUNTING_TIMEZONE,
): number[] => {
  const first = Number(String(earliest).slice(0, 4))
  const last = Number(civilDateAt(now, timezone).slice(0, 4))
  if (!Number.isFinite(first) || first < 1970 || first > last) return [last]
  const all: number[] = []
  for (let year = last; year >= first && all.length < YEAR_CHOICES; year -= 1) all.push(year)
  return all
}

/** How many points a line may carry before its labels stop being readable. */
const LABEL_BUDGET = 31

/**
 * A bucket label a person can read.
 *
 * The ledger labels a bucket `2026-06-10` or `2026-06`, which is right for a
 * key and wrong for an axis: the year repeats on every tick and the part that
 * differs is at the end, where a rotated label hides it.
 */
const pointLabel = (label: string): string => {
  const parts = label.split('-')
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`
  if (parts.length === 2) return `${parts[1]}/${parts[0]}`
  return label
}

const seriesOf = (
  _: Translator,
  points: Row[],
  label: string,
  series: number | 'comparison',
  currency: unknown,
): ChartDataset => ({
  label,
  series: series === 'comparison' ? 1 : series,
  emphasis: series === 'comparison' ? 'comparison' : 'primary',
  values: points.map((point) => n(point.revenue)),
  formatted: points.map((point) => formatMoney(_, point.revenue, currency)),
})

export type OverviewCharts = {
  revenue: { plot: JSXChild | null; keys: readonly ChartKey[] }
  mix: { plot: JSXChild | null; keys: readonly ChartKey[] }
}

/**
 * The two canvas charts, resolved.
 *
 * The revenue mix folds everything past the fifth account into one slice, for
 * the reason the palette is six wide: a legend of eleven near-identical greens
 * tells a reader less than five colours and a total.
 */
export const overviewCharts = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  data: { currency: unknown; current: Row; timeline: Row; previousTimeline: Row },
): Promise<OverviewCharts> => {
  const money = (value: unknown) => formatMoney(_, value, data.currency)
  const scale = scaleOf(data.currency)
  const points = (data.timeline.points as Row[] | undefined) ?? []
  const before = (data.previousTimeline.points as Row[] | undefined) ?? []
  const units = {
    billion: _('account_backend.overview.unitBillion'),
    million: _('account_backend.overview.unitMillion'),
    thousand: _('account_backend.overview.unitThousand'),
  }

  const revenueSets: ChartDataset[] = points.length
    ? [
        seriesOf(_, points, _('account_backend.overview.thisPeriod'), 1, data.currency),
        // Aligned by position, not by date: the previous window is the same
        // number of buckets, so bucket five against bucket five is what a
        // reader means by "the same point last period".
        ...(before.length
          ? [seriesOf(_, before, _('account_backend.overview.lastPeriod'), 'comparison', data.currency)]
          : []),
      ]
    : []
  const revenueLabels = points.map((point) => pointLabel(String(point.label)))
  const skip = Math.max(1, Math.ceil(revenueLabels.length / LABEL_BUDGET))
  const revenuePlot = revenueSets.length
    ? await chartControl(ctx, url, req, 'overview-revenue', {
        kind: 'line',
        label: _('account_backend.overview.revenueTrend'),
        labels: revenueLabels.map((label, at) => (at % skip === 0 ? label : '')),
        datasets: revenueSets,
        axis: axisScale(peakOf(revenueSets), units),
      })
    : null

  const accounts = ((data.current.revenueByAccount as Row[] | undefined) ?? []).filter(
    (row) => compareDecimals(row.amount, '0') > 0,
  )
  const head = accounts.slice(0, 5)
  const tail = accounts.slice(5)
  const tailTotal = sumMoneyMinor(
    tail.map((row) => row.amount),
    scale,
  )
  const slices = [
    ...head.map((row) => ({
      id: String(row.accountId),
      label: `${row.code} · ${row.name}`,
      amount: minorText(moneyMinor(row.amount, scale), scale),
      value: n(row.amount),
    })),
    ...(tailTotal > 0n
      ? [
          {
            id: 'other',
            label: _('account_backend.overview.otherRevenue'),
            amount: minorText(tailTotal, scale),
            value: Number(minorText(tailTotal, scale)),
          },
        ]
      : []),
  ]
  const mixSet: ChartDataset = {
    label: _('account_backend.overview.revenue'),
    series: 1,
    values: slices.map((slice) => slice.value),
    formatted: slices.map((slice) => money(slice.amount)),
  }
  const mixPlot = slices.length
    ? await chartControl(ctx, url, req, 'overview-mix', {
        kind: 'doughnut',
        label: _('account_backend.overview.mix'),
        labels: slices.map((slice) => slice.label),
        datasets: [mixSet],
      })
    : null

  const total = sumMoneyMinor(
    slices.map((slice) => slice.amount),
    scale,
  )
  return {
    revenue: {
      plot: revenuePlot,
      keys: revenueSets.map((set, at) => ({
        id: `revenue-${at}`,
        label: set.label,
        series: set.emphasis === 'comparison' ? ('comparison' as const) : at + 1,
        value: money(
          minorText(
            sumMoneyMinor(
              (at === 0 ? points : before).map((point) => point.revenue),
              scale,
            ),
            scale,
          ),
        ),
      })),
    },
    mix: {
      plot: mixPlot,
      keys: slices.map((slice, at) => ({
        id: slice.id,
        label: slice.label,
        series: at + 1,
        // Amount and share together: a percentage alone hides the scale, and an
        // amount alone hides how much of the whole it is.
        value: `${money(slice.amount)} · ${
          total
            ? (Number(roundedQuotient(moneyMinor(slice.amount, scale) * 1_000n, total)) / 10).toFixed(1)
            : '0.0'
        }%`,
      })),
    },
  }
}
