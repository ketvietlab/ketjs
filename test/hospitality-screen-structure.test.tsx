import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import * as billingScreens from '../packages/ketsuite/src/modules/hospitality_billing/screens/index.ts'
import { ListScreenFrame as BillingListFrame } from '../packages/ketsuite/src/modules/hospitality_billing/screens/page-frame.tsx'
import * as coreScreens from '../packages/ketsuite/src/modules/hospitality_core/screens/index.ts'
import { propertiesScreen } from '../packages/ketsuite/src/modules/hospitality_core/screens/properties.tsx'
import { roomTypesScreen } from '../packages/ketsuite/src/modules/hospitality_core/screens/room-types.tsx'
import { roomsScreen } from '../packages/ketsuite/src/modules/hospitality_core/screens/rooms.tsx'
import {
  FormScreenFrame as CoreFormFrame,
  ListScreenFrame as CoreListFrame,
} from '../packages/ketsuite/src/modules/hospitality_core/screens/page-frame.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('Hospitality exports one focused module for every routed renderer', () => {
  const routedScreens = (screens: Record<string, unknown>) =>
    Object.keys(screens).filter((name) => /^[a-z].*Screen$/.test(name))
  assert.equal(routedScreens(coreScreens).length, 31)
  assert.equal(routedScreens(billingScreens).length, 2)
})

test('Hospitality collection and form adapters use public page contracts', () => {
  const props = { translator: translate, title: 'Hospitality', frame: {}, body: <p>Body</p> }
  assert.match(renderToString(CoreListFrame(props)), /data-ui="list-page"/)
  assert.match(renderToString(CoreFormFrame(props)), /data-ui="form-page"/)
  assert.match(renderToString(BillingListFrame(props)), /data-ui="list-page"/)
})

test('Hospitality billing blockers link directly to their repair surfaces and suppress invoice actions', () => {
  const html = renderToString(
    billingScreens.billingScreen(
      translate,
      [
        {
          folioId: 'folio-1',
          folioCode: 'FOL-001',
          guest: null,
          closedAt: null,
          folioState: 'open',
          folioTotal: '0',
          chargeCount: 0,
          missingRules: [],
          blockers: [
            {
              code: 'folio_open',
              repairHref: '/admin/hospitality/stays/stay-1',
            },
            {
              code: 'folio_without_charges',
              repairHref: '/admin/hospitality/folios/folio-1',
            },
            {
              code: 'journal_missing',
              repairHref: '/admin/accounting/journals/new',
            },
            {
              code: 'folio_without_guest',
              repairHref: '/admin/hospitality/reservations/reservation-1',
            },
          ],
          moveId: null,
          moveName: null,
          amountTotal: null,
          amountDue: null,
          paymentState: null,
        },
      ],
      {},
    ),
  )

  assert.match(html, /hospitality_billing\.blocker\.folio_open/)
  assert.match(html, /href="\/admin\/hospitality\/stays\/stay-1"/)
  assert.match(html, /href="\/admin\/hospitality\/folios\/folio-1"/)
  assert.match(html, /href="\/admin\/accounting\/journals\/new"/)
  assert.match(html, /href="\/admin\/hospitality\/reservations\/reservation-1"/)
  assert.match(html, /data-col="folioCode"[\s\S]*data-col="state"[\s\S]*data-col="guest"/)
  assert.doesNotMatch(html, /hospitality_billing\.action\.invoice(?:All)?</)
})

test('Hospitality services show one useful prerequisite state instead of duplicate empty cards', () => {
  const html = renderToString(
    coreScreens.servicesScreen(
      translate,
      {
        properties: [{ id: 'hotel', name: 'Hotel' }],
        propertyId: 'hotel',
        products: [],
        targets: [],
        propertyCharges: [],
        extraLines: [],
        charges: [],
        ids: { propertyCharge: 'fee-1', extraLine: 'extra-1', requestKey: 'request-1' },
      },
      'vi',
      'Asia/Ho_Chi_Minh',
      {},
    ),
  )

  assert.match(html, /hospitality_core\.services\.empty\.catalogue/)
  assert.doesNotMatch(html, /hospitality_core\.services\.empty\.intentions/)
})

