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
