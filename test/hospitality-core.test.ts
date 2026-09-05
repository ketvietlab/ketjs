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
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'

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

test('hospitality core: a property accepts only an active branch from its own company', async () => {
  const adapter = await boot()
  try {
    await adapter.exec(
      `INSERT INTO company_branch (id, "companyId", code, name, "parentId", "rootKey", active) VALUES
        ('acme-branch', 'acme', 'HCM', 'Ho Chi Minh City', NULL, NULL, 1),
        ('globex-branch', 'globex', 'HN', 'Ha Noi', NULL, NULL, 1),
        ('archived-branch', 'acme', 'OLD', 'Archived', NULL, NULL, 0)`,
    )

    const created = await call(
      'hospitality_core.saveProperty',
      {
        id: 'branched-hotel',
        branchId: 'acme-branch',
        code: 'BRANCH',
        name: 'Branched Hotel',
        accommodationType: 'hotel',
      },
      adapter,
    )
    assert.equal((created.value as Row).ok, true)
    const detail = (await call('hospitality_core.getProperty', { id: 'branched-hotel' }, adapter))
      .value as Row
    assert.equal(detail.companyId, 'acme')
    assert.equal(detail.branchId, 'acme-branch')

    const wrongCompany = await call(
      'hospitality_core.saveProperty',
      {
        id: 'wrong-company',
        branchId: 'globex-branch',
        code: 'WRONG',
        name: 'Wrong company',
        accommodationType: 'hotel',
      },
      adapter,
    )
    assert.equal((wrongCompany.value as Row).ok, false)
    assert.equal(((wrongCompany.value as Row).errors as Row[])[0]?.code, 'branch_company_mismatch')

    const archived = await call(
      'hospitality_core.saveProperty',
      {
        id: 'archived-branch-hotel',
        branchId: 'archived-branch',
        code: 'ARCHIVED',
        name: 'Archived branch',
        accommodationType: 'hotel',
      },
      adapter,
    )
    assert.equal((archived.value as Row).ok, false)
    assert.equal(((archived.value as Row).errors as Row[])[0]?.code, 'branch_archived')
  } finally {
    await adapter.close()
  }
})

