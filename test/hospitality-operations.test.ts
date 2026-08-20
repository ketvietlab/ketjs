import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import { company, hospitalityCore, partner, storage } from 'ketsuite'
import backend from 'ketsuite/backend'

const modules = [partner, company, storage, backend, hospitalityCore]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

async function boot(): Promise<Adapter> {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' }, adapter)
  await call('partner.savePartner', { id: 'companion', kind: 'person', name: 'Trần Bình' }, adapter)
  await call(
    'hospitality_core.saveProperty',
    { id: 'hotel', code: 'HCM', name: 'Ket Hotel', accommodationType: 'hotel' },
    adapter,
  )
  await call(
    'hospitality_core.saveRoomType',
    { id: 'deluxe', propertyId: 'hotel', code: 'DLX', name: 'Deluxe', baseRate: '100' },
    adapter,
  )
  for (const room of ['101', '102'])
    await call(
      'hospitality_core.saveRoom',
      { id: room, propertyId: 'hotel', roomTypeId: 'deluxe', code: room, name: room },
      adapter,
    )
  return adapter
}

const reservation = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  propertyId: 'hotel',
  roomTypeId: 'deluxe',
  partnerId: 'guest',
  bookingType: 'nightly',
  checkIn: '2026-09-01T14:00:00.000Z',
  checkOut: '2026-09-03T12:00:00.000Z',
  rate: '100',
  createdAt: '2026-08-20T00:00:00.000Z',
  ...extra,
})

