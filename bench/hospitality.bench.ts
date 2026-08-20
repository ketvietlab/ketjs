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
import backend from 'ketsuite/backend'

const driver = process.env.KET_BENCH_DRIVER ?? 'sqlite'
const databaseCount = Number(process.env.KET_BENCH_DATABASES ?? (driver === 'postgres' ? 4 : 8))
const roomsPerDatabase = Number(process.env.KET_BENCH_ROOMS ?? 250)
const readPasses = Number(process.env.KET_BENCH_READS ?? 50)
if (!Number.isInteger(databaseCount) || databaseCount < 2) throw new Error('KET_BENCH_DATABASES must be >= 2')
if (!Number.isInteger(roomsPerDatabase) || roomsPerDatabase < 1)
  throw new Error('KET_BENCH_ROOMS must be >= 1')
if (!Number.isInteger(readPasses) || readPasses < 1) throw new Error('KET_BENCH_READS must be >= 1')

const keys = Array.from(
  { length: databaseCount },
  (_, index) => `hospitality_bench_${String(index).padStart(3, '0')}`,
)
const modules = [partner, company, storage, backend, hospitalityCore]
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
  callFn(name, args, {
    adapter: adapters.get(key)!,
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
  const totalReads = databaseCount * readPasses
  console.log(
    JSON.stringify(
      {
        driver,
        databases: databaseCount,
        rooms: totalRooms,
        migrateMs: Number(migrateMs.toFixed(1)),
        writeMs: Number(writeMs.toFixed(1)),
        writesPerSecond: Math.round((totalRooms * 1_000) / writeMs),
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
