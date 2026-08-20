// Loads the hotel master-data path through the public functions on several real
// databases. SQLite measures the local/dev shape; PostgreSQL catches DDL, index,
// decimal and concurrency differences that an in-memory unit test cannot see.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import { postgresAdapter } from 'ketjs-postgres'
import type { Adapter } from 'ketjs'
import { company, hospitalityCore, partner, storage } from 'ketsuite'
import { address } from 'ketsuite'
import backend from 'ketsuite/backend'

const driver = process.env.KET_BENCH_DRIVER ?? 'sqlite'
const databaseCount = Number(process.env.KET_BENCH_DATABASES ?? (driver === 'postgres' ? 4 : 8))
const roomsPerDatabase = Number(process.env.KET_BENCH_ROOMS ?? 250)
const readPasses = Number(process.env.KET_BENCH_READS ?? 50)
const reservationsPerDatabase = Number(process.env.KET_BENCH_RESERVATIONS ?? 100)
if (!Number.isInteger(databaseCount) || databaseCount < 2) throw new Error('KET_BENCH_DATABASES must be >= 2')
if (!Number.isInteger(roomsPerDatabase) || roomsPerDatabase < 1)
  throw new Error('KET_BENCH_ROOMS must be >= 1')
if (!Number.isInteger(readPasses) || readPasses < 1) throw new Error('KET_BENCH_READS must be >= 1')
if (!Number.isInteger(reservationsPerDatabase) || reservationsPerDatabase < 2)
  throw new Error('KET_BENCH_RESERVATIONS must be >= 2')

const keys = Array.from(
  { length: databaseCount },
  (_, index) => `hospitality_bench_${String(index).padStart(3, '0')}`,
)
const modules = [address, partner, company, storage, backend, hospitalityCore]
const manifest = compose(modules, { headless: true })
registerFunctions(modules)

const pgUrl = process.env.KET_BENCH_PG ?? 'postgres://dev:devpassword@127.0.0.1:5435/postgres'
const pgBase = pgUrl.replace(/\/[^/]*$/, '')
let localDir: string | null = null
let admin: Adapter | null = null
const adapters = new Map<string, Adapter>()

const open = (key: string): Adapter =>
  driver === 'postgres'
    ? postgresAdapter(`${pgBase}/${key}`, { max: 2 })
    : sqliteAdapter(join(localDir as string, `${key}.db`))

const prepare = async () => {
  if (driver === 'sqlite') {
    localDir = mkdtempSync(join(tmpdir(), 'ket-hospitality-bench-'))
    return
  }
  if (driver !== 'postgres') throw new Error('KET_BENCH_DRIVER must be sqlite or postgres')
  admin = postgresAdapter(pgUrl, { max: 1 })
  await admin.open()
  for (const key of keys) {
    await admin.exec(`DROP DATABASE IF EXISTS "${key}" WITH (FORCE)`)
    await admin.exec(`CREATE DATABASE "${key}"`)
  }
}

const cleanup = async () => {
  await Promise.all([...adapters.values()].map((adapter) => adapter.close().catch(() => {})))
  if (admin) {
    for (const key of keys) await admin.exec(`DROP DATABASE IF EXISTS "${key}" WITH (FORCE)`)
    await admin.close()
  }
  if (localDir) rmSync(localDir, { recursive: true, force: true })
}

const call = (key: string, name: string, args: Record<string, unknown>) =>
  callWith(adapters.get(key)!, key, name, args)

const callWith = (adapter: Adapter, key: string, name: string, args: Record<string, unknown>) =>
  callFn(name, args, {
    adapter,
    manifest,
    scope: { company: key, branches: null },
  })