test('Hospitality manual folio form cannot bypass stock fulfilment for minibar', () => {
  const html = renderToString(
    coreScreens.folioDetailScreen(
      translate,
      {
        id: 'folio-1',
        code: 'FOL-001',
        propertyId: 'hotel',
        partnerId: 'guest',
        state: 'open',
        amountTotal: '0',
        version: 0,
        openedAt: '2026-09-02T00:00:00.000Z',
        partner: { name: 'Synthetic Guest' },
        stays: [],
        charges: [],
      },
      'vi',
      'Asia/Ho_Chi_Minh',
      {},
      'charge-1',
    ),
  )

  assert.match(html, /value="spa"/)
  assert.doesNotMatch(html, /value="minibar"/)
})

test('Hospitality primary create actions stay in the ListPage title row', () => {
  const properties = renderToString(
    propertiesScreen(translate, [], { rooms: 0, available: 0, attention: 0 }, 'vi', {}),
  )
  const property = {
    id: 'hotel',
    code: 'HOTEL',
    name: 'Hotel',
    accommodationType: 'hotel',
    starRating: 4,
    active: true,
    rooms: 1,
    availableRooms: 1,
    attentionRooms: 0,
  }
  const rooms = renderToString(
    roomsScreen(
      translate,
      {
        rows: [],
        properties: [property],
        propertyId: 'hotel',
        roomTypes: [
          {
            id: 'type',
            code: 'TYPE',
            name: 'Type',
            defaultCapacity: 2,
            baseRate: 100,
            published: true,
            active: true,
          },
        ],
        buildings: [],
        floors: [],
      },
      'vi',
      {},
    ),
  )
  const roomTypes = renderToString(roomTypesScreen(translate, [], [property], 'hotel', 'vi', {}))

  assert.match(
    properties,
    /data-ui="list-page-title-row"[\s\S]*?data-ui="list-page-actions"[\s\S]*?href="\/admin\/hospitality\/properties\/new\?lang=vi"/,
  )
  assert.match(
    rooms,
    /data-ui="list-page-actions"[\s\S]*?href="\/admin\/hospitality\/rooms\/new\?lang=vi&amp;property=hotel"/,
  )
  assert.match(
    roomTypes,
    /data-ui="list-page-actions"[\s\S]*?href="\/admin\/hospitality\/room-types\/new\?lang=vi&amp;property=hotel"/,
  )
  assert.doesNotMatch(
    properties,
    /data-ui="list-page-body"[\s\S]*?href="\/admin\/hospitality\/properties\/new\?lang=vi"/,
  )
})

