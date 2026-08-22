import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const futureDate = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const onlineCheckIn = futureDate(10)
const onlineCheckOut = futureDate(12)
/** The ledger is keyed by property-local calendar date; arrival is the first night. */
const onlineFrom = onlineCheckIn
/** Well inside the free-cancellation window of the seeded policy. */
const onlineCancelAt = new Date().toISOString()
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

async function boot(): Promise<Adapter> {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Công ty ACME' }, adapter)
  await call(
    'company.saveCompany',
    { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' },
    adapter,
  )
  await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' }, adapter)
  await call('partner.savePartner', { id: 'companion', kind: 'person', name: 'Trần Bình' }, adapter)
  await call(
    'hospitality_core.saveProperty',
    { id: 'hotel', code: 'HCM', name: 'Ket Hotel', accommodationType: 'hotel' },
    adapter,
  )
  await call(
    'hospitality_core.saveRoomType',
    {
      id: 'deluxe',
      propertyId: 'hotel',
      code: 'DLX',
      name: 'Deluxe',
      baseRate: '100',
      published: true,
    },
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

test('hospitality operations: quote is read-only and reflects committed room-night inventory', async () => {
  const adapter = await boot()
  try {
    const args = {
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      bookingType: 'nightly',
      checkIn: '2026-09-01T14:00:00.000Z',
      checkOut: '2026-09-03T12:00:00.000Z',
    }
    const initial = (await call('hospitality_core.quoteReservation', args, adapter)).value as Row
    assert.deepEqual(
      {
        ok: initial.ok,
        rate: initial.rate,
        quantity: initial.quantity,
        amountTotal: initial.amountTotal,
        minimumAvailable: initial.minimumAvailable,
      },
      { ok: true, rate: '100', quantity: '2', amountTotal: '200', minimumAvailable: 2 },
    )
    assert.equal(
      Number((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_availability_ledger'))[0]?.n),
      0,
      'quoting does not materialize inventory rows',
    )

    await call('hospitality_core.createReservation', reservation('quoted-r1'), adapter)
    const afterOne = (await call('hospitality_core.quoteReservation', args, adapter)).value as Row
    assert.equal(afterOne.ok, true)
    assert.equal(afterOne.minimumAvailable, 1)
    assert.equal(
      Number((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_availability_ledger'))[0]?.n),
      2,
      're-quoting does not mutate the committed ledger',
    )

    await call('hospitality_core.createReservation', reservation('quoted-r2'), adapter)
    const full = (await call('hospitality_core.quoteReservation', args, adapter)).value as Row
    assert.equal(full.ok, false)
    assert.equal(((full.errors as Row[])[0] as Row).code, 'no_availability')
  } finally {
    await adapter.close()
  }
})

const onlineReservation = (id: string, requestKey: string, extra: Record<string, unknown> = {}) => ({
  id,
  requestKey,
  propertyId: 'hotel',
  roomTypeId: 'deluxe',
  partnerId: 'guest',
  checkIn: onlineCheckIn,
  checkOut: onlineCheckOut,
  adults: 2,
  ...extra,
})

test('hospitality online: quote is internal, public-safe and prices only from server configuration', async () => {
  const adapter = await boot()
  try {
    assert.equal(manifest.functions['hospitality_core.quoteAvailability']?.exposure, 'internal')
    assert.equal(manifest.functions['hospitality_core.createOnlineReservation']?.exposure, 'internal')
    const quoted = (
      await call(
        'hospitality_core.quoteAvailability',
        {
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          checkIn: onlineCheckIn,
          checkOut: onlineCheckOut,
          adults: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(quoted.ok, true)
    assert.equal(quoted.companyId, 'acme')
    assert.equal(quoted.nights, 2)
    assert.deepEqual(quoted.items, [
      {
        roomTypeId: 'deluxe',
        ratePlanId: null,
        availableQuantity: 2,
        requestedQuantity: 1,
        unitRate: '100',
        amountTotal: '200',
        currency: 'VND',
        restrictions: {
          minStay: null,
          maxStay: null,
          closedToArrival: false,
          closedToDeparture: false,
          stopSell: false,
        },
      },
    ])
    await call(
      'hospitality_core.saveRatePlan',
      {
        id: 'web-rate',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        code: 'WEB',
        name: 'Website rate',
        rateType: 'nightly',
        amount: '125',
        isDefault: true,
        active: true,
      },
      adapter,
    )
    const ratePlanQuote = (
      await call(
        'hospitality_core.quoteAvailability',
        {
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          ratePlanId: 'web-rate',
          checkIn: onlineCheckIn,
          checkOut: onlineCheckOut,
          adults: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(((ratePlanQuote.items as Row[])[0] as Row).unitRate, '125')
    assert.equal(((ratePlanQuote.items as Row[])[0] as Row).amountTotal, '250')
    await assert.rejects(
      call(
        'hospitality_core.createOnlineReservation',
        { ...onlineReservation('unsafe-price', 'unsafe-price'), rate: '1' },
        adapter,
      ),
      /unknown input "rate"/,
    )

    const overCapacity = (
      await call(
        'hospitality_core.quoteAvailability',
        {
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          checkIn: onlineCheckIn,
          checkOut: onlineCheckOut,
          adults: 3,
        },
        adapter,
      )
    ).value as Row
    assert.equal(overCapacity.ok, false)
    assert.equal((overCapacity.errors as Row[])[0]?.messageKey, 'hospitality_core.error.capacityExceeded')

    await call(
      'hospitality_core.setRestrictionRange',
      {
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        from: onlineCheckIn,
        to: onlineCheckIn,
        stopSell: true,
      },
      adapter,
    )
    const stopped = (
      await call(
        'hospitality_core.quoteAvailability',
        {
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          checkIn: onlineCheckIn,
          checkOut: onlineCheckOut,
          adults: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(stopped.ok, false)
    assert.equal((stopped.errors as Row[])[0]?.messageKey, 'hospitality_core.error.stopSell')

    const wrongCompany = (
      await callFn(
        'hospitality_core.quoteAvailability',
        {
          propertyId: 'hotel',
          roomTypeId: 'deluxe',
          checkIn: onlineCheckIn,
          checkOut: onlineCheckOut,
          adults: 2,
        },
        { adapter, manifest, scope: { company: 'globex', companies: ['globex'], branches: null } },
      )
    ).value as Row
    assert.equal(wrongCompany.ok, false)
    assert.equal((wrongCompany.errors as Row[])[0]?.messageKey, 'hospitality_core.error.propertyNotFound')
  } finally {
    await adapter.close()
  }
})

test('hospitality online: customer cancellation applies the configured policy', async () => {
  const adapter = await boot()
  try {
    await call(
      'hospitality_core.saveCancellationPolicy',
      {
        id: 'non-refundable',
        code: 'NONREF',
        name: 'Non-refundable',
        type: 'non_refundable',
        freeCancellationHours: 0,
        penaltyPercent: '100',
      },
      adapter,
    )
    await call(
      'hospitality_core.saveRoomType',
      {
        id: 'deluxe',
        propertyId: 'hotel',
        code: 'DLX',
        name: 'Deluxe',
        baseRate: '100',
        cancellationPolicyId: 'non-refundable',
        published: true,
      },
      adapter,
    )
    const created = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('nonref-web', 'nonref-web', {
          checkIn: futureDate(20),
          checkOut: futureDate(22),
        }),
        adapter,
      )
    ).value as Row
    assert.equal(created.ok, true)
    const cancelled = (
      await call(
        'hospitality_core.cancelPartnerReservation',
        { id: 'nonref-web', partnerId: 'guest', at: new Date().toISOString() },
        adapter,
      )
    ).value as Row
    assert.equal(cancelled.ok, false)
    assert.equal((cancelled.errors as Row[])[0]?.messageKey, 'hospitality_core.error.cancellationNotAllowed')
    assert.equal(
      (await adapter.all('SELECT state FROM hospitality_core_reservation WHERE id = ?', ['nonref-web']))[0]
        ?.state,
      'confirmed',
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality online: a multi-room checkout becomes one assignable stay per room', async () => {
  const adapter = await boot()
  try {
    const created = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-multi', 'checkout-multi', { quantity: 2 }),
        adapter,
      )
    ).value as Row
    assert.equal(created.ok, true)
    assert.equal(created.id, 'web-multi')
    assert.equal(created.quantity, 2)
    // The purchase total is the folio total; each room carries its own nights.
    assert.equal(created.amountTotal, '400')
    const units = created.units as Array<Record<string, string>>
    assert.deepEqual(
      units.map((unit) => unit.reservationId),
      ['web-multi', 'web-multi#2'],
    )
    assert.deepEqual(
      units.map((unit) => unit.amountTotal),
      ['200', '200'],
    )

    // Two rooms, two stays, and both can be given a physical room.
    const stays = (await call('hospitality_core.listStays', { propertyId: 'hotel' }, adapter)).value as Row[]
    assert.equal(stays.length, 2)
    for (const [index, unit] of units.entries()) {
      const arrived = (
        await call(
          'hospitality_core.checkIn',
          {
            stayId: unit.stayId,
            roomId: ['101', '102'][index],
            at: `${onlineCheckIn}T15:00:00.000Z`,
          },
          adapter,
        )
      ).value as Row
      assert.equal(arrived.ok, true)
      assert.equal(arrived.roomId, ['101', '102'][index])
    }
    const rooms = (await call('hospitality_core.listRooms', { propertyId: 'hotel' }, adapter)).value as Row[]
    assert.deepEqual(
      rooms.filter((room) => room.status === 'occupied').map((room) => room.code),
      ['101', '102'],
    )

    // One folio holding one charge per room, and the ledger sold both nights twice.
    const folio = (await call('hospitality_core.getFolio', { id: 'web-multi:folio' }, adapter)).value as Row
    assert.equal(Number(folio.amountTotal), 400)
    assert.equal((folio.charges as Row[]).length, 2)
    const ledger = (
      await call(
        'hospitality_core.listInventory',
        { propertyId: 'hotel', roomTypeId: 'deluxe', from: onlineFrom, to: onlineFrom },
        adapter,
      )
    ).value as Row[]
    assert.equal(ledger[0]?.sold, 2)
  } finally {
    await adapter.close()
  }
})

test('hospitality online: a multi-room purchase is listed and cancelled as one booking', async () => {
  const adapter = await boot()
  try {
    await call(
      'hospitality_core.createOnlineReservation',
      onlineReservation('web-multi', 'checkout-multi', { quantity: 2 }),
      adapter,
    )
    // Two reservations, but the guest bought one thing.
    const mine = (await call('hospitality_core.listPartnerReservations', { partnerId: 'guest' }, adapter))
      .value as Row[]
    assert.equal(mine.length, 1)
    assert.equal(mine[0]?.rooms, 2)
    assert.equal(Number(mine[0]?.amountTotal), 400)

    const cancelled = (
      await call(
        'hospitality_core.cancelPartnerReservation',
        { id: 'web-multi', partnerId: 'guest', at: onlineCancelAt },
        adapter,
      )
    ).value as Row
    assert.equal(cancelled.ok, true)
    assert.equal(cancelled.rooms, 2)
    const states = (await call('hospitality_core.listReservations', { propertyId: 'hotel' }, adapter))
      .value as Row[]
    assert.deepEqual(new Set(states.map((row) => row.state)), new Set(['cancelled']))
    const ledger = (
      await call(
        'hospitality_core.listInventory',
        { propertyId: 'hotel', roomTypeId: 'deluxe', from: onlineFrom, to: onlineFrom },
        adapter,
      )
    ).value as Row[]
    assert.equal(ledger[0]?.sold, 0)
  } finally {
    await adapter.close()
  }
})

test('hospitality online: retrying a multi-room checkout never sells a second set', async () => {
  const adapter = await boot()
  try {
    const first = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-multi', 'checkout-multi', { quantity: 2 }),
        adapter,
      )
    ).value as Row
    const again = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-multi', 'checkout-multi', { quantity: 2 }),
        adapter,
      )
    ).value as Row
    assert.equal(again.existing, true)
    assert.deepEqual(again.units, first.units)
    const ledger = (
      await call(
        'hospitality_core.listInventory',
        { propertyId: 'hotel', roomTypeId: 'deluxe', from: onlineFrom, to: onlineFrom },
        adapter,
      )
    ).value as Row[]
    assert.equal(ledger[0]?.sold, 2)

    // Same key, different room count is a different purchase and must be refused.
    const changed = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-multi', 'checkout-multi', { quantity: 1 }),
        adapter,
      )
    ).value as Row
    assert.equal(changed.ok, false)
    assert.equal((changed.errors as Row[])[0]?.code, 'requestConflict')
  } finally {
    await adapter.close()
  }
})

test('hospitality online: reservation, retry, ownership and cancellation remain atomic', async () => {
  const adapter = await boot()
  try {
    const created = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-1', 'checkout-session-1'),
        adapter,
      )
    ).value as Row
    assert.deepEqual(
      {
        ok: created.ok,
        id: created.id,
        companyId: created.companyId,
        rate: created.rate,
        quantity: created.quantity,
        amountTotal: created.amountTotal,
        currency: created.currency,
        existing: created.existing,
      },
      {
        ok: true,
        id: 'web-1',
        companyId: 'acme',
        rate: '100',
        quantity: 1,
        amountTotal: '200',
        currency: 'VND',
        existing: false,
      },
    )
    const retry = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-1-retried', 'checkout-session-1'),
        adapter,
      )
    ).value as Row
    assert.equal(retry.id, 'web-1')
    assert.equal(retry.existing, true)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_reservation'))[0]?.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_folio'))[0]?.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_stay'))[0]?.n, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_charge'))[0]?.n, 1)

    const conflict = (
      await call(
        'hospitality_core.createOnlineReservation',
        onlineReservation('web-conflict', 'checkout-session-1', { checkOut: futureDate(13) }),
        adapter,
      )
    ).value as Row
    assert.equal(conflict.ok, false)
    assert.equal((conflict.errors as Row[])[0]?.messageKey, 'hospitality_core.error.requestConflict')

    const mine = (await call('hospitality_core.listPartnerReservations', { partnerId: 'guest' }, adapter))
      .value as Row[]
    assert.equal(mine.length, 1)
    assert.equal(mine[0]?.companyId, 'acme')
    assert.equal(mine[0]?.cancellationAllowed, true)
    assert.equal('folioId' in mine[0]!, false)
    const stolen = (
      await call('hospitality_core.getPartnerReservation', { id: 'web-1', partnerId: 'companion' }, adapter)
    ).value as Row
    assert.equal(stolen.ok, false)
    assert.equal((stolen.errors as Row[])[0]?.messageKey, 'hospitality_core.error.reservationNotOwned')

    const cancelled = (
      await call(
        'hospitality_core.cancelPartnerReservation',
        { id: 'web-1', partnerId: 'guest', at: new Date().toISOString() },
        adapter,
      )
    ).value as Row
    assert.equal(cancelled.ok, true)
    assert.equal(cancelled.existing, false)
    const retriedCancel = (
      await call(
        'hospitality_core.cancelPartnerReservation',
        { id: 'web-1', partnerId: 'guest', at: new Date().toISOString() },
        adapter,
      )
    ).value as Row
    assert.equal(retriedCancel.existing, true)
    const ledger = await adapter.all(
      'SELECT sold, available FROM hospitality_core_availability_ledger ORDER BY date',
    )
    assert.deepEqual(
      ledger.map((row) => [Number(row.sold), Number(row.available)]),
      [
        [0, 2],
        [0, 2],
      ],
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality online: concurrent SQLite booking admits one reservation without oversell', async () => {
  const adapter = await boot()
  try {
    await adapter.run('UPDATE hospitality_core_room SET active = 0 WHERE id = ?', ['102'])
    const attempts = await Promise.all([
      call('hospitality_core.createOnlineReservation', onlineReservation('race-a', 'race-a'), adapter),
      call('hospitality_core.createOnlineReservation', onlineReservation('race-b', 'race-b'), adapter),
    ])
    const values = attempts.map((attempt) => attempt.value as Row)
    assert.equal(values.filter((value) => value.ok === true).length, 1)
    assert.equal(
      values.filter(
        (value) =>
          value.ok === false &&
          (value.errors as Row[]).some(
            (error) => error.messageKey === 'hospitality_core.error.inventoryUnavailable',
          ),
      ).length,
      1,
    )
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_reservation'))[0]?.n, 1)
    const ledger = await adapter.all('SELECT sold, total FROM hospitality_core_availability_ledger')
    assert.ok(ledger.every((row) => Number(row.sold) === 1 && Number(row.total) === 1))
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
    const moveTasks = await adapter.all(
      `SELECT "roomId", "stayId", "taskType", priority, state, notes
         FROM hospitality_core_cleaning_task
        WHERE id = ?`,
      ['move:a1:clean'],
    )
    assert.deepEqual(
      { ...moveTasks[0] },
      {
        roomId: '101',
        stayId: 'r1:stay',
        taskType: 'daily_clean',
        priority: 'normal',
        state: 'todo',
        notes: 'upgrade',
      },
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
    const tampered = await call(
      'hospitality_core.voidCharge',
      { id: 'spa-1', folioId: 'another:folio', reason: 'tampered route scope' },
      adapter,
    )
    assert.equal((tampered.value as Row).ok, false)
    assert.equal(((tampered.value as Row).errors as Row[])[0]!.code, 'folio_mismatch')
    assert.equal(
      (await adapter.all('SELECT state FROM hospitality_core_charge WHERE id = ?', ['spa-1']))[0]!.state,
      'active',
    )
    const voided = await call(
      'hospitality_core.voidCharge',
      {
        id: 'spa-1',
        folioId: 'r1:folio',
        reason: 'posted twice',
        voidedAt: '2026-08-25T10:00:00.000Z',
      },
      adapter,
    )
    const voidRetry = await call(
      'hospitality_core.voidCharge',
      { id: 'spa-1', folioId: 'r1:folio', reason: 'retry must not change evidence' },
      adapter,
    )
    assert.deepEqual(
      {
        ok: (voided.value as Row).ok,
        amount: (voided.value as Row).amount,
        amountTotal: (voided.value as Row).amountTotal,
        existing: (voided.value as Row).existing,
      },
      { ok: true, amount: 25, amountTotal: '200', existing: false },
    )
    assert.equal((voidRetry.value as Row).existing, true)
    const storedCharge = (
      await adapter.all('SELECT state, "voidedAt", "voidReason" FROM hospitality_core_charge WHERE id = ?', [
        'spa-1',
      ])
    )[0]!
    assert.deepEqual(
      { ...storedCharge },
      { state: 'void', voidedAt: '2026-08-25T10:00:00.000Z', voidReason: 'posted twice' },
    )
    assert.equal(
      (await adapter.all('SELECT "amountTotal" FROM hospitality_core_folio'))[0]!.amountTotal,
      '200',
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
    const unregistered = await call(
      'hospitality_core.saveGuestDocument',
      {
        id: 'doc1',
        stayId: 'r1:stay',
        partnerId: 'companion',
        type: 'passport',
        number: 'P7654321',
        fullName: 'TRAN BINH',
      },
      adapter,
    )
    assert.equal((unregistered.value as Row).ok, false)
    assert.equal(((unregistered.value as Row).errors as Row[])[0]?.code, 'guest_not_registered')

    const saved = await call(
      'hospitality_core.saveGuestDocument',
      {
        id: 'doc1',
        stayId: 'r1:stay',
        partnerId: 'guest',
        type: 'passport',
        number: 'P1234567',
        fullName: 'NGUYEN AN',
        dateOfBirth: '1990-05-12T00:00:00.000Z',
        nationality: 'VN',
        permanentAddress: 'private address',
        ocrRaw: { confidence: 0.99 },
      },
      adapter,
    )
    assert.equal((saved.value as Row).ok, true)
    await call(
      'hospitality_core.addStayGuest',
      { id: 'g2', stayId: 'r1:stay', partnerId: 'companion', displayName: 'Trần Bình' },
      adapter,
    )
    const reassigned = await call(
      'hospitality_core.saveGuestDocument',
      {
        id: 'doc1',
        stayId: 'r1:stay',
        partnerId: 'companion',
        type: 'passport',
        fullName: 'TRAN BINH',
      },
      adapter,
    )
    assert.equal((reassigned.value as Row).ok, false)
    assert.equal(((reassigned.value as Row).errors as Row[])[0]?.code, 'document_owner_immutable')

    const documents = (await call('hospitality_core.listGuestDocuments', { stayId: 'r1:stay' }, adapter))
      .value as Row[]
    assert.equal(documents[0]!.numberLast4, '4567')
    assert.equal(documents[0]!.dateOfBirthPresent, true)
    assert.equal('number' in documents[0]!, false)
    assert.equal('permanentAddress' in documents[0]!, false)
    assert.equal('ocrRaw' in documents[0]!, false)
    assert.doesNotMatch(JSON.stringify(documents), /P1234567|private address|confidence/)
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
    await call(
      'hospitality_core.saveRoom',
      { id: 'hnl-101', propertyId: 'honolulu', roomTypeId: 'ocean', code: '101', name: '101' },
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

test('hospitality housekeeping: checkout creates one urgent task and cleaning restores the room', async () => {
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('clean'), adapter)
    await call(
      'hospitality_core.checkIn',
      {
        stayId: 'clean:stay',
        roomId: '101',
        assignmentId: 'clean:assignment',
        at: '2026-09-01T14:05:00.000Z',
      },
      adapter,
    )
    await call('hospitality_core.checkOut', { stayId: 'clean:stay', at: '2026-09-03T12:00:00.000Z' }, adapter)
    await call('hospitality_core.checkOut', { stayId: 'clean:stay', at: '2026-09-03T12:00:00.000Z' }, adapter)

    const tasks = await adapter.all(
      'SELECT id, state, priority, "taskType", "roomId" FROM hospitality_core_cleaning_task',
    )
    assert.deepEqual(
      tasks.map((row) => ({ ...row })),
      [
        {
          id: 'checkout:clean:stay',
          state: 'todo',
          priority: 'urgent',
          taskType: 'checkout_clean',
          roomId: '101',
        },
      ],
    )
    const detail = (await call('hospitality_core.getCleaningTask', { id: 'checkout:clean:stay' }, adapter))
      .value as Row
    assert.equal((detail.room as Row).status, 'dirty')
    assert.equal((detail.property as Row).name, 'Ket Hotel')
    assert.equal((detail.stay as Row).code, 'S-CLEAN')
    const hidden = await callFn(
      'hospitality_core.getCleaningTask',
      { id: 'checkout:clean:stay' },
      { adapter, manifest, scope: { company: 'globex', branches: null } },
    )
    assert.equal(hidden.value, null, 'a company cannot open another company’s housekeeping task')
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'dirty',
    )

    const started = await call(
      'hospitality_core.startCleaningTask',
      { id: 'checkout:clean:stay', assigneeId: 'housekeeper', at: '2026-09-03T12:05:00.000Z' },
      adapter,
    )
    assert.equal((started.value as Row).state, 'in_progress')
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'cleaning',
    )

    const completed = await call(
      'hospitality_core.completeCleaningTask',
      { id: 'checkout:clean:stay', at: '2026-09-03T12:30:00.000Z' },
      adapter,
    )
    assert.equal((completed.value as Row).state, 'done')
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'available',
    )
    const summary = (await call('hospitality_core.cleaningTaskSummary', { propertyId: 'hotel' }, adapter))
      .value as Row
    assert.deepEqual(summary, { todo: 0, inProgress: 0, done: 1, cancelled: 0 })
  } finally {
    await adapter.close()
  }
})

test('hospitality housekeeping: room board is scoped, exact and rejects unsafe status changes', async () => {
  const adapter = await boot()
  try {
    const missingReason = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'available', status: 'maintenance' },
      adapter,
    )
    assert.equal((missingReason.value as Row).ok, false)
    assert.equal(((missingReason.value as Row).errors as Row[])[0]!.code, 'room_status_note_required')

    const bypassHousekeeping = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'available', status: 'available' },
      adapter,
    )
    assert.equal(
      ((bypassHousekeeping.value as Row).errors as Row[])[0]!.code,
      'room_status_available_managed',
    )

    const serviced = await call(
      'hospitality_core.setRoomStatus',
      {
        id: '101',
        expectedStatus: 'available',
        status: 'maintenance',
        note: 'Khóa nước tầng 1.',
      },
      adapter,
    )
    assert.equal((serviced.value as Row).status, 'maintenance')
    const serviceRetry = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'maintenance', status: 'maintenance' },
      adapter,
    )
    assert.equal((serviceRetry.value as Row).status, 'maintenance')
    const stale = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'available', status: 'dirty' },
      adapter,
    )
    assert.equal(((stale.value as Row).errors as Row[])[0]!.code, 'transition_conflict')

    const summary = (await call('hospitality_core.roomStatusSummary', { propertyId: 'hotel' }, adapter))
      .value as Row
    assert.deepEqual(summary, {
      available: 1,
      occupied: 0,
      dirty: 0,
      cleaning: 0,
      maintenance: 1,
      outOfOrder: 0,
    })
    const detail = (await call('hospitality_core.getHousekeepingRoom', { id: '101' }, adapter)).value as Row
    assert.equal((detail.property as Row).name, 'Ket Hotel')
    assert.equal((detail.roomType as Row).name, 'Deluxe')
    assert.equal(detail.note, 'Khóa nước tầng 1.')
    const hidden = await callFn(
      'hospitality_core.getHousekeepingRoom',
      { id: '101' },
      { adapter, manifest, scope: { company: 'globex', branches: null } },
    )
    assert.equal(hidden.value, null)

    const wrongTaskType = await call(
      'hospitality_core.createCleaningTask',
      { id: 'wrong-service-task', code: 'HK-WRONG', roomId: '101', taskType: 'inspection' },
      adapter,
    )
    assert.equal(((wrongTaskType.value as Row).errors as Row[])[0]!.code, 'cleaning_room_status')
    await call(
      'hospitality_core.createCleaningTask',
      { id: 'maintenance-task', code: 'HK-MAINT', roomId: '101', taskType: 'maintenance' },
      adapter,
    )
    const releaseBlocked = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'maintenance', status: 'dirty' },
      adapter,
    )
    assert.equal(((releaseBlocked.value as Row).errors as Row[])[0]!.code, 'room_task_open')
    await call('hospitality_core.cancelCleaningTask', { id: 'maintenance-task' }, adapter)
    await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'maintenance', status: 'dirty' },
      adapter,
    )
    await call(
      'hospitality_core.createCleaningTask',
      { id: 'room-board-clean', code: 'HK-ROOM-BOARD', roomId: '101', taskType: 'inspection' },
      adapter,
    )
    const taskBlocked = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'dirty', status: 'out_of_order', note: 'Khóa phòng.' },
      adapter,
    )
    assert.equal(((taskBlocked.value as Row).errors as Row[])[0]!.code, 'room_task_open')

    await call('hospitality_core.startCleaningTask', { id: 'room-board-clean' }, adapter)
    const cleaningBlocked = await call(
      'hospitality_core.setRoomStatus',
      { id: '101', expectedStatus: 'cleaning', status: 'maintenance', note: 'Dừng việc.' },
      adapter,
    )
    assert.equal(((cleaningBlocked.value as Row).errors as Row[])[0]!.code, 'room_cleaning')
    await call('hospitality_core.completeCleaningTask', { id: 'room-board-clean' }, adapter)

    await call('hospitality_core.createReservation', reservation('occupied-board'), adapter)
    await call(
      'hospitality_core.checkIn',
      {
        stayId: 'occupied-board:stay',
        roomId: '102',
        assignmentId: 'occupied-board:assignment',
        at: '2026-09-01T14:05:00.000Z',
      },
      adapter,
    )
    const occupiedBlocked = await call(
      'hospitality_core.setRoomStatus',
      { id: '102', expectedStatus: 'occupied', status: 'maintenance', note: 'Không an toàn.' },
      adapter,
    )
    assert.equal(((occupiedBlocked.value as Row).errors as Row[])[0]!.code, 'room_occupied')
    const occupied = (await call('hospitality_core.getHousekeepingRoom', { id: '102' }, adapter)).value as Row
    assert.equal((occupied.currentStay as Row).code, 'S-OCCUPIED-BOARD')
    assert.equal(((occupied.currentStay as Row).partner as Row).name, 'Nguyễn An')
  } finally {
    await adapter.close()
  }
})

