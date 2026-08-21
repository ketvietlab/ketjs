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
import { company, hospitalityCore, partner, product, storage, uom } from 'ketsuite'
import { address } from 'ketsuite'
import backend from 'ketsuite/backend'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
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
  assert.ok(manifest.models['hospitality_core.ContentImage'])
  assert.ok(manifest.models['hospitality_core.ContentChange'])
  assert.ok(manifest.models['hospitality_core.PropertyCharge'])
  assert.ok(manifest.models['hospitality_core.ExtraLine'])
  assert.equal(
    Object.keys(manifest.modules).some((name) => name.startsWith('vidoo_')),
    false,
  )
  assert.equal(JSON.stringify(hospitalityCore).includes('vidoo_'), false)
  assert.equal(hospitalityCore.depends.includes('storage'), true)
  assert.equal(hospitalityCore.depends.includes('product'), true)
  assert.equal(hospitalityCore.depends.includes('uom'), true)
  assert.equal('invoiceId' in manifest.models['hospitality_core.Property']!.fields, false)
  assert.equal('invoiceId' in manifest.models['hospitality_core.Charge']!.fields, false)
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

test('hospitality core: property settings validate timezone and default cancellation policy', async () => {
  const adapter = await boot()
  try {
    const invalidTimezone = await call(
      'hospitality_core.saveProperty',
      {
        id: 'invalid-timezone',
        code: 'TZ-BAD',
        name: 'Invalid timezone',
        accommodationType: 'hotel',
        timezone: 'Asia/Nowhere',
      },
      adapter,
    )
    assert.equal((invalidTimezone.value as Row).ok, false)
    assert.equal(((invalidTimezone.value as Row).errors as Row[])[0]?.code, 'timezone')

    const missingPolicy = await call(
      'hospitality_core.saveProperty',
      {
        id: 'missing-policy',
        code: 'POL-BAD',
        name: 'Missing policy',
        accommodationType: 'hotel',
        defaultCancellationPolicyId: 'not-here',
      },
      adapter,
    )
    assert.equal((missingPolicy.value as Row).ok, false)
    assert.equal(((missingPolicy.value as Row).errors as Row[])[0]?.code, 'policy_missing')

    await call(
      'hospitality_core.saveCancellationPolicy',
      { id: 'flex', code: 'FLEX', name: 'Flexible', type: 'flexible' },
      adapter,
    )
    const saved = await call(
      'hospitality_core.saveProperty',
      {
        id: 'policy-hotel',
        code: 'POLICY',
        name: 'Policy Hotel',
        accommodationType: 'hotel',
        timezone: 'Pacific/Honolulu',
        longStayBillOnCheckIn: false,
        defaultCancellationPolicyId: 'flex',
      },
      adapter,
    )
    assert.equal((saved.value as Row).ok, true)
    const detail = (await call('hospitality_core.getProperty', { id: 'policy-hotel' }, adapter)).value as Row
    assert.equal(detail.longStayBillOnCheckIn, false)
    assert.equal((detail.defaultCancellationPolicy as Row).name, 'Flexible')
  } finally {
    await adapter.close()
  }
})