test('Hospitality split collections keep context mounted under URL-owned create modals', () => {
  const modal = {
    open: true,
    createHref: '/collection?lang=vi&create=1',
    closeHref: '/collection?lang=vi',
    action: '/collection?lang=vi&create=1',
  }
  const reservationData = {
    rows: [],
    properties: [{ id: 'hotel', name: 'Hotel' }],
    roomTypes: [{ id: 'deluxe', name: 'Deluxe' }],
    partners: [{ id: 'guest', name: 'Guest' }],
    values: {
      id: 'reservation',
      code: 'RES-001',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      partnerId: 'guest',
      bookingType: 'nightly',
      checkIn: '2026-08-27T14:00',
      checkOut: '2026-08-28T12:00',
      adults: 1,
      children: 0,
      rate: '',
    },
  }
  const room = {
    id: '101',
    code: '101',
    name: 'Room 101',
    status: 'available',
  }
  const collectionPairs = [
    [
      coreScreens.reservationsScreen(translate, reservationData, 'vi', 'Asia/Ho_Chi_Minh', {}),
      coreScreens.reservationsScreen(translate, reservationData, 'vi', 'Asia/Ho_Chi_Minh', {}, null, modal),
      'hospitality-reservation-create',
    ],
    [
      coreScreens.ratePlansScreen(translate, [], [], [{ id: 'deluxe', name: 'Deluxe' }], 'hotel', {}),
      coreScreens.ratePlansScreen(
        translate,
        [],
        [],
        [{ id: 'deluxe', name: 'Deluxe' }],
        'hotel',
        {},
        null,
        modal,
      ),
      'hospitality-rate-plan-create',
    ],
    [
      coreScreens.cleaningTasksScreen(
        translate,
        {
          rows: [],
          properties: [],
          propertyId: 'hotel',
          state: 'all',
          rooms: [room] as never,
          summary: { todo: 0, inProgress: 0, done: 0, cancelled: 0 },
          id: 'task',
          code: 'HK-001',
        },
        'vi',
        'Asia/Ho_Chi_Minh',
        {},
      ),
      coreScreens.cleaningTasksScreen(
        translate,
        {
          rows: [],
          properties: [],
          propertyId: 'hotel',
          state: 'all',
          rooms: [room] as never,
          summary: { todo: 0, inProgress: 0, done: 0, cancelled: 0 },
          id: 'task',
          code: 'HK-001',
        },
        'vi',
        'Asia/Ho_Chi_Minh',
        {},
        null,
        modal,
      ),
      'hospitality-cleaning-task-create',
    ],
    [
      coreScreens.amenitiesScreen(translate, [], [], {}),
      coreScreens.amenitiesScreen(translate, [], [], {}, null, modal),
      'hospitality-amenity-create',
    ],
    [
      coreScreens.policiesScreen(translate, [], {}),
      coreScreens.policiesScreen(translate, [], {}, null, modal),
      'hospitality-policy-create',
    ],
  ] as const

  for (const [closed, open, id] of collectionPairs) {
    const closedHtml = renderToString(closed)
    const openHtml = renderToString(open)
    assert.match(closedHtml, /data-ui="list-page"/)
    assert.match(closedHtml, /href="[^"]*create=1"/)
    assert.doesNotMatch(closedHtml, /data-route-modal="true"/)
    assert.match(openHtml, /data-ui="list-page"/)
    assert.match(openHtml, /data-route-modal="true"/)
    assert.match(openHtml, new RegExp(`aria-labelledby="${id}-title"`))
    assert.match(openHtml, /href="\/collection\?lang=vi"/)
  }

  const billingModal = {
    ...modal,
    rowHref: (row: { chargeType: string }) => `/collection?lang=vi&create=1&rule=${row.chargeType}`,
  }
  const billingClosed = renderToString(
    billingScreens.chargeRulesScreen(translate, [], [], [], [], {}, null, {
      ...billingModal,
      open: false,
    }),
  )
  const billingOpen = renderToString(
    billingScreens.chargeRulesScreen(translate, [], [], [], [], {}, null, billingModal),
  )
  assert.match(billingClosed, /href="\/collection\?lang=vi&amp;create=1"/)
  assert.doesNotMatch(billingClosed, /data-route-modal="true"/)
  assert.match(billingOpen, /data-route-modal="true"/)
  assert.match(billingOpen, /aria-labelledby="hospitality-charge-rule-save-title"/)
})

test('Hospitality focused roles render only actions present in their exact allow-list', () => {
  const housekeepingQueue = renderToString(
    coreScreens.cleaningTasksScreen(
      translate,
      {
        rows: [],
        properties: [],
        propertyId: 'hotel',
        state: 'all',
        rooms: [{ id: '101', code: '101', name: 'Room 101', status: 'available' }] as never,
        summary: { todo: 0, inProgress: 0, done: 0, cancelled: 0 },
        id: 'task',
        code: 'HK-001',
      },
      'vi',
      'Asia/Ho_Chi_Minh',
      {},
      null,
      undefined,
      false,
    ),
  )
  assert.doesNotMatch(housekeepingQueue, /href="[^"]*create=1"/)

  const housekeeping = renderToString(
    coreScreens.cleaningTaskDetailScreen(
      translate,
      {
        id: 'task-1',
        code: 'HK-001',
        propertyId: 'hotel',
        roomId: '101',
        taskType: 'daily_clean',
        priority: 'normal',
        state: 'todo',
        requestedAt: '2026-09-03T00:00:00.000Z',
        room: { id: '101', code: '101', name: 'Room 101' },
      } as never,
      'vi',
      'Asia/Ho_Chi_Minh',
      {},
      null,
      [],
      { start: true, complete: true, cancel: false },
    ),
  )
  assert.match(housekeeping, /hospitality_core\.housekeeping\.action\.start</)
  assert.doesNotMatch(housekeeping, /hospitality_core\.housekeeping\.action\.cancel</)

  const reservation = renderToString(
    coreScreens.reservationDetailScreen(
      translate,
      {
        id: 'reservation-1',
        code: 'RES-001',
        propertyId: 'hotel',
        partnerId: 'guest',
        roomTypeId: 'deluxe',
        provider: 'direct',
        state: 'confirmed',
        checkIn: '2026-09-03T07:00:00.000Z',
        checkOut: '2026-09-04T05:00:00.000Z',
        adults: 1,
        children: 0,
        rate: 100,
      } as never,
      [],
      [{ id: 'deluxe', name: 'Deluxe' }],
      [{ id: 'guest', name: 'Guest' }],
      {
        partnerId: 'guest',
        roomTypeId: 'deluxe',
        checkIn: '2026-09-03T14:00',
        checkOut: '2026-09-04T12:00',
        adults: 1,
        children: 0,
        rate: '100',
      },
      '2026-09-04T12:00',
      'vi',
      'Asia/Ho_Chi_Minh',
      {},
      null,
      [],
      {
        amend: true,
        checkIn: false,
        holdRoom: false,
        adjustDeparture: false,
        checkOut: false,
        cancel: false,
        noShow: false,
      },
    ),
  )
  assert.match(reservation, /hospitality_core\.reservation\.action\.amend</)
  assert.doesNotMatch(
    reservation,
    /hospitality_core\.reservation\.action\.(?:cancel|checkIn|noShow|holdRoom)</,
  )
})

