import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Envelope<T> = { data: T; error: { code: string } | null }

const boot = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('partner.savePartner', { id: 'operator-party', kind: 'person', name: 'Lễ tân' })
  await fixture('user.createUser', {
    id: 'operator',
    partnerId: 'operator-party',
    login: 'operator',
    password: 'correct horse battery',
    name: 'Lễ tân',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'operator:acme',
    userId: 'operator',
    companyId: 'acme',
  })
  await fixture('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' })
  await fixture('hospitality_core.saveProperty', {
    id: 'hotel',
    code: 'HCM',
    name: 'Kết Hotel',
    accommodationType: 'hotel',
    timezone: 'Asia/Ho_Chi_Minh',
    defaultCheckIn: '14:00',
    defaultCheckOut: '12:00',
  })
  await fixture('hospitality_core.saveRoomType', {
    id: 'deluxe',
    propertyId: 'hotel',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '100',
    published: true,
  })
  for (const id of ['101', '102'])
    await fixture('hospitality_core.saveRoom', {
      id,
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      code: id,
      name: `Phòng ${id}`,
    })
  const reservation = await fixture('hospitality_core.createReservation', {
    id: 'reservation-a',
    propertyId: 'hotel',
    roomTypeId: 'deluxe',
    partnerId: 'guest',
    bookingType: 'nightly',
    checkIn: '2026-08-25T07:00:00.000Z',
    checkOut: '2026-08-27T05:00:00.000Z',
    rate: '100',
    createdAt: '2026-08-24T00:00:00.000Z',
  })
  assert.equal(reservation.value.ok, true, JSON.stringify(reservation.value))
  const task = await fixture('hospitality_core.createCleaningTask', {
    id: 'task-a',
    code: 'HK-001',
    roomId: '102',
    taskType: 'daily_clean',
    priority: 'urgent',
  })
  assert.equal(task.value.ok, true, JSON.stringify(task.value))

  await e2e.client.login({ login: 'operator', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  return { e2e, csrfToken: bootstrap.data.csrfToken }
}

test('staff hospitality channel serves the complete eleven-operation HTTP surface', async (t) => {
  const { e2e } = await boot(t)

  const context = await e2e.client.json<Envelope<Row>>('/api/staff/v1/hospitality/context')
  assert.equal(context.data.defaultPropertyId, 'hotel')
  assert.equal((context.data.properties as Row[])[0]?.roomCount, 2)

  const frontDesk = await e2e.client.json<Envelope<Row>>(
    '/api/staff/v1/hospitality/front-desk/today?propertyId=hotel',
  )
  assert.equal((frontDesk.data.property as Row).id, 'hotel')
  assert.equal((frontDesk.data.arrivals as Row[])[0]?.id, 'reservation-a')

  const reservations = await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
    '/api/staff/v1/hospitality/reservations?propertyId=hotel&status=confirmed&limit=1',
  )
  assert.equal(reservations.data.items[0]?.id, 'reservation-a')
  assert.match(String(reservations.data.items[0]?.version), /^hrv_[0-9a-f]{64}$/)

  const reservation = await e2e.client.json<Envelope<Row>>(
    '/api/staff/v1/hospitality/reservations/reservation-a',
  )
  assert.equal((reservation.data.property as Row).id, 'hotel')
  assert.equal((reservation.data.stay as Row).id, 'reservation-a:stay')

  const stay = await e2e.client.json<Envelope<Row>>(
    '/api/staff/v1/hospitality/stays/reservation-a:stay?propertyId=hotel',
  )
  assert.match(String(stay.data.version), /^hsv_[0-9a-f]{64}$/)
  assert.equal((stay.data.folio as Row).id, 'reservation-a:folio')

  const folio = await e2e.client.json<Envelope<Row>>(
    '/api/staff/v1/hospitality/folios/reservation-a:folio?propertyId=hotel',
  )
  assert.match(String(folio.data.version), /^hfv_[0-9a-f]{64}$/)
  assert.equal((folio.data.charges as Row[]).length, 1)

  const housekeeping = await e2e.client.json<Envelope<{ items: Row[] }>>(
    '/api/staff/v1/hospitality/housekeeping/tasks?propertyId=hotel&status=todo',
  )
  assert.equal(housekeeping.data.items[0]?.id, 'task-a')
  assert.deepEqual(housekeeping.data.items[0]?.availableActions, ['start', 'cancel'])

  const operations = await e2e.client.json<Envelope<Row>>(
    '/api/staff/v1/hospitality/operations/context?propertyId=hotel',
  )
  assert.equal((operations.data.rooms as Row[]).length, 2)
  assert.ok((operations.data.supportedOperations as string[]).includes('hospitality.stays.check_in'))

  for (const path of [
    '/api/staff/v1/hospitality/stays/reservation-a:stay?propertyId=other',
    '/api/staff/v1/hospitality/folios/reservation-a:folio?propertyId=other',
  ])
    assert.equal((await e2e.client.get(path)).status, 404)
})

