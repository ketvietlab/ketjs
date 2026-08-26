// The server-rendered half of a chart.
//
// The canvas is an island — `modules/backend/chart.ts` resolves it and hands
// this file the node. What is here is everything around it: the legend, the
// bars that are really a table, and the way a change against a previous period
// is written. That split is not tidiness. A canvas has no text in it, so a
// reader without the bundle, a reader using a screen reader, and a printed page
// all get nothing from it — the legend beside it carries the same numbers as
// real text, and is the thing that makes the chart optional rather than load-
// bearing.
//
// Colour never appears in this file either. A mark carries `data-series` and
// the stylesheet decides what that means, the same rule the client bundle
// follows when it reads `--admin-chart-N` off the document.

import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'chart',
  'chart-plot',
  'chart-legend',
  'chart-legend-item',
  'chart-legend-swatch',
  'chart-legend-label',
  'chart-legend-value',
  'chart-empty',
  'bar-chart',
  'bar-chart-row',
  'bar-chart-label',
  'bar-chart-track',
  'bar-chart-fill',
  'bar-chart-value',
  'bar-chart-scale',
  'delta',
] as const

/** How many distinct colours the stylesheet defines. Past this a legend stops being readable. */
export const CHART_SERIES = 6

/** One row of a legend: what the mark means, and the number it stands for. */
export type ChartKey = {
  id: string
  label: string
  /** 1-based slot into the palette, or `comparison` for the muted previous-period grey. */
  series: number | 'comparison'
  value?: string | null
  href?: string | null
}

/** A named magnitude, drawn against the largest in its set. */
export type ChartBar = { id: string; label: string; value: number; caption?: string; href?: string | null }

const finite = (value: number): number => (Number.isFinite(value) ? value : 0)

const slotOf = (series: number | 'comparison'): string =>
  series === 'comparison' ? 'comparison' : String(((Math.max(1, Math.trunc(series)) - 1) % CHART_SERIES) + 1)

/**
 * A round number at or above `max`, for the top of a bar track.
 *
 * A track topped by the largest bar puts that bar against the frame and leaves
 * the reader deciding whether it touches; 1, 2, 2.5 or 5 times a power of ten is
 * the smallest ceiling that still reads as a number.
 */
export const axisCeiling = (max: number): number => {
  const value = finite(max)
  if (value <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * magnitude) return step * magnitude
  return 10 * magnitude
}

/**
 * A chart: the canvas, and the legend that says what it shows.
 *
 * `plot` is whatever the joint resolved to — normally the island, and `null`
 * on a deployment that installed the kit without the admin, where the legend is
 * then the whole chart and still says everything it needs to.
 */
export const chart = (o: {
  plot: JSXChild | null
  keys: readonly ChartKey[]
  kind: 'line' | 'doughnut'
  empty?: string
}): TemplateResult => {
  if (!o.keys.length)
    return (
      <div data-ui="chart" data-kind={o.kind}>
        <p data-ui="chart-empty">{o.empty ?? ''}</p>
      </div>
    )
  return (
    <div data-ui="chart" data-kind={o.kind}>
      {o.plot !== null && <div data-ui="chart-plot">{o.plot}</div>}
      <ul data-ui="chart-legend">
        {each(
          o.keys,
          (key) => key.id,
          (key) => (
            <li data-ui="chart-legend-item" data-series={slotOf(key.series)}>
              <span data-ui="chart-legend-swatch" />
              <span data-ui="chart-legend-label">
                {key.href ? <a href={key.href}>{key.label}</a> : key.label}
              </span>
              {!!key.value && <span data-ui="chart-legend-value">{key.value}</span>}
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

/**
 * Magnitudes against the largest of them.
 *
 * Not a canvas, on purpose. Bars run horizontally because the labels are account
 * names, each row links to the ledger behind it, and both of those are things a
 * canvas cannot give — a chart nobody can click into is a number to trust
 * blindly, which is the same objection the trial balance already answers.
 */
export const barChart = (o: {
  bars: readonly ChartBar[]
  value: (bar: ChartBar) => string
  /** The scale spelled out under the bars, when the caller wants one printed. */
  scale?: readonly string[]
  empty?: string
}): TemplateResult => {
  const bars = o.bars.filter((bar) => finite(bar.value) !== 0)
  const ceiling = axisCeiling(Math.max(...bars.map((bar) => Math.abs(finite(bar.value))), 0))
  if (!bars.length) return <p data-ui="chart-empty">{o.empty ?? ''}</p>
  return (
    <div data-ui="bar-chart">
      {each(
        bars,
        (bar) => bar.id,
        (bar, index) => (
          <div data-ui="bar-chart-row">
            <span data-ui="bar-chart-label">{bar.href ? <a href={bar.href}>{bar.label}</a> : bar.label}</span>
            <span data-ui="bar-chart-track">
              <span
                data-ui="bar-chart-fill"
                data-series={slotOf(index + 1)}
                style={`inline-size: ${ceiling <= 0 ? 0 : ((Math.abs(finite(bar.value)) / ceiling) * 100).toFixed(2)}%`}
              />
            </span>
            <span data-ui="bar-chart-value">{o.value(bar)}</span>
          </div>
        ),
      )}
      {!!o.scale?.length && (
        <div data-ui="bar-chart-scale">
          {each(
            o.scale,
            (tick, at) => `${tick}:${at}`,
            (tick) => (
              <span>{tick}</span>
            ),
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A change against a previous period.
 *
 * `direction` is which way the number went and `sentiment` is what that means,
 * and they are separate on purpose. Debt falling is a fall and good news; a
 * component that coloured by direction alone painted every reduction in what the
 * company owes in the same red it uses for lost revenue.
 */
export const delta = (o: {
  label: string
  direction: 'up' | 'down' | 'flat'
  sentiment: 'good' | 'bad' | 'neutral'
}): TemplateResult => (
  <span data-ui="delta" data-direction={o.direction} data-sentiment={o.sentiment}>
    {o.label}
  </span>
)

/**
 * How a change should be read, given which way is the good way.
 *
 * `ratio` is null when there is nothing to compare against: a period whose
 * predecessor was zero has no percentage change, and printing 0% would claim
 * the books stood still.
 */
export const changeOf = (
  current: number,
  previous: number,
  better: 'higher' | 'lower',
): { ratio: number | null; direction: 'up' | 'down' | 'flat'; sentiment: 'good' | 'bad' | 'neutral' } => {
  const moved = finite(current) - finite(previous)
  const direction = moved > 0 ? 'up' : moved < 0 ? 'down' : 'flat'
  const sentiment =
    direction === 'flat' ? 'neutral' : (direction === 'up') === (better === 'higher') ? 'good' : 'bad'
  return { ratio: finite(previous) === 0 ? null : moved / Math.abs(finite(previous)), direction, sentiment }
}