test('the front desk offers the shift its work and a read-only viewer only the record', () => {
  const stay = (id: string, state: string, checkOut: string) => ({
    id,
    code: id.toUpperCase(),
    folioId: `${id}:folio`,
    propertyId: 'hotel',
    reservationId: `${id}:reservation`,
    partnerId: 'guest',
    roomTypeId: 'deluxe',
    bookingType: 'nightly',
    checkIn: '2026-09-05T07:00:00.000Z',
    checkOut,
    adults: 2,
    children: 1,
    billingMode: 'upfront',
    rate: '100',
    state,
    partner: { name: 'Nguyễn An' },
    roomType: { name: 'Deluxe' },
  })
  const today = {
    day: '2026-09-05',
    arrivals: [stay('arriving', 'draft', '2026-09-07T05:00:00.000Z')],
    departures: [stay('leaving', 'checked_in', '2026-09-05T05:00:00.000Z')],
    overdue: [],
    inHouse: [stay('leaving', 'checked_in', '2026-09-05T05:00:00.000Z')],
  }
  const render = (may: { checkIn: boolean; checkOut: boolean }) =>
    renderToString(coreScreens.frontDeskScreen(translate, today, may, 'vi', 'Asia/Ho_Chi_Minh', {} as never))

  const desk = render({ checkIn: true, checkOut: true })
  assert.match(desk, /hospitality_core\.reservation\.action\.checkIn/)
  assert.match(desk, /hospitality_core\.reservation\.action\.checkOut/)
  assert.match(desk, /hospitality_core\.col\.action/)
  // The action is a link to where the work is done, not a form on this screen.
  assert.match(desk, /\/admin\/hospitality\/reservations\/arriving%3Areservation/)

  const auditor = render({ checkIn: false, checkOut: false })
  assert.doesNotMatch(auditor, /hospitality_core\.reservation\.action\.checkIn/)
  assert.doesNotMatch(auditor, /hospitality_core\.reservation\.action\.checkOut/)
  assert.doesNotMatch(auditor, /hospitality_core\.col\.action/)
  // They still read the shift: both queues, both records.
  assert.match(auditor, /hospitality_core\.screen\.frontDesk\.arrivals/)
  assert.match(auditor, /hospitality_core\.screen\.frontDesk\.departures/)
  assert.match(auditor, /ARRIVING/)
  assert.match(auditor, /LEAVING/)

  // One permission at a time: a viewer who may check a guest out but not in
  // sees exactly one of the two columns.
  const departuresOnly = render({ checkIn: false, checkOut: true })
  assert.doesNotMatch(departuresOnly, /hospitality_core\.reservation\.action\.checkIn/)
  assert.match(departuresOnly, /hospitality_core\.reservation\.action\.checkOut/)
})

