import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  migrateOne,
  missingMessages,
  registerFunctions,
  sqliteAdapter,
  translator,
} from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import { company, hospitalityCore, partner, storage } from 'ketsuite'
import { address } from 'ketsuite'
import backend from 'ketsuite/backend'

const modules = [address, partner, company, storage, backend, hospitalityCore]
const manifest = compose(modules, { headless: true })
const ACME = { company: 'acme', branches: null }
const GLOBEX = { company: 'globex', branches: null }

const call = (name: string, args: Record<string, unknown>, adapter: Adapter, scope = ACME) =>
  callFn(name, args, { adapter, manifest, scope })

async function boot(): Promise<Adapter> {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  return adapter
}

async function property(adapter: Adapter, id = 'hotel', scope = ACME) {
  return call(
    'hospitality_core.saveProperty',
    {
      id,
      code: ' hcm ',
      name: 'Ket Hotel Saigon',
      accommodationType: 'hotel',
      starRating: 4,
      city: 'Hồ Chí Minh',
      country: 'VN',
    },
    adapter,
    scope,
  )
}

test('hospitality core: public namespace is clean and the whole vertical is one module', () => {
  assert.equal(hospitalityCore.name, 'hospitality_core')
  assert.ok(manifest.models['hospitality_core.Property'])
  assert.ok(manifest.models['hospitality_core.Room'])
  assert.ok(manifest.models['hospitality_core.Amenity'])
  assert.equal(
    Object.keys(manifest.modules).some((name) => name.startsWith('vidoo_')),
    false,
  )
  assert.equal(JSON.stringify(hospitalityCore).includes('vidoo_'), false)
  assert.equal(hospitalityCore.depends.includes('storage'), true)
  assert.equal('invoiceId' in manifest.models['hospitality_core.Property']!.fields, false)
})

test('hospitality core: property defaults and uniqueness are company-scoped', async () => {
  const adapter = await boot()
  try {
    const created = await property(adapter)
    assert.equal((created.value as Row).ok, true)
    const row = (
      await adapter.all(
        'SELECT code, timezone, "defaultCheckIn", "defaultCheckOut", "companyId" FROM hospitality_core_property',
      )
    )[0]!
    assert.deepEqual(
      { ...row },
      {
        code: 'HCM',
        timezone: 'Asia/Ho_Chi_Minh',
        defaultCheckIn: '14:00',
        defaultCheckOut: '12:00',
        companyId: 'acme',
      },
    )

    const duplicate = await call(
      'hospitality_core.saveProperty',
      { id: 'second', code: 'HCM', name: 'Other', accommodationType: 'hotel' },
      adapter,
    )
    assert.equal((duplicate.value as Row).ok, false)
    assert.equal(
      ((duplicate.value as Row).errors as Row[])[0]!.messageKey,
      'hospitality_core.validation.unique',
    )

    const otherCompany = await property(adapter, 'globex-hotel', GLOBEX)
    assert.equal((otherCompany.value as Row).ok, true, 'the same code is valid for another legal entity')
    const visible = (await call('hospitality_core.listProperties', {}, adapter)).value as Row[]
    assert.deepEqual(
      visible.map((row) => row.id),
      ['hotel'],
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality core: explicit booleans override creation defaults', async () => {
  const adapter = await boot()
  try {
    const created = await call(
      'hospitality_core.saveProperty',
      {
        id: 'custom',
        code: 'CUSTOM',
        name: 'Custom Hotel',
        accommodationType: 'hotel',
        timezone: 'Pacific/Honolulu',
        enforceTimes: false,
        childrenStayFree: true,
      },
      adapter,
    )
    assert.equal((created.value as Row).ok, true)
    await call(
      'hospitality_core.saveRoomType',
      {
        id: 'published',
        propertyId: 'custom',
        code: 'PUB',
        name: 'Published room',
        published: true,
      },
      adapter,
    )
    const savedProperty = (
      await adapter.all(
        'SELECT timezone, "enforceTimes", "childrenStayFree" FROM hospitality_core_property WHERE id = ?',
        ['custom'],
      )
    )[0]!
    const savedType = (
      await adapter.all('SELECT published FROM hospitality_core_room_type WHERE id = ?', ['published'])
    )[0]!
    assert.deepEqual(
      { ...savedProperty },
      { timezone: 'Pacific/Honolulu', enforceTimes: 0, childrenStayFree: 1 },
    )
    assert.equal(savedType.published, 1)
  } finally {
    await adapter.close()
  }
})

test('hospitality core: property location uses the active address catalog', async () => {
  const adapter = await boot()
  try {
    await call('address.installCatalog', { countryCode: 'VN' }, adapter)
    const invalidCountry = await call(
      'hospitality_core.saveProperty',
      {
        id: 'invalid-country',
        code: 'INVALID',
        name: 'Invalid country',
        accommodationType: 'hotel',
        countryCode: 'France',
      },
      adapter,
    )
    assert.equal((invalidCountry.value as Row).ok, false)
    assert.equal(((invalidCountry.value as Row).errors as Row[])[0]?.code, 'address.error.countryCode')

    const saved = await call(
      'hospitality_core.saveProperty',
      {
        id: 'hanoi-hotel',
        code: 'HAN',
        name: 'Ket Hotel Hà Nội',
        accommodationType: 'hotel',
        street1: '12 Nguyễn Huệ',
        countryId: 'VN',
        divisionId: 'VN:2025-07-01:10101003',
      },
      adapter,
    )
    assert.equal((saved.value as Row).ok, true)
    const detail = await call('hospitality_core.getProperty', { id: 'hanoi-hotel' }, adapter)
    assert.equal((detail.value as Row).addressLine, '12 Nguyễn Huệ, Phường Ba Đình, Hà Nội, Việt Nam')
    assert.equal((detail.value as Row).countryId, 'VN')
  } finally {
    await adapter.close()
  }
})

test('hospitality core: building, floor, room type and room cannot cross properties', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await call(
      'hospitality_core.saveProperty',
      { id: 'beach', code: 'PQC', name: 'Ket Beach', accommodationType: 'resort' },
      adapter,
    )
    await call(
      'hospitality_core.saveBuilding',
      { id: 'tower-a', propertyId: 'hotel', code: 'A', name: 'Tower A' },
      adapter,
    )
    const wrongFloor = await call(
      'hospitality_core.saveFloor',
      { id: 'f1', propertyId: 'beach', buildingId: 'tower-a', code: '01', name: 'Floor 1' },
      adapter,
    )
    assert.equal((wrongFloor.value as Row).ok, false)
    assert.equal(((wrongFloor.value as Row).errors as Row[])[0]!.code, 'property_mismatch')

    await call(
      'hospitality_core.saveFloor',
      { id: 'f1', propertyId: 'hotel', buildingId: 'tower-a', code: '01', name: 'Floor 1' },
      adapter,
    )
    await call(
      'hospitality_core.saveRoomType',
      {
        id: 'deluxe',
        propertyId: 'hotel',
        code: 'DLX',
        name: 'Deluxe',
        defaultCapacity: 2,
        baseRate: '1500000',
      },
      adapter,
    )
    const wrongRoom = await call(
      'hospitality_core.saveRoom',
      { id: '101', propertyId: 'beach', roomTypeId: 'deluxe', code: '101', name: '101' },
      adapter,
    )
    assert.equal((wrongRoom.value as Row).ok, false)
    assert.equal(((wrongRoom.value as Row).errors as Row[])[0]!.field, 'roomTypeId')

    const room = await call(
      'hospitality_core.saveRoom',
      {
        id: '101',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        buildingId: 'tower-a',
        floorId: 'f1',
        code: '101',
        name: '101',
      },
      adapter,
    )
    assert.equal((room.value as Row).ok, true)
    await call('hospitality_core.setRoomStatus', { id: '101', status: 'dirty' }, adapter)
    const rooms = (await call('hospitality_core.listRooms', { propertyId: 'hotel' }, adapter)).value as Row[]
    assert.equal(rooms[0]!.status, 'dirty')
    assert.equal((rooms[0]!.roomType as Row).name, 'Deluxe')
  } finally {
    await adapter.close()
  }
})

