import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestApp } from 'ketjs/testing'
import type { Row, Scope } from 'ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

const scope: Scope = { company: 'default', companies: ['default'], branches: null }

test('hospitality e2e: authenticated booking and front-desk flow crosses real HTTP', async (t) => {
  const e2e = await createTestApp(ketsuite)
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

  await e2e.client.login({ login: 'admin', password: 'hospitality-e2e' })
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
  assert.match(directDetailViHtml, /Nhận phòng/)
  assert.doesNotMatch(directDetailViHtml, /hospitality_core\./)
  const directDetailEn = await e2e.client.get('/admin/hospitality/reservations/direct-web?lang=en')
  assert.equal(directDetailEn.status, 200)
  const directDetailEnHtml = await directDetailEn.text()
  assert.match(directDetailEnHtml, /Check in/)
  assert.match(directDetailEnHtml, /Cancel reservation/)
  assert.doesNotMatch(directDetailEnHtml, /hospitality_core\./)
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
  const guestDocument = await e2e.client.call<Row>('hospitality_core.saveGuestDocument', {
    id: 'booking-1-document',
    stayId: 'booking-1:stay',
    partnerId: 'guest',
    type: 'cccd',
    number: '079203001234',
    fullName: 'Nguyễn An',
    dateOfBirth: '1990-05-12T00:00:00.000Z',
    ocrState: 'done',
  })
  assert.equal(guestDocument.value.ok, true)

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
  assert.doesNotMatch(checkedInHtml, /hospitality_core\./)
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
  }

  const frontDesk = await e2e.client.get('/admin/hospitality/front-desk?lang=vi&date=2026-08-20')
  const html = await frontDesk.text()
  assert.match(html, /Bàn lễ tân/)
  assert.match(html, /Nguyễn An/)

  const english = await e2e.client.get('/admin/hospitality/front-desk?lang=en&date=2026-08-20')
  assert.equal(english.status, 200)
  assert.match(await english.text(), /Front desk/)
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
    assert.deepEqual({ ...stays[0] }, { state: 'checked_in', currentRoomId: '101' })
    const notices = await adapter.all(
      'SELECT state, "packageHash", "submittedBy", "confirmedBy", "receiptRef" FROM hospitality_core_stay_notice WHERE id = ?',
      ['booking-1:stay:notice:booking-1:guest'],
    )
    assert.equal(notices[0]?.state, 'confirmed')
    assert.match(String(notices[0]?.packageHash), /^[a-f0-9]{64}$/)
    assert.equal(notices[0]?.submittedBy, 'admin')
    assert.equal(notices[0]?.confirmedBy, 'admin')
    assert.equal(notices[0]?.receiptRef, 'DVC-E2E-0001')
  })

  const checkedOut = await e2e.client.post(
    '/admin/hospitality/reservations/booking-1?lang=vi',
    new URLSearchParams({ operation: 'check-out', lang: 'vi' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(checkedOut.status, 303, await checkedOut.clone().text())
  assert.match(checkedOut.headers.get('location') ?? '', /status=checked-out/)
  const checkedOutPage = await e2e.client.get(checkedOut.headers.get('location')!)
  const checkedOutHtml = await checkedOutPage.text()
  assert.match(checkedOutHtml, /Đã trả phòng/)
  assert.doesNotMatch(checkedOutHtml, /hospitality_core\./)

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