test('hospitality housekeeping: stayover cleaning never makes an occupied room available', async () => {
  const adapter = await boot()
  try {
    await call('hospitality_core.createReservation', reservation('stayover'), adapter)
    await call(
      'hospitality_core.checkIn',
      {
        stayId: 'stayover:stay',
        roomId: '101',
        assignmentId: 'stayover:assignment',
        at: '2026-09-01T14:05:00.000Z',
      },
      adapter,
    )
    await call(
      'hospitality_core.createCleaningTask',
      {
        id: 'stayover-clean',
        code: 'HK-STAYOVER',
        roomId: '101',
        stayId: 'stayover:stay',
        taskType: 'daily_clean',
      },
      adapter,
    )
    await call('hospitality_core.startCleaningTask', { id: 'stayover-clean' }, adapter)
    await call('hospitality_core.completeCleaningTask', { id: 'stayover-clean' }, adapter)

    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'occupied',
    )
  } finally {
    await adapter.close()
  }
})

test('hospitality housekeeping: a room stays cleaning until its last active task finishes', async () => {
  const adapter = await boot()
  try {
    await call('hospitality_core.setRoomStatus', { id: '101', status: 'dirty' }, adapter)
    for (const id of ['clean-a', 'clean-b']) {
      await call(
        'hospitality_core.createCleaningTask',
        { id, code: id.toUpperCase(), roomId: '101', taskType: 'daily_clean' },
        adapter,
      )
      await call('hospitality_core.startCleaningTask', { id }, adapter)
    }
    await call('hospitality_core.completeCleaningTask', { id: 'clean-a' }, adapter)
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'cleaning',
    )
    await call('hospitality_core.completeCleaningTask', { id: 'clean-b' }, adapter)
    assert.equal(
      (await adapter.all('SELECT status FROM hospitality_core_room WHERE id = ?', ['101']))[0]!.status,
      'available',
    )
  } finally {
    await adapter.close()
  }
})
