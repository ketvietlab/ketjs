import {
  addCalendarDays,
  dateKeyIn,
  emptyState,
  type Frame,
  Framed,
  providerName,
  ScheduleBoard,
  setupAction,
  type TapeChart,
  type TemplateResult,
  type Translator,
  workflowTone,
  zonedMidnight,
} from './shared.tsx'

export const tapeChartScreen = (
  _: Translator,
  chart: TapeChart,
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
      label: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(value),
      detail: new Intl.DateTimeFormat(locale, {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
      }).format(value),
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
  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.tapeChart.title')}
      frame={frame}
      body={
        <ScheduleBoard
          corner={_('hospitality_core.screen.tapeChart.corner')}
          days={days}
          rows={rows}
          events={events}
          empty={emptyState(
            _('hospitality_core.screen.tapeChart.empty'),
            _('hospitality_core.screen.tapeChart.emptyHint'),
            {
              actions: setupAction(_('hospitality_core.room.action.create'), '/admin/hospitality/rooms/new'),
            },
          )}
        />
      }
    />
  )
}
