import {
  addCalendarDays,
  badge,
  dateKeyIn,
  emptyState,
  formatDateTime,
  type Frame,
  inline,
  linkButton,
  providerName,
  ScheduleBoard,
  Section,
  setupAction,
  type TapeChart,
  type TemplateResult,
  type Translator,
  workflowTone,
  zonedMidnight,
} from './shared.tsx'
import { BoardPage, shell } from '../../../ui/index.ts'

/** What the viewer may start from here, rather than what they may look at. */
export type TapeChartPermissions = { book: boolean }

const WORKFLOW_ORDER = ['draft', 'confirmed', 'checked_in', 'checked_out', 'no_show', 'cancelled']

export const tapeChartScreen = (
  _: Translator,
  chart: TapeChart,
  may: TapeChartPermissions,
  locale: string,
  frame: Frame,
): TemplateResult => {
  const timezone = chart.timezone || 'UTC'
  const startKey = dateKeyIn(new Date(chart.from), timezone)
  const endKey = dateKeyIn(new Date(chart.to), timezone)
  const dayCount = Math.max(
    1,
    Math.round((Date.parse(`${endKey}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / 86_400_000),
  )
  const nowKey = dateKeyIn(new Date(), timezone)
  const boundaries = Array.from({ length: dayCount + 1 }, (_, index) =>
    zonedMidnight(addCalendarDays(startKey, index), timezone).getTime(),
  )
  const days = Array.from({ length: dayCount }, (_, index) => {
    const key = addCalendarDays(startKey, index)
    const value = new Date(`${key}T12:00:00Z`)
    return {
      key,
      label: formatDateTime(locale, value, { timeZone: 'UTC', weekday: 'short' }),
      detail: formatDateTime(locale, value, {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
      }),
      today: key === nowKey,
    }
  })
  const unassigned = chart.events.filter((event) => !event.roomId)
  const rows = [
    ...chart.rooms.map((room) => ({
      id: room.id,
      label: room.name,
      detail: room.roomType?.name ?? room.code,
      state: room.status,
    })),
    ...unassigned.map((event) => ({
      id: `__unassigned:${event.id}`,
      label: _('hospitality_core.screen.tapeChart.unassigned'),
      detail: event.guest,
      state: 'unassigned',
    })),
  ]
  const events = chart.events.map((event) => {
    const startsAt = new Date(event.start).getTime()
    const endsAt = new Date(event.end).getTime()
    const matchingStart = boundaries.findIndex(
      (_boundary, index) => index < dayCount && startsAt < boundaries[index + 1]!,
    )
    const eventStart = matchingStart < 0 ? dayCount - 1 : Math.max(0, matchingStart)
    const boundaryAfterEnd = boundaries.findIndex((boundary, index) => index > 0 && endsAt <= boundary)
    const eventEnd = boundaryAfterEnd < 0 ? dayCount : boundaryAfterEnd
    return {
      id: event.id,
      rowId: event.roomId ?? `__unassigned:${event.id}`,
      start: Math.min(dayCount - 1, eventStart),
      span: Math.max(1, eventEnd - eventStart),
      label: event.guest,
      detail: providerName(_, event.provider),
      state: event.state,
      tone: workflowTone(event.state),
    }
  })
  const title = _('hospitality_core.screen.tapeChart.title')
  const day = (key: string) =>
    formatDateTime(locale, new Date(`${key}T12:00:00Z`), {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  // The route has always taken a `?from=`, so the seven columns can be any week.
  // Nothing on the page said which, and there was no way to reach another one.
  const week = (offset: number) =>
    `/admin/hospitality/tape-chart?from=${encodeURIComponent(addCalendarDays(startKey, offset))}&lang=${encodeURIComponent(locale)}`
  const lastKey = addCalendarDays(startKey, dayCount - 1)

  // Only the states actually on this week's board. A key to a colour nobody can
  // see is a key to nothing.
  const shown = new Set(events.map((event) => String(event.state)))
  const legend = WORKFLOW_ORDER.filter((state) => shown.has(state))

  return shell(
    _,
    title,
    <BoardPage
      variant="operational"
      frame={frame}
      title={title}
      description={`${day(startKey)} – ${day(lastKey)}`}
      actions={
        may.book
          ? linkButton({
              label: _('hospitality_core.reservation.action.new'),
              href: `/admin/hospitality/reservations?create=1&lang=${encodeURIComponent(locale)}`,
              variant: 'primary',
            })
          : undefined
      }
      controls={
        <>
          {linkButton({
            label: _('hospitality_core.screen.tapeChart.previous'),
            href: week(-dayCount),
            variant: 'tertiary',
            size: 'compact',
          })}
          {linkButton({
            label: _('hospitality_core.screen.tapeChart.next'),
            href: week(dayCount),
            variant: 'tertiary',
            size: 'compact',
          })}
          {linkButton({
            label: _('hospitality_core.screen.tapeChart.availability'),
            href: `/admin/hospitality/inventory?lang=${encodeURIComponent(locale)}`,
            variant: 'secondary',
            size: 'compact',
          })}
        </>
      }
      body={
        <>
          <ScheduleBoard
            corner={_('hospitality_core.screen.tapeChart.corner')}
            days={days}
            rows={rows}
            events={events}
            empty={emptyState(
              _('hospitality_core.screen.tapeChart.empty'),
              _('hospitality_core.screen.tapeChart.emptyHint'),
              {
                actions: setupAction(
                  _('hospitality_core.room.action.create'),
                  '/admin/hospitality/rooms/new',
                ),
              },
            )}
          />
          {legend.length ? (
            <Section
              title={_('hospitality_core.screen.tapeChart.legend')}
              description={_('hospitality_core.screen.tapeChart.legendHint')}
              body={inline(
                legend.map((state) =>
                  badge(_(`hospitality_core.stayState.${state}`), workflowTone(state), state),
                ),
              )}
            />
          ) : null}
        </>
      }
    />,
    { ...frame, topbar: false },
  )
}