test('hospitality core: amenities preserve property and room scopes', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await call(
      'hospitality_core.saveRoomType',
      { id: 'standard', propertyId: 'hotel', code: 'STD', name: 'Standard' },
      adapter,
    )
    await call('hospitality_core.saveAmenityCategory', { id: 'access', name: 'Accessibility' }, adapter)
    await call(
      'hospitality_core.saveAmenity',
      { id: 'pool', categoryId: 'access', code: 'POOL', name: 'Pool', scope: 'property' },
      adapter,
    )
    const invalid = await call(
      'hospitality_core.assignAmenity',
      { id: 'bad', target: 'room_type', targetId: 'standard', amenityId: 'pool' },
      adapter,
    )
    assert.equal((invalid.value as Row).ok, false)
    assert.equal(((invalid.value as Row).errors as Row[])[0]!.code, 'amenity_scope_mismatch')

    const first = await call(
      'hospitality_core.assignAmenity',
      { id: 'hotel-pool', target: 'property', targetId: 'hotel', amenityId: 'pool' },
      adapter,
    )
    const retry = await call(
      'hospitality_core.assignAmenity',
      { id: 'retry-id', target: 'property', targetId: 'hotel', amenityId: 'pool' },
      adapter,
    )
    assert.equal((first.value as Row).id, 'hotel-pool')
    assert.equal((retry.value as Row).id, 'hotel-pool', 'an idempotent retry returns the existing assignment')
  } finally {
    await adapter.close()
  }
})

test('hospitality core: Vietnamese and English cover every UI and validation key', () => {
  assert.deepEqual(missingMessages(manifest, ['vi', 'en']), {})
  const vi = translator(manifest, 'vi')
  const en = translator(manifest, 'en')
  for (const key of [
    'hospitality_core.screen.rooms.title',
    'hospitality_core.roomStatus.out_of_order',
    'hospitality_core.validation.property_mismatch',
    'hospitality_core.policy.non_refundable',
  ]) {
    assert.equal(vi.has(key), true, `Vietnamese should own ${key}`)
    assert.equal(en.has(key), true, `English should own ${key}`)
    assert.notEqual(vi(key), key)
    assert.notEqual(en(key), key)
  }
  assert.equal(vi('hospitality_core.value.hours', { count: 24 }), '24 giờ')
  assert.equal(en('hospitality_core.value.hours', { count: 24 }), '24 hours')
})
