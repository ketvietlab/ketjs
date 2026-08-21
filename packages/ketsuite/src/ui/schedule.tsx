// A dense, server-rendered schedule board. Modules provide rows, days and spans;
// this component owns the grid markup, sticky labels and overflow behaviour.

import { each } from 'ketjs-view'
import type { JSXChild, TemplateResult } from 'ketjs-view'

export const HOOKS = [
  'schedule-scroll',
  'schedule',
  'schedule-head',
  'schedule-corner',
  'schedule-day',
  'schedule-day-label',
  'schedule-day-detail',
  'schedule-row',
  'schedule-row-label',
  'schedule-row-name',
  'schedule-row-detail',
  'schedule-cell',
  'schedule-event',
  'schedule-event-title',
  'schedule-event-detail',
] as const

export type ScheduleDay = { key: string; label: string; detail?: string | null; today?: boolean }
export type ScheduleRow = { id: string; label: string; detail?: string | null; state?: string | null }
export type ScheduleTone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger'
export type ScheduleEvent = {
  id: string
  rowId: string
  start: number
  span: number
  label: string
  detail?: string | null
  tone?: ScheduleTone | null
  state?: string | null
}

const columns = (count: number): string => `12rem repeat(${count}, minmax(6.5rem, 1fr))`

export const scheduleBoard = (o: {
  corner: string
  days: readonly ScheduleDay[]
  rows: readonly ScheduleRow[]
  events: readonly ScheduleEvent[]
  empty?: JSXChild
}): TemplateResult => {
  if (!o.rows.length) return <>{o.empty}</>
  const template = columns(o.days.length)
  return (
    <div data-ui="schedule-scroll">
      <div data-ui="schedule" style={{ minWidth: `${12 + o.days.length * 6.5}rem` }}>
        <header data-ui="schedule-head" style={{ gridTemplateColumns: template }}>
          <div data-ui="schedule-corner">{o.corner}</div>
          {each(
            o.days,
            (day) => day.key,
            (day) => (
              <div data-ui="schedule-day" data-today={String(day.today === true)}>
                <span data-ui="schedule-day-label">{day.label}</span>
                {!!day.detail && <span data-ui="schedule-day-detail">{day.detail}</span>}
              </div>
            ),
          )}
        </header>
        {each(
          o.rows,
          (row) => row.id,
          (row) => (
            <div
              data-ui="schedule-row"
              data-state={row.state ?? null}
              style={{ gridTemplateColumns: template }}
            >
              <div data-ui="schedule-row-label" style={{ gridColumn: '1' }}>
                <span data-ui="schedule-row-name">{row.label}</span>
                {!!row.detail && <span data-ui="schedule-row-detail">{row.detail}</span>}
              </div>
              {each(
                o.days,
                (day) => day.key,
                (day, index) => (
                  <div
                    data-ui="schedule-cell"
                    data-today={String(day.today === true)}
                    style={{ gridColumn: String(index + 2) }}
                  />
                ),
              )}
              {each(
                o.events.filter((event) => event.rowId === row.id),
                (event) => event.id,
                (event) => (
                  <article
                    data-ui="schedule-event"
                    data-tone={event.tone ?? 'neutral'}
                    data-state={event.state ?? null}
                    style={{ gridColumn: `${event.start + 2} / span ${Math.max(1, event.span)}` }}
                    title={event.detail ? `${event.label} · ${event.detail}` : event.label}
                  >
                    <strong data-ui="schedule-event-title">{event.label}</strong>
                    {!!event.detail && <span data-ui="schedule-event-detail">{event.detail}</span>}
                  </article>
                ),
              )}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
