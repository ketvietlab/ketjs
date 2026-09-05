// Records as bars on a day axis.
//
// Server-rendered and link-navigable, with no client island behind it: the
// chart has no state a reader changes, so there is nothing for hydration to
// buy. A bar is a link to its record, and the whole thing reads with scripting
// off — which a canvas would not.
//
// Everything is laid out in whole days, because that is the resolution the
// data has. A record carries dates, not datetimes, and a bar claiming to start
// at 14:32 would be inventing precision nobody entered.

import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { formatDateTime } from './format.ts'

export const HOOKS = [
  'gantt',
  'gantt-scroll',
  'gantt-canvas',
  'gantt-head',
  'gantt-month',
  'gantt-today',
  'gantt-body',
  'gantt-row',
  'gantt-label',
  'gantt-track',
  'gantt-bar',
  'gantt-fill',
  'gantt-point',
  'gantt-empty',
] as const

const DAY = 86400000
const LAYOUT = { dayWidth: 26, labelWidth: 220 }

export type GanttItem = {
  id: string
  title: string
  href: string
  /** `YYYY-MM-DD`. A row without one cannot be placed and is left out. */
  startsOn?: string | null
  /** `YYYY-MM-DD`. Absent means a point rather than a bar — see below. */
  endsOn?: string | null
  /** True when the start was inferred rather than chosen, so it can be drawn as such. */
  inferredStart?: boolean
  detail?: string | null
  done?: boolean
  /** 0–100, or null when the question does not apply to this record. */
  progress?: number | null
}

export type GanttLabels = { today: string; empty: string }

/** A `YYYY-MM-DD` as a UTC day number, so the arithmetic never crosses a timezone. */
const dayOf = (value: unknown): number | null => {
  const parsed = Date.parse(`${String(value ?? '').slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(parsed) ? null : Math.floor(parsed / DAY)
}

type Placed = GanttItem & { start: number; end: number | null }

/**
 * The rows that can be drawn, and the span they cover.
 *
 * A record with no end is a point, not a bar: it has a day work begins and no
 * day it finishes, and stretching it to today would assert a deadline nobody
 * set. One day of margin either side, so the first bar does not begin flush
 * against the axis.
 */
export const ganttSpan = (
  items: readonly GanttItem[],
  today?: string | null,
): { rows: Placed[]; from: number; to: number; todayAt: number | null } => {
  const rows: Placed[] = []
  for (const item of items) {
    const start = dayOf(item.startsOn)
    if (start == null) continue
    const end = dayOf(item.endsOn)
    rows.push({ ...item, start, end: end != null && end >= start ? end : null })
  }
  if (!rows.length) return { rows, from: 0, to: 0, todayAt: null }
  const days = rows.flatMap((row) => (row.end == null ? [row.start] : [row.start, row.end]))
  const from = Math.min(...days) - 1
  const to = Math.max(...days) + 1
  const now = dayOf(today)
  return { rows, from, to, todayAt: now != null && now >= from && now <= to ? now : null }
}

type Band = { key: string; x: number; width: number; label: string }

const months = (from: number, to: number, locale: string): Band[] => {
  const bands: Band[] = []
  for (let day = from; day <= to; day++) {
    const date = new Date(day * DAY)
    if (day !== from && date.getUTCDate() !== 1) continue
    const previous = bands[bands.length - 1]
    if (previous) previous.width = (day - from) * LAYOUT.dayWidth - previous.x
    bands.push({
      key: String(day),
      x: (day - from) * LAYOUT.dayWidth,
      width: (to - day + 1) * LAYOUT.dayWidth,
      label: formatDateTime(locale, date, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    })
  }
  return bands
}

/**
 * `locale` picks the month names only. Everything else is a caller's string,
 * because a chart in a product speaks that product's vocabulary.
 */
export const gantt = (o: {
  items: readonly GanttItem[]
  labels: GanttLabels
  today?: string | null
  locale?: string
  empty?: TemplateResult
}): TemplateResult => {
  const { rows, from, to, todayAt } = ganttSpan(o.items, o.today)
  if (!rows.length) return o.empty ?? <p data-ui="gantt-empty">{o.labels.empty}</p>
  const width = (to - from + 1) * LAYOUT.dayWidth
  const at = (day: number) => (day - from) * LAYOUT.dayWidth
  return (
    <div data-ui="gantt" style={`--gantt-label:${LAYOUT.labelWidth}px;--gantt-width:${width}px`}>
      <div data-ui="gantt-scroll">
        <div data-ui="gantt-canvas">
          <div data-ui="gantt-head">
            {each(
              months(from, to, o.locale ?? 'en-GB'),
              (band) => band.key,
              (band) => (
                <span data-ui="gantt-month" style={`--gantt-x:${band.x}px;--gantt-w:${band.width}px`}>
                  {band.label}
                </span>
              ),
            )}
            {todayAt != null && (
              <span
                data-ui="gantt-today"
                style={`--gantt-x:${at(todayAt) + LAYOUT.dayWidth / 2}px`}
                title={o.labels.today}
                aria-hidden="true"
              />
            )}
          </div>
          <div data-ui="gantt-body">
            {each(
              rows,
              (row) => row.id,
              (row) => (
                <a data-ui="gantt-row" href={row.href} title={row.detail ?? row.title}>
                  <span data-ui="gantt-label">{row.title}</span>
                  <span data-ui="gantt-track">
                    {row.end == null ? (
                      <span
                        data-ui="gantt-point"
                        style={`--gantt-x:${at(row.start)}px`}
                        data-inferred={String(row.inferredStart === true)}
                      />
                    ) : (
                      <span
                        data-ui="gantt-bar"
                        style={`--gantt-x:${at(row.start)}px;--gantt-w:${(row.end - row.start + 1) * LAYOUT.dayWidth}px`}
                        data-done={String(row.done === true)}
                        data-inferred={String(row.inferredStart === true)}
                      >
                        {row.progress != null && (
                          <span
                            data-ui="gantt-fill"
                            style={`--gantt-p:${Math.max(0, Math.min(100, Math.round(row.progress)))}%`}
                          />
                        )}
                      </span>
                    )}
                  </span>
                </a>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