await prepare()
try {
  for (const key of keys) {
    const adapter = open(key)
    await adapter.open()
    adapters.set(key, adapter)
  }

  const migrateStarted = performance.now()
  await Promise.all([...adapters.values()].map((adapter) => migrateOne(adapter, manifest)))
  const migrateMs = performance.now() - migrateStarted

  const writeStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      await call(key, 'partner.savePartner', {
        id: 'guest',
        kind: 'person',
        name: `Benchmark guest ${key}`,
      })
      await call(key, 'hospitality_core.saveProperty', {
        id: 'property',
        code: 'MAIN',
        name: `Benchmark ${key}`,
        accommodationType: 'hotel',
        starRating: 4,
      })
      await call(key, 'hospitality_core.saveBuilding', {
        id: 'building',
        propertyId: 'property',
        code: 'A',
        name: 'Main building',
      })
      for (let floor = 0; floor < 10; floor++)
        await call(key, 'hospitality_core.saveFloor', {
          id: `floor:${floor}`,
          propertyId: 'property',
          buildingId: 'building',
          code: String(floor + 1).padStart(2, '0'),
          name: `Floor ${floor + 1}`,
          sequence: floor,
        })
      for (let type = 0; type < 12; type++)
        await call(key, 'hospitality_core.saveRoomType', {
          id: `type:${type}`,
          propertyId: 'property',
          code: `T${String(type).padStart(2, '0')}`,
          name: `Room type ${type}`,
          defaultCapacity: 2 + (type % 3),
          baseRate: String(800_000 + type * 125_000),
          published: true,
        })
      for (let room = 0; room < roomsPerDatabase; room++) {
        const floor = room % 10
        await call(key, 'hospitality_core.saveRoom', {
          id: `room:${room}`,
          propertyId: 'property',
          roomTypeId: `type:${room % 12}`,
          buildingId: 'building',
          floorId: `floor:${floor}`,
          code: String(101 + room),
          name: String(101 + room),
          status: room % 17 === 0 ? 'maintenance' : room % 5 === 0 ? 'occupied' : 'available',
        })
      }
    }),
  )
  const writeMs = performance.now() - writeStarted

  const bookingStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      for (let booking = 0; booking < reservationsPerDatabase; booking++)
        await call(key, 'hospitality_core.createReservation', {
          id: `reservation:${booking}`,
          propertyId: 'property',
          roomTypeId: `type:${booking % 12}`,
          partnerId: 'guest',
          provider: booking % 3 === 0 ? 'booking' : 'direct',
          ...(booking % 3 === 0 ? { externalId: `${key}:${booking}` } : {}),
          bookingType: 'nightly',
          checkIn: '2026-09-01T14:00:00.000Z',
          checkOut: '2026-09-03T12:00:00.000Z',
          rate: String(800_000 + (booking % 12) * 125_000),
          createdAt: '2026-08-20T00:00:00.000Z',
        })
    }),
  )
  const bookingMs = performance.now() - bookingStarted

  const candidateRooms = Array.from({ length: roomsPerDatabase }, (_, room) => room).filter(
    (room) => room % 17 !== 0 && room % 5 !== 0,
  )
  const transitionCount = Math.min(12, candidateRooms.length, reservationsPerDatabase)
  const transitionRooms = Array.from({ length: transitionCount }, (_, index) =>
    candidateRooms.find((candidate, offset) => offset >= index && candidate % 12 === index % 12),
  )
  const transitionStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      for (let index = 0; index < transitionCount; index++) {
        const room = transitionRooms[index]
        if (room === undefined) continue
        const checkedIn = await call(key, 'hospitality_core.checkIn', {
          stayId: `reservation:${index}:stay`,
          roomId: `room:${room}`,
          assignmentId: `assignment:${index}`,
          at: '2026-09-01T14:05:00.000Z',
        })
        if (!(checkedIn.value as { ok: boolean }).ok) throw new Error(`${key}: check-in failed`)
        await call(key, 'hospitality_core.addCharge', {
          id: `service:${index}`,
          folioId: `reservation:${index}:folio`,
          stayId: `reservation:${index}:stay`,
          description: 'Benchmark service',
          type: 'service',
          unitPrice: '250000',
          sourceKey: `${key}:service:${index}`,
          occurredAt: '2026-09-02T08:00:00.000Z',
        })
        if (index % 2 === 0)
          await call(key, 'hospitality_core.checkOut', {
            stayId: `reservation:${index}:stay`,
            at: '2026-09-03T12:00:00.000Z',
          })
      }
    }),
  )
  const transitionMs = performance.now() - transitionStarted

  const collisionKey = keys[0]!
  const usedRooms = new Set(transitionRooms.filter((room): room is number => room !== undefined))
  const collisionRoom = candidateRooms.find((room) => !usedRooms.has(room))
  if (collisionRoom === undefined) throw new Error('benchmark needs one unused available room')
  for (const suffix of ['a', 'b'])
    await call(collisionKey, 'hospitality_core.createReservation', {
      id: `collision:${suffix}`,
      propertyId: 'property',
      roomTypeId: `type:${collisionRoom % 12}`,
      partnerId: 'guest',
      bookingType: 'nightly',
      checkIn: '2026-10-01T14:00:00.000Z',
      checkOut: '2026-10-02T12:00:00.000Z',
      rate: '1000000',
    })
  const contender = driver === 'postgres' ? open(collisionKey) : null
  if (contender) await contender.open()
  const claim = (adapter: Adapter, suffix: string) =>
    callWith(adapter, collisionKey, 'hospitality_core.checkIn', {
      stayId: `collision:${suffix}:stay`,
      roomId: `room:${collisionRoom}`,
      assignmentId: `collision:${suffix}:assignment`,
      at: '2026-10-01T14:05:00.000Z',
    })
  const collisionResults =
    contender === null
      ? [await claim(adapters.get(collisionKey)!, 'a'), await claim(adapters.get(collisionKey)!, 'b')]
      : await Promise.all([claim(adapters.get(collisionKey)!, 'a'), claim(contender, 'b')])
  const concurrentRoomClaimSingleWinner =
    collisionResults.filter((result) => (result.value as { ok: boolean }).ok).length === 1
  if (!concurrentRoomClaimSingleWinner) throw new Error('room claim did not produce exactly one winner')

  const raceRoom = candidateRooms.find((room) => !usedRooms.has(room) && room !== collisionRoom)
  if (raceRoom === undefined) throw new Error('benchmark needs another unused available room')
  await call(collisionKey, 'hospitality_core.createReservation', {
    id: 'transition-race',
    propertyId: 'property',
    roomTypeId: `type:${raceRoom % 12}`,
    partnerId: 'guest',
    bookingType: 'nightly',
    checkIn: '2026-11-01T14:00:00.000Z',
    checkOut: '2026-11-02T12:00:00.000Z',
    rate: '1000000',
  })
  const checkInRace = (adapter: Adapter) =>
    callWith(adapter, collisionKey, 'hospitality_core.checkIn', {
      stayId: 'transition-race:stay',
      roomId: `room:${raceRoom}`,
      assignmentId: 'transition-race:assignment',
      at: '2026-11-01T14:05:00.000Z',
    })
  const cancelRace = (adapter: Adapter) =>
    callWith(adapter, collisionKey, 'hospitality_core.cancelReservation', {
      id: 'transition-race',
      reason: 'concurrent benchmark',
      at: '2026-10-20T00:00:00.000Z',
    })
  const transitionRaceResults =
    contender === null
      ? [await checkInRace(adapters.get(collisionKey)!), await cancelRace(adapters.get(collisionKey)!)]
      : await Promise.all([checkInRace(adapters.get(collisionKey)!), cancelRace(contender)])
  if (contender) await contender.close()
  if (transitionRaceResults.filter((result) => (result.value as { ok: boolean }).ok).length !== 1)
    throw new Error('check-in/cancel race did not produce exactly one winner')
  const transitionState = (
    await adapters.get(collisionKey)!.all(
      `SELECT r.state AS reservation, s.state AS stay, room.status AS room,
          (SELECT COUNT(*) FROM hospitality_core_room_assignment a WHERE a."stayId" = s.id) AS assignments
         FROM hospitality_core_reservation r
         JOIN hospitality_core_stay s ON s.id = r."stayId"
         JOIN hospitality_core_room room ON room.id = ${driver === 'postgres' ? '$1' : '?'}
         WHERE r.id = ${driver === 'postgres' ? '$2' : '?'}`,
      [`room:${raceRoom}`, 'transition-race'],
    )
  )[0]!
  const concurrentCancelCheckInConsistent =
    (transitionState.reservation === 'checked_in' &&
      transitionState.stay === 'checked_in' &&
      transitionState.room === 'occupied' &&
      Number(transitionState.assignments) === 1) ||
    (transitionState.reservation === 'cancelled' &&
      transitionState.stay === 'cancelled' &&
      transitionState.room === 'available' &&
      Number(transitionState.assignments) === 0)
  if (!concurrentCancelCheckInConsistent) throw new Error('check-in/cancel race left inconsistent state')

  const readStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      for (let pass = 0; pass < readPasses; pass++) {
        const response = await call(key, 'hospitality_core.listRooms', {
          propertyId: 'property',
          ...(pass % 2 ? { status: 'available' } : {}),
        })
        const rows = response.value as unknown[]
        if (!rows.length) throw new Error(`${key}: room query returned no rows`)
        const reservations = await call(key, 'hospitality_core.listReservations', {
          propertyId: 'property',
          from: '2026-09-01T00:00:00.000Z',
          to: '2026-09-04T00:00:00.000Z',
        })
        if ((reservations.value as unknown[]).length !== reservationsPerDatabase)
          throw new Error(`${key}: reservation query returned the wrong count`)
      }
    }),
  )
  const readMs = performance.now() - readStarted

  if (driver === 'postgres') {
    const columns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_property!
    if (columns['baseRate']) throw new Error('room-type fields leaked into property')
    const roomTypeColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_room_type!
    if (roomTypeColumns['baseRate'] !== 'numeric')
      throw new Error(`PostgreSQL baseRate is ${roomTypeColumns['baseRate']}, expected numeric`)
  }

  const totalRooms = databaseCount * roomsPerDatabase
  const totalReservations = databaseCount * reservationsPerDatabase
  const totalTransitions = databaseCount * transitionCount
  const totalReads = databaseCount * readPasses
  const expectedCheckoutTasks = transitionRooms.filter(
    (room, index) => room !== undefined && index % 2 === 0,
  ).length
  const housekeepingCheckoutTasksMatch = await Promise.all(
    keys.map(async (key) => {
      const rows = await adapters
        .get(key)!
        .all(`SELECT COUNT(*) AS n FROM hospitality_core_cleaning_task WHERE "taskType" = 'checkout_clean'`)
      return Number(rows[0]!.n) === expectedCheckoutTasks
    }),
  ).then((matches) => matches.every(Boolean))
  if (!housekeepingCheckoutTasksMatch) throw new Error('checkout did not create one cleaning task per stay')
  console.log(
    JSON.stringify(
      {
        driver,
        databases: databaseCount,
        rooms: totalRooms,
        migrateMs: Number(migrateMs.toFixed(1)),
        writeMs: Number(writeMs.toFixed(1)),
        writesPerSecond: Math.round((totalRooms * 1_000) / writeMs),
        reservations: totalReservations,
        bookingMs: Number(bookingMs.toFixed(1)),
        bookingsPerSecond: Math.round((totalReservations * 1_000) / bookingMs),
        checkInChargeCheckoutCycles: totalTransitions,
        transitionMs: Number(transitionMs.toFixed(1)),
        transitionsPerSecond: Math.round((totalTransitions * 1_000) / transitionMs),
        concurrentRoomClaimSingleWinner,
        concurrentCancelCheckInConsistent,
        housekeepingCheckoutTasksMatch,
        listQueries: totalReads,
        readMs: Number(readMs.toFixed(1)),
        readsPerSecond: Math.round((totalReads * 1_000) / readMs),
        isolatedDatabaseCountsMatch: await Promise.all(
          keys.map(async (key) => {
            const rows = await adapters
              .get(key)!
              .all(
                `SELECT COUNT(*) AS n FROM hospitality_core_room WHERE "companyId" = ${driver === 'postgres' ? '$1' : '?'}`,
                [key],
              )
            return Number(rows[0]!.n) === roomsPerDatabase
          }),
        ).then((matches) => matches.every(Boolean)),
      },
      null,
      2,
    ),
  )
} finally {
  await cleanup()
}