test('staff hospitality housekeeping workflow enforces CSRF, replay keys and strong versions', async (t) => {
  const { e2e, csrfToken } = await boot(t)
  const tasks = await e2e.client.json<Envelope<{ items: Row[] }>>(
    '/api/staff/v1/hospitality/housekeeping/tasks?propertyId=hotel&status=todo',
  )
  const version = String(tasks.data.items[0]?.version)
  const path = '/api/staff/v1/hospitality/housekeeping/tasks/task-a/start?propertyId=hotel'
  const body = JSON.stringify({ expectedVersion: version })

  assert.equal(
    (
      await e2e.client.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'hospitality-start-1' },
        body,
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await e2e.client.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
          'idempotency-key': 'hospitality-start-1',
          'if-match': `"wrong"`,
        },
        body,
      })
    ).status,
    409,
  )

  const started = await e2e.client.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
      'idempotency-key': 'hospitality-start-1',
      'if-match': `"${version}"`,
    },
    body,
  })
  assert.equal(started.status, 200)
  const startedBody = (await started.json()) as Envelope<Row>
  assert.equal(startedBody.data.outcome, 'started')
  assert.equal((startedBody.data.task as Row).state, 'in_progress')

  const nextVersion = String(startedBody.data.version)
  const completed = await e2e.client.request(
    '/api/staff/v1/hospitality/housekeeping/tasks/task-a/complete?propertyId=hotel',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        'idempotency-key': 'hospitality-complete-1',
        'if-match': `"${nextVersion}"`,
      },
      body: JSON.stringify({ expectedVersion: nextVersion }),
    },
  )
  assert.equal(completed.status, 200)
  assert.equal(((await completed.json()) as Envelope<Row>).data.outcome, 'completed')
})

test('staff hospitality dispatcher executes supported commands and rejects missing domain primitives', async (t) => {
  const { e2e, csrfToken } = await boot(t)
  const headers = (key: string, version?: string) => ({
    'content-type': 'application/json',
    'x-csrf-token': csrfToken,
    'idempotency-key': key,
    ...(version ? { 'if-match': `"${version}"` } : {}),
  })

  const created = await e2e.client.request(
    '/api/staff/v1/hospitality/operations/hospitality.housekeeping.tasks.create',
    {
      method: 'POST',
      headers: headers('hospitality-create-task-1'),
      body: JSON.stringify({
        propertyId: 'hotel',
        roomId: '101',
        taskType: 'daily_clean',
        priority: 'normal',
      }),
    },
  )
  assert.equal(created.status, 200)
  const createdBody = (await created.json()) as Envelope<Row>
  assert.equal(createdBody.data.outcome, 'created')
  assert.match(String(createdBody.data.version), /^hkv_[0-9a-f]{64}$/)

  const unsupported = await e2e.client.request(
    '/api/staff/v1/hospitality/operations/hospitality.refunds.refund',
    {
      method: 'POST',
      headers: headers('hospitality-refund-1'),
      body: JSON.stringify({ propertyId: 'hotel' }),
    },
  )
  assert.equal(unsupported.status, 422)
  assert.equal(
    ((await unsupported.json()) as Envelope<null>).error?.code,
    'hospitality_staff_channel.unsupportedOperation',
  )
})