test('hospitality operations: booking engine creates one atomic reservation, folio, stay, charge and guest', async () => {
  const adapter = await boot()
  try {
    const created = await call('hospitality_core.createReservation', reservation('r1'), adapter)
    assert.deepEqual(created.value, {
      ok: true,
      id: 'r1',
      folioId: 'r1:folio',
      stayId: 'r1:stay',
      existing: false,
      errors: [],
    })
    const retry = await call('hospitality_core.createReservation', reservation('r1'), adapter)
    assert.equal((retry.value as Row).existing, true)

    const stored = (
      await adapter.all(
        'SELECT state, quantity, "amountTotal", "stayId" FROM hospitality_core_reservation WHERE id = ?',
        ['r1'],
      )
    )[0]!
    assert.deepEqual(
      { ...stored },
      { state: 'confirmed', quantity: '2', amountTotal: '200', stayId: 'r1:stay' },
    )
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_folio'))[0]!.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_stay'))[0]!.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_charge'))[0]!.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_stay_guest'))[0]!.n, 1)

    const invalid = await call(
      'hospitality_core.createReservation',
      reservation('bad', { roomTypeId: 'missing' }),
      adapter,
    )
    assert.equal((invalid.value as Row).ok, false)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_reservation'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: room assignments are append-only across check-in, move and checkout', async () => {
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('r1'), adapter)
    const checkedIn = await call(
      'hospitality_core.checkIn',
      { stayId: 'r1:stay', roomId: '101', assignmentId: 'a1', at: '2026-09-01T14:05:00.000Z' },
      adapter,
    )
    assert.equal((checkedIn.value as Row).state, 'checked_in')
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'occupied',
    )

    const moved = await call(
      'hospitality_core.moveRoom',
      {
        stayId: 'r1:stay',
        roomId: '102',
        assignmentId: 'a2',
        reason: 'upgrade',
        at: '2026-09-02T09:00:00.000Z',
      },
      adapter,
    )
    assert.equal((moved.value as Row).roomId, '102')
    const afterMove = await adapter.all(
      'SELECT id, state, "roomId", "endAt" FROM hospitality_core_room_assignment ORDER BY "startAt"',
    )
    assert.deepEqual(
      afterMove.map((row) => [row.id, row.state, row.roomId, !!row.endAt]),
      [
        ['a1', 'closed', '101', true],
        ['a2', 'active', '102', false],
      ],
    )
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'dirty',
    )

    const checkedOut = await call(
      'hospitality_core.checkOut',
      { stayId: 'r1:stay', at: '2026-09-03T12:00:00.000Z' },
      adapter,
    )
    assert.equal((checkedOut.value as Row).state, 'checked_out')
    const stay = (await adapter.all('SELECT state, "currentRoomId" FROM hospitality_core_stay'))[0]!
    assert.deepEqual({ ...stay }, { state: 'checked_out', currentRoomId: null })
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['102']))[0]!.status,
      'dirty',
    )
    assert.equal((await adapter.all('SELECT state FROM hospitality_core_folio'))[0]!.state, 'closed')
    assert.equal(
      (await adapter.all('SELECT state FROM hospitality_core_reservation'))[0]!.state,
      'checked_out',
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: one physical room cannot be checked in twice', async () => {
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('r1'), adapter)
    await call('hospitality_core.createReservation', reservation('r2'), adapter)
    await call(
      'hospitality_core.checkIn',
      { stayId: 'r1:stay', roomId: '101', assignmentId: 'a1', at: '2026-09-01T14:05:00.000Z' },
      adapter,
    )
    const collision = await call(
      'hospitality_core.checkIn',
      { stayId: 'r2:stay', roomId: '101', assignmentId: 'a2', at: '2026-09-01T14:06:00.000Z' },
      adapter,
    )
    assert.equal((collision.value as Row).ok, false)
    assert.equal(((collision.value as Row).errors as Row[])[0]!.code, 'room_not_available')
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_room_assignment'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: cancellation preserves audit rows and voids operational charges', async () => {
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('r1'), adapter)
    const cancelled = await call(
      'hospitality_core.cancelReservation',
      { id: 'r1', reason: 'guest request', at: '2026-08-25T00:00:00.000Z' },
      adapter,
    )
    assert.equal((cancelled.value as Row).state, 'cancelled')
    assert.equal((await adapter.all('SELECT state FROM hospitality_core_charge'))[0]!.state, 'void')
    const folio = (await adapter.all('SELECT state, "amountTotal" FROM hospitality_core_folio'))[0]!
    assert.deepEqual({ ...folio }, { state: 'cancelled', amountTotal: '0' })
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_reservation'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: charges are idempotent and guest lists do not expose contact PII', async () => {
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('r1'), adapter)
    const charge = {
      id: 'spa-1',
      folioId: 'r1:folio',
      stayId: 'r1:stay',
      description: 'Spa',
      type: 'spa',
      quantity: '1',
      unitPrice: '25',
      sourceKey: 'spa:visit:1',
    }
    const first = await call('hospitality_core.addCharge', charge, adapter)
    const retry = await call('hospitality_core.addCharge', { ...charge, id: 'spa-retry' }, adapter)
    assert.equal((first.value as Row).amount, '25')
    assert.equal((retry.value as Row).id, 'spa-1')
    assert.equal((retry.value as Row).existing, true)
    assert.equal(
      (await adapter.all('SELECT "amountTotal" FROM hospitality_core_folio'))[0]!.amountTotal,
      '225',
    )

    await call(
      'hospitality_core.addStayGuest',
      { id: 'g2', stayId: 'r1:stay', partnerId: 'companion', displayName: 'Trần Bình' },
      adapter,
    )
    const guests = (await call('hospitality_core.listStayGuests', { stayId: 'r1:stay' }, adapter))
      .value as Row[]
    assert.deepEqual(
      guests.map((guest) => Object.keys(guest).sort()),
      [
        ['displayName', 'id', 'primary', 'stayId'],
        ['displayName', 'id', 'primary', 'stayId'],
      ],
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: identity documents use storage references and safe projections', async () => {
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('r1'), adapter)
    await call(
      'hospitality_core.saveGuestDocument',
      {
        id: 'doc1',
        stayId: 'r1:stay',
        partnerId: 'guest',
        type: 'passport',
        number: 'P1234567',
        fullName: 'NGUYEN AN',
        nationality: 'VN',
        permanentAddress: 'private address',
        ocrRaw: { confidence: 0.99 },
      },
      adapter,
    )
    const documents = (await call('hospitality_core.listGuestDocuments', { stayId: 'r1:stay' }, adapter))
      .value as Row[]
    assert.equal(documents[0]!.number, 'P1234567')
    assert.equal('permanentAddress' in documents[0]!, false)
    assert.equal('ocrRaw' in documents[0]!, false)
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: tape chart keeps assigned and unassigned stays in one schedule', async () => {
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('r1'), adapter)
    await call('hospitality_core.createReservation', reservation('r2'), adapter)
    await call(
      'hospitality_core.checkIn',
      { stayId: 'r1:stay', roomId: '101', assignmentId: 'a1', at: '2026-09-01T14:05:00.000Z' },
      adapter,
    )
    const chart = (
      await call(
        'hospitality_core.getTapeChart',
        { propertyId: 'hotel', from: '2026-09-01T00:00:00.000Z', to: '2026-09-04T00:00:00.000Z' },
        adapter,
      )
    ).value as Row
    assert.equal((chart.rooms as Row[]).length, 2)
    assert.deepEqual((chart.events as Row[]).map((event) => [event.stayId, event.roomId]).sort(), [
      ['r1:stay', '101'],
      ['r2:stay', null],
    ])
  } finally {
    await adapter.close()
  }
})

test('hospitality operations: nightly quantity follows the property calendar, not UTC dates', async () => {
  const adapter = await boot()
  try {
    await call(
      'hospitality_core.saveProperty',
      {
        id: 'honolulu',
        code: 'HNL',
        name: 'Ket Honolulu',
        accommodationType: 'hotel',
        timezone: 'Pacific/Honolulu',
      },
      adapter,
    )
    await call(
      'hospitality_core.saveRoomType',
      { id: 'ocean', propertyId: 'honolulu', code: 'OCN', name: 'Ocean', baseRate: '100' },
      adapter,
    )
    const created = await call(
      'hospitality_core.createReservation',
      reservation('honolulu-night', {
        propertyId: 'honolulu',
        roomTypeId: 'ocean',
        checkIn: '2026-09-02T01:00:00.000Z',
        checkOut: '2026-09-02T21:00:00.000Z',
      }),
      adapter,
    )
    assert.equal((created.value as Row).ok, true)
    const row = (
      await adapter.all('SELECT quantity, "amountTotal" FROM hospitality_core_reservation WHERE id = ?', [
        'honolulu-night',
      ])
    )[0]!
    assert.deepEqual({ ...row }, { quantity: '1', amountTotal: '100' })
  } finally {
    await adapter.close()
  }
})