test('the tape chart says which week it is showing and what its colours mean', () => {
  const stay = (id: string, roomId: string | null, state: string, start: string, end: string) => ({
    id,
    stayId: `${id}:stay`,
    roomId,
    guest: 'Nguyễn An',
    provider: 'direct',
    state,
    start,
    end,
  })
  const chart = {
    timezone: 'UTC',
    from: '2026-09-05T00:00:00.000Z',
    to: '2026-09-12T00:00:00.000Z',
    rooms: [
      {
        id: 'r301',
        code: '301',
        name: 'Phòng 301',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        status: 'available',
        capacity: 2,
        active: true,
        roomType: { name: 'Deluxe' },
      },
    ],
    events: [
      stay('in-house', 'r301', 'checked_in', '2026-09-05T07:00:00.000Z', '2026-09-07T05:00:00.000Z'),
      stay('waiting', null, 'draft', '2026-09-08T07:00:00.000Z', '2026-09-09T05:00:00.000Z'),
    ],
  }
  const render = (may: { book: boolean }) =>
    renderToString(coreScreens.tapeChartScreen(translate, chart as never, may, 'vi', {} as never))

  const board = render({ book: true })
  // The week, not just seven unlabelled columns.
  assert.match(board, /05\/09\/2026 – 11\/09\/2026/)
  // And a way to reach another one, which the route accepted all along.
  assert.match(board, /from=2026-08-29/)
  assert.match(board, /from=2026-09-12/)
  assert.match(board, /hospitality_core\.screen\.tapeChart\.availability/)
  assert.match(board, /reservations\?create=1/)
  assert.match(board, /hospitality_core\.reservation\.action\.new/)
  // A key to exactly the two states on this board, and to nothing else.
  assert.match(board, /hospitality_core\.stayState\.draft/)
  assert.match(board, /hospitality_core\.stayState\.checked_in/)
  assert.doesNotMatch(board, /hospitality_core\.stayState\.cancelled/)
  assert.doesNotMatch(board, /hospitality_core\.stayState\.no_show/)
  // The board looks draggable and is not; the key says so.
  assert.match(board, /hospitality_core\.screen\.tapeChart\.legendHint/)

  // Looking at the week is not permission to book into it.
  const readOnly = render({ book: false })
  assert.doesNotMatch(readOnly, /reservations\?create=1/)
  assert.match(readOnly, /05\/09\/2026 – 11\/09\/2026/)
  assert.match(readOnly, /hospitality_core\.stayState\.checked_in/)
})

test('a reservation row says how long the stay is, in the unit it is sold by', () => {
  const row = (bookingType: string, checkIn: string, checkOut: string) => ({
    id: 'dp-1',
    code: 'DP-1',
    partnerId: 'guest',
    provider: 'direct',
    roomTypeId: 'deluxe',
    bookingType,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    amountTotal: '100',
    state: 'confirmed',
  })
  const length = (r: ReturnType<typeof row>) => coreScreens.stayLength(translate, r, 'vi', 'Asia/Ho_Chi_Minh')

  // Two nights, and it says two nights rather than making a reader subtract.
  assert.match(
    length(row('nightly', '2026-09-04T07:00:00.000Z', '2026-09-06T05:00:00.000Z')),
    /hospitality_core\.duration\.nightly/,
  )
  // A room sold by the hour is not measured in nights.
  assert.match(
    length(row('hourly', '2026-09-04T07:00:00.000Z', '2026-09-04T10:00:00.000Z')),
    /hospitality_core\.duration\.hourly/,
  )
  assert.doesNotMatch(
    length(row('hourly', '2026-09-04T07:00:00.000Z', '2026-09-04T10:00:00.000Z')),
    /hospitality_core\.duration\.nightly/,
  )
  // A booking type with no unit, or dates that make no span, says the dates and
  // claims nothing else.
  assert.doesNotMatch(
    length(row('bespoke', '2026-09-04T07:00:00.000Z', '2026-09-06T05:00:00.000Z')),
    /hospitality_core\.duration\./,
  )
  assert.doesNotMatch(
    length(row('nightly', '2026-09-06T05:00:00.000Z', '2026-09-04T07:00:00.000Z')),
    /hospitality_core\.duration\./,
  )

  // A nightly stay always starts and ends at the property's own hours, so the
  // clock is the same on every row; only the hourly case prints it.
  assert.doesNotMatch(
    length(row('nightly', '2026-09-04T07:00:00.000Z', '2026-09-06T05:00:00.000Z')),
    /\d\d:\d\d/,
  )
  assert.match(length(row('hourly', '2026-09-04T07:00:00.000Z', '2026-09-04T10:00:00.000Z')), /\d\d:\d\d/)

  // The list leads with what a reader scans for, and has one date column.
  const columns = coreScreens.reservationColumns(translate, 'vi', 'Asia/Ho_Chi_Minh').map((c) => c.key)
  assert.deepEqual(columns, ['code', 'guest', 'status', 'provider', 'roomType', 'stay', 'amount'])
})

