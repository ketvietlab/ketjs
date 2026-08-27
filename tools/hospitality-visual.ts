// Repeatable local data for browser review of every hospitality screen.
// The target must be an explicit, new SQLite file; this tool never replaces data.

import { existsSync } from 'node:fs'
import { bootWorker, callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const path = process.env.KET_VISUAL_SQLITE
if (!path) throw new Error('set KET_VISUAL_SQLITE to a new SQLite file')
if (existsSync(path)) throw new Error(`refusing to replace existing visual database: ${path}`)

const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : [])]
const manifest = compose(modules)
const adapter = sqliteAdapter(path)
await adapter.open()
await migrateOne(adapter, manifest)
registerFunctions(modules)

const scope = { company: 'default', companies: ['default'], branches: null }
let visualActor: string | null = null
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await callFn(name, args, { adapter, manifest, scope, actor: visualActor })
  const value = result.value as { ok?: boolean; errors?: unknown }
  if (value?.ok === false) throw new Error(`${name}: ${JSON.stringify(value.errors)}`)
  return result.value
}

const property = 'ket-hotel'
const roomType = 'deluxe'

try {
  await call('partner.savePartner', {
    id: 'ket-company',
    kind: 'company',
    name: 'Công ty Két Việt',
  })
  await call('company.saveCompany', {
    id: 'default',
    partnerId: 'ket-company',
    currency: 'VND',
  })
  await call('user.createUser', {
    id: 'visual-admin',
    login: 'admin',
    password: 'hospitality-demo',
    name: 'Quản trị khách sạn',
    defaultCompanyId: 'default',
    superuser: true,
  })
  visualActor = 'visual-admin'
  await call('user.grantCompany', {
    id: 'visual-admin:default',
    userId: 'visual-admin',
    companyId: 'default',
  })
  await call('address.installCatalog', { countryCode: 'VN' })
  await call('uom.saveUnit', { id: 'service-unit', name: 'Lần', relativeFactor: '1' })
  for (const service of [
    { id: 'breakfast', code: 'BF', name: 'Bữa sáng buffet', price: '220000' },
    { id: 'minibar', code: 'MB', name: 'Minibar', price: '180000' },
    { id: 'laundry', code: 'LD', name: 'Giặt ủi', price: '90000' },
  ]) {
    await call('product.saveTemplate', {
      id: `${service.id}-template`,
      name: service.name,
      type: 'service',
      uomId: 'service-unit',
      listPrice: service.price,
      saleOk: true,
    })
    await call('product.saveVariant', {
      id: service.id,
      templateId: `${service.id}-template`,
      defaultCode: service.code,
      combinationKey: '',
    })
  }
  for (const guest of [
    { id: 'guest-an', name: 'Nguyễn Minh An' },
    { id: 'guest-binh', name: 'Trần Gia Bình' },
    { id: 'guest-chi', name: 'Lê Thùy Chi' },
    { id: 'guest-dung', name: 'Phạm Anh Dũng' },
    { id: 'guest-giang', name: 'Vũ Hương Giang' },
  ])
    await call('partner.savePartner', { ...guest, kind: 'person' })

  await call('hospitality_core.saveCancellationPolicy', {
    id: 'flexible',
    code: 'FLEX',
    name: 'Linh hoạt 24 giờ',
    type: 'flexible',
    freeCancellationHours: 24,
    penaltyPercent: '50',
  })
  await call('hospitality_core.saveProperty', {
    id: property,
    code: 'KET-SGN',
    name: 'Ket Hotel Sài Gòn',
    publicName: 'Ket Hotel',
    accommodationType: 'hotel',
    starRating: 4,
    description: 'Khách sạn đô thị bên phố đi bộ, phù hợp cho chuyến công tác và kỳ nghỉ cuối tuần.',
    street1: '25 Nguyễn Huệ',
    countryId: 'VN',
    divisionId: 'VN:2025-07-01:70101063',
    defaultCancellationPolicyId: 'flexible',
    allowWeekly: true,
  })
  for (const fee of [
    { id: 'city-tax', chargeType: 'city_tax', name: 'Thuế lưu trú thành phố', amount: '35000' },
    { id: 'parking-fee', chargeType: 'parking', name: 'Phí đỗ xe qua đêm', amount: '120000' },
    { id: 'resort-fee', chargeType: 'resort_fee', name: 'Phí tiện ích', amount: '180000' },
  ])
    await call('hospitality_core.savePropertyCharge', {
      ...fee,
      propertyId: property,
      active: true,
    })
  await call('hospitality_core.saveBuilding', {
    id: 'tower-a',
    propertyId: property,
    code: 'A',
    name: 'Tòa A',
  })
  await call('hospitality_core.saveFloor', {
    id: 'floor-1',
    propertyId: property,
    buildingId: 'tower-a',
    code: 'F1',
    name: 'Tầng 1',
  })
  await call('hospitality_core.saveRoomType', {
    id: roomType,
    propertyId: property,
    code: 'DLX',
    name: 'Deluxe King',
    publicName: 'Deluxe King hướng phố',
    description: 'Phòng sáng, giường king và góc làm việc nhìn ra trung tâm thành phố.',
    defaultCapacity: 2,
    maxAdults: 2,
    maxChildren: 1,
    maxInfants: 1,
    maxExtraBeds: 1,
    sizeSqm: '29.5',
    viewType: 'city',
    baseRate: '1450000',
    color: '#2563eb',
    cancellationPolicyId: 'flexible',
    published: true,
  })
  await call('hospitality_core.saveRoomType', {
    id: 'suite',
    propertyId: property,
    code: 'STE',
    name: 'Executive Suite',
    publicName: 'Executive Suite',
    description: 'Không gian suite tách biệt phòng ngủ và phòng khách dành cho kỳ nghỉ dài ngày.',
    defaultCapacity: 3,
    maxAdults: 2,
    maxChildren: 2,
    maxInfants: 1,
    maxExtraBeds: 1,
    sizeSqm: '48',
    viewType: 'river',
    baseRate: '2650000',
    color: '#0f766e',
    cancellationPolicyId: 'flexible',
    published: true,
    allowWeekly: true,
  })
  await call('hospitality_core.saveBed', {
    id: 'deluxe-king-bed',
    roomTypeId: roomType,
    type: 'king',
    quantity: 1,
  })
  for (const image of [
    {
      id: 'hotel-exterior',
      resModel: 'hospitality_core.Property',
      resId: property,
      category: 'exterior',
      caption: 'Mặt tiền Ket Hotel lúc hoàng hôn',
      url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=80',
    },
    {
      id: 'hotel-lobby',
      resModel: 'hospitality_core.Property',
      resId: property,
      category: 'lobby',
      caption: 'Sảnh đón khách',
      url: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1600&q=80',
    },
    {
      id: 'deluxe-room',
      resModel: 'hospitality_core.RoomType',
      resId: roomType,
      category: 'room',
      caption: 'Phòng Deluxe King',
      url: 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1600&q=80',
    },
    {
      id: 'deluxe-bathroom',
      resModel: 'hospitality_core.RoomType',
      resId: roomType,
      category: 'bathroom',
      caption: 'Phòng tắm Deluxe',
      url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=1600&q=80',
    },
  ]) {
    await call('storage.createAttachment', {
      id: image.id,
      name: `${image.id}.jpg`,
      resModel: image.resModel,
      resId: image.resId,
      resField: 'contentImages',
      kind: 'url',
      url: image.url,
      mimetype: 'image/jpeg',
      size: 1,
      public: true,
      createdAt: '2026-08-20T01:00:00.000Z',
    })
    await call('hospitality_core.attachContentImage', {
      id: image.id,
      attachmentId: image.id,
      ...(image.resModel === 'hospitality_core.Property'
        ? { propertyId: image.resId }
        : { roomTypeId: image.resId }),
      category: image.category,
      caption: image.caption,
    })
  }
  for (const room of [
    { id: '101', type: roomType },
    { id: '102', type: roomType },
    { id: '103', type: roomType },
    { id: '104', type: 'suite' },
    { id: '105', type: 'suite' },
    { id: '106', type: roomType },
  ])
    await call('hospitality_core.saveRoom', {
      id: room.id,
      propertyId: property,
      roomTypeId: room.type,
      buildingId: 'tower-a',
      floorId: 'floor-1',
      code: room.id,
      name: `Phòng ${room.id}`,
    })
  await call('hospitality_core.setRoomStatus', {
    id: '105',
    expectedStatus: 'available',
    status: 'maintenance',
    note: 'Bảo trì điều hòa theo kế hoạch.',
  })
  await call('hospitality_core.saveRatePlan', {
    id: 'deluxe-flex',
    propertyId: property,
    roomTypeId: roomType,
    code: 'FLEX-BB',
    name: 'Linh hoạt kèm bữa sáng',
    rateType: 'nightly',
    amount: '1650000',
    mealPlan: 'BB',
    isDefault: true,
    active: true,
  })
  await call('hospitality_core.saveRatePlan', {
    id: 'deluxe-weekly',
    propertyId: property,
    roomTypeId: roomType,
    code: 'WEEKLY',
    name: 'Ưu đãi tuần',
    rateType: 'weekly',
    amount: '9200000',
    minStay: 1,
    active: true,
  })
  await call('hospitality_core.saveRatePlan', {
    id: 'suite-flex',
    propertyId: property,
    roomTypeId: 'suite',
    code: 'SUITE-RO',
    name: 'Suite linh hoạt',
    rateType: 'nightly',
    amount: '2650000',
    mealPlan: 'RO',
    isDefault: true,
    active: true,
  })
  await call('hospitality_core.setInventoryRange', {
    propertyId: property,
    roomTypeId: roomType,
    from: '2026-08-18',
    to: '2026-09-02',
    total: 3,
  })
  await call('hospitality_core.setRestrictionRange', {
    propertyId: property,
    roomTypeId: roomType,
    from: '2026-08-25',
    to: '2026-08-26',
    minLos: 2,
    closedToArrival: true,
  })
  await call('hospitality_core.setRestrictionRange', {
    propertyId: property,
    roomTypeId: roomType,
    from: '2026-08-30',
    to: '2026-08-30',
    stopSell: true,
  })
  await call('hospitality_core.saveAmenityCategory', {
    id: 'comfort',
    name: 'Tiện nghi phòng',
  })
  for (const amenity of [
    { id: 'wifi', code: 'WIFI', name: 'Wi-Fi tốc độ cao', scope: 'property' },
    { id: 'bathtub', code: 'BATH', name: 'Bồn tắm', scope: 'room' },
    { id: 'workspace', code: 'WORK', name: 'Bàn làm việc', scope: 'room' },
  ])
    await call('hospitality_core.saveAmenity', { ...amenity, categoryId: 'comfort' })

  const booking = async (
    id: string,
    guestId: string,
    checkIn: string,
    checkOut: string,
    extra: Record<string, unknown> = {},
  ) =>
    call('hospitality_core.createReservation', {
      id,
      code: id.toUpperCase(),
      propertyId: property,
      roomTypeId: roomType,
      partnerId: guestId,
      bookingType: 'nightly',
      checkIn,
      checkOut,
      rate: '1450000',
      createdAt: '2026-08-18T02:00:00.000Z',
      ...extra,
    })

  await booking('res-arrive', 'guest-an', '2026-08-20T14:00:00.000Z', '2026-08-22T12:00:00.000Z')
  await booking('res-house', 'guest-binh', '2026-08-19T14:00:00.000Z', '2026-08-21T12:00:00.000Z', {
    provider: 'booking',
    externalId: 'BKG-4201',
  })
  await booking('res-depart', 'guest-chi', '2026-08-18T14:00:00.000Z', '2026-08-20T12:00:00.000Z', {
    provider: 'agoda',
    externalId: 'AGO-8842',
  })
  await booking('res-future', 'guest-dung', '2026-08-21T14:00:00.000Z', '2026-08-24T12:00:00.000Z', {
    provider: 'traveloka',
    externalId: 'TVL-9931',
  })
  await booking('res-cancel', 'guest-giang', '2026-08-22T14:00:00.000Z', '2026-08-23T12:00:00.000Z')
  await call('hospitality_core.createReservation', {
    id: 'res-long-stay',
    code: 'RES-LONG-STAY',
    propertyId: property,
    roomTypeId: 'suite',
    partnerId: 'guest-giang',
    bookingType: 'weekly',
    billingMode: 'recurring',
    checkIn: '2026-07-01T14:00:00.000Z',
    checkOut: '2026-09-02T12:00:00.000Z',
    rate: '9200000',
    createdAt: '2026-06-25T02:00:00.000Z',
  })
  await call('hospitality_core.cancelReservation', {
    id: 'res-cancel',
    reason: 'Khách đổi lịch',
    at: '2026-08-19T03:00:00.000Z',
  })
  await call('hospitality_core.checkIn', {
    stayId: 'res-house:stay',
    roomId: '101',
    assignmentId: 'assignment-house',
    at: '2026-08-19T14:05:00.000Z',
  })
  await call('hospitality_core.checkIn', {
    stayId: 'res-depart:stay',
    roomId: '102',
    assignmentId: 'assignment-depart',
    at: '2026-08-18T14:10:00.000Z',
  })
  await call('hospitality_core.checkIn', {
    stayId: 'res-long-stay:stay',
    roomId: '104',
    assignmentId: 'assignment-long-stay',
    at: '2026-07-01T14:00:00.000Z',
  })
  await call('hospitality_core.saveGuestDocument', {
    id: 'document-binh',
    stayId: 'res-house:stay',
    partnerId: 'guest-binh',
    type: 'cccd',
    number: '079201004201',
    fullName: 'Trần Gia Bình',
    dateOfBirth: '1988-04-20T00:00:00.000Z',
    ocrState: 'done',
  })
  await call('hospitality_core.saveGuestDocument', {
    id: 'document-chi',
    stayId: 'res-depart:stay',
    partnerId: 'guest-chi',
    type: 'passport',
    number: 'P8842001',
    fullName: 'Lê Thùy Chi',
    dateOfBirth: '1992-09-12T00:00:00.000Z',
    ocrState: 'done',
  })
  await call('hospitality_core.addStayGuest', {
    id: 'res-house:companion',
    stayId: 'res-house:stay',
    partnerId: 'guest-an',
    displayName: 'Nguyễn Minh An',
  })
  await call('hospitality_core.saveGuestDocument', {
    id: 'document-an',
    stayId: 'res-house:stay',
    partnerId: 'guest-an',
    type: 'cccd',
    number: '079202007530',
    fullName: 'Nguyễn Minh An',
    dateOfBirth: '1995-11-08T00:00:00.000Z',
    ocrState: 'done',
  })
  const worker = await bootWorker(ketsuite, {
    env: { KET_SQLITE: path, KET_COMPANY: 'default', KET_QUEUE_NOTIFY: '0' },
    log: () => {},
  })
  try {
    await worker.drain()
  } finally {
    await worker.close()
  }
  await call('hospitality_core.recordStayNoticeSubmission', {
    id: 'res-house:stay:notice:res-house:guest',
    reason: 'business',
    channel: 'online',
    evidenceRef: 'DVC-4201',
  })
  await call('hospitality_core.confirmStayNotice', {
    id: 'res-house:stay:notice:res-house:guest',
    receiptRef: 'DVC-4201',
  })
  await call('hospitality_core.recordStayNoticeSubmission', {
    id: 'res-depart:stay:notice:res-depart:guest',
    reason: 'tourism',
    channel: 'vneid',
    evidenceRef: 'VNEID-8842',
  })
  await call('hospitality_core.saveExtraLine', {
    id: 'extra-minibar',
    reservationId: 'res-arrive',
    productId: 'minibar',
    description: 'Minibar chào phòng',
    recurrence: 'once',
  })
  await call('hospitality_core.materializeExtraLine', { id: 'extra-minibar' })
  await call('hospitality_core.saveExtraLine', {
    id: 'extra-breakfast',
    stayId: 'res-house:stay',
    productId: 'breakfast',
    description: 'Bữa sáng người lớn',
    recurrence: 'per_night',
    quantity: '2',
  })
  await call('hospitality_core.saveExtraLine', {
    id: 'extra-long-stay-breakfast',
    stayId: 'res-long-stay:stay',
    productId: 'breakfast',
    description: 'Bữa sáng lưu trú dài hạn',
    recurrence: 'per_night',
    quantity: '1',
  })
  for (const serviceDate of ['2026-08-19', '2026-08-20'])
    await call('hospitality_core.materializeExtraLine', { id: 'extra-breakfast', serviceDate })
  await call('hospitality_core.saveExtraLine', {
    id: 'extra-laundry',
    stayId: 'res-house:stay',
    productId: 'laundry',
    description: 'Giặt ủi theo túi',
    recurrence: 'per_unit',
  })
  await call('hospitality_core.materializeExtraLine', {
    id: 'extra-laundry',
    quantity: '3',
    requestKey: 'laundry-bag-001',
  })
  await call('hospitality_core.addCharge', {
    id: 'charge-spa',
    folioId: 'res-house:folio',
    stayId: 'res-house:stay',
    description: 'Dịch vụ spa',
    type: 'spa',
    quantity: '1',
    unitPrice: '650000',
    sourceKey: 'visual:spa:1',
    occurredAt: '2026-08-19T16:00:00.000Z',
  })
  await call('hospitality_core.voidCharge', {
    id: 'charge-spa',
    folioId: 'res-house:folio',
    reason: 'Khách đổi ý trước khi sử dụng dịch vụ',
    voidedAt: '2026-08-19T16:15:00.000Z',
  })
  await call('hospitality_core.createCleaningTask', {
    id: 'cleaning-103',
    code: 'HK-000103',
    roomId: '103',
    taskType: 'daily_clean',
    priority: 'normal',
    assigneeId: 'visual-admin',
    requestedAt: '2026-08-20T01:30:00.000Z',
    notes: 'Ưu tiên bổ sung khăn và nước uống.',
  })
  await call('hospitality_core.startCleaningTask', {
    id: 'cleaning-103',
    assigneeId: 'visual-admin',
    at: '2026-08-20T01:45:00.000Z',
  })
  await call('hospitality_core.requestNightAudit', {
    propertyId: property,
    auditDate: '2026-08-20',
  })
  console.log(`hospitality visual database ready: ${path}`)
  console.log('sign in with admin / hospitality-demo')
} finally {
  await (adapter as Adapter).close()
}
