import {
  badge,
  CardGrid,
  type Column,
  dataTable,
  dateTime,
  emptyState,
  formatDateTime,
  type Frame,
  guestName,
  inline,
  linkButton,
  Metric,
  Notice,
  person,
  Section,
  setupAction,
  stack,
  type StayRow,
  type TemplateResult,
  type Translator,
  WorkspaceScreen,
  zonedMidnight,
} from './shared.tsx'

export type FrontDeskToday = {
  /** The calendar day the screen is showing, as YYYY-MM-DD. */
  day: string
  /** Booked for today and not yet in the room. */
  arrivals: StayRow[]
  /** In the room and due out today. */
  departures: StayRow[]
  /** In the room past the hour they were due out. */
  overdue: StayRow[]
  /** Everyone in a room right now, whatever day they leave. */
  inHouse: StayRow[]
}

/**
 * What the viewer may do, not what they may see. A read-only viewer opens this
 * screen legitimately — an auditor reads the shift, a night auditor reconciles
 * it — and offering them a button for work the reservation screen will refuse
 * is the same mistake the sidebar made before it separated the two.
 */
export type FrontDeskPermissions = {
  checkIn: boolean
  checkOut: boolean
}

/**
 * The room being kept for an arriving guest.
 *
 * Until rooms could be held this column was the booked room type, because a
 * room column on somebody who has not arrived was empty by construction. Now
 * it is either the room the desk chose or a mark that nobody has.
 */
const heldRoom = (row: StayRow): string | null => {
  const held = row.assignments?.find((assignment) => assignment.state === 'held')
  return held ? (held.roomName ?? held.roomId) : null
}

const headcount = (rows: StayRow[]): number =>
  rows.reduce((total, row) => total + row.adults + row.children, 0)

/**
 * Every heading on this screen says "today". The route has always accepted a
 * `?date=`, so "today" can be a Tuesday in August, and nothing on the page
 * said so. The day is now named under the title.
 */
