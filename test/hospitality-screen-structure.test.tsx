import assert from 'node:assert/strict'
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
  assert.equal(Object.keys(coreScreens).filter((name) => name.endsWith('Screen')).length, 31)
  assert.equal(Object.keys(billingScreens).filter((name) => name.endsWith('Screen')).length, 2)
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
  assert.doesNotMatch(html, /hospitality_billing\.action\.invoice(?:All)?</)
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
        adjustDeparture: false,
        checkOut: false,
        cancel: false,
        noShow: false,
      },
    ),
  )
  assert.match(reservation, /hospitality_core\.reservation\.action\.amend</)
  assert.doesNotMatch(reservation, /hospitality_core\.reservation\.action\.(?:cancel|checkIn|noShow)</)
})
