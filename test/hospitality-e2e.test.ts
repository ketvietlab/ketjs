import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from 'ketjs/testing'
import type { Row, Scope } from 'ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

const scope: Scope = { company: 'default', companies: ['default'], branches: null }

test('hospitality e2e: authenticated booking and front-desk flow crosses real HTTP', async (t) => {
  const e2e = await createTestApp(ketsuite, { worker: false })
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
  await seed('hospitality_core.saveProperty', {
    id: 'hotel',
    code: 'HCM',
    name: 'Ket Hotel',
    accommodationType: 'hotel',
    timezone: 'Asia/Ho_Chi_Minh',
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

  await e2e.client.login({ login: 'admin', password: 'hospitality-e2e' })
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

  const checkedIn = await e2e.client.call<Row>('hospitality_core.checkIn', {
    stayId: 'booking-1:stay',
    roomId: '101',
    assignmentId: 'booking-1:assignment',
    at: '2026-08-20T14:05:00.000Z',
  })
  assert.deepEqual(
    { ok: checkedIn.value.ok, state: checkedIn.value.state, roomId: checkedIn.value.roomId },
    { ok: true, state: 'checked_in', roomId: '101' },
  )

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
  }

  const frontDesk = await e2e.client.get('/admin/hospitality/front-desk?lang=vi&date=2026-08-20')
  const html = await frontDesk.text()
  assert.match(html, /Bàn lễ tân/)
  assert.match(html, /Nguyễn An/)

  const english = await e2e.client.get('/admin/hospitality/front-desk?lang=en&date=2026-08-20')
  assert.equal(english.status, 200)
  assert.match(await english.text(), /Front desk/)

  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const stays = await adapter.all('SELECT state, "currentRoomId" FROM hospitality_core_stay WHERE id = ?', [
      'booking-1:stay',
    ])
    assert.deepEqual({ ...stays[0] }, { state: 'checked_in', currentRoomId: '101' })
  })

  const checkedOut = await e2e.client.call<Row>('hospitality_core.checkOut', {
    stayId: 'booking-1:stay',
    at: '2026-08-21T12:00:00.000Z',
  })
  assert.equal(checkedOut.value.state, 'checked_out')
  assert.equal(checkedOut.writes.length, 6)

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
      'SELECT state, priority, "roomId" FROM hospitality_core_cleaning_task WHERE id = ?',
      ['checkout:booking-1:stay'],
    )
    assert.deepEqual({ ...tasks[0] }, { state: 'todo', priority: 'urgent', roomId: '101' })
  })
})