const dayLabel = (day: string, locale: string, timezone: string): string =>
  formatDateTime(locale, zonedMidnight(day, timezone), {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

/**
 * Where the work is done. Check-in and check-out both live on the reservation,
 * so that is where a row sends the clerk; a stay with no reservation behind it
 * can still be opened on its own.
 */
const workHref = (row: StayRow, locale: string): string =>
  row.reservationId
    ? `/admin/hospitality/reservations/${encodeURIComponent(row.reservationId)}?lang=${encodeURIComponent(locale)}`
    : `/admin/hospitality/stays/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`

const codeColumn = (_: Translator, locale: string): Column<StayRow> => ({
  key: 'code',
  label: _('hospitality_core.col.code'),
  cell: (row) =>
    linkButton({
      label: row.code,
      href: `/admin/hospitality/stays/${encodeURIComponent(row.id)}?lang=${encodeURIComponent(locale)}`,
      variant: 'tertiary',
      size: 'compact',
    }),
  kind: 'identifier',
})

const guestColumn = (_: Translator): Column<StayRow> => ({
  key: 'guest',
  label: _('hospitality_core.col.guest'),
  cell: (row) => person(guestName(row)),
  kind: 'person',
  priority: 'primary',
})

/**
 * What the clerk needs to see before the guest walks up: the room being kept
 * for them, or — when nobody has chosen one — the type that was booked, so the
 * clerk knows what to choose from.
 */
const arrivalRoomColumn = (_: Translator): Column<StayRow> => ({
  key: 'roomType',
  label: _('hospitality_core.col.room'),
  cell: (row) => {
    const held = heldRoom(row)
    if (held) return held
    return inline([
      row.roomType?.name ?? '—',
      badge(_('hospitality_core.screen.frontDesk.unassigned'), 'warning', 'unassigned'),
    ])
  },
})

const roomColumn = (_: Translator): Column<StayRow> => ({
  key: 'room',
  label: _('hospitality_core.col.room'),
  cell: (row) => row.currentRoom?.name ?? row.currentRoom?.code ?? '—',
})

const actionColumn = (_: Translator, label: string, locale: string): Column<StayRow> => ({
  key: 'action',
  label: _('hospitality_core.col.action'),
  cell: (row) => linkButton({ label, href: workHref(row, locale), variant: 'secondary', size: 'compact' }),
  align: 'end',
})

const arrivalColumns = (
  _: Translator,
  locale: string,
  timezone: string,
  permitted: boolean,
): Array<Column<StayRow>> => [
  codeColumn(_, locale),
  guestColumn(_),
  arrivalRoomColumn(_),
  {
    // Not `col.checkIn`: that reads "Nhận phòng", the same words as the button
    // beside it, and the two mean different things — an hour and a job to do.
    key: 'checkIn',
    label: _('hospitality_core.col.arrivalTime'),
    cell: (row) => dateTime(row.checkIn, locale, timezone),
    kind: 'date',
  },
  ...(permitted ? [actionColumn(_, _('hospitality_core.reservation.action.checkIn'), locale)] : []),
]

const departureColumns = (
  _: Translator,
  locale: string,
  timezone: string,
  permitted: boolean,
): Array<Column<StayRow>> => [
  codeColumn(_, locale),
  guestColumn(_),
  roomColumn(_),
  {
    key: 'checkOut',
    label: _('hospitality_core.col.departureTime'),
    cell: (row) => dateTime(row.checkOut, locale, timezone),
    kind: 'date',
  },
  ...(permitted ? [actionColumn(_, _('hospitality_core.reservation.action.checkOut'), locale)] : []),
]

/**
 * The desk's own screen: the guests moving today, the ones already late, and
 * four counts that say whether the shift is on top of it.
 *
 * It deliberately does not list every stay the property holds. A guest who
 * arrived on Monday and leaves on Friday is not the desk's work on Wednesday,
 * and putting them in the same table as today's arrivals was what made the
 * screen something to read rather than something to work from. The full list
 * is one click away under its own menu entry.
 */
export const frontDeskScreen = (
  _: Translator,
  today: FrontDeskToday,
  may: FrontDeskPermissions,
  locale: string,
  timezone: string,
  frame: Frame,
  configured = true,
): TemplateResult => {
  const nothingToday =
    !today.arrivals.length && !today.departures.length && !today.overdue.length && !today.inHouse.length

  return (
    <WorkspaceScreen
      translator={_}
      title={_('hospitality_core.screen.frontDesk.title')}
      subtitle={dayLabel(today.day, locale, timezone)}
      frame={frame}
      body={stack([
        // Three counts of movement and one of trouble. Each says how many people
        // that is, because a shift plans around guests rather than rows.
        <CardGrid
          items={[
            {
              id: 'arrivals',
              label: _('hospitality_core.metric.arrivals'),
              value: today.arrivals.length,
              detail: _('hospitality_core.screen.frontDesk.guestCount', {
                count: headcount(today.arrivals),
              }),
              tone: 'neutral' as const,
            },
            {
              id: 'departures',
              label: _('hospitality_core.metric.departures'),
              value: today.departures.length,
              detail: _('hospitality_core.screen.frontDesk.guestCount', {
                count: headcount(today.departures),
              }),
              tone: 'neutral' as const,
            },
            {
              id: 'in-house',
              label: _('hospitality_core.metric.inHouse'),
              value: today.inHouse.length,
              detail: _('hospitality_core.screen.frontDesk.guestCount', {
                count: headcount(today.inHouse),
              }),
              tone: 'neutral' as const,
            },
            {
              id: 'overdue',
              label: _('hospitality_core.metric.overdue'),
              value: today.overdue.length,
              detail: today.overdue.length
                ? _('hospitality_core.screen.frontDesk.overdueDetail')
                : _('hospitality_core.screen.frontDesk.overdueClear'),
              tone: today.overdue.length ? ('danger' as const) : ('positive' as const),
            },
          ]}
          id={(item) => item.id}
          card={(item) => (
            <Metric label={item.label} value={String(item.value)} detail={item.detail} tone={item.tone} />
          )}
        />,
        // The band says what is wrong; the table under it is the list to work
        // through, so it carries no second heading repeating the same sentence.
        today.overdue.length ? (
          <Notice
            title={_('hospitality_core.screen.frontDesk.overdue')}
            message={_('hospitality_core.screen.frontDesk.overdueHint', { count: today.overdue.length })}
            tone="warning"
          />
        ) : null,
        today.overdue.length
          ? dataTable(_, {
              columns: departureColumns(_, locale, timezone, may.checkOut),
              rows: today.overdue,
              id: (row) => row.id,
              responsive: 'stack',
            })
          : null,
        nothingToday
          ? configured
            ? emptyState(
                _('hospitality_core.screen.frontDesk.empty'),
                _('hospitality_core.screen.frontDesk.emptyHint'),
              )
            : emptyState(
                _('hospitality_core.screen.frontDesk.setup'),
                _('hospitality_core.screen.frontDesk.setupHint'),
                {
                  actions: setupAction(
                    _('hospitality_core.property.action.create'),
                    '/admin/hospitality/properties/new',
                  ),
                },
              )
          : null,
        nothingToday ? null : (
          <Section
            title={_('hospitality_core.screen.frontDesk.arrivals')}
            body={
              today.arrivals.length
                ? dataTable(_, {
                    columns: arrivalColumns(_, locale, timezone, may.checkIn),
                    rows: today.arrivals,
                    id: (row) => row.id,
                    responsive: 'stack',
                  })
                : emptyState(
                    _('hospitality_core.screen.frontDesk.arrivalsEmpty'),
                    _('hospitality_core.screen.frontDesk.arrivalsEmptyHint'),
                  )
            }
          />
        ),
        nothingToday ? null : (
          <Section
            title={_('hospitality_core.screen.frontDesk.departures')}
            body={
              today.departures.length
                ? dataTable(_, {
                    columns: departureColumns(_, locale, timezone, may.checkOut),
                    rows: today.departures,
                    id: (row) => row.id,
                    responsive: 'stack',
                  })
                : emptyState(
                    _('hospitality_core.screen.frontDesk.departuresEmpty'),
                    _('hospitality_core.screen.frontDesk.departuresEmptyHint'),
                  )
            }
          />
        ),
      ])}
    />
  )
}