test('the stay list leads with state and marks a guest still in the room past their hour', () => {
  const hour = 3_600_000
  const stay = (state: string, checkOut: number) => ({
    id: 'st-1',
    code: 'ST-1',
    folioId: 'f-1',
    propertyId: 'hotel',
    partnerId: 'guest',
    roomTypeId: 'deluxe',
    bookingType: 'nightly',
    checkIn: new Date(Date.now() - 48 * hour).toISOString(),
    checkOut: new Date(Date.now() + checkOut).toISOString(),
    adults: 2,
    children: 1,
    billingMode: 'upfront',
    rate: '100',
    state,
  })

  // Still in the room, two hours past the hour they were due out.
  assert.equal(coreScreens.overdue(stay('checked_in', -2 * hour)), true)
  // Due out later today: nothing to say yet.
  assert.equal(coreScreens.overdue(stay('checked_in', 2 * hour)), false)
  // Already gone. The dates are in the past; the guest is not.
  assert.equal(coreScreens.overdue(stay('checked_out', -2 * hour)), false)
  // Never arrived, and the same is true of a cancellation.
  assert.equal(coreScreens.overdue(stay('no_show', -2 * hour)), false)
  assert.equal(coreScreens.overdue(stay('cancelled', -2 * hour)), false)

  const columns = coreScreens.stayColumns(translate, 'vi', 'Asia/Ho_Chi_Minh')
  assert.deepEqual(
    columns.map((c) => c.key),
    ['code', 'guest', 'status', 'room', 'stay', 'guests'],
  )
  // A row with nothing to flag renders the dates as plain text; only the flagged
  // one becomes markup, which is the difference the badge makes.
  const dates = columns.find((c) => c.key === 'stay')!
  const quiet = dates.cell(stay('checked_in', 2 * hour))
  assert.equal(typeof quiet, 'string')
  assert.match(quiet as string, /hospitality_core\.duration\.nightly/)
  assert.match(
    renderToString(dates.cell(stay('checked_in', -2 * hour)) as never),
    /hospitality_core\.stayState\.overdue/,
  )
})

test('every Hospitality metric card asks for a tone the design system knows', () => {
  const TONES = new Set(['neutral', 'info', 'positive', 'warning', 'danger'])
  // Resolved from the repository root, not from this file: the test runs
  // compiled, out of `.build/test`, where a relative path lands in the build
  // output — a directory with no `.tsx` in it, so the check would pass by
  // reading nothing. The count below is what makes that failure loud.
  const dir = `${process.cwd()}/packages/ketsuite/src/modules/hospitality_core/screens`
  const screens = readdirSync(dir).filter((file) => file.endsWith('.tsx'))
  assert.ok(screens.length > 20, `expected the Hospitality screens, found ${screens.length} files`)
  const offenders: string[] = []
  for (const file of screens) {
    const source = readFileSync(`${dir}/${file}`, 'utf8')
    // `tone` is deliberately open in the KetSuite wrapper so a board can colour
    // itself by a domain status, and the stylesheet draws a dot only for the
    // five it knows. That is exactly why a wrong value is silent: the card
    // simply stops saying anything. Passing a card's own id was the way this
    // went unnoticed on nine screens at once.
    for (const [, value] of source.matchAll(/tone=\{(?:'|")([a-z-]+)(?:'|")\}/g))
      if (!TONES.has(value)) offenders.push(`${file}: tone="${value}"`)
    for (const [, expression] of source.matchAll(/tone=\{(item\.[A-Za-z]+)\}/g))
      if (expression !== 'item.tone') offenders.push(`${file}: tone={${expression}}`)
  }
  assert.deepEqual(offenders, [], 'a metric tone must be a design-system tone, not an id')
})