test('hospitality catalog: internal projections are company-scoped and public-safe', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await property(adapter, 'globex-hotel', GLOBEX)
    await call(
      'hospitality_core.saveProperty',
      { id: 'inactive-hotel', code: 'OLD', name: 'Old Hotel', accommodationType: 'hotel' },
      adapter,
    )
    await call('hospitality_core.archiveProperty', { id: 'inactive-hotel', active: false }, adapter)
    await call(
      'hospitality_core.saveRoomType',
      {
        id: 'published-room',
        propertyId: 'hotel',
        code: 'PUB',
        name: 'Published room',
        published: true,
      },
      adapter,
    )
    await call(
      'hospitality_core.saveRoomType',
      { id: 'draft-room', propertyId: 'hotel', code: 'DRAFT', name: 'Draft room' },
      adapter,
    )
    await call(
      'hospitality_core.saveRoom',
      {
        id: 'secret-room-number',
        propertyId: 'hotel',
        roomTypeId: 'published-room',
        code: '101',
        name: 'Room 101',
      },
      adapter,
    )
    await call(
      'hospitality_core.saveAmenity',
      { id: 'wifi', code: 'WIFI', name: 'Wi-Fi', scope: 'property' },
      adapter,
    )
    await call(
      'hospitality_core.assignAmenity',
      { id: 'hotel-wifi', target: 'property', targetId: 'hotel', amenityId: 'wifi' },
      adapter,
    )
    await call(
      'storage.createAttachment',
      {
        id: 'catalog-image',
        name: 'catalog.jpg',
        resModel: 'hospitality_core.Property',
        resId: 'hotel',
        resField: 'contentImages',
        kind: 'url',
        url: 'https://private-origin.example/catalog.jpg',
        mimetype: 'image/jpeg',
        size: 42,
        public: true,
        createdAt: '2026-08-20T00:00:00.000Z',
      },
      adapter,
    )
    await call(
      'hospitality_core.attachContentImage',
      {
        id: 'catalog-image',
        attachmentId: 'catalog-image',
        propertyId: 'hotel',
        category: 'exterior',
        caption: 'Main entrance',
      },
      adapter,
    )

    const properties = (await call('hospitality_core.listPropertyCatalog', {}, adapter)).value as Row[]
    assert.deepEqual(
      properties.map((row) => row.id),
      ['hotel'],
    )
    const publicProperty = properties[0]!
    assert.equal(publicProperty.companyId, 'acme')
    assert.equal('rooms' in publicProperty, false)
    assert.equal('availableRooms' in publicProperty, false)
    assert.equal('url' in (publicProperty.primaryImage as Row), false)
    assert.equal(((publicProperty.amenities as Row[])[0] as Row).code, 'WIFI')

    const rooms = (await call('hospitality_core.listRoomTypeCatalog', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    assert.deepEqual(
      rooms.map((row) => row.id),
      ['published-room'],
    )
    assert.equal(rooms[0]?.companyId, 'acme')
    assert.equal('rooms' in rooms[0]!, false)
    assert.equal(
      (await call('hospitality_core.getPropertyCatalog', { id: 'globex-hotel' }, adapter)).value,
      null,
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

test('hospitality core: room configuration preserves workflow-owned status and preloads location', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await call(
      'hospitality_core.saveBuilding',
      { id: 'tower-a', propertyId: 'hotel', code: 'A', name: 'Tower A', sequence: 10 },
      adapter,
    )
    await call(
      'hospitality_core.saveFloor',
      { id: 'floor-1', propertyId: 'hotel', buildingId: 'tower-a', code: '01', name: 'Floor 1' },
      adapter,
    )
    await call(
      'hospitality_core.saveRoomType',
      { id: 'deluxe', propertyId: 'hotel', code: 'DLX', name: 'Deluxe', defaultCapacity: 2 },
      adapter,
    )
    const created = await call(
      'hospitality_core.saveRoom',
      {
        id: '101',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        floorId: 'floor-1',
        code: '101',
        name: 'Room 101',
        capacity: 3,
        status: 'available',
      },
      adapter,
    )
    assert.equal((created.value as Row).ok, true)

    await call('hospitality_core.setRoomStatus', { id: '101', status: 'dirty' }, adapter)
    const bypass = await call(
      'hospitality_core.saveRoom',
      {
        id: '101',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        buildingId: 'tower-a',
        floorId: 'floor-1',
        code: '101',
        name: 'Room 101',
        capacity: 3,
        status: 'maintenance',
      },
      adapter,
    )
    assert.equal((bypass.value as Row).ok, false)
    assert.equal(((bypass.value as Row).errors as Row[])[0]?.code, 'room_status_configuration_managed')

    const updated = await call(
      'hospitality_core.saveRoom',
      {
        id: '101',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        buildingId: 'tower-a',
        floorId: 'floor-1',
        code: '101',
        name: 'River Room 101',
        capacity: 4,
      },
      adapter,
    )
    assert.equal((updated.value as Row).ok, true)

    const detail = (await call('hospitality_core.getRoom', { id: '101' }, adapter)).value as Row
    assert.equal(detail.status, 'dirty')
    assert.equal(detail.name, 'River Room 101')
    assert.equal(Number(detail.capacity), 4)
    assert.equal((detail.property as Row).name, 'Ket Hotel Saigon')
    assert.equal((detail.roomType as Row).name, 'Deluxe')
    assert.equal((detail.building as Row).name, 'Tower A')
    assert.equal((detail.floor as Row).name, 'Floor 1')

    const buildings = (await call('hospitality_core.listBuildings', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    const floors = (await call('hospitality_core.listFloors', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    const buildingRow = buildings[0]
    const floorRow = floors[0]
    assert.ok(buildingRow)
    assert.ok(floorRow)
    assert.equal((buildingRow.floors as Row[]).length, 1)
    assert.equal((buildingRow.rooms as Row[]).length, 1)
    assert.equal((floorRow.rooms as Row[]).length, 1)
    assert.equal((floorRow.building as Row).id, 'tower-a')

    const buildingDetail = (await call('hospitality_core.getBuilding', { id: 'tower-a' }, adapter))
      .value as Row
    const floorDetail = (await call('hospitality_core.getFloor', { id: 'floor-1' }, adapter)).value as Row
    assert.equal((buildingDetail.property as Row).id, 'hotel')
    assert.equal((buildingDetail.floors as Row[]).length, 1)
    assert.equal((floorDetail.property as Row).id, 'hotel')
    assert.equal((floorDetail.building as Row).id, 'tower-a')

    const blockedFloor = (
      await call('hospitality_core.archiveFloor', { id: 'floor-1', active: false }, adapter)
    ).value as Row
    assert.equal(blockedFloor.ok, false)
    assert.equal((blockedFloor.errors as Row[])[0]?.code, 'location_has_active_rooms')

    await call(
      'hospitality_core.saveBuilding',
      { id: 'annex', propertyId: 'hotel', code: 'B', name: 'Annex', sequence: 20 },
      adapter,
    )
    await call(
      'hospitality_core.saveFloor',
      { id: 'annex-floor', propertyId: 'hotel', buildingId: 'annex', code: '01', name: 'Annex floor' },
      adapter,
    )
    const blockedBuilding = (
      await call('hospitality_core.archiveBuilding', { id: 'annex', active: false }, adapter)
    ).value as Row
    assert.equal(blockedBuilding.ok, false)
    assert.equal((blockedBuilding.errors as Row[])[0]?.code, 'location_has_active_floors')
    assert.equal(
      (
        (await call('hospitality_core.archiveFloor', { id: 'annex-floor', active: false }, adapter))
          .value as Row
      ).ok,
      true,
    )
    assert.equal(
      ((await call('hospitality_core.archiveBuilding', { id: 'annex', active: false }, adapter)).value as Row)
        .ok,
      true,
    )
    const activeBuildings = (await call('hospitality_core.listBuildings', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    const archivedBuildings = (
      await call('hospitality_core.listBuildings', { propertyId: 'hotel', includeArchived: true }, adapter)
    ).value as Row[]
    const archivedFloors = (
      await call('hospitality_core.listFloors', { propertyId: 'hotel', includeArchived: true }, adapter)
    ).value as Row[]
    assert.equal(activeBuildings.length, 1)
    assert.equal(
      archivedBuildings.some((row) => row.id === 'annex' && row.active === false),
      true,
    )
    assert.equal(
      archivedFloors.some((row) => row.id === 'annex-floor' && row.active === false),
      true,
    )

    const blockedRestore = (
      await call('hospitality_core.archiveFloor', { id: 'annex-floor', active: true }, adapter)
    ).value as Row
    assert.equal(blockedRestore.ok, false)
    assert.equal((blockedRestore.errors as Row[])[0]?.code, 'location_archived')
    assert.equal(
      ((await call('hospitality_core.archiveBuilding', { id: 'annex', active: true }, adapter)).value as Row)
        .ok,
      true,
    )
    assert.equal(
      (
        (await call('hospitality_core.archiveFloor', { id: 'annex-floor', active: true }, adapter))
          .value as Row
      ).ok,
      true,
    )

    await call(
      'hospitality_core.saveRoom',
      {
        id: 'annex-room',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        buildingId: 'annex',
        floorId: 'annex-floor',
        code: '201',
        name: 'Annex room 201',
      },
      adapter,
    )
    const archivedRoom = (
      await call('hospitality_core.archiveRoom', { id: 'annex-room', active: false }, adapter)
    ).value as Row
    assert.equal(archivedRoom.ok, true)
    const archivedTask = (
      await call(
        'hospitality_core.createCleaningTask',
        {
          id: 'archived-task',
          code: 'HK-ARCHIVED',
          roomId: 'annex-room',
          taskType: 'daily_clean',
        },
        adapter,
      )
    ).value as Row
    assert.equal(archivedTask.ok, false)
    assert.equal((archivedTask.errors as Row[])[0]?.code, 'room_archived')

    assert.equal(
      (
        (await call('hospitality_core.archiveFloor', { id: 'annex-floor', active: false }, adapter))
          .value as Row
      ).ok,
      true,
    )
    assert.equal(
      ((await call('hospitality_core.archiveBuilding', { id: 'annex', active: false }, adapter)).value as Row)
        .ok,
      true,
    )
    const blockedRoomRestore = (
      await call('hospitality_core.archiveRoom', { id: 'annex-room', active: true }, adapter)
    ).value as Row
    assert.equal(blockedRoomRestore.ok, false)
    assert.equal((blockedRoomRestore.errors as Row[])[0]?.code, 'location_archived')
    await call('hospitality_core.archiveBuilding', { id: 'annex', active: true }, adapter)
    await call('hospitality_core.archiveFloor', { id: 'annex-floor', active: true }, adapter)
    assert.equal(
      ((await call('hospitality_core.archiveRoom', { id: 'annex-room', active: true }, adapter)).value as Row)
        .ok,
      true,
    )

    await call(
      'hospitality_core.saveRoom',
      {
        id: 'task-room',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        code: '202',
        name: 'Task room 202',
      },
      adapter,
    )
    await call(
      'hospitality_core.createCleaningTask',
      {
        id: 'task-room-clean',
        code: 'HK-202',
        roomId: 'task-room',
        taskType: 'daily_clean',
      },
      adapter,
    )
    const blockedTaskRoom = (
      await call('hospitality_core.archiveRoom', { id: 'task-room', active: false }, adapter)
    ).value as Row
    assert.equal(blockedTaskRoom.ok, false)
    assert.equal((blockedTaskRoom.errors as Row[])[0]?.code, 'room_has_open_task')
    assert.equal(
      ((await call('hospitality_core.getRoom', { id: 'task-room' }, adapter)).value as Row).active,
      true,
    )

    const blockedStatusRoom = (
      await call('hospitality_core.archiveRoom', { id: '101', active: false }, adapter)
    ).value as Row
    assert.equal(blockedStatusRoom.ok, false)
    assert.equal((blockedStatusRoom.errors as Row[])[0]?.code, 'room_archive_status')
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

test('hospitality reservations: front desk amends a direct booking atomically', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    for (const [id, code, rate] of [
      ['standard', 'STD', '100'],
      ['deluxe', 'DLX', '200'],
    ]) {
      await call(
        'hospitality_core.saveRoomType',
        { id, propertyId: 'hotel', code, name: code, baseRate: rate },
        adapter,
      )
      await call(
        'hospitality_core.saveRoom',
        { id: `${id}-room`, propertyId: 'hotel', roomTypeId: id, code, name: code },
        adapter,
      )
    }
    await call('partner.savePartner', { id: 'guest-a', kind: 'person', name: 'Guest A' }, adapter)
    await call('partner.savePartner', { id: 'guest-b', kind: 'person', name: 'Guest B' }, adapter)
    const created = await call(
      'hospitality_core.createReservation',
      {
        id: 'amend-me',
        propertyId: 'hotel',
        roomTypeId: 'standard',
        partnerId: 'guest-a',
        checkIn: '2026-10-01T07:00:00.000Z',
        checkOut: '2026-10-02T05:00:00.000Z',
        rate: '100',
      },
      adapter,
    )
    assert.equal((created.value as Row).ok, true)
    await call(
      'hospitality_core.addCharge',
      {
        id: 'late-checkout',
        folioId: 'amend-me:folio',
        stayId: 'amend-me:stay',
        description: 'Late checkout',
        type: 'service',
        quantity: '1',
        unitPrice: '50',
      },
      adapter,
    )

    const amended = await call(
      'hospitality_core.amendReservation',
      {
        id: 'amend-me',
        roomTypeId: 'deluxe',
        partnerId: 'guest-b',
        checkIn: '2026-10-02T07:00:00.000Z',
        checkOut: '2026-10-04T05:00:00.000Z',
        adults: 2,
        children: 1,
        rate: '200',
        at: '2026-09-20T00:00:00.000Z',
      },
      adapter,
    )
    assert.deepEqual(amended.value, { ok: true, id: 'amend-me', errors: [], amountTotal: '400' })

    const reservation = (await call('hospitality_core.getReservation', { id: 'amend-me' }, adapter))
      .value as Row
    const stay = (await call('hospitality_core.getStay', { id: 'amend-me:stay' }, adapter)).value as Row
    const folio = (await call('hospitality_core.getFolio', { id: 'amend-me:folio' }, adapter)).value as Row
    assert.deepEqual(
      {
        partnerId: reservation.partnerId,
        roomTypeId: reservation.roomTypeId,
        adults: reservation.adults,
        children: reservation.children,
        rate: Number(reservation.rate),
        amountTotal: Number(reservation.amountTotal),
      },
      {
        partnerId: 'guest-b',
        roomTypeId: 'deluxe',
        adults: 2,
        children: 1,
        rate: 200,
        amountTotal: 400,
      },
    )
    assert.equal(stay.partnerId, 'guest-b')
    assert.equal(stay.roomTypeId, 'deluxe')
    assert.equal(Number(folio.amountTotal), 450, 'non-room charges remain on the folio')
    assert.equal(
      ((stay.guests as Row[]).find((guest) => guest.primary === true || guest.primary === 1) as Row)
        .displayName,
      'Guest B',
    )
    const ledger = await adapter.all(
      `SELECT "roomTypeId", date, sold FROM hospitality_core_availability_ledger ORDER BY "roomTypeId", date`,
    )
    assert.deepEqual(
      ledger.map((row) => ({ roomTypeId: row.roomTypeId, date: row.date, sold: Number(row.sold) })),
      [
        { roomTypeId: 'deluxe', date: '2026-10-02', sold: 1 },
        { roomTypeId: 'deluxe', date: '2026-10-03', sold: 1 },
        { roomTypeId: 'standard', date: '2026-10-01', sold: 0 },
      ],
    )

    const retried = await call(
      'hospitality_core.amendReservation',
      {
        id: 'amend-me',
        roomTypeId: 'deluxe',
        partnerId: 'guest-b',
        checkIn: '2026-10-02T07:00:00.000Z',
        checkOut: '2026-10-04T05:00:00.000Z',
        adults: 2,
        children: 1,
        rate: '200',
        at: '2026-09-20T00:01:00.000Z',
      },
      adapter,
    )
    assert.equal((retried.value as Row).ok, true, 'the current reservation owns its occupied nights')

    await call(
      'hospitality_core.createReservation',
      {
        id: 'blocks-amendment',
        propertyId: 'hotel',
        roomTypeId: 'standard',
        partnerId: 'guest-a',
        checkIn: '2026-10-05T07:00:00.000Z',
        checkOut: '2026-10-06T05:00:00.000Z',
      },
      adapter,
    )
    const rejected = await call(
      'hospitality_core.amendReservation',
      {
        id: 'amend-me',
        roomTypeId: 'standard',
        partnerId: 'guest-b',
        checkIn: '2026-10-05T07:00:00.000Z',
        checkOut: '2026-10-06T05:00:00.000Z',
        adults: 2,
        children: 1,
        rate: '200',
      },
      adapter,
    )
    assert.equal((rejected.value as Row).ok, false)
    assert.equal(((rejected.value as Row).errors as Row[])[0]?.code, 'no_availability')
    const afterRejected = (await call('hospitality_core.getReservation', { id: 'amend-me' }, adapter))
      .value as Row
    assert.equal(afterRejected.roomTypeId, 'deluxe')
    assert.equal(afterRejected.checkIn, '2026-10-02T07:00:00.000Z')

    await call(
      'hospitality_core.createReservation',
      {
        id: 'ota-booking',
        propertyId: 'hotel',
        roomTypeId: 'standard',
        partnerId: 'guest-a',
        provider: 'agoda',
        externalId: 'AGODA-1',
        checkIn: '2026-10-07T07:00:00.000Z',
        checkOut: '2026-10-08T05:00:00.000Z',
      },
      adapter,
    )
    const external = await call(
      'hospitality_core.amendReservation',
      {
        id: 'ota-booking',
        roomTypeId: 'standard',
        partnerId: 'guest-a',
        checkIn: '2026-10-08T07:00:00.000Z',
        checkOut: '2026-10-09T05:00:00.000Z',
        adults: 1,
        children: 0,
        rate: '100',
      },
      adapter,
    )
    assert.equal(((external.value as Row).errors as Row[])[0]?.code, 'reservation_external_readonly')
  } finally {
    await adapter.close()
  }
})

test('hospitality stays: front desk adjusts an in-house departure atomically', async () => {
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
    const created = await call(
      'hospitality_core.createReservation',
      {
        id: 'in-house',
        propertyId: 'hotel',
        roomTypeId: 'standard',
        partnerId: 'guest',
        checkIn: '2026-10-01T07:00:00.000Z',
        checkOut: '2026-10-02T05:00:00.000Z',
        rate: '100',
      },
      adapter,
    )
    assert.equal((created.value as Row).ok, true)
    const checkedIn = await call(
      'hospitality_core.checkIn',
      { stayId: 'in-house:stay', roomId: '101', at: '2026-10-01T07:00:00.000Z' },
      adapter,
    )
    assert.equal((checkedIn.value as Row).ok, true)
    await call(
      'hospitality_core.addCharge',
      {
        id: 'breakfast',
        folioId: 'in-house:folio',
        stayId: 'in-house:stay',
        description: 'Breakfast',
        type: 'service',
        quantity: '1',
        unitPrice: '25',
      },
      adapter,
    )

    const extended = await call(
      'hospitality_core.adjustStayDeparture',
      {
        stayId: 'in-house:stay',
        checkOut: '2026-10-03T05:00:00.000Z',
        at: '2026-10-01T08:00:00.000Z',
      },
      adapter,
    )
    assert.deepEqual(extended.value, {
      ok: true,
      id: 'in-house:stay',
      checkOut: '2026-10-03T05:00:00.000Z',
      amountTotal: '200',
      errors: [],
    })
    const reservation = (await call('hospitality_core.getReservation', { id: 'in-house' }, adapter))
      .value as Row
    const stay = (await call('hospitality_core.getStay', { id: 'in-house:stay' }, adapter)).value as Row
    const folio = (await call('hospitality_core.getFolio', { id: 'in-house:folio' }, adapter)).value as Row
    assert.deepEqual(
      {
        reservationCheckOut: reservation.checkOut,
        stayCheckOut: stay.checkOut,
        quantity: Number(reservation.quantity),
        amountTotal: Number(reservation.amountTotal),
        folioTotal: Number(folio.amountTotal),
        roomCharge: Number(
          ((folio.charges as Row[]).find((charge) => charge.id === 'in-house:room') as Row).amount,
        ),
      },
      {
        reservationCheckOut: '2026-10-03T05:00:00.000Z',
        stayCheckOut: '2026-10-03T05:00:00.000Z',
        quantity: 2,
        amountTotal: 200,
        folioTotal: 225,
        roomCharge: 200,
      },
    )
    assert.deepEqual(
      (await adapter.all(`SELECT date, sold FROM hospitality_core_availability_ledger ORDER BY date`)).map(
        (row) => ({ date: row.date, sold: Number(row.sold) }),
      ),
      [
        { date: '2026-10-01', sold: 1 },
        { date: '2026-10-02', sold: 1 },
      ],
    )

    const retried = await call(
      'hospitality_core.adjustStayDeparture',
      {
        stayId: 'in-house:stay',
        checkOut: '2026-10-03T05:00:00.000Z',
        at: '2026-10-01T08:01:00.000Z',
      },
      adapter,
    )
    assert.equal((retried.value as Row).ok, true)

    const shortened = await call(
      'hospitality_core.adjustStayDeparture',
      {
        stayId: 'in-house:stay',
        checkOut: '2026-10-02T05:00:00.000Z',
        at: '2026-10-01T08:02:00.000Z',
      },
      adapter,
    )
    assert.equal((shortened.value as Row).ok, true)
    assert.equal(
      Number(
        ((await call('hospitality_core.getFolio', { id: 'in-house:folio' }, adapter)).value as Row)
          .amountTotal,
      ),
      125,
    )

    const blocker = await call(
      'hospitality_core.createReservation',
      {
        id: 'blocks-extension',
        propertyId: 'hotel',
        roomTypeId: 'standard',
        partnerId: 'guest',
        checkIn: '2026-10-02T07:00:00.000Z',
        checkOut: '2026-10-04T05:00:00.000Z',
      },
      adapter,
    )
    assert.equal((blocker.value as Row).ok, true)
    const rejected = await call(
      'hospitality_core.adjustStayDeparture',
      {
        stayId: 'in-house:stay',
        checkOut: '2026-10-04T05:00:00.000Z',
        at: '2026-10-01T08:03:00.000Z',
      },
      adapter,
    )
    assert.equal((rejected.value as Row).ok, false)
    assert.equal(((rejected.value as Row).errors as Row[])[0]?.code, 'no_availability')
    const afterRejected = (await call('hospitality_core.getReservation', { id: 'in-house' }, adapter))
      .value as Row
    assert.equal(afterRejected.checkOut, '2026-10-02T05:00:00.000Z')
    assert.equal(Number(afterRejected.amountTotal), 100)

    const expiredRetry = await call(
      'hospitality_core.adjustStayDeparture',
      {
        stayId: 'in-house:stay',
        checkOut: '2026-10-02T05:00:00.000Z',
        at: '2026-10-03T05:00:00.000Z',
      },
      adapter,
    )
    assert.equal((expiredRetry.value as Row).ok, true, 'an idempotent retry remains safe after departure')

    const elapsed = await call(
      'hospitality_core.adjustStayDeparture',
      {
        stayId: 'in-house:stay',
        checkOut: '2026-10-03T05:00:00.000Z',
        at: '2026-10-03T05:00:00.000Z',
      },
      adapter,
    )
    assert.equal(((elapsed.value as Row).errors as Row[])[0]?.code, 'departure_not_future')
  } finally {
    await adapter.close()
  }
})

test('hospitality stays: early check-out releases only future inventory and retains charges', async () => {
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
    const created = await call(
      'hospitality_core.createReservation',
      {
        id: 'early-departure',
        propertyId: 'hotel',
        roomTypeId: 'standard',
        partnerId: 'guest',
        checkIn: '2026-10-01T07:00:00.000Z',
        checkOut: '2026-10-05T05:00:00.000Z',
        rate: '100',
      },
      adapter,
    )
    assert.equal((created.value as Row).ok, true)
    await call(
      'hospitality_core.checkIn',
      { stayId: 'early-departure:stay', roomId: '101', at: '2026-10-01T07:00:00.000Z' },
      adapter,
    )

    const checkedOut = await call(
      'hospitality_core.checkOut',
      { stayId: 'early-departure:stay', at: '2026-10-02T05:00:00.000Z' },
      adapter,
    )
    assert.deepEqual(checkedOut.value, {
      ok: true,
      id: 'early-departure:stay',
      roomId: '101',
      state: 'checked_out',
      inventoryReleased: 3,
      errors: [],
    })
    const reservation = (await call('hospitality_core.getReservation', { id: 'early-departure' }, adapter))
      .value as Row
    const stay = (await call('hospitality_core.getStay', { id: 'early-departure:stay' }, adapter))
      .value as Row
    const folio = (await call('hospitality_core.getFolio', { id: 'early-departure:folio' }, adapter))
      .value as Row
    assert.deepEqual(
      {
        reservationState: reservation.state,
        scheduledCheckOut: reservation.checkOut,
        stayState: stay.state,
        actualCheckOut: stay.checkedOutAt,
        folioState: folio.state,
        folioTotal: Number(folio.amountTotal),
      },
      {
        reservationState: 'checked_out',
        scheduledCheckOut: '2026-10-05T05:00:00.000Z',
        stayState: 'checked_out',
        actualCheckOut: '2026-10-02T05:00:00.000Z',
        folioState: 'closed',
        folioTotal: 400,
      },
    )
    assert.deepEqual(
      (await adapter.all(`SELECT date, sold FROM hospitality_core_availability_ledger ORDER BY date`)).map(
        (row) => ({ date: row.date, sold: Number(row.sold) }),
      ),
      [
        { date: '2026-10-01', sold: 1 },
        { date: '2026-10-02', sold: 0 },
        { date: '2026-10-03', sold: 0 },
        { date: '2026-10-04', sold: 0 },
      ],
    )
    const room = (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!
    assert.equal(room.status, 'dirty')
    assert.equal(
      Number(
        (
          await adapter.all(
            `SELECT COUNT(*) AS n FROM hospitality_core_cleaning_task WHERE id = 'checkout:early-departure:stay'`,
          )
        )[0]!.n,
      ),
      1,
    )

    const retried = await call(
      'hospitality_core.checkOut',
      { stayId: 'early-departure:stay', at: '2026-10-02T05:01:00.000Z' },
      adapter,
    )
    assert.equal((retried.value as Row).ok, true)
    assert.equal(
      Number(
        (
          await adapter.all(
            `SELECT COUNT(*) AS n FROM hospitality_core_inventory_change WHERE "aggregateId" = 'early-departure'`,
          )
        )[0]!.n,
      ),
      2,
      'booking and early release each emit one durable inventory signal',
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality reservations: no-show releases inventory but retains charges for reconciliation', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await call(
      'hospitality_core.saveRoomType',
      { id: 'standard', propertyId: 'hotel', code: 'STD', name: 'Standard', baseRate: '125' },
      adapter,
    )
    await call(
      'hospitality_core.saveRoom',
      { id: '101', propertyId: 'hotel', roomTypeId: 'standard', code: '101', name: '101' },
      adapter,
    )
    await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Guest' }, adapter)
    const created = await call(
      'hospitality_core.createReservation',
      {
        id: 'no-show-booking',
        propertyId: 'hotel',
        roomTypeId: 'standard',
        partnerId: 'guest',
        checkIn: '2026-10-01T07:00:00.000Z',
        checkOut: '2026-10-03T05:00:00.000Z',
        rate: '125',
      },
      adapter,
    )
    assert.equal((created.value as Row).ok, true)

    const early = await call(
      'hospitality_core.markNoShow',
      {
        id: 'no-show-booking',
        reason: 'Guest did not answer',
        at: '2026-10-01T06:59:59.000Z',
      },
      adapter,
    )
    assert.equal((early.value as Row).ok, false)
    assert.equal(((early.value as Row).errors as Row[])[0]?.code, 'reservation_no_show_too_early')

    const marked = await call(
      'hospitality_core.markNoShow',
      {
        id: 'no-show-booking',
        reason: 'Guest did not answer',
        at: '2026-10-01T07:00:00.000Z',
      },
      adapter,
    )
    assert.deepEqual(marked.value, { ok: true, id: 'no-show-booking', state: 'no_show', errors: [] })
    const reservation = (await call('hospitality_core.getReservation', { id: 'no-show-booking' }, adapter))
      .value as Row
    const stay = (await call('hospitality_core.getStay', { id: 'no-show-booking:stay' }, adapter))
      .value as Row
    const folio = (await call('hospitality_core.getFolio', { id: 'no-show-booking:folio' }, adapter))
      .value as Row
    assert.deepEqual(
      {
        reservationState: reservation.state,
        stayState: stay.state,
        folioState: folio.state,
        amountTotal: Number(folio.amountTotal),
        noShowReason: reservation.noShowReason,
        noShowAt: reservation.noShowAt,
      },
      {
        reservationState: 'no_show',
        stayState: 'no_show',
        folioState: 'closed',
        amountTotal: 250,
        noShowReason: 'Guest did not answer',
        noShowAt: '2026-10-01T07:00:00.000Z',
      },
    )
    assert.equal((folio.charges as Row[])[0]?.state, 'active', 'no-show does not void the room charge')
    const ledger = await adapter.all(
      `SELECT date, sold FROM hospitality_core_availability_ledger ORDER BY date`,
    )
    assert.deepEqual(
      ledger.map((row) => ({ date: row.date, sold: Number(row.sold) })),
      [
        { date: '2026-10-01', sold: 0 },
        { date: '2026-10-02', sold: 0 },
      ],
    )
    const retried = await call(
      'hospitality_core.markNoShow',
      { id: 'no-show-booking', reason: 'Guest did not answer', at: '2026-10-01T08:00:00.000Z' },
      adapter,
    )
    assert.equal((retried.value as Row).state, 'no_show')
    const cancelled = await call(
      'hospitality_core.cancelReservation',
      { id: 'no-show-booking', reason: 'late provider cancellation' },
      adapter,
    )
    assert.equal(
      (cancelled.value as Row).state,
      'no_show',
      'a later cancellation keeps the no-show audit state',
    )
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

test('hospitality rooms: a room kept for an arriving guest is theirs, and is let go with them', async () => {
  const adapter = await boot()
  try {
    await property(adapter)
    await call(
      'hospitality_core.saveRoomType',
      { id: 'standard', propertyId: 'hotel', code: 'STD', name: 'Standard', baseRate: '100' },
      adapter,
    )
    for (const code of ['101', '102'])
      await call(
        'hospitality_core.saveRoom',
        { id: code, propertyId: 'hotel', roomTypeId: 'standard', code, name: code },
        adapter,
      )
    await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Guest' }, adapter)
    await call('partner.savePartner', { id: 'other', kind: 'person', name: 'Other' }, adapter)
    const book = (id: string, partnerId: string, from: string, to: string) =>
      call(
        'hospitality_core.createReservation',
        {
          id,
          propertyId: 'hotel',
          roomTypeId: 'standard',
          partnerId,
          checkIn: `${from}T07:00:00.000Z`,
          checkOut: `${to}T05:00:00.000Z`,
          rate: '100',
        },
        adapter,
      )
    const hold = (stayId: string, roomId: string) =>
      call('hospitality_core.holdRoom', { stayId, roomId }, adapter)
    const heldRoom = async (stayId: string) =>
      (
        await adapter.all(
          `SELECT "roomId" FROM hospitality_core_room_assignment WHERE "stayId" = '${stayId}' AND state = 'held'`,
        )
      )[0]?.roomId ?? null

    assert.equal(((await book('first', 'guest', '2026-11-01', '2026-11-03')).value as Row).ok, true)
    assert.equal(((await book('second', 'other', '2026-11-02', '2026-11-04')).value as Row).ok, true)

    /* ── Keeping a room takes it from everybody else for those nights ─────── */

    assert.equal(((await hold('first:stay', '101')).value as Row).ok, true)
    assert.equal(await heldRoom('first:stay'), '101')

    const clash = (await hold('second:stay', '101')).value as Row
    assert.equal(clash.ok, false)
    assert.equal((clash.errors as Row[])[0]?.code, 'room_already_held')

    // But the room is still *sold* to nobody: availability counts room types,
    // not rooms, so keeping 101 has not taken a room-night from anybody.
    const ledger = await adapter.all(
      `SELECT date, sold, total FROM hospitality_core_availability_ledger WHERE date = '2026-11-01'`,
    )
    assert.equal(Number(ledger[0]?.sold), 1, 'the reservation took one, the hold took none')
    assert.equal(Number(ledger[0]?.total), 2)

    // The second guest may have the other room over the same nights.
    assert.equal(((await hold('second:stay', '102')).value as Row).ok, true)

    /* ── Choosing again replaces the choice rather than keeping two rooms ─── */

    assert.equal(((await hold('first:stay', '101')).value as Row).ok, true)
    assert.equal(
      Number(
        (
          await adapter.all(
            `SELECT COUNT(*) AS n FROM hospitality_core_room_assignment WHERE "stayId" = 'first:stay' AND state = 'held'`,
          )
        )[0]?.n,
      ),
      1,
      'one guest keeps one room',
    )

    /* ── Arriving uses the room that was kept, without being told which ──── */

    // No `roomId`: the point is that the desk does not have to say it again.
    const arrived = (
      await call(
        'hospitality_core.checkIn',
        { stayId: 'first:stay', at: '2026-11-01T08:00:00.000Z' },
        adapter,
      )
    ).value as Row
    assert.equal(arrived.ok, true)
    assert.equal(
      arrived.roomId,
      '101',
      'the desk already decided; arriving is not the moment to decide again',
    )
    assert.equal(await heldRoom('first:stay'), null, 'the hold is spent, not left behind')

    /* ── A guest who never comes does not keep the room ──────────────────── */

    const gone = (
      await call('hospitality_core.cancelReservation', { id: 'second', reason: 'Khách đổi ý' }, adapter)
    ).value as Row
    assert.equal(gone.ok, true)
    assert.equal(await heldRoom('second:stay'), null, 'a cancelled stay lets its room go')
  } finally {
    await adapter.close()
  }
})
