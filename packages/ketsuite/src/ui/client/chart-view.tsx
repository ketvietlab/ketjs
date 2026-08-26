// The chart island: Chart.js on a canvas, driven entirely by props.
//
// What this file decides is nothing. Every number arrives already computed and
// every string already translated and already formatted in the company's
// currency, because the translator and the currency both live on the server and
// a browser bundle that reimplemented either would drift from the tables on the
// same page. The same reason `crm-kanban-view` is handed its wording rather than
// holding a second vocabulary.
//
// Colour is read from the stylesheet, not written here. A dataset carries a
// palette index and the client resolves `--admin-chart-N` off the document at
// mount, so tokens.css stays the only place a chart hue is named — and a scheme
// change is re-read rather than baked in at build time.
//
// Only the controllers the suite actually draws are registered. `chart.js/auto`
// would have been one import instead of ten, but it registers every controller
// the library ships and the zero-dep audit forbids reaching inside a package
// anyway, so the explicit list is both the smaller bundle and the allowed one.

import {
  ArcElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import type { ChartOptions, ChartType } from 'chart.js'
import type { IslandController, IslandProps } from '@ketvietlab/ketjs-view'

Chart.register(
  ArcElement,
  CategoryScale,
  DoughnutController,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
)

/** One run of numbers, with the palette slot the stylesheet should colour it from. */
export type ChartDataset = {
  label: string
  /** 1-based slot into `--admin-chart-N`. Past the sixth the stylesheet repeats. */
  series: number
  values: readonly number[]
  /**
   * The same values as text, one per point, formatted where the translator and
   * the company currency are. A tooltip prints these; it never formats a number.
   */
  formatted?: readonly string[]
  /** A comparison run is drawn in the muted grey the stylesheet reserves for it. */
  emphasis?: 'primary' | 'comparison'
}

export type ChartSpec = {
  kind: 'line' | 'doughnut' | 'sparkline'
  /** The accessible name. A canvas has no text in it, so this is the only one. */
  label: string
  labels: readonly string[]
  datasets: readonly ChartDataset[]
  /**
   * How to write an axis number: divide, then append. Decided on the server from
   * the magnitude of the data, because "1,2 tỷ" is a translation and belongs in
   * the catalogue rather than in a browser bundle.
   */
  axis?: { divisor: number; suffix: string }
}

type ChartIslandProps = IslandProps & { id: string; config: ChartSpec }

const PALETTE_SLOTS = 6

/**
 * A token's *resolved* colour.
 *
 * `getPropertyValue` hands back the custom property's declared text, and every
 * colour role here is declared as `light-dark(...)` — a function the browser
 * resolves when it paints, not when it stores. Chart.js was handed that string
 * verbatim, could not parse it, and drew every series in its own default black
 * while the legend beside it — coloured by CSS, which does resolve it — showed
 * the right hues. Painting the token onto a probe and reading the computed
 * colour back is what makes the browser do the resolving.
 */
const readToken = (name: string): string => {
  const probe = document.createElement('span')
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:var(${name})`
  document.documentElement.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved
}

const seriesColour = (slot: number): string =>
  readToken(`--admin-chart-${((Math.max(1, Math.trunc(slot)) - 1) % PALETTE_SLOTS) + 1}`)

const colourOf = (dataset: ChartDataset): string =>
  dataset.emphasis === 'comparison' ? readToken('--admin-chart-comparison') : seriesColour(dataset.series)

const number = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0)

/** `formatted` is what a reader is shown; the raw number is only ever a fallback. */
const textOf = (dataset: ChartDataset, at: number): string =>
  dataset.formatted?.[at] ?? String(number(dataset.values[at]))

const axisText = (spec: ChartSpec, value: number): string => {
  const axis = spec.axis
  if (!axis?.divisor) return String(value)
  const scaled = value / axis.divisor
  const digits = Math.abs(scaled) >= 100 || Number.isInteger(scaled) ? 0 : 1
  return `${scaled.toFixed(digits)}${axis.suffix}`
}

const commonOptions = (spec: ChartSpec): ChartOptions => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  // The legend is server-rendered text beside the canvas, so it survives without
  // this bundle and can carry links a canvas cannot. Drawing a second one inside
  // the canvas would only disagree with it.
  plugins: {
    legend: { display: false },
    tooltip: {
      displayColors: spec.kind !== 'sparkline',
      callbacks: {
        label: (item) => {
          const dataset = spec.datasets[item.datasetIndex]
          return dataset ? `${dataset.label}: ${textOf(dataset, item.dataIndex)}` : ''
        },
      },
    },
  },
})

const lineOptions = (spec: ChartSpec): ChartOptions<'line'> => {
  const bare = spec.kind === 'sparkline'
  return {
    ...(commonOptions(spec) as ChartOptions<'line'>),
    scales: {
      x: {
        display: !bare,
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: readToken('--admin-ink-muted'),
          maxRotation: 0,
          autoSkipPadding: 24,
        },
      },
      y: {
        display: !bare,
        beginAtZero: true,
        grid: { color: readToken('--admin-chart-grid') },
        border: { display: false },
        ticks: {
          color: readToken('--admin-ink-muted'),
          maxTicksLimit: 5,
          callback: (value) => axisText(spec, number(value)),
        },
      },
    },
    elements: { point: { radius: 0, hitRadius: 12, hoverRadius: 4 } },
  }
}

const doughnutOptions = (spec: ChartSpec): ChartOptions<'doughnut'> => ({
  ...(commonOptions(spec) as ChartOptions<'doughnut'>),
  cutout: '62%',
})

const datasetsOf = (spec: ChartSpec) => {
  if (spec.kind === 'doughnut') {
    const only = spec.datasets[0]
    if (!only) return []
    return [
      {
        label: only.label,
        data: only.values.map(number),
        // One arc per label, so the palette slot walks with the label rather
        // than with the dataset: a doughnut is one dataset of many categories.
        backgroundColor: only.values.map((_, at) => seriesColour(at + 1)),
        borderColor: readToken('--admin-card'),
        borderWidth: 2,
      },
    ]
  }
  return spec.datasets.map((dataset) => {
    const colour = colourOf(dataset)
    return {
      label: dataset.label,
      data: dataset.values.map(number),
      borderColor: colour,
      backgroundColor: colour,
      borderWidth: dataset.emphasis === 'comparison' ? 1.5 : 2,
      borderDash: dataset.emphasis === 'comparison' ? [5, 4] : undefined,
      tension: 0.3,
      fill: false,
    }
  })
}

const chartTypeOf = (spec: ChartSpec): ChartType => (spec.kind === 'doughnut' ? 'doughnut' : 'line')

/**
 * Mounts one chart onto a canvas and keeps it matched to the colour scheme.
 *
 * Returned rather than run: `IslandController` has no "mounted" hook, so the
 * export below queues this for after the view has rendered and finds the canvas
 * by id — the same arrangement `live-doc-view.tsx` uses next door.
 */
export function createChartView(props: ChartIslandProps): {
  view: IslandController['view']
  canvasId: string
  mount(canvas: HTMLCanvasElement): void
  dispose(): void
} {
  const spec = props.config
  const canvasId = `chart-${props.id}`
  let chart: Chart | null = null
  let scheme: MediaQueryList | null = null
  const repaint = (): void => {
    if (!chart) return
    chart.data.datasets = datasetsOf(spec) as never
    chart.options = (spec.kind === 'doughnut' ? doughnutOptions(spec) : lineOptions(spec)) as never
    chart.update('none')
  }
  return {
    canvasId,
    view: () => (
      <canvas data-ui="chart-canvas" data-kind={spec.kind} id={canvasId} role="img" aria-label={spec.label} />
    ),
    mount(canvas) {
      chart = new Chart(canvas, {
        type: chartTypeOf(spec),
        data: { labels: [...spec.labels], datasets: datasetsOf(spec) as never },
        options: (spec.kind === 'doughnut' ? doughnutOptions(spec) : lineOptions(spec)) as never,
      })
      // Tokens resolve through `light-dark()`, so every colour in the chart is
      // wrong the moment the scheme flips. Cheaper to re-read them than to
      // duplicate the palette per scheme in here.
      scheme = window.matchMedia('(prefers-color-scheme: dark)')
      scheme.addEventListener('change', repaint)
    },
    dispose() {
      scheme?.removeEventListener('change', repaint)
      scheme = null
      chart?.destroy()
      chart = null
    },
  }
}

export const chart = (props: IslandProps): IslandController => {
  const controller = createChartView(props as ChartIslandProps)
  queueMicrotask(() => {
    const canvas = document.getElementById(controller.canvasId)
    if (canvas instanceof HTMLCanvasElement) controller.mount(canvas)
  })
  return { view: controller.view, dispose: () => controller.dispose() }
}