test('hospitality core: room type settings are validated, preloaded and cannot move properties', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await call(
      'hospitality_core.saveProperty',
      { id: 'other-hotel', code: 'OTHER', name: 'Other Hotel', accommodationType: 'hotel' },
      adapter,
    )
    await call(
      'hospitality_core.saveCancellationPolicy',
      { id: 'flex', code: 'FLEX', name: 'Flexible', type: 'flexible' },
      adapter,
    )
    const saved = await call(
      'hospitality_core.saveRoomType',
      {
        id: 'deluxe',
        propertyId: 'hotel',
        code: ' dlx ',
        name: 'Deluxe river room',
        publicName: 'Deluxe River View',
        defaultCapacity: 3,
        maxAdults: 2,
        maxChildren: 1,
        maxInfants: 1,
        maxExtraBeds: 1,
        sizeSqm: '31.5',
        viewType: 'river',
        sharedBathroom: false,
        baseRate: '1850000.50',
        color: '#0f766e',
        cancellationPolicyId: 'flex',
        published: true,
      },
      adapter,
    )
    assert.equal((saved.value as Row).ok, true)
    await call(
      'hospitality_core.saveRoom',
      {
        id: 'room-301',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        code: '301',
        name: 'Room 301',
      },
      adapter,
    )

    const detail = (await call('hospitality_core.getRoomType', { id: 'deluxe' }, adapter)).value as Row
    assert.equal(detail.code, 'DLX')
    assert.equal(detail.viewType, 'river')
    assert.equal(detail.color, '#0f766e')
    assert.equal((detail.property as Row).name, 'Ket Hotel Saigon')
    assert.equal((detail.cancellationPolicy as Row).name, 'Flexible')
    assert.deepEqual(
      (detail.rooms as Row[]).map((room) => room.id),
      ['room-301'],
    )

    const moved = await call(
      'hospitality_core.saveRoomType',
      {
        id: detail.id,
        propertyId: 'other-hotel',
        code: detail.code,
        name: detail.name,
        publicName: detail.publicName,
        description: detail.description,
        defaultCapacity: detail.defaultCapacity,
        maxAdults: detail.maxAdults,
        maxChildren: detail.maxChildren,
        maxInfants: detail.maxInfants,
        maxExtraBeds: detail.maxExtraBeds,
        sizeSqm: String(detail.sizeSqm),
        viewType: detail.viewType,
        sharedBathroom: detail.sharedBathroom,
        baseRate: String(detail.baseRate),
        color: detail.color,
        cancellationPolicyId: detail.cancellationPolicyId,
        published: detail.published,
      },
      adapter,
    )
    assert.equal((moved.value as Row).ok, false)
    assert.ok(((moved.value as Row).errors as Row[]).some((error) => error.code === 'property_mismatch'))

    const invalid = await call(
      'hospitality_core.saveRoomType',
      {
        id: 'invalid-room-type',
        propertyId: 'hotel',
        code: 'INVALID',
        name: 'Invalid room type',
        defaultCapacity: 4,
        maxAdults: 2,
        maxChildren: 1,
        baseRate: '-1',
        sizeSqm: '0',
        viewType: 'space',
        color: 'teal',
      },
      adapter,
    )
    assert.equal((invalid.value as Row).ok, false)
    const codes = new Set(((invalid.value as Row).errors as Row[]).map((error) => error.code))
    assert.deepEqual(
      ['capacity_total', 'non_negative', 'positive', 'view_type', 'color'].every((code) => codes.has(code)),
      true,
    )
    const changes = await adapter.all(
      `SELECT "resourceId" FROM hospitality_core_content_change WHERE "resourceType" = ?`,
      ['room_type'],
    )
    assert.deepEqual(
      changes.map((change) => change.resourceId),
      ['deluxe'],
    )
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

test('hospitality content: media lifecycle is ordered, scoped and emits a durable feed', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await call(
      'hospitality_core.saveRoomType',
      {
        id: 'deluxe',
        propertyId: 'hotel',
        code: 'DLX',
        name: 'Deluxe',
        description: 'A bright room with a city view.',
      },
      adapter,
    )
    const attachment = async (id: string, resModel = 'hospitality_core.Property', resId = 'hotel') =>
      call(
        'storage.createAttachment',
        {
          id,
          name: `${id}.jpg`,
          resModel,
          resId,
          resField: 'contentImages',
          kind: 'url',
          url: `https://example.com/${id}.jpg`,
          mimetype: 'image/jpeg',
          size: 42,
          public: true,
          createdAt: '2026-08-20T00:00:00.000Z',
        },
        adapter,
      )
    await attachment('exterior')
    await attachment('lobby')
    await attachment('wrong-target', 'hospitality_core.RoomType', 'deluxe')

    const first = await call(
      'hospitality_core.attachContentImage',
      {
        id: 'exterior',
        attachmentId: 'exterior',
        propertyId: 'hotel',
        category: 'exterior',
        caption: 'Main entrance',
      },
      adapter,
    )
    assert.equal((first.value as Row).primary, true, 'the first image becomes primary')
    const retried = await call(
      'hospitality_core.attachContentImage',
      {
        id: 'exterior',
        attachmentId: 'exterior',
        propertyId: 'hotel',
        category: 'exterior',
        caption: 'Main entrance',
      },
      adapter,
    )
    assert.deepEqual(
      { primary: (retried.value as Row).primary, sequence: (retried.value as Row).sequence },
      { primary: true, sequence: 10 },
      'an idempotent retry preserves primary and ordering semantics',
    )
    await call(
      'hospitality_core.attachContentImage',
      {
        id: 'lobby',
        attachmentId: 'lobby',
        propertyId: 'hotel',
        category: 'lobby',
      },
      adapter,
    )
    await assert.rejects(
      call(
        'hospitality_core.attachContentImage',
        {
          id: 'wrong-target',
          attachmentId: 'wrong-target',
          propertyId: 'hotel',
          category: 'room',
        },
        adapter,
      ),
      (error: unknown) => (error as { code?: string }).code === 'E_HOSPITALITY_CONTENT_INVALID',
    )
    assert.equal(
      (
        await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_content_image WHERE id = ?', [
          'wrong-target',
        ])
      )[0]!.n,
      0,
      'invalid attachment ownership leaves no partial media row',
    )

    await call('hospitality_core.setPrimaryContentImage', { id: 'lobby' }, adapter)
    await call(
      'hospitality_core.updateContentImage',
      { id: 'lobby', category: 'restaurant', caption: 'Breakfast room' },
      adapter,
    )
    await call(
      'hospitality_core.reorderContentImages',
      { propertyId: 'hotel', ids: ['lobby', 'exterior'] },
      adapter,
    )
    let images = (await call('hospitality_core.listContentImages', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    assert.deepEqual(
      images.map((image) => [image.id, image.sequence, image.primary, image.category]),
      [
        ['lobby', 10, true, 'restaurant'],
        ['exterior', 20, false, 'exterior'],
      ],
    )

    const allChanges = (await call('hospitality_core.listContentChanges', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    assert.equal(
      allChanges.some((change) => change.resourceType === 'property'),
      true,
    )
    assert.equal(
      allChanges.some((change) => change.resourceType === 'room_type'),
      true,
    )
    const cursor = allChanges[2]!
    const after = (
      await call(
        'hospitality_core.listContentChanges',
        {
          propertyId: 'hotel',
          afterAt: cursor.createdAt,
          afterId: cursor.id,
        },
        adapter,
      )
    ).value as Row[]
    assert.deepEqual(
      after.map((change) => change.id),
      allChanges.slice(3).map((change) => change.id),
      'the tuple cursor resumes after the exact persisted row',
    )
    assert.equal(
      after.every((change) => change.propertyId === 'hotel'),
      true,
    )

    await call('hospitality_core.removeContentImage', { id: 'lobby' }, adapter)
    images = (await call('hospitality_core.listContentImages', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    assert.deepEqual(
      images.map((image) => [image.id, image.primary]),
      [['exterior', true]],
    )
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM storage_attachment WHERE id = ?', ['lobby']))[0]!.n,
      0,
      'removal drops attachment metadata in the same transaction',
    )
    const deletion = (
      await adapter.all(
        'SELECT kind FROM hospitality_core_content_change WHERE "resourceType" = \'image\' AND "resourceId" = \'lobby\' ORDER BY "createdAt" DESC, id DESC LIMIT 1',
      )
    )[0]!
    assert.equal(deletion.kind, 'delete')
    assert.equal(
      (await adapter.all("SELECT COUNT(*) AS n FROM ket_job WHERE job = 'storage.sweep'"))[0]!.n,
      1,
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality inventory: default rate plans price bookings and remain unique per rate type', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await call(
      'hospitality_core.saveRoomType',
      { id: 'deluxe', propertyId: 'hotel', code: 'DLX', name: 'Deluxe', baseRate: '100' },
      adapter,
    )
    await call(
      'hospitality_core.saveRoom',
      { id: '101', propertyId: 'hotel', roomTypeId: 'deluxe', code: '101', name: '101' },
      adapter,
    )
    const saved = await call(
      'hospitality_core.saveRatePlan',
      {
        id: 'flex',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        code: 'FLEX',
        name: 'Flexible nightly',
        rateType: 'nightly',
        amount: '250',
        isDefault: true,
        mealPlan: 'BB',
        minStay: 2,
      },
      adapter,
    )
    assert.equal((saved.value as Row).ok, true)
    const rateChanges = (
      await call('hospitality_core.listInventoryChanges', { propertyId: 'hotel' }, adapter)
    ).value as Row[]
    assert.deepEqual(
      rateChanges.map((change) => change.kind),
      ['rate'],
    )
    assert.equal(rateChanges[0]?.aggregateId, 'flex')
    const duplicate = await call(
      'hospitality_core.saveRatePlan',
      {
        id: 'other',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        code: 'OTHER',
        name: 'Other nightly',
        rateType: 'nightly',
        amount: '200',
        isDefault: true,
      },
      adapter,
    )
    assert.equal((duplicate.value as Row).ok, false)
    assert.equal(((duplicate.value as Row).errors as Row[])[0]?.code, 'default_rate_unique')

    await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Guest' }, adapter)
    const tooShort = await call(
      'hospitality_core.createReservation',
      {
        id: 'short',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'guest',
        checkIn: '2026-09-01T07:00:00.000Z',
        checkOut: '2026-09-02T05:00:00.000Z',
      },
      adapter,
    )
    assert.equal((tooShort.value as Row).ok, false)
    assert.equal(((tooShort.value as Row).errors as Row[])[0]?.code, 'rate_plan_min_stay')
    const booked = await call(
      'hospitality_core.createReservation',
      {
        id: 'two-nights',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'guest',
        checkIn: '2026-09-01T07:00:00.000Z',
        checkOut: '2026-09-03T05:00:00.000Z',
      },
      adapter,
    )
    assert.equal((booked.value as Row).ok, true)
    const reservation = (await call('hospitality_core.getReservation', { id: 'two-nights' }, adapter))
      .value as Row
    assert.equal(Number(reservation.rate), 250)
    assert.equal(Number(reservation.amountTotal), 500)
  } finally {
    await adapter.close()
  }
})

test('hospitality inventory: room-night capacity is atomic and cancellation releases it', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await call(
      'hospitality_core.saveRoomType',
      { id: 'standard', propertyId: 'hotel', code: 'STD', name: 'Standard', baseRate: '100' },
      adapter,
    )
    await call(
      'hospitality_core.saveRoom',
      { id: '101', propertyId: 'hotel', roomTypeId: 'standard', code: '101', name: '101' },
      adapter,
    )
    await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Guest' }, adapter)
    const range = await call(
      'hospitality_core.setInventoryRange',
      {
        propertyId: 'hotel',
        roomTypeId: 'standard',
        from: '2026-10-01',
        to: '2026-10-02',
        total: 1,
      },
      adapter,
    )
    assert.deepEqual(range.value, { ok: true, count: 2, errors: [] })
    const reserve = (id: string, from: string, to: string) =>
      call(
        'hospitality_core.createReservation',
        {
          id,
          propertyId: 'hotel',
          roomTypeId: 'standard',
          partnerId: 'guest',
          checkIn: `${from}T07:00:00.000Z`,
          checkOut: `${to}T05:00:00.000Z`,
          rate: '100',
        },
        adapter,
      )
    assert.equal(((await reserve('first', '2026-10-01', '2026-10-02')).value as Row).ok, true)
    const full = await reserve('second', '2026-10-01', '2026-10-02')
    assert.equal((full.value as Row).ok, false)
    assert.equal(((full.value as Row).errors as Row[])[0]?.code, 'no_availability')
    const changesAfterRejectedBooking = (
      await call('hospitality_core.listInventoryChanges', { propertyId: 'hotel' }, adapter)
    ).value as Row[]
    assert.equal(changesAfterRejectedBooking.length, 2, 'failed booking and change signal roll back together')
    assert.equal(
      Number(
        (await adapter.all(`SELECT COUNT(*) AS n FROM hospitality_core_reservation WHERE id = 'second'`))[0]
          ?.n,
      ),
      0,
      'a failed reserve leaves no partial booking records',
    )
    const lowered = await call(
      'hospitality_core.setInventoryRange',
      {
        propertyId: 'hotel',
        roomTypeId: 'standard',
        from: '2026-10-01',
        to: '2026-10-01',
        total: 0,
      },
      adapter,
    )
    assert.equal((lowered.value as Row).ok, false)
    assert.equal(((lowered.value as Row).errors as Row[])[0]?.code, 'inventory_capacity')
    assert.equal(
      ((await call('hospitality_core.listInventoryChanges', { propertyId: 'hotel' }, adapter)).value as Row[])
        .length,
      2,
      'rejected allotment changes do not emit a signal',
    )
    await call('hospitality_core.cancelReservation', { id: 'first' }, adapter)
    assert.equal(((await reserve('second', '2026-10-01', '2026-10-02')).value as Row).ok, true)
    const calendar = (
      await call(
        'hospitality_core.listInventory',
        { propertyId: 'hotel', roomTypeId: 'standard', from: '2026-10-01', to: '2026-10-02' },
        adapter,
      )
    ).value as Row[]
    assert.deepEqual(
      calendar.map((row) => ({ date: row.date, sold: row.sold, available: row.available })),
      [
        { date: '2026-10-01', sold: 1, available: 0 },
        { date: '2026-10-02', sold: 0, available: 1 },
      ],
    )
    const changes = (await call('hospitality_core.listInventoryChanges', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    assert.equal(changes.length, 4)
    assert.deepEqual(
      changes.map((change) => change.kind),
      ['availability', 'availability', 'availability', 'availability'],
    )
    const firstPage = (
      await call('hospitality_core.listInventoryChanges', { propertyId: 'hotel', limit: 1 }, adapter)
    ).value as Row[]
    const rest = (
      await call(
        'hospitality_core.listInventoryChanges',
        {
          propertyId: 'hotel',
          afterAt: firstPage[0]!.createdAt,
          afterId: firstPage[0]!.id,
        },
        adapter,
      )
    ).value as Row[]
    assert.equal(rest.length, 3, 'the durable cursor resumes after an exact timestamp/id pair')
  } finally {
    await adapter.close()
  }
})

test('hospitality inventory: restrictions enforce stop-sell, CTA, CTD and LOS', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await call(
      'hospitality_core.saveRoomType',
      { id: 'suite', propertyId: 'hotel', code: 'STE', name: 'Suite', baseRate: '500' },
      adapter,
    )
    for (const room of ['201', '202'])
      await call(
        'hospitality_core.saveRoom',
        { id: room, propertyId: 'hotel', roomTypeId: 'suite', code: room, name: room },
        adapter,
      )
    await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Guest' }, adapter)
    await call(
      'hospitality_core.setRestrictionRange',
      {
        propertyId: 'hotel',
        roomTypeId: 'suite',
        from: '2026-11-01',
        to: '2026-11-01',
        stopSell: true,
      },
      adapter,
    )
    const restrictionChanges = (
      await call('hospitality_core.listInventoryChanges', { propertyId: 'hotel' }, adapter)
    ).value as Row[]
    assert.deepEqual(
      restrictionChanges.map((change) => change.kind),
      ['restriction'],
    )
    const stopped = await call(
      'hospitality_core.createReservation',
      {
        id: 'stopped',
        propertyId: 'hotel',
        roomTypeId: 'suite',
        partnerId: 'guest',
        checkIn: '2026-11-01T07:00:00.000Z',
        checkOut: '2026-11-02T05:00:00.000Z',
      },
      adapter,
    )
    assert.equal(((stopped.value as Row).errors as Row[])[0]?.code, 'stop_sell')
    await call(
      'hospitality_core.setRestrictionRange',
      {
        propertyId: 'hotel',
        roomTypeId: 'suite',
        from: '2026-11-01',
        to: '2026-11-01',
        minLos: 2,
        closedToArrival: true,
      },
      adapter,
    )
    const restricted = await call(
      'hospitality_core.createReservation',
      {
        id: 'restricted',
        propertyId: 'hotel',
        roomTypeId: 'suite',
        partnerId: 'guest',
        checkIn: '2026-11-01T07:00:00.000Z',
        checkOut: '2026-11-02T05:00:00.000Z',
      },
      adapter,
    )
    assert.deepEqual(((restricted.value as Row).errors as Row[]).map((error) => error.code).sort(), [
      'closed_to_arrival',
      'min_los',
    ])
    await call(
      'hospitality_core.setRestrictionRange',
      {
        propertyId: 'hotel',
        roomTypeId: 'suite',
        from: '2026-11-01',
        to: '2026-11-01',
      },
      adapter,
    )
    await call(
      'hospitality_core.setRestrictionRange',
      {
        propertyId: 'hotel',
        roomTypeId: 'suite',
        from: '2026-11-03',
        to: '2026-11-03',
        closedToDeparture: true,
      },
      adapter,
    )
    const departure = await call(
      'hospitality_core.createReservation',
      {
        id: 'departure',
        propertyId: 'hotel',
        roomTypeId: 'suite',
        partnerId: 'guest',
        checkIn: '2026-11-01T07:00:00.000Z',
        checkOut: '2026-11-03T05:00:00.000Z',
      },
      adapter,
    )
    assert.equal(((departure.value as Row).errors as Row[])[0]?.code, 'closed_to_departure')
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
    'hospitality_core.screen.inventory.title',
    'hospitality_core.validation.no_availability',
  ]) {
    assert.equal(vi.has(key), true, `Vietnamese should own ${key}`)
    assert.equal(en.has(key), true, `English should own ${key}`)
    assert.notEqual(vi(key), key)
    assert.notEqual(en(key), key)
  }
  assert.equal(vi('hospitality_core.value.hours', { count: 24 }), '24 giờ')
  assert.equal(en('hospitality_core.value.hours', { count: 24 }), '24 hours')
})
