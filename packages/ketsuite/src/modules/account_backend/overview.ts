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

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { formatMoney } from '../../ui/index.ts'
import type { ChartKey } from '../../ui/index.ts'
import { axisScale, chartControl, peakOf } from '../backend/chart.ts'
import type { ChartDataset } from '../backend/chart.ts'

type Row = Record<string, unknown>
type Req = Parameters<Route>[1]
type Translator = ReturnType<ServeContext['translate']>

const DAY = 86_400_000
const n = (value: unknown): number => Number(value ?? 0)

/** The window the screen is reporting on, and the one it compares against. */
export type Period = {
  from: string
  to: string
  previousFrom: string
  previousTo: string
  /** What the date inputs show: a day, not an instant. */
  fromDay: string
  toDay: string
}

const day = (at: Date): string => at.toISOString().slice(0, 10)
const startOf = (value: string): string => `${value}T00:00:00.000Z`
/** Inclusive: a window ending on the 30th contains everything posted that day. */
const endOf = (value: string): string => `${value}T23:59:59.999Z`

/**
 * The window from the URL, defaulting to the month in progress.
 *
 * The comparison window is the same number of days ending the day before this
 * one opens, rather than "the previous calendar month". A user who asked for
 * the 1st to the 10th is comparing ten days, and answering with a thirty-one
 * day month would have made every figure on the screen look like a collapse.
 */
export const periodOf = (url: URL, now: Date = new Date()): Period => {
  const asked = {
    from: url.searchParams.get('dateFrom') ?? '',
    to: url.searchParams.get('dateTo') ?? '',
  }
  const valid = (value: string): boolean =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(startOf(value)).getTime())
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const fromDay = valid(asked.from) ? asked.from : day(monthStart)
  const toDay = valid(asked.to) && asked.to >= fromDay ? asked.to : day(now)
  const span = Math.max(1, Math.round((new Date(toDay).getTime() - new Date(fromDay).getTime()) / DAY) + 1)
  const previousEnd = new Date(new Date(fromDay).getTime() - DAY)
  const previousStart = new Date(previousEnd.getTime() - (span - 1) * DAY)
  return {
    from: startOf(fromDay),
    to: endOf(toDay),
    previousFrom: startOf(day(previousStart)),
    previousTo: endOf(day(previousEnd)),
    fromDay,
    toDay,
  }
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
    (row) => n(row.amount) > 0,
  )
  const head = accounts.slice(0, 5)
  const tail = accounts.slice(5)
  const tailTotal = tail.reduce((sum, row) => sum + n(row.amount), 0)
  const slices = [
    ...head.map((row) => ({
      id: String(row.accountId),
      label: `${row.code} · ${row.name}`,
      amount: n(row.amount),
    })),
    ...(tailTotal > 0
      ? [{ id: 'other', label: _('account_backend.overview.otherRevenue'), amount: tailTotal }]
      : []),
  ]
  const mixSet: ChartDataset = {
    label: _('account_backend.overview.revenue'),
    series: 1,
    values: slices.map((slice) => slice.amount),
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

  const total = slices.reduce((sum, slice) => sum + slice.amount, 0)
  return {
    revenue: {
      plot: revenuePlot,
      keys: revenueSets.map((set, at) => ({
        id: `revenue-${at}`,
        label: set.label,
        series: set.emphasis === 'comparison' ? ('comparison' as const) : at + 1,
        value: money(set.values.reduce((sum, value) => sum + value, 0)),
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
        value: `${money(slice.amount)} · ${total ? ((slice.amount / total) * 100).toFixed(1) : '0.0'}%`,
      })),
    },
  }
}
