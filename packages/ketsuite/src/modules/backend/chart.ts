/**
 * Placing a chart on a backend screen.
 *
 * The same shape as `relation-select.ts` next door: a route resolves the joint,
 * hands the resulting node to its screen, and the screen never knows an island
 * was involved. Charts go through a joint rather than being a plain component
 * because a canvas needs a browser module behind it, and the module that owns
 * the browser module is this one.
 *
 * What a caller builds here is the *spec*, and building it is deliberately
 * server work: the numbers come off the ledger, the words come from the
 * translation catalogue, and the amounts are formatted in the company's
 * currency. Handing the browser a raw number and a locale would have put a
 * second money formatter in a bundle, disagreeing with the tables printed
 * beside it.
 */

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type { ChartDataset, ChartSpec } from '../../ui/client/chart-view.tsx'

export type { ChartDataset, ChartSpec } from '../../ui/client/chart-view.tsx'

type Req = Parameters<Route>[1]

/** Resolves one chart into a node the screen can place. `id` must be unique on the page. */
export const chartControl = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  config: ChartSpec,
): Promise<JSXChild> => ctx.joint(url, req, 'backend:screen.chart', { id, config })

/**
 * How to write the numbers on an axis, given the largest one on it.
 *
 * A revenue axis in đồng runs to ten digits, and ten digits repeated five times
 * up the side of a chart is not a scale, it is a wall. The divisor and its
 * suffix are chosen here so the words are translated ones — `axis.billion` in
 * the catalogue, not a `'B'` hard-coded in a browser bundle.
 */
export const axisScale = (
  max: number,
  units: { billion: string; million: string; thousand: string },
): { divisor: number; suffix: string } => {
  const size = Math.abs(Number.isFinite(max) ? max : 0)
  if (size >= 1_000_000_000) return { divisor: 1_000_000_000, suffix: units.billion }
  if (size >= 1_000_000) return { divisor: 1_000_000, suffix: units.million }
  if (size >= 1_000) return { divisor: 1_000, suffix: units.thousand }
  return { divisor: 1, suffix: '' }
}

/** The largest absolute value across every dataset, for `axisScale`. */
export const peakOf = (datasets: readonly ChartDataset[]): number =>
  datasets.reduce(
    (peak, dataset) =>
      dataset.values.reduce((held, value) => Math.max(held, Math.abs(Number(value) || 0)), peak),
    0,
  )
