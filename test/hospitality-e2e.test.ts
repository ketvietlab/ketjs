import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import type { Row, Scope } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const scope: Scope = { company: 'default', companies: ['default'], branches: null }

test('hospitality e2e: authenticated booking and front-desk flow crosses real HTTP', async (t) => {
  const e2e = await createTestDeployment(ketsuite)
  t.after(() => e2e.close())
  const seed = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })

  await seed('partner.savePartner', {
    id: 'company-partner',
    kind: 'company',
    name: 'Ket Hospitality',
  })
  await seed('company.saveCompany', {
    id: 'default',
    partnerId: 'company-partner',
    currency: 'VND',
  })
  await seed('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'hospitality-e2e',
    name: 'Hospitality admin',
    defaultCompanyId: 'default',
    superuser: true,
  })
  await seed('user.grantCompany', {
    id: 'admin:default',
    userId: 'admin',
    companyId: 'default',
  })
  await seed('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' })
  await seed('partner.savePartner', { id: 'companion', kind: 'person', name: 'Trần Bình' })
  await seed('uom.saveUnit', { id: 'service-unit', name: 'Lần', relativeFactor: '1' })
  await seed('product.saveTemplate', {
    id: 'breakfast-template',
    name: 'Bữa sáng',
    type: 'service',
    uomId: 'service-unit',
    listPrice: '25',
    saleOk: true,
  })
  await seed('product.saveVariant', {
    id: 'breakfast',
    templateId: 'breakfast-template',
    defaultCode: 'BF',
    combinationKey: '',
  })
  await seed('hospitality_core.saveProperty', {
    id: 'hotel',
    code: 'HCM',
    name: 'Ket Hotel',
    accommodationType: 'hotel',
    timezone: 'Asia/Ho_Chi_Minh',
    street1: '123 Nguyễn Huệ',
    locality: 'Thành phố Hồ Chí Minh',
  })
  await seed('hospitality_core.saveRoomType', {
    id: 'deluxe',
    propertyId: 'hotel',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '100',
    published: true,
  })
  await seed('hospitality_core.saveRoom', {
    id: '101',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '101',
    name: 'Phòng 101',
  })
  await seed('hospitality_core.saveRoom', {
    id: '102',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '102',
    name: 'Phòng 102',
  })
  await seed('hospitality_core.saveRoom', {
    id: '103',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '103',
    name: 'Phòng 103',
  })
  await seed('hospitality_core.saveRoom', {
    id: '104',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '104',
    name: 'Phòng 104',
  })
  await seed('hospitality_core.saveRoom', {
    id: 'archived-room',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    code: '199',
    name: 'Phòng đã lưu trữ',
  })
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    await adapter.run('UPDATE hospitality_core_room SET active = ? WHERE id = ?', [false, 'archived-room'])
  })

  await e2e.client.login({ login: 'admin', password: 'hospitality-e2e' })

  const propertyList = await e2e.client.get('/admin/hospitality/properties?lang=vi')
  const propertyListHtml = await propertyList.text()
  assert.equal(propertyList.status, 200, propertyListHtml)
  assert.match(propertyListHtml, /Tạo cơ sở/)
  assert.match(propertyListHtml, /\/admin\/hospitality\/properties\/hotel\?lang=vi/)
  assert.doesNotMatch(propertyListHtml, /hospitality_core\./)

  const preservedProperty = await e2e.client.post(
    '/admin/hospitality/properties/hotel?lang=en',
    new URLSearchParams({
      code: 'HCM',
      name: 'Ket Hotel',
      publicName: 'Ket Hotel Saigon',
      accommodationType: 'hotel',
      starRating: '0',
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCheckIn: '14:00',
      defaultCheckOut: '12:00',
      enforceTimes: '1',
      longStayBillOnCheckIn: '1',
    }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(preservedProperty.status, 303, await preservedProperty.clone().text())
  const preservedPropertyPage = await e2e.client.get(preservedProperty.headers.get('location')!)
  assert.match(await preservedPropertyPage.text(), /123 Nguyễn Huệ, Thành phố Hồ Chí Minh/)

  const newProperty = await e2e.client.get('/admin/hospitality/properties/new?lang=en')
  const newPropertyHtml = await newProperty.text()
  assert.equal(newProperty.status, 200, newPropertyHtml)
  assert.match(newPropertyHtml, /Create property/)
  assert.match(newPropertyHtml, /type="time"[^>]*name="defaultCheckIn"[^>]*value="14:00"/)
  assert.doesNotMatch(newPropertyHtml, /hospitality_core\./)

  const invalidProperty = await e2e.client.post(
    '/admin/hospitality/properties/new?lang=en',
    new URLSearchParams({
      code: 'TZ-BAD',
      name: 'Invalid timezone property',
      accommodationType: 'hotel',
      starRating: '0',
      timezone: 'Asia/Nowhere',
      defaultCheckIn: '14:00',
      defaultCheckOut: '12:00',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const invalidPropertyHtml = await invalidProperty.text()
  assert.equal(invalidProperty.status, 200, invalidPropertyHtml)
  assert.match(invalidPropertyHtml, /Timezone must be a valid IANA name/)

  const createdProperty = await e2e.client.post(
    '/admin/hospitality/properties/new?lang=vi',
    new URLSearchParams({
      code: 'DAD',
      name: 'Két Hotel Đà Nẵng',
      publicName: 'Két Riverside',
      accommodationType: 'boutique',
      starRating: '4',
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCheckIn: '15:00',
      defaultCheckOut: '11:00',
      enforceTimes: '1',
      longStayBillOnCheckIn: '1',
      minimumGuestAge: '18',
      description: 'Khách sạn ven sông dành cho chuyến đi thành phố.',
      houseRules: 'Không hút thuốc trong phòng.',
    }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(createdProperty.status, 303, await createdProperty.clone().text())
  const propertyLocation = createdProperty.headers.get('location') ?? ''
  assert.match(propertyLocation, /^\/admin\/hospitality\/properties\/[^?]+\?status=created&lang=vi$/)
  const propertyDetailPath = propertyLocation.split('?')[0]!
  const createdPropertyId = propertyDetailPath.split('/').at(-1)!
  const createdPropertyPage = await e2e.client.get(propertyLocation)
  const createdPropertyHtml = await createdPropertyPage.text()
  assert.match(createdPropertyHtml, /Đã tạo cơ sở lưu trú/)
  assert.match(createdPropertyHtml, /Két Riverside/)
  assert.match(createdPropertyHtml, /15:00/)
  assert.doesNotMatch(createdPropertyHtml, /hospitality_core\./)

  const updatedProperty = await e2e.client.post(
    `${propertyDetailPath}?lang=en`,
    new URLSearchParams({
      code: 'DAD',
      name: 'Ket Hotel Da Nang',
      publicName: 'Ket Riverside Hotel',
      accommodationType: 'boutique',
      starRating: '5',
      timezone: 'Asia/Ho_Chi_Minh',
      defaultCheckIn: '15:00',
      defaultCheckOut: '11:00',
      enforceTimes: '1',
      childrenStayFree: '1',
      minimumGuestAge: '18',
      description: 'A riverside city stay.',
      houseRules: 'No smoking in guest rooms.',
    }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(updatedProperty.status, 303, await updatedProperty.clone().text())
  const updatedPropertyPage = await e2e.client.get(updatedProperty.headers.get('location')!)
  const updatedPropertyHtml = await updatedPropertyPage.text()
  assert.match(updatedPropertyHtml, /Property settings saved/)
  assert.match(updatedPropertyHtml, /Ket Riverside Hotel/)
  assert.match(updatedPropertyHtml, /value="5"/)
  assert.doesNotMatch(updatedPropertyHtml, /hospitality_core\./)

  const roomTypeList = await e2e.client.get('/admin/hospitality/room-types?property=hotel&lang=en')
  const roomTypeListHtml = await roomTypeList.text()
  assert.equal(roomTypeList.status, 200, roomTypeListHtml)
  assert.match(roomTypeListHtml, /Create room type/)
  assert.match(roomTypeListHtml, /\/admin\/hospitality\/room-types\/deluxe\?lang=en/)
  assert.doesNotMatch(roomTypeListHtml, /hospitality_core\./)

  const newRoomType = await e2e.client.get(
    `/admin/hospitality/room-types/new?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
  )
  const newRoomTypeHtml = await newRoomType.text()
  assert.equal(newRoomType.status, 200, newRoomTypeHtml)
  assert.match(newRoomTypeHtml, /Tạo loại phòng/)
  assert.match(newRoomTypeHtml, /type="color"[^>]*name="color"[^>]*value="#2563eb"/)
  assert.doesNotMatch(newRoomTypeHtml, /hospitality_core\./)

  const invalidRoomType = await e2e.client.post(
    '/admin/hospitality/room-types/new?lang=en',
    new URLSearchParams({
      propertyId: 'hotel',
      code: 'BAD-RATE',
      name: 'Invalid rate room',
      defaultCapacity: '4',
      maxAdults: '2',
      maxChildren: '1',
      maxInfants: '0',
      maxExtraBeds: '0',
      baseRate: '1',
      viewType: 'space',
      color: 'blue',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const invalidRoomTypeHtml = await invalidRoomType.text()
  assert.equal(invalidRoomType.status, 200, invalidRoomTypeHtml)
  assert.match(invalidRoomTypeHtml, /Default guests cannot exceed/)
  assert.match(invalidRoomTypeHtml, /View type is invalid/)
  assert.match(invalidRoomTypeHtml, /#RRGGBB/)

  const invalidDecimalRoomType = await e2e.client.post(
    '/admin/hospitality/room-types/new?lang=en',
    new URLSearchParams({
      propertyId: 'hotel',
      code: 'BAD-DECIMAL',
      name: 'Invalid decimal room',
      defaultCapacity: '2',
      maxAdults: '2',
      maxChildren: '0',
      maxInfants: '0',
      maxExtraBeds: '0',
      baseRate: 'invalid',
      color: '#2563eb',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const invalidDecimalRoomTypeHtml = await invalidDecimalRoomType.text()
  assert.equal(invalidDecimalRoomType.status, 200, invalidDecimalRoomTypeHtml)
  assert.match(invalidDecimalRoomTypeHtml, /valid decimal number/)

  const createdRoomType = await e2e.client.post(
    `/admin/hospitality/room-types/new?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
    new URLSearchParams({
      propertyId: createdPropertyId,
      code: 'RIVER-DLX',
      name: 'Deluxe ven sông',
      publicName: 'Deluxe River View',
      description: 'Phòng hướng sông với khu vực làm việc riêng.',
      defaultCapacity: '3',
      maxAdults: '2',
      maxChildren: '1',
      maxInfants: '1',
      maxExtraBeds: '1',
      sizeSqm: '31.5',
      viewType: 'river',
      baseRate: '1850000.50',
      color: '#0f766e',
      published: '1',
    }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(createdRoomType.status, 303, await createdRoomType.clone().text())
  const roomTypeLocation = createdRoomType.headers.get('location') ?? ''
  assert.match(roomTypeLocation, /^\/admin\/hospitality\/room-types\/[^?]+\?status=created&lang=vi$/)
  const roomTypeDetailPath = roomTypeLocation.split('?')[0]!
  const createdRoomTypePage = await e2e.client.get(roomTypeLocation)
  const createdRoomTypeHtml = await createdRoomTypePage.text()
  assert.match(createdRoomTypeHtml, /Đã tạo loại phòng/)
  assert.match(createdRoomTypeHtml, /Deluxe River View/)
  assert.match(createdRoomTypeHtml, /value="river" selected/)
  assert.match(createdRoomTypeHtml, /type="color"[^>]*value="#0f766e"/)
  assert.doesNotMatch(createdRoomTypeHtml, /hospitality_core\./)

  const updatedRoomType = await e2e.client.post(
    `${roomTypeDetailPath}?lang=en`,
    new URLSearchParams({
      propertyId: createdPropertyId,
      code: 'RIVER-DLX',
      name: 'River Deluxe',
      publicName: 'River Deluxe Suite',
      description: 'An updated river-facing room type.',
      defaultCapacity: '2',
      maxAdults: '2',
      maxChildren: '1',
      maxInfants: '1',
      maxExtraBeds: '1',
      sizeSqm: '32',
      viewType: 'river',
      baseRate: '1950000',
      color: '#115e59',
      published: '1',
    }),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    },
  )
  assert.equal(updatedRoomType.status, 303, await updatedRoomType.clone().text())
  const updatedRoomTypePage = await e2e.client.get(updatedRoomType.headers.get('location')!)
  const updatedRoomTypeHtml = await updatedRoomTypePage.text()
  assert.match(updatedRoomTypeHtml, /Room type saved/)
  assert.match(updatedRoomTypeHtml, /River Deluxe Suite/)
  assert.match(updatedRoomTypeHtml, /value="1950000"/)
  assert.doesNotMatch(updatedRoomTypeHtml, /hospitality_core\./)

  const buildingCreated = await e2e.client.post(
    `/admin/hospitality/rooms?property=${encodeURIComponent(createdPropertyId)}&lang=en`,
    new URLSearchParams({
      operation: 'save-building',
      propertyId: createdPropertyId,
      code: 'RIVER',
      name: 'River Tower',
      sequence: '10',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(buildingCreated.status, 303, await buildingCreated.clone().text())
  const buildingPage = await e2e.client.get(buildingCreated.headers.get('location')!)
  const buildingHtml = await buildingPage.text()
  assert.match(buildingHtml, /Building added/)
  assert.match(buildingHtml, /River Tower/)
  const buildingId = buildingHtml.match(
    /<select[^>]*name="buildingId"[^>]*>[\s\S]*?<option value="([^"]+)"/,
  )?.[1]
  assert.ok(buildingId)

  const floorCreated = await e2e.client.post(
    `/admin/hospitality/rooms?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
    new URLSearchParams({
      operation: 'save-floor',
      propertyId: createdPropertyId,
      buildingId,
      code: '01',
      name: 'Tầng sông',
      sequence: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(floorCreated.status, 303, await floorCreated.clone().text())
  const floorPage = await e2e.client.get(floorCreated.headers.get('location')!)
  const floorHtml = await floorPage.text()
  assert.match(floorHtml, /Đã thêm tầng/)
  assert.match(floorHtml, /Tầng sông/)
  const floorDetailPath = floorHtml
    .match(/\/admin\/hospitality\/levels\/([^"?]+)\?lang=vi/)?.[0]
    .split('?')[0]
  assert.ok(floorDetailPath)

  const buildingDetailPage = await e2e.client.get(`/admin/hospitality/buildings/${buildingId}?lang=en`)
  const buildingDetailHtml = await buildingDetailPage.text()
  assert.equal(buildingDetailPage.status, 200, buildingDetailHtml)
  assert.match(buildingDetailHtml, /Archive building/)
  assert.match(buildingDetailHtml, /River Tower/)
  assert.doesNotMatch(
    buildingDetailHtml,
    /Building record|data-ui="breadcrumbs"|data-ui="record-thumbnail"|data-ui="record-kicker"/,
  )
  assert.doesNotMatch(buildingDetailHtml, /hospitality_core\./)

  const buildingUpdated = await e2e.client.post(
    `/admin/hospitality/buildings/${buildingId}?lang=en`,
    new URLSearchParams({
      propertyId: createdPropertyId,
      code: 'RIVER',
      name: 'River Wing',
      sequence: '12',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(buildingUpdated.status, 303, await buildingUpdated.clone().text())
  const buildingUpdatedHtml = await (await e2e.client.get(buildingUpdated.headers.get('location')!)).text()
  assert.match(buildingUpdatedHtml, /Building saved/)
  assert.match(buildingUpdatedHtml, /River Wing/)

  const floorDetailPage = await e2e.client.get(`${floorDetailPath}?lang=vi`)
  const floorDetailHtml = await floorDetailPage.text()
  assert.equal(floorDetailPage.status, 200, floorDetailHtml)
  assert.match(floorDetailHtml, /Lưu trữ tầng/)
  assert.match(floorDetailHtml, /River Wing/)
  assert.doesNotMatch(
    floorDetailHtml,
    /Hồ sơ tầng|data-ui="breadcrumbs"|data-ui="record-thumbnail"|data-ui="record-kicker"|hospitality_core\./,
  )

  const floorUpdated = await e2e.client.post(
    `${floorDetailPath}?lang=vi`,
    new URLSearchParams({
      propertyId: createdPropertyId,
      buildingId,
      code: '01',
      name: 'Tầng ven sông',
      sequence: '2',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(floorUpdated.status, 303, await floorUpdated.clone().text())
  const floorUpdatedHtml = await (await e2e.client.get(floorUpdated.headers.get('location')!)).text()
  assert.match(floorUpdatedHtml, /Đã lưu tầng/)
  assert.match(floorUpdatedHtml, /Tầng ven sông/)

  const blockedBuildingArchive = await e2e.client.post(
    `/admin/hospitality/buildings/${buildingId}/archive?lang=vi`,
    new URLSearchParams({ action: 'archive' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const blockedBuildingArchiveHtml = await blockedBuildingArchive.text()
  assert.equal(blockedBuildingArchive.status, 200, blockedBuildingArchiveHtml)
  assert.match(blockedBuildingArchiveHtml, /vẫn còn tầng hoạt động/)

  const floorArchived = await e2e.client.post(
    `${floorDetailPath}/archive?lang=en`,
    new URLSearchParams({ action: 'archive' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(floorArchived.status, 303, await floorArchived.clone().text())
  const buildingArchived = await e2e.client.post(
    `/admin/hospitality/buildings/${buildingId}/archive?lang=en`,
    new URLSearchParams({ action: 'archive' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(buildingArchived.status, 303, await buildingArchived.clone().text())

  const blockedFloorRestore = await e2e.client.post(
    `${floorDetailPath}/archive?lang=en`,
    new URLSearchParams({ action: 'restore' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const blockedFloorRestoreHtml = await blockedFloorRestore.text()
  assert.equal(blockedFloorRestore.status, 200, blockedFloorRestoreHtml)
  assert.match(blockedFloorRestoreHtml, /location is archived/)

  const buildingRestored = await e2e.client.post(
    `/admin/hospitality/buildings/${buildingId}/archive?lang=en`,
    new URLSearchParams({ action: 'restore' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(buildingRestored.status, 303, await buildingRestored.clone().text())
  const floorRestored = await e2e.client.post(
    `${floorDetailPath}/archive?lang=en`,
    new URLSearchParams({ action: 'restore' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(floorRestored.status, 303, await floorRestored.clone().text())

  const newRoom = await e2e.client.get(
    `/admin/hospitality/rooms/new?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
  )
  const newRoomHtml = await newRoom.text()
  assert.equal(newRoom.status, 200, newRoomHtml)
  assert.match(newRoomHtml, /Tạo phòng vật lý/)
  assert.doesNotMatch(newRoomHtml, /name="status"/)
  const floorId = newRoomHtml.match(/<select[^>]*name="floorId"[^>]*>[\s\S]*?<option value="([^"]+)"/)?.[1]
  assert.ok(floorId)

  const createdRoomTypeId = roomTypeDetailPath.split('/').at(-1)!
  const physicalRoomCreated = await e2e.client.post(
    `/admin/hospitality/rooms/new?property=${encodeURIComponent(createdPropertyId)}&lang=vi`,
    new URLSearchParams({
      propertyId: createdPropertyId,
      roomTypeId: createdRoomTypeId,
      buildingId,
      floorId,
      code: 'R101',
      name: 'Phòng ven sông 101',
      capacity: '3',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(physicalRoomCreated.status, 303, await physicalRoomCreated.clone().text())
  const roomLocation = physicalRoomCreated.headers.get('location') ?? ''
  assert.match(roomLocation, /^\/admin\/hospitality\/rooms\/[^?]+\?status=created&lang=vi$/)
  const roomDetailPath = roomLocation.split('?')[0]!
  const physicalRoomPage = await e2e.client.get(roomLocation)
  const physicalRoomHtml = await physicalRoomPage.text()
  assert.match(physicalRoomHtml, /Đã tạo phòng vật lý/)
  assert.match(physicalRoomHtml, /Phòng ven sông 101/)
  assert.match(physicalRoomHtml, /River Wing · Tầng ven sông/)
  assert.doesNotMatch(physicalRoomHtml, /name="status"/)
  assert.doesNotMatch(physicalRoomHtml, /hospitality_core\./)

  const blockedFloorWithRoom = await e2e.client.post(
    `${floorDetailPath}/archive?lang=en`,
    new URLSearchParams({ action: 'archive' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  )
  const blockedFloorWithRoomHtml = await blockedFloorWithRoom.text()
  assert.equal(blockedFloorWithRoom.status, 200, blockedFloorWithRoomHtml)
  assert.match(blockedFloorWithRoomHtml, /still has active rooms/)

  const physicalRoomUpdated = await e2e.client.post(
    `${roomDetailPath}?lang=en`,
    new URLSearchParams({
      propertyId: createdPropertyId,
      roomTypeId: createdRoomTypeId,
      buildingId,
      floorId,
      code: 'R101',
      name: 'River Room 101',
      capacity: '4',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(physicalRoomUpdated.status, 303, await physicalRoomUpdated.clone().text())
  const physicalRoomUpdatedPage = await e2e.client.get(physicalRoomUpdated.headers.get('location')!)
  const physicalRoomUpdatedHtml = await physicalRoomUpdatedPage.text()
  assert.match(physicalRoomUpdatedHtml, /Room settings saved/)
  assert.match(physicalRoomUpdatedHtml, /River Room 101/)
  assert.match(physicalRoomUpdatedHtml, /value="4"/)
  assert.doesNotMatch(physicalRoomUpdatedHtml, /hospitality_core\./)

  const physicalRoomArchived = await e2e.client.post(
    `${roomDetailPath}/archive?lang=vi`,
    new URLSearchParams({ action: 'archive' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(physicalRoomArchived.status, 303, await physicalRoomArchived.clone().text())
  const physicalRoomArchivedPage = await e2e.client.get(physicalRoomArchived.headers.get('location')!)
  const physicalRoomArchivedHtml = await physicalRoomArchivedPage.text()
  assert.match(physicalRoomArchivedHtml, /Đã lưu trữ phòng/)
  assert.match(physicalRoomArchivedHtml, /Khôi phục phòng/)
  assert.doesNotMatch(physicalRoomArchivedHtml, /hospitality_core\./)

  const physicalRoomRestored = await e2e.client.post(
    `${roomDetailPath}/archive?lang=en`,
    new URLSearchParams({ action: 'restore' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(physicalRoomRestored.status, 303, await physicalRoomRestored.clone().text())
  const physicalRoomRestoredHtml = await (
    await e2e.client.get(physicalRoomRestored.headers.get('location')!)
  ).text()
  assert.match(physicalRoomRestoredHtml, /Room restored/)
  assert.match(physicalRoomRestoredHtml, /Archive room/)
  assert.doesNotMatch(physicalRoomRestoredHtml, /hospitality_core\./)

  const directQuote = await e2e.client.post(
    '/admin/hospitality/reservations',
    new URLSearchParams({
      operation: 'quote',
      lang: 'vi',
      property: 'hotel',
      id: 'direct-web',
      code: 'WEB-001',
      partnerId: 'guest',
      roomTypeId: 'deluxe',
      bookingType: 'nightly',
      checkIn: '2026-08-22T14:00',
      checkOut: '2026-08-23T12:00',
      adults: '2',
      children: '0',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(directQuote.status, 303, await directQuote.clone().text())
  assert.match(directQuote.headers.get('location') ?? '', /status=quoted/)
  const quotePage = await e2e.client.get(directQuote.headers.get('location')!)
  const quoteHtml = await quotePage.text()
  assert.equal(quotePage.status, 200)
  assert.match(quoteHtml, /Báo giá sẵn sàng/)
  assert.match(quoteHtml, /100/)
  assert.match(quoteHtml, /data-route-modal="true"/)
  assert.doesNotMatch(quoteHtml, /hospitality_core\./)

  const impossibleLocalDate = await e2e.client.post(
    '/admin/hospitality/reservations',
    new URLSearchParams({
      operation: 'quote',
      lang: 'vi',
      property: 'hotel',
      id: 'invalid-local-date',
      partnerId: 'guest',
      roomTypeId: 'deluxe',
      bookingType: 'nightly',
      checkIn: '2026-02-31T14:00',
      checkOut: '2026-03-04T12:00',
      adults: '1',
      children: '0',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(impossibleLocalDate.status, 303, await impossibleLocalDate.clone().text())
  assert.match(impossibleLocalDate.headers.get('location') ?? '', /status=invalid/)

  const confirmDirect = () =>
    e2e.client.post(
      '/admin/hospitality/reservations',
      new URLSearchParams({
        operation: 'create',
        lang: 'vi',
        property: 'hotel',
        id: 'direct-web',
        code: 'WEB-001',
        partnerId: 'guest',
        roomTypeId: 'deluxe',
        bookingType: 'nightly',
        checkIn: '2026-08-22T14:00',
        checkOut: '2026-08-23T12:00',
        adults: '2',
        children: '0',
        rate: '100',
      }),
      { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
    )
  const directCreated = await confirmDirect()
  assert.equal(directCreated.status, 303, await directCreated.clone().text())
  assert.match(directCreated.headers.get('location') ?? '', /status=saved/)
  const directRetried = await confirmDirect()
  assert.equal(directRetried.status, 303, await directRetried.clone().text())
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const count = await adapter.all(
      `SELECT COUNT(*) AS n FROM hospitality_core_reservation WHERE id = 'direct-web'`,
    )
    assert.equal(Number(count[0]?.n), 1, 'a retried confirmation keeps the same reservation')
  })
  const directDetailVi = await e2e.client.get('/admin/hospitality/reservations/direct-web?lang=vi')
  assert.equal(directDetailVi.status, 200)
  const directDetailViHtml = await directDetailVi.text()
  assert.match(directDetailViHtml, /WEB-001/)
  assert.match(directDetailViHtml, /Cập nhật đặt phòng/)
  assert.match(directDetailViHtml, /Nhận phòng/)
  assert.doesNotMatch(directDetailViHtml, /hospitality_core\./)
  const directDetailEn = await e2e.client.get('/admin/hospitality/reservations/direct-web?lang=en')
  assert.equal(directDetailEn.status, 200)
  const directDetailEnHtml = await directDetailEn.text()
  assert.match(directDetailEnHtml, /Check in/)
  assert.match(directDetailEnHtml, /Update reservation/)
  assert.match(directDetailEnHtml, /Cancel reservation/)
  assert.doesNotMatch(directDetailEnHtml, /hospitality_core\./)
  const directAmended = await e2e.client.post(
    '/admin/hospitality/reservations/direct-web?lang=vi',
    new URLSearchParams({
      operation: 'amend',
      lang: 'vi',
      partnerId: 'guest',
      roomTypeId: 'deluxe',
      checkIn: '2026-08-23T14:00',
      checkOut: '2026-08-25T12:00',
      adults: '2',
      children: '0',
      rate: '120',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(directAmended.status, 303, await directAmended.clone().text())
  assert.match(directAmended.headers.get('location') ?? '', /status=amended/)
  const amendedPage = await e2e.client.get(directAmended.headers.get('location')!)
  const amendedHtml = await amendedPage.text()
  assert.match(amendedHtml, /Đã cập nhật đặt phòng/)
  assert.match(amendedHtml, /240/)
  assert.doesNotMatch(amendedHtml, /hospitality_core\./)
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    await adapter.exec(`UPDATE hospitality_core_reservation SET provider = 'exely' WHERE id = 'direct-web'`)
  })
  const externalDetail = await e2e.client.get('/admin/hospitality/reservations/direct-web?lang=en')
  const externalDetailHtml = await externalDetail.text()
  assert.match(externalDetailHtml, /Exely/)
  assert.doesNotMatch(externalDetailHtml, /Update reservation/)
  assert.doesNotMatch(externalDetailHtml, /hospitality_core\.provider/)
  const directCancelled = await e2e.client.post(
    '/admin/hospitality/reservations/direct-web?lang=vi',
    new URLSearchParams({ operation: 'cancel', lang: 'vi', reason: 'Khách đổi lịch' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(directCancelled.status, 303, await directCancelled.clone().text())
  assert.match(directCancelled.headers.get('location') ?? '', /status=cancelled/)
  const cancelledPage = await e2e.client.get(directCancelled.headers.get('location')!)
  const cancelledHtml = await cancelledPage.text()
  assert.match(cancelledHtml, /Đã hủy đặt phòng/)
  assert.match(cancelledHtml, /Khách đổi lịch/)

  const noShowCreated = await e2e.client.call<Row>('hospitality_core.createReservation', {
    id: 'no-show-web',
    code: 'WEB-NOSHOW',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    partnerId: 'guest',
    bookingType: 'nightly',
    checkIn: '2026-08-20T14:00:00.000Z',
    checkOut: '2026-08-21T12:00:00.000Z',
    rate: '100',
  })
  assert.equal(noShowCreated.value.ok, true)
  const noShowDetailEn = await e2e.client.get('/admin/hospitality/reservations/no-show-web?lang=en')
  const noShowDetailEnHtml = await noShowDetailEn.text()
  assert.match(noShowDetailEnHtml, /Mark guest as no-show/)
  assert.match(noShowDetailEnHtml, /No-show note/)
  assert.doesNotMatch(noShowDetailEnHtml, /hospitality_core\./)
  const noShowMarked = await e2e.client.post(
    '/admin/hospitality/reservations/no-show-web?lang=vi',
    new URLSearchParams({ operation: 'no-show', lang: 'vi', reason: 'Không liên lạc được với khách' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(noShowMarked.status, 303, await noShowMarked.clone().text())
  assert.match(noShowMarked.headers.get('location') ?? '', /status=no-show/)
  const noShowPage = await e2e.client.get(noShowMarked.headers.get('location')!)
  const noShowHtml = await noShowPage.text()
  assert.match(noShowHtml, /Đã ghi nhận khách không đến/)
  assert.match(noShowHtml, /Khách không đến/)
  assert.doesNotMatch(noShowHtml, /hospitality_core\./)

  const contentUpload = new FormData()
  contentUpload.set(
    'file',
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'hotel-e2e.png', {
      type: 'image/png',
    }),
  )
  const uploaded = await e2e.client.post(
    '/admin/hospitality/content/upload?lang=en&property=hotel&target=property',
    contentUpload,
    { redirect: 'manual' },
  )
  assert.equal(uploaded.status, 303, await uploaded.clone().text())
  assert.match(uploaded.headers.get('location') ?? '', /status=saved/)
  const contentMedia = await e2e.client.call<Row[]>('hospitality_core.listContentImages', {
    propertyId: 'hotel',
  })
  assert.equal(contentMedia.value.length, 1)
  assert.equal(contentMedia.value[0]!.primary, true)
  const downloaded = await e2e.client.get(`/files/${contentMedia.value[0]!.attachmentId}`)
  assert.equal(downloaded.status, 200)
  assert.equal(downloaded.headers.get('content-type'), 'image/png')
  const booked = await e2e.client.call<Row>(
    'hospitality_core.createReservation',
    {
      id: 'booking-1',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      partnerId: 'guest',
      bookingType: 'nightly',
      checkIn: '2026-08-20T14:00:00.000Z',
      checkOut: '2026-08-21T12:00:00.000Z',
      rate: '100',
      createdAt: '2026-08-20T01:00:00.000Z',
    },
    { idempotencyKey: 'hospitality-booking-1' },
  )
  assert.equal(booked.value.ok, true)
  assert.equal(booked.writes.length, 9, 'booking, room-night inventory and change signal commit together')
  const stayIntake = await e2e.client.get('/admin/hospitality/stays/booking-1%3Astay?lang=vi')
  assert.equal(stayIntake.status, 200)
  assert.match(await stayIntake.text(), /Lưu giấy tờ tùy thân/)
  const guestDocument = await e2e.client.post(
    '/admin/hospitality/stays/booking-1%3Astay?lang=vi',
    new URLSearchParams({
      operation: 'save-document',
      lang: 'vi',
      documentId: 'booking-1-document',
      partnerId: 'guest',
      type: 'cccd',
      number: '079203001234',
      fullName: 'Nguyễn An',
      dateOfBirth: '1990-05-12',
      nationality: 'VN',
      permanentAddress: '12 Đường Riêng Tư',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(guestDocument.status, 303, await guestDocument.clone().text())
  assert.match(guestDocument.headers.get('location') ?? '', /status=document-saved/)
  const documentPage = await e2e.client.get(guestDocument.headers.get('location')!)
  const documentHtml = await documentPage.text()
  assert.match(documentHtml, /Đã lưu giấy tờ tùy thân/)
  assert.match(documentHtml, /•••• 1234/)
  assert.doesNotMatch(documentHtml, /079203001234|12 Đường Riêng Tư|hospitality_core\./)

  const rateSaved = await e2e.client.post(
    '/admin/hospitality/rate-plans?lang=vi',
    new URLSearchParams({
      operation: 'save-rate-plan',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      code: 'WEB-FLEX',
      name: 'Giá trực tiếp',
      rateType: 'nightly',
      amount: '120',
      minStay: '0',
      maxStay: '0',
      active: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(rateSaved.status, 303, await rateSaved.clone().text())
  assert.match(rateSaved.headers.get('location') ?? '', /status=saved/)
  const inventorySaved = await e2e.client.post(
    '/admin/hospitality/inventory?lang=vi',
    new URLSearchParams({
      operation: 'set-inventory',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      from: '2026-08-20',
      to: '2026-08-20',
      total: '1',
      blocked: '0',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(inventorySaved.status, 303, await inventorySaved.clone().text())
  assert.match(inventorySaved.headers.get('location') ?? '', /status=saved/)
  const inventoryRejected = await e2e.client.post(
    '/admin/hospitality/inventory?lang=vi',
    new URLSearchParams({
      operation: 'set-inventory',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      from: '2026-08-20',
      to: '2026-08-20',
      total: '0',
      blocked: '0',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(inventoryRejected.status, 303, await inventoryRejected.clone().text())
  assert.match(inventoryRejected.headers.get('location') ?? '', /status=invalid/)

  const feeSaved = await e2e.client.post(
    '/admin/hospitality/services?lang=vi&property=hotel',
    new URLSearchParams({
      operation: 'save-property-charge',
      id: 'city-tax',
      propertyId: 'hotel',
      chargeType: 'city_tax',
      name: 'Thuế thành phố',
      amount: '20',
      active: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(feeSaved.status, 303, await feeSaved.clone().text())
  assert.match(feeSaved.headers.get('location') ?? '', /status=saved/)
  const extraSaved = await e2e.client.post(
    '/admin/hospitality/services?lang=vi&property=hotel',
    new URLSearchParams({
      operation: 'save-extra-line',
      id: 'breakfast-extra',
      target: 'reservation:booking-1',
      productId: 'breakfast',
      quantity: '1',
      recurrence: 'once',
      active: '1',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(extraSaved.status, 303, await extraSaved.clone().text())
  assert.match(extraSaved.headers.get('location') ?? '', /status=saved/)
  const extraPosted = await e2e.client.post(
    '/admin/hospitality/services?lang=vi&property=hotel',
    new URLSearchParams({
      operation: 'materialize-extra',
      id: 'breakfast-extra',
      requestKey: 'e2e-breakfast',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(extraPosted.status, 303, await extraPosted.clone().text())
  assert.match(extraPosted.headers.get('location') ?? '', /status=saved/)

  const checkedIn = await e2e.client.post(
    '/admin/hospitality/reservations/booking-1?lang=vi',
    new URLSearchParams({ operation: 'check-in', lang: 'vi', roomId: '101' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(checkedIn.status, 303, await checkedIn.clone().text())
  assert.match(checkedIn.headers.get('location') ?? '', /status=checked-in/)
  const checkedInPage = await e2e.client.get(checkedIn.headers.get('location')!)
  const checkedInHtml = await checkedInPage.text()
  assert.match(checkedInHtml, /Đã nhận phòng/)
  assert.match(checkedInHtml, /Trả phòng/)
  assert.match(checkedInHtml, /Điều chỉnh ngày trả phòng/)
  assert.doesNotMatch(checkedInHtml, /hospitality_core\./)

  // The field is a datetime-local, read in the property's timezone. Building it
  // from toISOString() spells the instant in UTC, so once UTC and Ho Chi Minh
  // City fall on different dates — every day from 17:00 UTC — "tomorrow" arrived
  // as tomorrow-in-UTC, which is still today where the property is. The stay then
  // had no night left to release and the early checkout stopped being early.
  const adjustedCheckOut = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
    .slice(0, 16)
    .replace(' ', 'T')
  const departureAdjusted = await e2e.client.post(
    '/admin/hospitality/reservations/booking-1?lang=vi',
    new URLSearchParams({
      operation: 'adjust-departure',
      lang: 'vi',
      checkOut: adjustedCheckOut,
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(departureAdjusted.status, 303, await departureAdjusted.clone().text())
  assert.match(departureAdjusted.headers.get('location') ?? '', /status=departure-adjusted/)
  const departurePage = await e2e.client.get(departureAdjusted.headers.get('location')!)
  const departureHtml = await departurePage.text()
  assert.match(departureHtml, /Đã cập nhật ngày trả phòng/)
  assert.ok(departureHtml.includes(`value="${adjustedCheckOut}"`))
  assert.doesNotMatch(departureHtml, /hospitality_core\./)
  const departurePageEn = await e2e.client.get('/admin/hospitality/reservations/booking-1?lang=en')
  const departureHtmlEn = await departurePageEn.text()
  assert.match(departureHtmlEn, /Adjust departure/)
  assert.ok(departureHtmlEn.includes(`value="${adjustedCheckOut}"`))
  assert.doesNotMatch(departureHtmlEn, /hospitality_core\./)

  const stayDetailEn = await e2e.client.get('/admin/hospitality/stays/booking-1%3Astay?lang=en')
  assert.equal(stayDetailEn.status, 200)
  const stayDetailEnHtml = await stayDetailEn.text()
  assert.match(stayDetailEnHtml, /Room assignment history/)
  assert.match(stayDetailEnHtml, /Add staying guest/)
  assert.doesNotMatch(stayDetailEnHtml, /Phòng đã lưu trữ/)
  assert.doesNotMatch(stayDetailEnHtml, /hospitality_core\./)
  const guestAdded = await e2e.client.post(
    '/admin/hospitality/stays/booking-1%3Astay?lang=vi',
    new URLSearchParams({
      operation: 'add-guest',
      lang: 'vi',
      displayName: 'Trần Bình',
      partnerId: 'companion',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(guestAdded.status, 303, await guestAdded.clone().text())
  assert.match(guestAdded.headers.get('location') ?? '', /status=guest-added/)
  const roomMoved = await e2e.client.post(
    '/admin/hospitality/stays/booking-1%3Astay?lang=vi',
    new URLSearchParams({
      operation: 'move-room',
      lang: 'vi',
      roomId: '102',
      reason: 'Khách cần phòng yên tĩnh hơn',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(roomMoved.status, 303, await roomMoved.clone().text())
  assert.match(roomMoved.headers.get('location') ?? '', /status=room-moved/)
  const movedPage = await e2e.client.get(roomMoved.headers.get('location')!)
  const movedHtml = await movedPage.text()
  assert.match(movedHtml, /Đã chuyển phòng/)
  assert.match(movedHtml, /Trần Bình/)
  assert.match(movedHtml, /Phòng 102/)
  assert.doesNotMatch(movedHtml, /hospitality_core\./)

  const folioDetailEn = await e2e.client.get('/admin/hospitality/folios/booking-1%3Afolio?lang=en')
  assert.equal(folioDetailEn.status, 200)
  const folioDetailEnHtml = await folioDetailEn.text()
  assert.match(folioDetailEnHtml, /Operational record only/)
  assert.match(folioDetailEnHtml, /Post charge/)
  assert.doesNotMatch(folioDetailEnHtml, /hospitality_core\./)
  const chargePosted = await e2e.client.post(
    '/admin/hospitality/folios/booking-1%3Afolio?lang=vi',
    new URLSearchParams({
      operation: 'post-charge',
      id: 'e2e-manual-charge',
      lang: 'vi',
      stayId: 'booking-1:stay',
      description: 'Dịch vụ spa',
      type: 'spa',
      quantity: '2',
      unitPrice: '10',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(chargePosted.status, 303, await chargePosted.clone().text())
  assert.match(chargePosted.headers.get('location') ?? '', /status=charge-posted/)
  const chargeVoided = await e2e.client.post(
    '/admin/hospitality/folios/booking-1%3Afolio?lang=vi',
    new URLSearchParams({
      operation: 'void-charge',
      lang: 'vi',
      chargeId: 'e2e-manual-charge',
      reason: 'Lễ tân ghi nhầm số lượng',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(chargeVoided.status, 303, await chargeVoided.clone().text())
  assert.match(chargeVoided.headers.get('location') ?? '', /status=charge-voided/)
  const correctedFolio = await e2e.client.get(chargeVoided.headers.get('location')!)
  const correctedFolioHtml = await correctedFolio.text()
  assert.match(correctedFolioHtml, /Đã hủy khoản phí/)
  assert.match(correctedFolioHtml, /Dịch vụ spa/)
  assert.doesNotMatch(correctedFolioHtml, /hospitality_core\./)
  assert.equal(await e2e.drainJobs(), 1)

  const stayNotice = await e2e.client.get(
    '/admin/hospitality/stay-notices?lang=vi&property=hotel&notice=booking-1%3Astay%3Anotice%3Abooking-1%3Aguest',
  )
  assert.equal(stayNotice.status, 200)
  const stayNoticeHtml = await stayNotice.text()
  assert.match(stayNoticeHtml, /Thông báo lưu trú/)
  assert.match(stayNoticeHtml, /•••• 1234/)
  assert.match(stayNoticeHtml, /Ghi nhận đã gửi/)
  assert.doesNotMatch(stayNoticeHtml, /079203001234|hospitality_core\./)

  const submission = await e2e.client.post(
    '/admin/hospitality/stay-notices?lang=vi&property=hotel',
    new URLSearchParams({
      operation: 'record-submission',
      id: 'booking-1:stay:notice:booking-1:guest',
      stayId: 'booking-1:stay',
      property: 'hotel',
      state: 'all',
      reason: 'tourism',
      channel: 'online',
      evidenceRef: 'DVC-E2E-0001',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(submission.status, 303, await submission.clone().text())
  assert.match(submission.headers.get('location') ?? '', /status=submitted/)
  const confirmation = await e2e.client.post(
    '/admin/hospitality/stay-notices?lang=vi&property=hotel',
    new URLSearchParams({
      operation: 'confirm',
      id: 'booking-1:stay:notice:booking-1:guest',
      stayId: 'booking-1:stay',
      property: 'hotel',
      state: 'all',
      receiptRef: 'DVC-E2E-0001',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(confirmation.status, 303, await confirmation.clone().text())
  assert.match(confirmation.headers.get('location') ?? '', /status=confirmed/)

  const auditQueued = await e2e.client.post(
    '/admin/hospitality/night-audit?lang=vi&property=hotel&auditDate=2026-08-20',
    new URLSearchParams({
      operation: 'request-night-audit',
      propertyId: 'hotel',
      auditDate: '2026-08-20',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(auditQueued.status, 303, await auditQueued.clone().text())
  assert.match(auditQueued.headers.get('location') ?? '', /status=queued/)

  const screens = [
    ['/admin/hospitality/front-desk?lang=vi&date=2026-08-20', 'Bàn lễ tân'],
    ['/admin/hospitality/tape-chart?lang=vi&from=2026-08-20', 'Lịch phòng'],
    ['/admin/hospitality/reservations?lang=vi', 'Đặt phòng'],
    ['/admin/hospitality/stays?lang=vi', 'Lưu trú'],
    ['/admin/hospitality/folios?lang=vi', 'Hồ sơ dịch vụ'],
    ['/admin/hospitality/properties?lang=vi', 'Cơ sở lưu trú'],
    ['/admin/hospitality/rooms?lang=vi', 'Sơ đồ phòng'],
    ['/admin/hospitality/room-types?lang=vi', 'Loại phòng'],
    [
      '/admin/hospitality/content?lang=vi&property=hotel&target=room_type%3Adeluxe',
      'Nội dung &amp; hình ảnh',
    ],
    ['/admin/hospitality/rate-plans?lang=vi', 'Giá bán'],
    ['/admin/hospitality/services?lang=vi&property=hotel', 'Dịch vụ &amp; phụ phí'],
    ['/admin/hospitality/night-audit?lang=vi&property=hotel&auditDate=2026-08-20', 'Chốt ngày vận hành'],
    ['/admin/hospitality/stay-notices?lang=vi&property=hotel', 'Thông báo lưu trú'],
    [
      '/admin/hospitality/inventory?lang=vi&property=hotel&roomType=deluxe&from=2026-08-20&to=2026-08-22',
      'Tồn kho &amp; hạn chế bán',
    ],
    ['/admin/hospitality/amenities?lang=vi', 'Danh mục tiện nghi'],
    ['/admin/hospitality/policies?lang=vi', 'Chính sách hủy'],
  ] as const
  for (const [path, title] of screens) {
    const response = await e2e.client.get(path)
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.doesNotMatch(html, /hospitality_core\./, path)
    assert.match(html, new RegExp(title), path)
    assert.doesNotMatch(html, /data-route-modal="true"/, path)
  }

  for (const path of [
    '/admin/hospitality/reservations?lang=vi&property=hotel&create=1',
    '/admin/hospitality/rate-plans?lang=vi&property=hotel&create=1',
    '/admin/hospitality/housekeeping?lang=vi&property=hotel&create=1',
    '/admin/hospitality/amenities?lang=vi&create=1',
    '/admin/hospitality/policies?lang=vi&create=1',
    '/admin/hospitality/billing/rules?lang=vi&create=1',
  ] as const) {
    const response = await e2e.client.get(path)
    const html = await response.text()
    assert.equal(response.status, 200, `${path}: ${html}`)
    assert.match(html, /data-ui="list-page"/, path)
    assert.match(html, /data-route-modal="true"/, path)
    assert.match(html, /role="dialog"/, path)
  }

  const overdueReservation = await seed('hospitality_core.createReservation', {
    id: 'overdue-booking',
    code: 'RES-OVERDUE',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    partnerId: 'companion',
    checkIn: '2026-08-18T07:00:00.000Z',
    checkOut: '2026-08-19T05:00:00.000Z',
    rate: '100',
  })
  assert.equal((overdueReservation.value as Row).ok, true)
  const overdueCheckIn = await seed('hospitality_core.checkIn', {
    stayId: 'overdue-booking:stay',
    roomId: '104',
    at: '2026-08-18T07:00:00.000Z',
  })
  assert.equal((overdueCheckIn.value as Row).ok, true)

  const frontDesk = await e2e.client.get('/admin/hospitality/front-desk?lang=vi&date=2026-08-20')
  const html = await frontDesk.text()
  assert.match(html, /Bàn lễ tân/)
  assert.match(html, /Nguyễn An/)
  assert.match(html, /Lưu trú quá giờ trả phòng/)
  assert.match(html, /RES-OVERDUE/)
  assert.match(html, /Trần Bình/)

  const english = await e2e.client.get('/admin/hospitality/front-desk?lang=en&date=2026-08-20')
  assert.equal(english.status, 200)
  const englishHtml = await english.text()
  assert.match(englishHtml, /Front desk/)
  assert.match(englishHtml, /Overdue departures/)
  assert.match(englishHtml, /RES-OVERDUE/)
  const englishServices = await e2e.client.get('/admin/hospitality/services?lang=en&property=hotel')
  assert.equal(englishServices.status, 200)
  const englishServicesHtml = await englishServices.text()
  assert.match(englishServicesHtml, /Services &amp; fees/)
  assert.doesNotMatch(englishServicesHtml, /hospitality_core\./)
  const englishAudit = await e2e.client.get(
    '/admin/hospitality/night-audit?lang=en&property=hotel&auditDate=2026-08-20',
  )
  assert.equal(englishAudit.status, 200)
  const englishAuditHtml = await englishAudit.text()
  assert.match(englishAuditHtml, /Night audit/)
  assert.doesNotMatch(englishAuditHtml, /hospitality_core\./)
  const englishStayNotices = await e2e.client.get('/admin/hospitality/stay-notices?lang=en&property=hotel')
  assert.equal(englishStayNotices.status, 200)
  const englishStayNoticesHtml = await englishStayNotices.text()
  assert.match(englishStayNoticesHtml, /Stay notices/)
  assert.match(englishStayNoticesHtml, /Confirmed/)
  assert.doesNotMatch(englishStayNoticesHtml, /079203001234|hospitality_core\./)

  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const stays = await adapter.all('SELECT state, "currentRoomId" FROM hospitality_core_stay WHERE id = ?', [
      'booking-1:stay',
    ])
    assert.deepEqual({ ...stays[0] }, { state: 'checked_in', currentRoomId: '102' })
    const notices = await adapter.all(
      'SELECT state, "packageHash", "submittedBy", "confirmedBy", "receiptRef" FROM hospitality_core_stay_notice WHERE id = ?',
      ['booking-1:stay:notice:booking-1:guest'],
    )
    assert.equal(notices[0]?.state, 'confirmed')
    assert.match(String(notices[0]?.packageHash), /^[a-f0-9]{64}$/)
    assert.equal(notices[0]?.submittedBy, 'admin')
    assert.equal(notices[0]?.confirmedBy, 'admin')
    assert.equal(notices[0]?.receiptRef, 'DVC-E2E-0001')
    const correction = await adapter.all(
      'SELECT state, "voidReason" FROM hospitality_core_charge WHERE id = ?',
      ['e2e-manual-charge'],
    )
    assert.deepEqual({ ...correction[0] }, { state: 'void', voidReason: 'Lễ tân ghi nhầm số lượng' })
  })

  const checkedOut = await e2e.client.post(
    '/admin/hospitality/reservations/booking-1?lang=vi',
    new URLSearchParams({ operation: 'check-out', lang: 'vi' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(checkedOut.status, 303, await checkedOut.clone().text())
  assert.match(checkedOut.headers.get('location') ?? '', /status=checked-out-early/)
  const checkedOutPage = await e2e.client.get(checkedOut.headers.get('location')!)
  const checkedOutHtml = await checkedOutPage.text()
  assert.match(checkedOutHtml, /Đã trả phòng sớm/)
  assert.match(checkedOutHtml, /Tồn phòng các đêm còn lại đã được hoàn/)
  assert.doesNotMatch(checkedOutHtml, /hospitality_core\./)

  const taskPath = '/admin/hospitality/housekeeping/tasks/checkout%3Abooking-1%3Astay'
  const taskVi = await e2e.client.get(`${taskPath}?lang=vi`)
  const taskViHtml = await taskVi.text()
  assert.equal(taskVi.status, 200, taskViHtml)
  assert.match(taskViHtml, /Việc dọn phòng HK-S-BOOKING-1/)
  assert.match(taskViHtml, /Bắt đầu thực hiện/)
  assert.doesNotMatch(taskViHtml, /hospitality_core\./)

  const startedTask = await e2e.client.post(
    `${taskPath}?lang=vi`,
    new URLSearchParams({ operation: 'start', lang: 'vi', assigneeId: 'housekeeper-01' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(startedTask.status, 303, await startedTask.clone().text())
  assert.match(startedTask.headers.get('location') ?? '', /status=started/)
  const taskEn = await e2e.client.get(`${taskPath}?lang=en`)
  const taskEnHtml = await taskEn.text()
  assert.equal(taskEn.status, 200, taskEnHtml)
  assert.match(taskEnHtml, /Cleaning task HK-S-BOOKING-1/)
  assert.match(taskEnHtml, /In progress/)
  assert.match(taskEnHtml, /housekeeper-01/)
  assert.doesNotMatch(taskEnHtml, /hospitality_core\./)

  const completedTask = await e2e.client.post(
    `${taskPath}?lang=en`,
    new URLSearchParams({ operation: 'complete', lang: 'en' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(completedTask.status, 303, await completedTask.clone().text())
  assert.match(completedTask.headers.get('location') ?? '', /status=completed/)
  const completedTaskPage = await e2e.client.get(completedTask.headers.get('location')!)
  const completedTaskHtml = await completedTaskPage.text()
  assert.match(completedTaskHtml, /Task completed/)
  assert.match(completedTaskHtml, /Completed at/)
  assert.doesNotMatch(completedTaskHtml, /hospitality_core\./)

  const createdTask = await e2e.client.post(
    '/admin/hospitality/housekeeping?lang=vi&property=hotel',
    new URLSearchParams({
      operation: 'create',
      lang: 'vi',
      id: 'manual-inspection',
      code: 'HK-MANUAL-001',
      propertyId: 'hotel',
      state: 'all',
      roomId: '102',
      taskType: 'inspection',
      priority: 'normal',
      assigneeId: 'supervisor-01',
      notes: 'Kiểm tra minibar sau khi vệ sinh.',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(createdTask.status, 303, await createdTask.clone().text())
  assert.match(createdTask.headers.get('location') ?? '', /status=created/)
  const createdTaskPage = await e2e.client.get(createdTask.headers.get('location')!)
  const createdTaskHtml = await createdTaskPage.text()
  assert.match(createdTaskHtml, /Đã tạo công việc buồng phòng/)
  assert.match(createdTaskHtml, /HK-MANUAL-001/)
  assert.doesNotMatch(createdTaskHtml, /hospitality_core\./)

  const roomBoard = await e2e.client.get('/admin/hospitality/housekeeping/rooms?lang=vi&property=hotel')
  const roomBoardHtml = await roomBoard.text()
  assert.equal(roomBoard.status, 200, roomBoardHtml)
  assert.match(roomBoardHtml, /Bảng trạng thái phòng/)
  assert.match(roomBoardHtml, /Phòng 103/)
  assert.doesNotMatch(roomBoardHtml, /Phòng đã lưu trữ/)
  assert.doesNotMatch(roomBoardHtml, /hospitality_core\./)

  const roomPath = '/admin/hospitality/housekeeping/rooms/103'
  const roomDetail = await e2e.client.get(`${roomPath}?lang=en`)
  const roomDetailHtml = await roomDetail.text()
  assert.equal(roomDetail.status, 200, roomDetailHtml)
  assert.match(roomDetailHtml, /Room 103/)
  assert.match(roomDetailHtml, /Take room out of service/)
  assert.doesNotMatch(roomDetailHtml, /hospitality_core\./)

  const maintainedRoom = await e2e.client.post(
    `${roomPath}?lang=en`,
    new URLSearchParams({
      operation: 'set-status',
      lang: 'en',
      expectedStatus: 'available',
      status: 'maintenance',
      note: 'Air-conditioning inspection.',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(maintainedRoom.status, 303, await maintainedRoom.clone().text())
  assert.match(maintainedRoom.headers.get('location') ?? '', /status=updated/)
  const maintainedPage = await e2e.client.get(maintainedRoom.headers.get('location')!)
  const maintainedHtml = await maintainedPage.text()
  assert.match(maintainedHtml, /Room status updated/)
  assert.match(maintainedHtml, /Air-conditioning inspection/)
  assert.match(maintainedHtml, /Return room to housekeeping/)

  const releasedRoom = await e2e.client.post(
    `${roomPath}?lang=vi`,
    new URLSearchParams({
      operation: 'set-status',
      lang: 'vi',
      expectedStatus: 'maintenance',
      status: 'dirty',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(releasedRoom.status, 303, await releasedRoom.clone().text())
  const releasedPage = await e2e.client.get(releasedRoom.headers.get('location')!)
  const releasedHtml = await releasedPage.text()
  assert.match(releasedHtml, /Đã cập nhật trạng thái phòng/)
  assert.match(releasedHtml, /Chưa vệ sinh/)
  const preselectedQueue = await e2e.client.get(
    '/admin/hospitality/housekeeping?lang=vi&property=hotel&room=103&create=1',
  )
  assert.match(await preselectedQueue.text(), /<option(?=[^>]*value="103")(?=[^>]*selected)[^>]*>/)

  for (const [path, title] of [
    ['/admin/hospitality/housekeeping?lang=vi', 'Việc dọn phòng'],
    ['/admin/hospitality/housekeeping/rooms?lang=vi', 'Bảng trạng thái phòng'],
  ] as const) {
    const response = await e2e.client.get(path)
    const page = await response.text()
    assert.equal(response.status, 200, `${path}: ${page}`)
    assert.match(page, new RegExp(title), path)
    assert.doesNotMatch(page, /hospitality_core\./, path)
  }

  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const tasks = await adapter.all(
      'SELECT id, state, priority, "roomId", "taskType" FROM hospitality_core_cleaning_task ORDER BY id',
    )
    assert.deepEqual(
      tasks.map((task) => ({ ...task })),
      [
        {
          id: 'checkout:booking-1:stay',
          state: 'done',
          priority: 'urgent',
          roomId: '102',
          taskType: 'checkout_clean',
        },
        {
          id: 'manual-inspection',
          state: 'todo',
          priority: 'normal',
          roomId: '102',
          taskType: 'inspection',
        },
        {
          id: 'move:booking-1:stay:assignment:1:clean',
          state: 'todo',
          priority: 'normal',
          roomId: '101',
          taskType: 'daily_clean',
        },
      ],
    )
    const cleanedRoom = await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['102'])
    assert.equal(cleanedRoom[0]?.status, 'available')
    const manualTask = await adapter.all(
      'SELECT "assigneeId", notes FROM hospitality_core_cleaning_task WHERE id = ?',
      ['manual-inspection'],
    )
    assert.deepEqual(
      { ...manualTask[0] },
      { assigneeId: 'supervisor-01', notes: 'Kiểm tra minibar sau khi vệ sinh.' },
    )
  })
})
