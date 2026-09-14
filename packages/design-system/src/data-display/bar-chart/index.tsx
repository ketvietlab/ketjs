import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'bar-chart',
  'bar-chart-rows',
  'bar-chart-row',
  'bar-chart-label',
  'bar-chart-caption',
  'bar-chart-track',
  'bar-chart-fill',
  'bar-chart-segment',
  'bar-chart-value',
  'bar-chart-scale',
  'bar-chart-legend',
  'bar-chart-legend-item',
  'bar-chart-legend-swatch',
  'bar-chart-empty',
] as const

/** How many categorical colours the stylesheet defines. Past this a legend stops being readable. */
export const CHART_SERIES = 6

/** One part of a stacked bar. `series` is the 1-based palette slot its legend key also names. */
export type BarChartSegment = { series: number; value: number }

/** A named magnitude, drawn against the largest in its set or against `max`. */
export type BarChartBar = {
  id: string
  label: string
  value: number
  caption?: string | null
  href?: string | null
  /** Parts of `value`, in legend order. Present on every bar when the chart is stacked. */
  segments?: readonly BarChartSegment[]
}

export type BarChartKey = { id: string; label: string; series: number }

export type BarChartProps = {
  /** The accessible name of the list; the visible heading belongs to the surface around it. */
  label: string
  bars: readonly BarChartBar[]
  value: (bar: BarChartBar) => string
  /** A fixed top for the track, such as 100 for rates. Defaults to a round number above the largest bar. */
  max?: number
  /** What each stacked segment colour means. Required for a stacked chart to be readable. */
  keys?: readonly BarChartKey[]
  /** The scale spelled out under the bars, when the caller wants one printed. */
  scale?: readonly string[]
  empty?: string
}

const finite = (value: number): number => (Number.isFinite(value) ? value : 0)

const slotOf = (series: number): string => String(((Math.max(1, Math.trunc(series)) - 1) % CHART_SERIES) + 1)

const percent = (value: number, of: number): string =>
  of <= 0 ? '0' : Math.min(100, (Math.abs(finite(value)) / of) * 100).toFixed(2)

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
 * Magnitudes against one scale.
 *
 * HTML rather than a canvas or SVG, on purpose. Bars run horizontally because
 * their labels are business names that need room, a row may link to the records
 * behind it, and every number is real text — so the chart reads the same to a
 * screen reader, a printed page and an agent comparing screens, with no script.
 *
 * Plain bars share one colour: they are one series, and a hue per row would
 * read as a legend that does not exist.
 *
 * A bar with `segments` is stacked: the fill still spans the bar's total, and
 * the segments divide it. `keys` names the segments once, above the rows.
 */
export const BarChart = (props: BarChartProps): TemplateResult => {
  const bars = props.bars.filter((bar) => finite(bar.value) !== 0)
  if (!bars.length) return <p data-ui="bar-chart-empty">{props.empty ?? ''}</p>
  const largest = Math.max(...bars.map((bar) => Math.abs(finite(bar.value))), 0)
  const ceiling = props.max !== undefined && props.max > 0 ? props.max : axisCeiling(largest)
  const stacked = bars.some((bar) => bar.segments?.length)
  return (
    <div data-ui="bar-chart" data-stacked={stacked ? 'true' : null}>
      {!!props.keys?.length && (
        <ul data-ui="bar-chart-legend">
          {each(
            props.keys,
            (key) => key.id,
            (key) => (
              <li data-ui="bar-chart-legend-item" data-series={slotOf(key.series)}>
                <span data-ui="bar-chart-legend-swatch" aria-hidden="true" />
                {key.label}
              </li>
            ),
          )}
        </ul>
      )}
      <ul data-ui="bar-chart-rows" aria-label={props.label}>
        {each(
          bars,
          (bar) => bar.id,
          (bar) => (
            <li data-ui="bar-chart-row">
              <span data-ui="bar-chart-label">
                {bar.href ? <a href={bar.href}>{bar.label}</a> : bar.label}
                {!!bar.caption && <small data-ui="bar-chart-caption">{bar.caption}</small>}
              </span>
              <span data-ui="bar-chart-track" aria-hidden="true">
                {bar.segments?.length ? (
                  <span data-ui="bar-chart-fill" style={`inline-size: ${percent(bar.value, ceiling)}%`}>
                    {each(
                      bar.segments,
                      (segment) => String(segment.series),
                      (segment) => (
                        <span
                          data-ui="bar-chart-segment"
                          data-series={slotOf(segment.series)}
                          style={`inline-size: ${percent(segment.value, Math.abs(finite(bar.value)))}%`}
                        />
                      ),
                    )}
                  </span>
                ) : (
                  <span
                    data-ui="bar-chart-fill"
                    data-series={props.keys?.length ? slotOf(props.keys[0]!.series) : '1'}
                    style={`inline-size: ${percent(bar.value, ceiling)}%`}
                  />
                )}
              </span>
              <span data-ui="bar-chart-value">{props.value(bar)}</span>
            </li>
          ),
        )}
      </ul>
      {!!props.scale?.length && (
        <div data-ui="bar-chart-scale" aria-hidden="true">
          {each(
            props.scale,
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
