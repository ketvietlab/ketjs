// Loads the hotel master-data path through the public functions on several real
// databases. SQLite measures the local/dev shape; PostgreSQL catches DDL, index,
// decimal and concurrency differences that an in-memory unit test cannot see.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  callFn,
  compose,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import type { Adapter, Ctx } from '@ketvietlab/ketjs'
import { company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import { executeNightAudit } from '../packages/ketsuite/src/modules/hospitality_core/night-audit.ts'
import { prepareStayNotices } from '../packages/ketsuite/src/modules/hospitality_core/stay-notices.ts'

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
const onlineDate = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const onlineQuoteCheckIn = onlineDate(10)
const onlineQuoteCheckOut = onlineDate(12)
const onlineContentionCheckIn = onlineDate(20)
const onlineContentionCheckOut = onlineDate(21)
const onlineBookingCheckIn = onlineDate(30)
const onlineBookingCheckOut = onlineDate(32)

const keys = Array.from(
  { length: databaseCount },
  (_, index) => `hospitality_bench_${String(index).padStart(3, '0')}`,
)
const nightAuditEffects = [
  'read:hospitality_core.Property',
  'read:hospitality_core.Stay',
  'write:hospitality_core.Stay',
  'read:hospitality_core.Folio',
  'write:hospitality_core.Folio',
  'read:hospitality_core.ExtraLine',
  'read:hospitality_core.Charge',
  'write:hospitality_core.Charge',
  'read:hospitality_core.NightAuditRun',
  'write:hospitality_core.NightAuditRun',
  'read:product.Product',
  'read:product.Template',
  'read:product.ProductUom',
  'read:uom.Unit',
]
const benchmarkAudit = defineModule({
  name: 'hospitality_benchmark_audit',
  depends: ['hospitality_core'],
  functions: {
    prepare: {
      input: { runId: 'id', propertyId: 'id', auditDate: 'date' },
      effects: ['write:hospitality_core.NightAuditRun'],
      handler: (ctx: Ctx, args) =>
        ctx.db.insertIfAbsent('hospitality_core.NightAuditRun', {
          id: args.runId,
          propertyId: args.propertyId,
          auditDate: args.auditDate,
          state: 'queued',
          inHouseCount: 0,
          servicePosted: 0,
          rentPosted: 0,
          existingCount: 0,
          totalAmount: '0',
          attempt: 0,
          requestedAt: '2026-09-02T01:00:00.000Z',
        }),
    },
    execute: {
      input: { runId: 'id', propertyId: 'id', auditDate: 'date' },
      effects: nightAuditEffects,
      handler: (ctx: Ctx, args) =>
        executeNightAudit(ctx, {
          runId: String(args.runId),
          propertyId: String(args.propertyId),
          auditDate: String(args.auditDate),
        }),
    },
    prepareStayNotices: {
      input: { stayId: 'id' },
      effects: [
        'read:hospitality_core.Stay',
        'read:hospitality_core.Property',
        'read:hospitality_core.StayGuest',
        'read:hospitality_core.GuestDocument',
        'read:hospitality_core.StayNotice',
        'write:hospitality_core.StayNotice',
      ],
      handler: (ctx: Ctx, args) => prepareStayNotices(ctx, String(args.stayId)),
    },
  },
})
const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore, benchmarkAudit]
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
    actor: 'benchmark-operator',
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
      await call(key, 'partner.savePartner', {
        id: 'companion',
        kind: 'person',
        name: `Benchmark companion ${key}`,
      })
      await call(key, 'hospitality_core.saveProperty', {
        id: 'property',
        code: 'MAIN',
        name: `Benchmark ${key}`,
        accommodationType: 'hotel',
        starRating: 4,
        street1: '123 Benchmark Street',
        locality: 'Ho Chi Minh City',
      })
      await call(key, 'hospitality_core.saveGuestDocument', {
        id: 'guest-document',
        partnerId: 'guest',
        type: 'cccd',
        number: `ID-${key}-9876`,
        fullName: `Benchmark guest ${key}`,
        dateOfBirth: '1990-05-12T00:00:00.000Z',
        ocrState: 'done',
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
        })
      }
      await call(key, 'hospitality_core.setRoomStatus', {
        id: 'room:0',
        expectedStatus: 'available',
        status: 'maintenance',
        note: 'Initial benchmark maintenance evidence',
      })
    }),
  )
  const writeMs = performance.now() - writeStarted

  const propertySettingsStarted = performance.now()
  const propertySettingsMatch = await Promise.all(
    keys.map(async (key) => {
      const policy = await call(key, 'hospitality_core.saveCancellationPolicy', {
        id: 'property-default-policy',
        code: 'PROPERTY-DEFAULT',
        name: 'Benchmark flexible policy',
        type: 'flexible',
        freeCancellationHours: 24,
      })
      if (!(policy.value as { ok: boolean }).ok) return false
      const saved = await call(key, 'hospitality_core.saveProperty', {
        id: 'property',
        code: 'MAIN',
        name: `Benchmark ${key}`,
        publicName: `Benchmark public ${key}`,
        accommodationType: 'hotel',
        timezone: 'Asia/Ho_Chi_Minh',
        defaultCheckIn: '15:00',
        defaultCheckOut: '11:00',
        enforceTimes: true,
        longStayBillOnCheckIn: true,
        starRating: 4,
        street1: '123 Benchmark Street',
        locality: 'Ho Chi Minh City',
        description: `Property workspace ${key}`,
        houseRules: 'Synthetic benchmark rules',
        childrenStayFree: true,
        minimumGuestAge: 18,
        defaultCancellationPolicyId: 'property-default-policy',
      })
      if (!(saved.value as { ok: boolean }).ok) return false
      const detail = await call(key, 'hospitality_core.getProperty', { id: 'property' })
      const value = detail.value as Record<string, unknown>
      const defaultPolicy = value.defaultCancellationPolicy as Record<string, unknown> | null
      return (
        value.publicName === `Benchmark public ${key}` &&
        value.defaultCheckIn === '15:00' &&
        value.defaultCheckOut === '11:00' &&
        value.longStayBillOnCheckIn === true &&
        value.addressLine === '123 Benchmark Street, Ho Chi Minh City' &&
        defaultPolicy?.id === 'property-default-policy'
      )
    }),
  ).then((matches) => matches.every(Boolean))
  const propertySettingsMs = performance.now() - propertySettingsStarted
  if (!propertySettingsMatch)
    throw new Error('property workspace settings, address preservation or default policy did not persist')

  const roomTypeSettingsStarted = performance.now()
  const roomTypeSettingsResults = await Promise.all(
    keys.map(async (key) => {
      const saved = await call(key, 'hospitality_core.saveRoomType', {
        id: 'type:0',
        propertyId: 'property',
        code: 'T00',
        name: 'Benchmark river deluxe',
        publicName: `River Deluxe ${key}`,
        description: 'Synthetic room type workspace benchmark',
        defaultCapacity: 3,
        maxAdults: 2,
        maxChildren: 1,
        maxInfants: 1,
        maxExtraBeds: 1,
        sizeSqm: '31.5',
        viewType: 'river',
        sharedBathroom: false,
        baseRate: '925000.50',
        color: '#0f766e',
        cancellationPolicyId: 'property-default-policy',
        published: true,
      })
      if (!(saved.value as { ok: boolean }).ok)
        return { key, match: false, saved: saved.value, value: null, expectedRooms: null }
      const detail = await call(key, 'hospitality_core.getRoomType', { id: 'type:0' })
      const value = detail.value as Record<string, unknown>
      const property = value.property as Record<string, unknown> | null
      const policy = value.cancellationPolicy as Record<string, unknown> | null
      const rooms = value.rooms as unknown[]
      const expectedRooms = Math.ceil(roomsPerDatabase / 12)
      return {
        key,
        match:
          value.publicName === `River Deluxe ${key}` &&
          Number(value.defaultCapacity) === 3 &&
          value.viewType === 'river' &&
          value.color === '#0f766e' &&
          property?.id === 'property' &&
          policy?.id === 'property-default-policy' &&
          rooms.length === expectedRooms,
        value: {
          publicName: value.publicName,
          defaultCapacity: value.defaultCapacity,
          viewType: value.viewType,
          color: value.color,
          propertyId: property?.id,
          policyId: policy?.id,
          rooms: rooms.length,
        },
        expectedRooms,
      }
    }),
  )
  const roomTypeSettingsMatch = roomTypeSettingsResults.every((result) => result.match)
  const roomTypeSettingsMs = performance.now() - roomTypeSettingsStarted
  if (!roomTypeSettingsMatch)
    throw new Error(
      `room type workspace settings, property, policy or room preloads did not persist: ${JSON.stringify(
        roomTypeSettingsResults.filter((result) => !result.match),
      )}`,
    )

  const roomConfigurationStarted = performance.now()
  const roomConfigurationResults = await Promise.all(
    keys.map(async (key) => {
      const saved = await call(key, 'hospitality_core.saveRoom', {
        id: 'room:0',
        propertyId: 'property',
        roomTypeId: 'type:0',
        buildingId: 'building',
        floorId: 'floor:0',
        code: '101',
        name: `Configured room ${key}`,
        capacity: 4,
      })
      const bypass = await call(key, 'hospitality_core.saveRoom', {
        id: 'room:0',
        propertyId: 'property',
        roomTypeId: 'type:0',
        buildingId: 'building',
        floorId: 'floor:0',
        code: '101',
        name: `Configured room ${key}`,
        capacity: 4,
        status: 'dirty',
      })
      const detail = await call(key, 'hospitality_core.getRoom', { id: 'room:0' })
      const buildings = await call(key, 'hospitality_core.listBuildings', { propertyId: 'property' })
      const floors = await call(key, 'hospitality_core.listFloors', { propertyId: 'property' })
      const value = detail.value as Record<string, unknown>
      const building = value.building as Record<string, unknown> | null
      const floor = value.floor as Record<string, unknown> | null
      const buildingRows = buildings.value as Array<Record<string, unknown>>
      const floorRows = floors.value as Array<Record<string, unknown>>
      const buildingFloors = buildingRows[0]?.floors
      const buildingRooms = buildingRows[0]?.rooms
      const floorBuilding = floorRows[0]?.building as Record<string, unknown> | undefined
      return {
        key,
        match:
          (saved.value as { ok: boolean }).ok === true &&
          (bypass.value as { ok: boolean }).ok === false &&
          value.name === `Configured room ${key}` &&
          Number(value.capacity) === 4 &&
          value.status === 'maintenance' &&
          building?.id === 'building' &&
          floor?.id === 'floor:0' &&
          Array.isArray(buildingFloors) &&
          buildingFloors.length === 10 &&
          Array.isArray(buildingRooms) &&
          buildingRooms.length === roomsPerDatabase &&
          floorBuilding?.id === 'building',
        saved: saved.value,
        bypass: bypass.value,
        value,
      }
    }),
  )
  const roomConfigurationMatch = roomConfigurationResults.every((result) => result.match)
  const roomConfigurationMs = performance.now() - roomConfigurationStarted
  if (!roomConfigurationMatch)
    throw new Error(
      `room configuration, location preloads or status guard did not persist: ${JSON.stringify(
        roomConfigurationResults.filter((result) => !result.match),
      )}`,
    )

  const locationLifecycleStarted = performance.now()
  const locationLifecycleResults = await Promise.all(
    keys.map(async (key) => {
      await call(key, 'hospitality_core.saveBuilding', {
        id: 'lifecycle-building',
        propertyId: 'property',
        code: 'LIFE',
        name: `Lifecycle building ${key}`,
        sequence: 99,
      })
      await call(key, 'hospitality_core.saveFloor', {
        id: 'lifecycle-floor',
        propertyId: 'property',
        buildingId: 'lifecycle-building',
        code: 'L1',
        name: `Lifecycle floor ${key}`,
        sequence: 99,
      })
      const blockedBuilding = await call(key, 'hospitality_core.archiveBuilding', {
        id: 'lifecycle-building',
        active: false,
      })
      const floorArchived = await call(key, 'hospitality_core.archiveFloor', {
        id: 'lifecycle-floor',
        active: false,
      })
      const buildingArchived = await call(key, 'hospitality_core.archiveBuilding', {
        id: 'lifecycle-building',
        active: false,
      })
      const buildingDetail = await call(key, 'hospitality_core.getBuilding', {
        id: 'lifecycle-building',
      })
      const floorDetail = await call(key, 'hospitality_core.getFloor', { id: 'lifecycle-floor' })
      const blockedFloorRestore = await call(key, 'hospitality_core.archiveFloor', {
        id: 'lifecycle-floor',
        active: true,
      })
      const buildingRestored = await call(key, 'hospitality_core.archiveBuilding', {
        id: 'lifecycle-building',
        active: true,
      })
      const floorRestored = await call(key, 'hospitality_core.archiveFloor', {
        id: 'lifecycle-floor',
        active: true,
      })
      const building = buildingDetail.value as Record<string, unknown>
      const floor = floorDetail.value as Record<string, unknown>
      return {
        key,
        match:
          (blockedBuilding.value as { ok: boolean }).ok === false &&
          (floorArchived.value as { ok: boolean }).ok === true &&
          (buildingArchived.value as { ok: boolean }).ok === true &&
          building.active === false &&
          (building.property as Record<string, unknown> | undefined)?.id === 'property' &&
          floor.active === false &&
          (floor.building as Record<string, unknown> | undefined)?.id === 'lifecycle-building' &&
          (blockedFloorRestore.value as { ok: boolean }).ok === false &&
          (buildingRestored.value as { ok: boolean }).ok === true &&
          (floorRestored.value as { ok: boolean }).ok === true,
      }
    }),
  )
  const locationLifecycleMatch = locationLifecycleResults.every((result) => result.match)
  const locationLifecycleMs = performance.now() - locationLifecycleStarted
  if (!locationLifecycleMatch)
    throw new Error(
      `building and floor lifecycle did not preserve dependency order: ${JSON.stringify(
        locationLifecycleResults.filter((result) => !result.match),
      )}`,
    )

  let concurrentLocationMutationConsistent = true
  if (driver === 'postgres') {
    const races = await Promise.all(
      keys.map(async (key) => {
        await call(key, 'hospitality_core.saveBuilding', {
          id: 'location-race-building',
          propertyId: 'property',
          code: 'RACE',
          name: `Location race ${key}`,
          sequence: 100,
        })
        const contender = open(key)
        await contender.open()
        try {
          const [archive, createFloor] = await Promise.all([
            call(key, 'hospitality_core.archiveBuilding', {
              id: 'location-race-building',
              active: false,
            }),
            callWith(contender, key, 'hospitality_core.saveFloor', {
              id: 'location-race-floor',
              propertyId: 'property',
              buildingId: 'location-race-building',
              code: 'R1',
              name: `Location race floor ${key}`,
              sequence: 100,
            }),
          ])
          const building = (
            await call(key, 'hospitality_core.getBuilding', {
              id: 'location-race-building',
            })
          ).value as Record<string, unknown>
          const floors = building.floors as Array<Record<string, unknown>>
          return (
            [archive, createFloor].filter((result) => (result.value as { ok: boolean }).ok).length === 1 &&
            (building.active === true || !floors.some((floor) => floor.active === true))
          )
        } finally {
          await contender.close()
        }
      }),
    )
    concurrentLocationMutationConsistent = races.every(Boolean)
    if (!concurrentLocationMutationConsistent)
      throw new Error('concurrent location archive and floor creation left an inconsistent hierarchy')
  }

  const roomLifecycleStarted = performance.now()
  const roomLifecycleResults = await Promise.all(
    keys.map(async (key) => {
      await call(key, 'hospitality_core.saveRoom', {
        id: 'lifecycle-room',
        propertyId: 'property',
        roomTypeId: 'type:0',
        buildingId: 'lifecycle-building',
        floorId: 'lifecycle-floor',
        code: 'LIFE-ROOM',
        name: `Lifecycle room ${key}`,
      })
      const archived = await call(key, 'hospitality_core.archiveRoom', {
        id: 'lifecycle-room',
        active: false,
      })
      const activeRooms = await call(key, 'hospitality_core.listRooms', { propertyId: 'property' })
      const allRooms = await call(key, 'hospitality_core.listRooms', {
        propertyId: 'property',
        includeArchived: true,
      })
      await call(key, 'hospitality_core.archiveFloor', { id: 'lifecycle-floor', active: false })
      await call(key, 'hospitality_core.archiveBuilding', {
        id: 'lifecycle-building',
        active: false,
      })
      const blockedRestore = await call(key, 'hospitality_core.archiveRoom', {
        id: 'lifecycle-room',
        active: true,
      })
      await call(key, 'hospitality_core.archiveBuilding', {
        id: 'lifecycle-building',
        active: true,
      })
      await call(key, 'hospitality_core.archiveFloor', { id: 'lifecycle-floor', active: true })
      const restored = await call(key, 'hospitality_core.archiveRoom', {
        id: 'lifecycle-room',
        active: true,
      })
      const detail = await call(key, 'hospitality_core.getRoom', { id: 'lifecycle-room' })
      return {
        key,
        match:
          (archived.value as { ok: boolean }).ok === true &&
          !(activeRooms.value as Array<Record<string, unknown>>).some((row) => row.id === 'lifecycle-room') &&
          (allRooms.value as Array<Record<string, unknown>>).some(
            (row) => row.id === 'lifecycle-room' && row.active === false,
          ) &&
          (blockedRestore.value as { ok: boolean }).ok === false &&
          (restored.value as { ok: boolean }).ok === true &&
          (detail.value as Record<string, unknown>).active === true &&
          (detail.value as Record<string, unknown>).status === 'available',
      }
    }),
  )
  const roomLifecycleMatch = roomLifecycleResults.every((result) => result.match)
  const roomLifecycleMs = performance.now() - roomLifecycleStarted
  if (!roomLifecycleMatch)
    throw new Error(
      `room lifecycle did not preserve archive history or parent restore order: ${JSON.stringify(
        roomLifecycleResults.filter((result) => !result.match),
      )}`,
    )

  let concurrentRoomArchiveTaskSingleWinner = true
  if (driver === 'postgres') {
    const races = await Promise.all(
      keys.map(async (key) => {
        await call(key, 'hospitality_core.saveRoom', {
          id: 'room-archive-race',
          propertyId: 'property',
          roomTypeId: 'type:0',
          code: 'ROOM-RACE',
          name: `Room archive race ${key}`,
        })
        const contender = open(key)
        await contender.open()
        try {
          const [archive, task] = await Promise.all([
            call(key, 'hospitality_core.archiveRoom', { id: 'room-archive-race', active: false }),
            callWith(contender, key, 'hospitality_core.createCleaningTask', {
              id: 'room-archive-race-task',
              code: 'HK-ARCHIVE-RACE',
              roomId: 'room-archive-race',
              taskType: 'daily_clean',
            }),
          ])
          const room = (await call(key, 'hospitality_core.getRoom', { id: 'room-archive-race' }))
            .value as Record<string, unknown>
          const tasks = await adapters
            .get(key)!
            .all(
              `SELECT state FROM hospitality_core_cleaning_task WHERE id = ${driver === 'postgres' ? '$1' : '?'}`,
              ['room-archive-race-task'],
            )
          return (
            [archive, task].filter((result) => (result.value as { ok: boolean }).ok).length === 1 &&
            (room.active === true ||
              !tasks.some((row) => row.state === 'todo' || row.state === 'in_progress'))
          )
        } finally {
          await contender.close()
        }
      }),
    )
    concurrentRoomArchiveTaskSingleWinner = races.every(Boolean)
    if (!concurrentRoomArchiveTaskSingleWinner)
      throw new Error('concurrent room archive and housekeeping task creation did not serialize')
  }

  const contentImagesPerTarget = 3
  const contentStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      const targets = [
        { kind: 'property', id: 'property' },
        ...Array.from({ length: 12 }, (_, index) => ({ kind: 'roomType', id: `type:${index}` })),
      ]
      for (const target of targets)
        for (let image = 0; image < contentImagesPerTarget; image++) {
          const id = `content:${target.kind}:${target.id}:${image}`
          await call(key, 'storage.createAttachment', {
            id,
            name: `${id}.jpg`,
            resModel: target.kind === 'property' ? 'hospitality_core.Property' : 'hospitality_core.RoomType',
            resId: target.id,
            resField: 'contentImages',
            kind: 'url',
            url: `https://example.com/${encodeURIComponent(id)}.jpg`,
            mimetype: 'image/jpeg',
            size: 1024,
            public: true,
            createdAt: '2026-08-20T00:00:00.000Z',
          })
          await call(key, 'hospitality_core.attachContentImage', {
            id,
            attachmentId: id,
            ...(target.kind === 'property' ? { propertyId: target.id } : { roomTypeId: target.id }),
            category: target.kind === 'property' ? (image ? 'lobby' : 'exterior') : 'room',
            caption: `Benchmark image ${image}`,
          })
        }
    }),
  )
  const contentMs = performance.now() - contentStarted

  const calendarConfigStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      for (let type = 0; type < 12; type++) {
        const roomTypeId = `type:${type}`
        const total = Array.from({ length: roomsPerDatabase }, (_, room) => room).filter(
          (room) => room % 12 === type,
        ).length
        const plan = await call(key, 'hospitality_core.saveRatePlan', {
          id: `rate:${type}`,
          propertyId: 'property',
          roomTypeId,
          code: 'DEFAULT',
          name: `Default rate ${type}`,
          rateType: 'nightly',
          amount: String(800_000 + type * 125_000),
          isDefault: true,
          active: true,
        })
        if (!(plan.value as { ok: boolean }).ok) throw new Error(`${key}: rate plan failed`)
        const inventory = await call(key, 'hospitality_core.setInventoryRange', {
          propertyId: 'property',
          roomTypeId,
          from: '2026-09-01',
          to: '2026-09-03',
          total,
        })
        if (!(inventory.value as { ok: boolean }).ok) throw new Error(`${key}: inventory setup failed`)
      }
      const restriction = await call(key, 'hospitality_core.setRestrictionRange', {
        propertyId: 'property',
        roomTypeId: 'type:0',
        from: '2026-12-15',
        to: '2026-12-21',
        minLos: 2,
        closedToArrival: true,
      })
      if (!(restriction.value as { ok: boolean }).ok) throw new Error(`${key}: restriction setup failed`)
    }),
  )
  const calendarConfigMs = performance.now() - calendarConfigStarted

  const ledgerCountsBeforeQuote = await Promise.all(
    keys.map(async (key) => {
      const rows = await adapters
        .get(key)!
        .all('SELECT COUNT(*) AS n FROM hospitality_core_availability_ledger')
      return Number(rows[0]!.n)
    }),
  )
  const quoteStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      for (let quote = 0; quote < reservationsPerDatabase; quote++) {
        const result = await call(key, 'hospitality_core.quoteAvailability', {
          propertyId: 'property',
          roomTypeId: `type:${quote % 12}`,
          checkIn: onlineQuoteCheckIn,
          checkOut: onlineQuoteCheckOut,
          adults: 1,
        })
        const value = result.value as { ok: boolean; items?: Array<{ availableQuantity: number }> }
        if (!value.ok || Number(value.items?.[0]?.availableQuantity) < 1)
          throw new Error(`${key}: online quote failed`)
      }
    }),
  )
  const quoteMs = performance.now() - quoteStarted
  const quoteIsReadOnly = await Promise.all(
    keys.map(async (key, index) => {
      const rows = await adapters
        .get(key)!
        .all('SELECT COUNT(*) AS n FROM hospitality_core_availability_ledger')
      return Number(rows[0]!.n) === ledgerCountsBeforeQuote[index]
    }),
  ).then((matches) => matches.every(Boolean))
  if (!quoteIsReadOnly) throw new Error('reservation quote mutated the availability ledger')

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

  // Keep the first twelve reservations untouched for the check-in/out workload
  // below; amend later direct bookings so the benchmark exercises room-night
  // replacement on every physical database without changing that lifecycle.
  const amendmentIndexes = Array.from(
    { length: Math.max(0, Math.min(50, reservationsPerDatabase - 12)) },
    (_, index) => index + 12,
  ).filter((index) => index % 3 !== 0)
  const amendmentStarted = performance.now()
  const amendmentResults = await Promise.all(
    keys.map(async (key) => {
      for (const index of amendmentIndexes) {
        const result = await call(key, 'hospitality_core.amendReservation', {
          id: `reservation:${index}`,
          roomTypeId: `type:${index % 12}`,
          partnerId: 'companion',
          checkIn: '2026-09-02T14:00:00.000Z',
          checkOut: '2026-09-04T12:00:00.000Z',
          adults: 2,
          children: 0,
          rate: String(825_000 + (index % 12) * 125_000),
        })
        if (!(result.value as { ok: boolean }).ok) return { key, match: false, index, failure: result.value }
      }
      if (!amendmentIndexes.length) return { key, match: true }
      const sample = (
        await call(key, 'hospitality_core.getReservation', {
          id: `reservation:${amendmentIndexes[0]}`,
        })
      ).value as Record<string, unknown>
      return {
        key,
        match:
          sample.partnerId === 'companion' &&
          new Date(String(sample.checkOut)).toISOString() === '2026-09-04T12:00:00.000Z',
        sample,
      }
    }),
  )
  const amendmentMs = performance.now() - amendmentStarted
  const amendmentsMatch = amendmentResults.every((result) => result.match)
  if (!amendmentsMatch)
    throw new Error(
      `reservation amendment lost inventory, stay, guest or folio state: ${JSON.stringify(
        amendmentResults.filter((result) => !result.match),
      )}`,
    )

  const frontDeskIdentityStarted = performance.now()
  const frontDeskIdentityResults = await Promise.all(
    keys.map(async (key) => {
      const rejected = await call(key, 'hospitality_core.saveGuestDocument', {
        id: 'front-desk-unregistered',
        stayId: 'reservation:1:stay',
        partnerId: 'companion',
        type: 'passport',
        number: `REJECTED-${key}-9876`,
        fullName: `Benchmark companion ${key}`,
      })
      const leadSaved = await call(key, 'hospitality_core.saveGuestDocument', {
        id: 'front-desk-lead-document',
        stayId: 'reservation:0:stay',
        partnerId: 'guest',
        type: 'cccd',
        number: `LEAD-${key}-9876`,
        fullName: `Benchmark guest ${key}`,
        dateOfBirth: '1990-05-12T00:00:00.000Z',
        nationality: 'VN',
        permanentAddress: 'Benchmark private address',
      })
      const reassigned = await call(key, 'hospitality_core.saveGuestDocument', {
        id: 'front-desk-lead-document',
        stayId: 'reservation:0:stay',
        partnerId: 'companion',
        type: 'passport',
        fullName: `Benchmark companion ${key}`,
      })
      const documents = (
        await call(key, 'hospitality_core.listGuestDocuments', { stayId: 'reservation:0:stay' })
      ).value as Array<Record<string, unknown>>
      return {
        rejected: (rejected.value as { ok: boolean }).ok === false,
        saved: (leadSaved.value as { ok: boolean }).ok === true,
        immutable: (reassigned.value as { ok: boolean }).ok === false,
        safe:
          documents.length === 1 &&
          documents.every(
            (document) =>
              document.numberLast4 === '9876' &&
              document.dateOfBirthPresent === true &&
              !('number' in document) &&
              !('permanentAddress' in document),
          ),
      }
    }),
  )
  const frontDeskIdentityMs = performance.now() - frontDeskIdentityStarted
  const frontDeskIdentitySafe = frontDeskIdentityResults.every(
    (result) => result.rejected && result.saved && result.immutable && result.safe,
  )
  if (!frontDeskIdentitySafe)
    throw new Error('front-desk identity intake lost ownership guards or exposed protected fields')

  const serviceIntentionsPerDatabase = Math.min(50, reservationsPerDatabase)
  const serviceStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      await call(key, 'uom.saveUnit', { id: 'service-unit', name: 'Unit', relativeFactor: '1' })
      await call(key, 'product.saveTemplate', {
        id: 'service-template',
        name: 'Benchmark breakfast',
        type: 'service',
        uomId: 'service-unit',
        listPrice: '250000',
        saleOk: true,
      })
      await call(key, 'product.saveVariant', {
        id: 'service-product',
        templateId: 'service-template',
        defaultCode: 'SVC',
        combinationKey: '',
      })
      for (let fee = 0; fee < 3; fee++)
        await call(key, 'hospitality_core.savePropertyCharge', {
          id: `property-fee:${fee}`,
          propertyId: 'property',
          chargeType: fee === 0 ? 'city_tax' : fee === 1 ? 'parking' : 'other',
          name: `Benchmark fee ${fee}`,
          amount: String(35_000 + fee * 25_000),
          active: true,
        })
      for (let index = 0; index < serviceIntentionsPerDatabase; index++) {
        const saved = await call(key, 'hospitality_core.saveExtraLine', {
          id: `extra:${index}`,
          reservationId: `reservation:${index}`,
          productId: 'service-product',
          recurrence: 'once',
        })
        if (!(saved.value as { ok: boolean }).ok) throw new Error(`${key}: service intention failed`)
        const posted = await call(key, 'hospitality_core.materializeExtraLine', { id: `extra:${index}` })
        const retry = await call(key, 'hospitality_core.materializeExtraLine', { id: `extra:${index}` })
        if (!(posted.value as { ok: boolean }).ok || !(retry.value as { existing: boolean }).existing)
          throw new Error(`${key}: service materialisation was not idempotent`)
      }
      await call(key, 'hospitality_core.saveRoomType', {
        id: 'audit-type',
        propertyId: 'property',
        code: 'AUDIT',
        name: 'Long-stay audit room',
        baseRate: '7000000',
      })
      await call(key, 'hospitality_core.saveRoom', {
        id: 'audit-room',
        propertyId: 'property',
        roomTypeId: 'audit-type',
        code: 'AUDIT-ROOM',
        name: 'Audit room',
      })
      const longStay = await call(key, 'hospitality_core.createReservation', {
        id: 'audit-long-stay',
        propertyId: 'property',
        roomTypeId: 'audit-type',
        partnerId: 'guest',
        bookingType: 'weekly',
        billingMode: 'recurring',
        checkIn: '2026-06-01T14:00:00.000Z',
        checkOut: '2026-09-30T12:00:00.000Z',
        rate: '7000000',
        createdAt: '2026-05-20T00:00:00.000Z',
      })
      if (!(longStay.value as { ok: boolean }).ok) throw new Error(`${key}: long stay failed`)
      const longStayCheckIn = await call(key, 'hospitality_core.checkIn', {
        stayId: 'audit-long-stay:stay',
        roomId: 'audit-room',
        assignmentId: 'audit-long-stay:assignment',
        at: '2026-06-01T14:00:00.000Z',
      })
      if (!(longStayCheckIn.value as { ok: boolean }).ok) throw new Error(`${key}: long-stay check-in failed`)
      const longStayService = await call(key, 'hospitality_core.saveExtraLine', {
        id: 'audit-long-stay-breakfast',
        stayId: 'audit-long-stay:stay',
        productId: 'service-product',
        recurrence: 'per_night',
      })
      if (!(longStayService.value as { ok: boolean }).ok) throw new Error(`${key}: long-stay service failed`)
    }),
  )
  const serviceMs = performance.now() - serviceStarted

  const candidateRooms = Array.from({ length: roomsPerDatabase }, (_, room) => room).filter(
    (room) => room % 17 !== 0 && room % 5 !== 0,
  )
  const transitionCount = Math.min(12, candidateRooms.length, reservationsPerDatabase)
  const transitionRooms = Array.from({ length: transitionCount }, (_, index) =>
    candidateRooms.find((candidate, offset) => offset >= index && candidate % 12 === index % 12),
  )
  const reservedTransitionRooms = new Set(
    transitionRooms.filter((room): room is number => room !== undefined),
  )
  const moveRooms = candidateRooms
    .filter((room) => !reservedTransitionRooms.has(room))
    .slice(0, Math.min(4, transitionCount))
  if (moveRooms.length !== Math.min(4, transitionCount))
    throw new Error('benchmark needs one available destination for each room move')
  const folioCorrectionCount = Math.min(4, transitionCount)
  let concurrentFolioCorrectionSingleAdjustment = true
  let earlyCheckoutInventoryReleased = 0
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
        if (index < folioCorrectionCount) {
          const correction = {
            id: `service:${index}`,
            folioId: `reservation:${index}:folio`,
            reason: 'benchmark correction',
            voidedAt: '2026-09-02T08:30:00.000Z',
          }
          if (driver === 'postgres') {
            const contender = open(key)
            await contender.open()
            try {
              const attempts = await Promise.all([
                callWith(adapters.get(key)!, key, 'hospitality_core.voidCharge', correction),
                callWith(contender, key, 'hospitality_core.voidCharge', correction),
              ])
              const values = attempts.map((attempt) => attempt.value as { ok: boolean; existing?: boolean })
              if (
                values.some((value) => !value.ok) ||
                values.filter((value) => value.existing === false).length !== 1 ||
                values.filter((value) => value.existing === true).length !== 1
              )
                concurrentFolioCorrectionSingleAdjustment = false
            } finally {
              await contender.close()
            }
          } else {
            const first = await call(key, 'hospitality_core.voidCharge', correction)
            const retry = await call(key, 'hospitality_core.voidCharge', correction)
            if (
              !(first.value as { ok: boolean }).ok ||
              (first.value as { existing?: boolean }).existing !== false ||
              (retry.value as { existing?: boolean }).existing !== true
            )
              concurrentFolioCorrectionSingleAdjustment = false
          }
        }
        if (index < moveRooms.length) {
          const moved = await call(key, 'hospitality_core.moveRoom', {
            stayId: `reservation:${index}:stay`,
            roomId: `room:${moveRooms[index]}`,
            assignmentId: `move-assignment:${index}`,
            reason: 'benchmark room move',
            at: '2026-09-02T09:00:00.000Z',
          })
          if (!(moved.value as { ok: boolean }).ok) throw new Error(`${key}: room move failed`)
        }
        if (index % 2 === 1) {
          const nightlyService = await call(key, 'hospitality_core.saveExtraLine', {
            id: `audit-extra:${index}`,
            stayId: `reservation:${index}:stay`,
            productId: 'service-product',
            recurrence: 'per_night',
          })
          if (!(nightlyService.value as { ok: boolean }).ok)
            throw new Error(`${key}: audit service intention failed`)
        }
        if (index % 2 === 0) {
          const checkedOut = await call(key, 'hospitality_core.checkOut', {
            stayId: `reservation:${index}:stay`,
            at: '2026-09-02T12:00:00.000Z',
          })
          const value = checkedOut.value as { ok: boolean; inventoryReleased?: number }
          if (!value.ok || value.inventoryReleased !== 1)
            throw new Error(`${key}: early check-out did not release its remaining night`)
          earlyCheckoutInventoryReleased += value.inventoryReleased
        }
      }
    }),
  )
  const transitionMs = performance.now() - transitionStarted

  const departureIndexes = Array.from({ length: transitionCount }, (_, index) => index).filter(
    (index) => index % 2 === 1,
  )
  const departureStarted = performance.now()
  const departureResults = await Promise.all(
    keys.map(async (key) => {
      for (const index of departureIndexes) {
        const result = await call(key, 'hospitality_core.adjustStayDeparture', {
          stayId: `reservation:${index}:stay`,
          checkOut: '2026-09-04T12:00:00.000Z',
          at: '2026-09-02T10:00:00.000Z',
        })
        if (!(result.value as { ok: boolean }).ok) return { key, match: false, index, failure: result.value }
      }
      if (!departureIndexes.length) return { key, match: true }
      const index = departureIndexes[0]!
      const rows = await adapters.get(key)!.all(
        `SELECT r."checkOut" AS reservation_checkout, s."checkOut" AS stay_checkout,
                r."amountTotal" AS reservation_total, c.amount AS charge_total
           FROM hospitality_core_reservation r
           JOIN hospitality_core_stay s ON s.id = r."stayId"
           JOIN hospitality_core_charge c ON c.id = ${driver === 'postgres' ? '$1' : '?'}
          WHERE r.id = ${driver === 'postgres' ? '$2' : '?'}`,
        [`reservation:${index}:room`, `reservation:${index}`],
      )
      const sample = rows[0]
      return {
        key,
        match:
          new Date(String(sample?.reservation_checkout)).toISOString() === '2026-09-04T12:00:00.000Z' &&
          new Date(String(sample?.stay_checkout)).toISOString() === '2026-09-04T12:00:00.000Z' &&
          Number(sample?.reservation_total) === Number(sample?.charge_total),
        sample,
      }
    }),
  )
  const departureMs = performance.now() - departureStarted
  const departuresMatch = departureResults.every((result) => result.match)
  if (!departuresMatch)
    throw new Error(
      `departure adjustment lost stay, reservation, inventory or folio state: ${JSON.stringify(
        departureResults.filter((result) => !result.match),
      )}`,
    )

  const housekeepingTaskCount = Math.ceil(transitionCount / 2)
  const housekeepingStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      for (let index = 0; index < transitionCount; index += 2) {
        const id = `checkout:reservation:${index}:stay`
        const started = await call(key, 'hospitality_core.startCleaningTask', {
          id,
          assigneeId: 'benchmark-housekeeper',
          at: '2026-09-03T12:05:00.000Z',
        })
        if (!(started.value as { ok: boolean }).ok) throw new Error(`${key}: housekeeping start failed`)
        const completed = await call(key, 'hospitality_core.completeCleaningTask', {
          id,
          at: '2026-09-03T12:35:00.000Z',
        })
        if (!(completed.value as { ok: boolean }).ok)
          throw new Error(`${key}: housekeeping completion failed`)
      }
    }),
  )
  const housekeepingMs = performance.now() - housekeepingStarted

  const roomStatusStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      const released = await call(key, 'hospitality_core.setRoomStatus', {
        id: 'room:0',
        expectedStatus: 'maintenance',
        status: 'dirty',
      })
      if (!(released.value as { ok: boolean }).ok) throw new Error(`${key}: room release failed`)
      const serviced = await call(key, 'hospitality_core.setRoomStatus', {
        id: 'room:0',
        expectedStatus: 'dirty',
        status: 'maintenance',
        note: 'Benchmark maintenance evidence',
      })
      if (!(serviced.value as { ok: boolean }).ok) throw new Error(`${key}: room service transition failed`)
    }),
  )
  const roomStatusMs = performance.now() - roomStatusStarted
  let concurrentRoomStatusTaskSingleWinner = true
  if (driver === 'postgres') {
    const key = keys[0]!
    const released = await call(key, 'hospitality_core.setRoomStatus', {
      id: 'room:0',
      expectedStatus: 'maintenance',
      status: 'dirty',
    })
    if (!(released.value as { ok: boolean }).ok) throw new Error(`${key}: room race setup failed`)
    const contender = open(key)
    await contender.open()
    try {
      const [statusAttempt, taskAttempt] = await Promise.all([
        callWith(adapters.get(key)!, key, 'hospitality_core.setRoomStatus', {
          id: 'room:0',
          expectedStatus: 'dirty',
          status: 'maintenance',
          note: 'Concurrent maintenance evidence',
        }),
        callWith(contender, key, 'hospitality_core.createCleaningTask', {
          id: 'room-status-race-task',
          code: 'HK-ROOM-RACE',
          roomId: 'room:0',
          taskType: 'inspection',
        }),
      ])
      const statusWon = (statusAttempt.value as { ok: boolean }).ok
      const taskWon = (taskAttempt.value as { ok: boolean }).ok
      concurrentRoomStatusTaskSingleWinner = statusWon !== taskWon
      if (taskWon) {
        await call(key, 'hospitality_core.cancelCleaningTask', { id: 'room-status-race-task' })
        const restored = await call(key, 'hospitality_core.setRoomStatus', {
          id: 'room:0',
          expectedStatus: 'dirty',
          status: 'maintenance',
          note: 'Concurrent maintenance evidence',
        })
        if (!(restored.value as { ok: boolean }).ok) concurrentRoomStatusTaskSingleWinner = false
      }
    } finally {
      await contender.close()
    }
  }
  if (!concurrentRoomStatusTaskSingleWinner)
    throw new Error('room status and task creation did not serialize to one winner')

  const stayNoticeStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      for (let index = 0; index < transitionCount; index++)
        await call(key, 'hospitality_benchmark_audit.prepareStayNotices', {
          stayId: `reservation:${index}:stay`,
        })
      if (driver === 'postgres' && key === keys[0] && transitionCount > 0) {
        const contender = open(key)
        await contender.open()
        try {
          await Promise.all([
            callWith(adapters.get(key)!, key, 'hospitality_benchmark_audit.prepareStayNotices', {
              stayId: 'reservation:0:stay',
            }),
            callWith(contender, key, 'hospitality_benchmark_audit.prepareStayNotices', {
              stayId: 'reservation:0:stay',
            }),
          ])
        } finally {
          await contender.close()
        }
      }
      let submissionStart = 0
      if (driver === 'postgres' && key === keys[0] && transitionCount > 0) {
        const contender = open(key)
        await contender.open()
        try {
          const attempts = await Promise.all([
            callWith(adapters.get(key)!, key, 'hospitality_core.recordStayNoticeSubmission', {
              id: 'reservation:0:stay:notice:reservation:0:guest',
              reason: 'business',
              channel: 'online',
              evidenceRef: `${key}:notice:0:first`,
            }),
            callWith(contender, key, 'hospitality_core.recordStayNoticeSubmission', {
              id: 'reservation:0:stay:notice:reservation:0:guest',
              reason: 'business',
              channel: 'vneid',
              evidenceRef: `${key}:notice:0:second`,
            }),
          ])
          if (attempts.some((attempt) => !(attempt.value as { ok: boolean }).ok))
            throw new Error(`${key}: concurrent stay-notice submission failed`)
          submissionStart = 1
        } finally {
          await contender.close()
        }
      }
      for (let index = submissionStart; index < transitionCount; index++) {
        const id = `reservation:${index}:stay:notice:reservation:${index}:guest`
        const submitted = await call(key, 'hospitality_core.recordStayNoticeSubmission', {
          id,
          reason: index % 3 === 0 ? 'business' : 'tourism',
          channel: 'online',
          evidenceRef: `${key}:notice:${index}`,
        })
        if (!(submitted.value as { ok: boolean }).ok) throw new Error(`${key}: stay notice submission failed`)
        if (index % 2 === 0) {
          const confirmed = await call(key, 'hospitality_core.confirmStayNotice', {
            id,
            receiptRef: `${key}:notice:${index}`,
          })
          if (!(confirmed.value as { ok: boolean }).ok)
            throw new Error(`${key}: stay notice confirmation failed`)
        }
      }
      if (submissionStart === 1) {
        const confirmed = await call(key, 'hospitality_core.confirmStayNotice', {
          id: 'reservation:0:stay:notice:reservation:0:guest',
          receiptRef: `${key}:notice:0`,
        })
        if (!(confirmed.value as { ok: boolean }).ok)
          throw new Error(`${key}: concurrent stay-notice confirmation failed`)
      }
    }),
  )
  const stayNoticeMs = performance.now() - stayNoticeStarted
  const stayNoticeCounts = await Promise.all(
    keys.map(async (key) => {
      const rows = await adapters.get(key)!.all(
        `SELECT state, "documentLast4", "packageHash"
           FROM hospitality_core_stay_notice
          WHERE "companyId" = ${driver === 'postgres' ? '$1' : '?'}`,
        [key],
      )
      return {
        count: rows.length,
        readyEvidence: rows.every(
          (row) =>
            row.documentLast4 === '9876' &&
            /^[a-f0-9]{64}$/u.test(String(row.packageHash)) &&
            (row.state === 'submitted' || row.state === 'confirmed'),
        ),
        confirmed: rows.filter((row) => row.state === 'confirmed').length,
      }
    }),
  )
  if (
    !stayNoticeCounts.every(
      (result) =>
        result.count === transitionCount &&
        result.readyEvidence &&
        result.confirmed === Math.ceil(transitionCount / 2),
    )
  )
    throw new Error('stay-notice preparation, evidence or database isolation mismatch')

  const auditDate = '2026-09-02'
  const auditStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      const run = {
        runId: `property:${auditDate}`,
        propertyId: 'property',
        auditDate,
      }
      await call(key, 'hospitality_benchmark_audit.prepare', run)
      if (driver !== 'postgres' || key !== keys[0]) {
        await call(key, 'hospitality_benchmark_audit.execute', run)
        return
      }
      const contender = open(key)
      await contender.open()
      try {
        await Promise.all([
          callWith(adapters.get(key)!, key, 'hospitality_benchmark_audit.execute', run),
          callWith(contender, key, 'hospitality_benchmark_audit.execute', run),
        ])
      } finally {
        await contender.close()
      }
    }),
  )
  const auditMs = performance.now() - auditStarted
  const expectedAuditServices = 1 + Math.floor(transitionCount / 2)
  const auditResults = await Promise.all(
    keys.map(async (key) => {
      const run = (
        await adapters.get(key)!.all(
          `SELECT state, attempt, "servicePosted", "rentPosted", "totalAmount"
             FROM hospitality_core_night_audit_run
            WHERE id = ${driver === 'postgres' ? '$1' : '?'}`,
          [`property:${auditDate}`],
        )
      )[0]!
      const charges = (
        await adapters
          .get(key)!
          .all(
            `SELECT COUNT(*) AS n FROM hospitality_core_charge WHERE "nightAuditRunId" = ${
              driver === 'postgres' ? '$1' : '?'
            }`,
            [`property:${auditDate}`],
          )
      )[0]!
      return {
        state: run.state,
        attempt: Number(run.attempt),
        services: Number(run.servicePosted),
        rent: Number(run.rentPosted),
        charges: Number(charges.n),
      }
    }),
  )
  if (
    !auditResults.every(
      (result) =>
        result.state === 'completed' &&
        result.services === expectedAuditServices &&
        result.rent === 13 &&
        result.charges === expectedAuditServices + 13,
    )
  )
    throw new Error(`night audit mismatch: ${JSON.stringify(auditResults)}`)
  if (driver === 'postgres' && auditResults[0]?.attempt !== 2)
    throw new Error(`concurrent night audit lost an attempt: ${JSON.stringify(auditResults[0])}`)

  const collisionKey = keys[0]!
  const usedRooms = new Set([
    ...transitionRooms.filter((room): room is number => room !== undefined),
    ...moveRooms,
  ])
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
  await call(collisionKey, 'hospitality_core.saveExtraLine', {
    id: 'concurrent-extra',
    reservationId: 'collision:a',
    productId: 'service-product',
    recurrence: 'once',
  })
  const postSameService = (adapter: Adapter) =>
    callWith(adapter, collisionKey, 'hospitality_core.materializeExtraLine', { id: 'concurrent-extra' })
  const serviceRaceResults =
    contender === null
      ? [
          await postSameService(adapters.get(collisionKey)!),
          await postSameService(adapters.get(collisionKey)!),
        ]
      : await Promise.all([postSameService(adapters.get(collisionKey)!), postSameService(contender)])
  const concurrentServicePostSingleCharge =
    serviceRaceResults.every((result) => (result.value as { ok: boolean }).ok) &&
    Number(
      (
        await adapters
          .get(collisionKey)!
          .all(
            `SELECT COUNT(*) AS n FROM hospitality_core_charge WHERE "extraLineId" = ${driver === 'postgres' ? '$1' : '?'}`,
            ['concurrent-extra'],
          )
      )[0]!.n,
    ) === 1
  if (!concurrentServicePostSingleCharge)
    throw new Error('concurrent service materialisation did not produce one charge')
  await call(collisionKey, 'hospitality_core.setInventoryRange', {
    propertyId: 'property',
    roomTypeId: 'type:0',
    from: '2027-01-10',
    to: '2027-01-10',
    total: 1,
  })
  const reserveScarceInventory = (adapter: Adapter, suffix: string) =>
    callWith(adapter, collisionKey, 'hospitality_core.createOnlineReservation', {
      id: `inventory-collision:${suffix}`,
      requestKey: `inventory-collision:${suffix}`,
      propertyId: 'property',
      roomTypeId: 'type:0',
      partnerId: 'guest',
      checkIn: onlineContentionCheckIn,
      checkOut: onlineContentionCheckOut,
      adults: 1,
    })
  const inventoryCollisionResults =
    contender === null
      ? [
          await reserveScarceInventory(adapters.get(collisionKey)!, 'a'),
          await reserveScarceInventory(adapters.get(collisionKey)!, 'b'),
        ]
      : await Promise.all([
          reserveScarceInventory(adapters.get(collisionKey)!, 'a'),
          reserveScarceInventory(contender, 'b'),
        ])
  const concurrentInventoryClaimSingleWinner =
    inventoryCollisionResults.filter((result) => (result.value as { ok: boolean }).ok).length === 1
  if (!concurrentInventoryClaimSingleWinner)
    throw new Error('room-night inventory claim did not produce exactly one winner')
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

  const amendmentRaceRoom = candidateRooms.find(
    (room) => !usedRooms.has(room) && room !== collisionRoom && room !== raceRoom,
  )
  if (amendmentRaceRoom === undefined) throw new Error('benchmark needs a room for amendment/check-in race')
  const amendmentRaceType = `type:${amendmentRaceRoom % 12}`
  const amendmentRaceNextType = `type:${(amendmentRaceRoom + 1) % 12}`
  await call(collisionKey, 'hospitality_core.createReservation', {
    id: 'amendment-transition-race',
    propertyId: 'property',
    roomTypeId: amendmentRaceType,
    partnerId: 'guest',
    bookingType: 'nightly',
    checkIn: '2027-02-01T14:00:00.000Z',
    checkOut: '2027-02-02T12:00:00.000Z',
    rate: '1000000',
  })
  const amendmentContender = driver === 'postgres' ? open(collisionKey) : null
  if (amendmentContender) await amendmentContender.open()
  const amendRace = (adapter: Adapter) =>
    callWith(adapter, collisionKey, 'hospitality_core.amendReservation', {
      id: 'amendment-transition-race',
      roomTypeId: amendmentRaceNextType,
      partnerId: 'companion',
      checkIn: '2027-02-02T14:00:00.000Z',
      checkOut: '2027-02-04T12:00:00.000Z',
      adults: 2,
      children: 0,
      rate: '1250000',
    })
  const checkInAmendRace = (adapter: Adapter) =>
    callWith(adapter, collisionKey, 'hospitality_core.checkIn', {
      stayId: 'amendment-transition-race:stay',
      roomId: `room:${amendmentRaceRoom}`,
      assignmentId: 'amendment-transition-race:assignment',
      at: '2027-02-01T15:00:00.000Z',
    })
  const amendmentTransitionResults =
    amendmentContender === null
      ? [await amendRace(adapters.get(collisionKey)!), await checkInAmendRace(adapters.get(collisionKey)!)]
      : await Promise.all([amendRace(adapters.get(collisionKey)!), checkInAmendRace(amendmentContender)])
  if (amendmentContender) await amendmentContender.close()
  if (amendmentTransitionResults.filter((result) => (result.value as { ok: boolean }).ok).length !== 1)
    throw new Error('amendment/check-in race did not produce exactly one winner')
  const amendmentTransitionState = (
    await adapters.get(collisionKey)!.all(
      `SELECT r.state AS reservation, s.state AS stay, s."roomTypeId" AS "roomTypeId",
              s."currentRoomId" AS "currentRoomId", room.status AS room
         FROM hospitality_core_reservation r
         JOIN hospitality_core_stay s ON s.id = r."stayId"
         JOIN hospitality_core_room room ON room.id = ${driver === 'postgres' ? '$1' : '?'}
        WHERE r.id = ${driver === 'postgres' ? '$2' : '?'}`,
      [`room:${amendmentRaceRoom}`, 'amendment-transition-race'],
    )
  )[0]!
  const concurrentAmendCheckInConsistent =
    (amendmentTransitionState.reservation === 'checked_in' &&
      amendmentTransitionState.stay === 'checked_in' &&
      amendmentTransitionState.roomTypeId === amendmentRaceType &&
      amendmentTransitionState.currentRoomId === `room:${amendmentRaceRoom}` &&
      amendmentTransitionState.room === 'occupied') ||
    (amendmentTransitionState.reservation === 'confirmed' &&
      amendmentTransitionState.stay === 'draft' &&
      amendmentTransitionState.roomTypeId === amendmentRaceNextType &&
      amendmentTransitionState.currentRoomId == null &&
      amendmentTransitionState.room === 'available')
  if (!concurrentAmendCheckInConsistent)
    throw new Error(
      `amendment/check-in race left inconsistent state: ${JSON.stringify(amendmentTransitionState)}`,
    )

  const noShowStart = Math.max(12, serviceIntentionsPerDatabase, transitionCount)
  const noShowIndexes = Array.from(
    { length: Math.max(0, Math.min(10, reservationsPerDatabase - noShowStart)) },
    (_, index) => noShowStart + index,
  ).filter((index) => index % 3 !== 0)
  const noShowStarted = performance.now()
  const noShowResults = await Promise.all(
    keys.map(async (key) => {
      for (const index of noShowIndexes) {
        const result = await call(key, 'hospitality_core.markNoShow', {
          id: `reservation:${index}`,
          reason: 'Benchmark arrival cutoff passed',
          at: '2026-09-03T00:00:00.000Z',
        })
        if (!(result.value as { ok: boolean }).ok) return { key, match: false, index, failure: result.value }
      }
      if (!noShowIndexes.length) return { key, match: true }
      const sample = (
        await call(key, 'hospitality_core.getReservation', {
          id: `reservation:${noShowIndexes[0]}`,
        })
      ).value as Record<string, unknown>
      const folio = (
        await call(key, 'hospitality_core.getFolio', {
          id: `reservation:${noShowIndexes[0]}:folio`,
        })
      ).value as Record<string, unknown>
      return {
        key,
        match:
          sample.state === 'no_show' &&
          sample.noShowReason === 'Benchmark arrival cutoff passed' &&
          folio.state === 'closed' &&
          (folio.charges as Array<Record<string, unknown>>).some((charge) => charge.state === 'active'),
      }
    }),
  )
  const noShowMs = performance.now() - noShowStarted
  const noShowsMatch = noShowResults.every((result) => result.match)
  if (!noShowsMatch)
    throw new Error(`no-show lifecycle lost state or charges: ${JSON.stringify(noShowResults)}`)

  const catalogStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      for (let pass = 0; pass < readPasses; pass++) {
        const properties = (
          await call(key, 'hospitality_core.listPropertyCatalog', {
            propertyIds: ['property'],
            limit: 20,
          })
        ).value as Array<Record<string, unknown>>
        const roomTypes = (
          await call(key, 'hospitality_core.listRoomTypeCatalog', {
            propertyId: 'property',
            limit: 20,
          })
        ).value as Array<Record<string, unknown>>
        if (properties.length !== 1 || properties[0]?.companyId !== key || 'rooms' in properties[0]!)
          throw new Error(`${key}: property catalog projection is not safe or company-owned`)
        if (roomTypes.length !== 12 || roomTypes.some((row) => row.companyId !== key || 'rooms' in row))
          throw new Error(`${key}: room catalog projection is not safe or company-owned`)
      }
    }),
  )
  const catalogMs = performance.now() - catalogStarted

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
        if ((reservations.value as unknown[]).length !== reservationsPerDatabase + 1)
          throw new Error(`${key}: reservation query returned the wrong count`)
        const images = await call(key, 'hospitality_core.listContentImages', {
          roomTypeId: `type:${pass % 12}`,
        })
        if ((images.value as unknown[]).length !== contentImagesPerTarget)
          throw new Error(`${key}: content image query returned the wrong count`)
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
    const rateColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_rate_plan!
    if (rateColumns.amount !== 'numeric')
      throw new Error(`PostgreSQL rate amount is ${rateColumns.amount}, expected numeric`)
    const ledgerColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_availability_ledger!
    if (ledgerColumns.date !== 'date')
      throw new Error(`PostgreSQL inventory date is ${ledgerColumns.date}, expected date`)
    const changeColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_inventory_change!
    if (changeColumns.dateFrom !== 'date')
      throw new Error(`PostgreSQL change dateFrom is ${changeColumns.dateFrom}, expected date`)
    if (changeColumns.createdAt !== 'timestamp with time zone')
      throw new Error(
        `PostgreSQL change createdAt is ${changeColumns.createdAt}, expected timestamp with time zone`,
      )
    const contentChangeColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_content_change!
    if (contentChangeColumns.createdAt !== 'timestamp with time zone')
      throw new Error(
        `PostgreSQL content change createdAt is ${contentChangeColumns.createdAt}, expected timestamp with time zone`,
      )
    const extraColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_extra_line!
    if (extraColumns.unitPrice !== 'numeric')
      throw new Error(`PostgreSQL service unitPrice is ${extraColumns.unitPrice}, expected numeric`)
    const serviceChargeColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_charge!
    if (serviceChargeColumns.serviceDate !== 'date')
      throw new Error(`PostgreSQL serviceDate is ${serviceChargeColumns.serviceDate}, expected date`)
    if (serviceChargeColumns.voidedAt !== 'timestamp with time zone')
      throw new Error(`PostgreSQL voidedAt is ${serviceChargeColumns.voidedAt}, expected timestamptz`)
    const stayColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_stay!
    if (stayColumns.nextBillDate !== 'date')
      throw new Error(`PostgreSQL nextBillDate is ${stayColumns.nextBillDate}, expected date`)
    if (stayColumns.noShowAt !== 'timestamp with time zone')
      throw new Error(`PostgreSQL noShowAt is ${stayColumns.noShowAt}, expected timestamptz`)
    const reservationColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_reservation!
    if (reservationColumns.noShowAt !== 'timestamp with time zone')
      throw new Error(
        `PostgreSQL reservation noShowAt is ${reservationColumns.noShowAt}, expected timestamptz`,
      )
    const auditColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_night_audit_run!
    if (auditColumns.auditDate !== 'date')
      throw new Error(`PostgreSQL auditDate is ${auditColumns.auditDate}, expected date`)
    const stayNoticeColumns = (await adapters.get(keys[0]!)!.introspect()).hospitality_core_stay_notice!
    if (stayNoticeColumns.dueAt !== 'timestamp with time zone')
      throw new Error(`PostgreSQL stay-notice dueAt is ${stayNoticeColumns.dueAt}, expected timestamptz`)
    if (stayNoticeColumns.documentNumber)
      throw new Error('PostgreSQL stay-notice table must not retain a full document number')
  }

  const totalRooms = databaseCount * roomsPerDatabase
  const totalReservations = databaseCount * reservationsPerDatabase
  const totalTransitions = databaseCount * transitionCount
  const totalReads = databaseCount * readPasses
  const totalContentImages = databaseCount * 13 * contentImagesPerTarget
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
  const housekeepingLifecycleMatch = await Promise.all(
    keys.map(async (key) => {
      const rows = await adapters.get(key)!.all(
        `SELECT COUNT(*) AS n
           FROM hospitality_core_cleaning_task task
           JOIN hospitality_core_room room ON room.id = task."roomId"
          WHERE task."taskType" = 'checkout_clean'
            AND task.state = 'done'
            AND task."assigneeId" = 'benchmark-housekeeper'
            AND room.status = 'available'`,
      )
      return Number(rows[0]!.n) === housekeepingTaskCount
    }),
  ).then((matches) => matches.every(Boolean))
  if (!housekeepingLifecycleMatch)
    throw new Error('housekeeping task lifecycle did not restore every cleaned checkout room')
  const roomStatusLifecycleMatch = await Promise.all(
    keys.map(async (key) => {
      const room = await adapters
        .get(key)!
        .all(
          `SELECT status, note FROM hospitality_core_room WHERE id = ${driver === 'postgres' ? '$1' : '?'}`,
          ['room:0'],
        )
      const summary = await call(key, 'hospitality_core.roomStatusSummary', { propertyId: 'property' })
      const counts = summary.value as { maintenance: number }
      return (
        room[0]?.status === 'maintenance' &&
        room[0]?.note ===
          (driver === 'postgres' && key === keys[0]
            ? 'Concurrent maintenance evidence'
            : 'Benchmark maintenance evidence') &&
        counts.maintenance > 0
      )
    }),
  ).then((matches) => matches.every(Boolean))
  if (!roomStatusLifecycleMatch)
    throw new Error('room status lifecycle or exact per-property summary did not persist')
  const housekeepingMoveTasksMatch = await Promise.all(
    keys.map(async (key) => {
      const rows = await adapters
        .get(key)!
        .all(`SELECT COUNT(*) AS n FROM hospitality_core_cleaning_task WHERE id LIKE 'move:%:clean'`)
      return Number(rows[0]!.n) === moveRooms.length
    }),
  ).then((matches) => matches.every(Boolean))
  if (!housekeepingMoveTasksMatch) throw new Error('room moves did not create one cleaning task per old room')
  const folioCorrectionsMatch = await Promise.all(
    keys.map(async (key) => {
      const rows = await adapters
        .get(key)!
        .all(
          `SELECT COUNT(*) AS n FROM hospitality_core_charge WHERE id LIKE 'service:%' AND state = 'void' AND "voidReason" = 'benchmark correction'`,
        )
      return Number(rows[0]!.n) === folioCorrectionCount
    }),
  ).then((matches) => matches.every(Boolean))
  if (!folioCorrectionsMatch || !concurrentFolioCorrectionSingleAdjustment)
    throw new Error('folio correction was lost, duplicated or adjusted the total more than once')
  const inventoryChangeCounts = await Promise.all(
    keys.map(async (key) => {
      const rows = await adapters.get(key)!.all('SELECT COUNT(*) AS n FROM hospitality_core_inventory_change')
      return Number(rows[0]!.n)
    }),
  )
  const minimumInventoryChanges = 12 + 12 + 1 + reservationsPerDatabase
  const durableInventoryChangesPresent = inventoryChangeCounts.every(
    (count) => count >= minimumInventoryChanges,
  )
  if (!durableInventoryChangesPresent)
    throw new Error('rate, allotment, restriction or booking changes were not recorded durably')
  const contentChangeCounts = await Promise.all(
    keys.map(async (key) => {
      const rows = await adapters.get(key)!.all('SELECT COUNT(*) AS n FROM hospitality_core_content_change')
      return Number(rows[0]!.n)
    }),
  )
  const minimumContentChanges = 3 + 12 + 13 * contentImagesPerTarget + 3
  const durableContentChangesPresent = contentChangeCounts.every((count) => count >= minimumContentChanges)
  if (!durableContentChangesPresent)
    throw new Error('property, room-type or media changes were not recorded durably')
  const serviceChargeCounts = await Promise.all(
    keys.map(async (key) => {
      const rows = await adapters
        .get(key)!
        .all('SELECT COUNT(*) AS n FROM hospitality_core_charge WHERE "extraLineId" IS NOT NULL')
      return { key, count: Number(rows[0]!.n) }
    }),
  )
  const idempotentServiceCountsMatch = serviceChargeCounts.every(
    ({ key, count }) =>
      count === serviceIntentionsPerDatabase + expectedAuditServices + (key === collisionKey ? 1 : 0),
  )
  if (!idempotentServiceCountsMatch) throw new Error('service materialisation created duplicate charges')

  const onlineReservationsPerDatabase = Math.min(reservationsPerDatabase, 24)
  const onlineBookingStarted = performance.now()
  await Promise.all(
    keys.map(async (key) => {
      for (let booking = 0; booking < onlineReservationsPerDatabase; booking++) {
        const result = await call(key, 'hospitality_core.createOnlineReservation', {
          id: `online-benchmark:${booking}`,
          requestKey: `online-benchmark:${booking}`,
          propertyId: 'property',
          roomTypeId: `type:${booking % 12}`,
          partnerId: 'guest',
          checkIn: onlineBookingCheckIn,
          checkOut: onlineBookingCheckOut,
          adults: 1,
        })
        if (!(result.value as { ok: boolean }).ok)
          throw new Error(`${key}: online reservation benchmark failed`)
      }
    }),
  )
  const onlineBookingMs = performance.now() - onlineBookingStarted
  console.log(
    JSON.stringify(
      {
        driver,
        databases: databaseCount,
        rooms: totalRooms,
        migrateMs: Number(migrateMs.toFixed(1)),
        writeMs: Number(writeMs.toFixed(1)),
        writesPerSecond: Math.round((totalRooms * 1_000) / writeMs),
        propertySettingsUpdates: databaseCount,
        propertySettingsMs: Number(propertySettingsMs.toFixed(1)),
        propertySettingsPerSecond: Math.round((databaseCount * 1_000) / propertySettingsMs),
        propertySettingsMatch,
        roomTypeSettingsUpdates: databaseCount,
        roomTypeSettingsMs: Number(roomTypeSettingsMs.toFixed(1)),
        roomTypeSettingsPerSecond: Math.round((databaseCount * 1_000) / roomTypeSettingsMs),
        roomTypeSettingsMatch,
        roomConfigurationUpdates: databaseCount,
        roomConfigurationMs: Number(roomConfigurationMs.toFixed(1)),
        roomConfigurationPerSecond: Math.round((databaseCount * 1_000) / roomConfigurationMs),
        roomConfigurationMatch,
        locationLifecycleTransitions: databaseCount * 4,
        locationLifecycleMs: Number(locationLifecycleMs.toFixed(1)),
        locationLifecycleTransitionsPerSecond: Math.round((databaseCount * 4 * 1_000) / locationLifecycleMs),
        locationLifecycleMatch,
        concurrentLocationMutationConsistent,
        roomLifecycleTransitions: databaseCount * 2,
        roomLifecycleMs: Number(roomLifecycleMs.toFixed(1)),
        roomLifecycleTransitionsPerSecond: Math.round((databaseCount * 2 * 1_000) / roomLifecycleMs),
        roomLifecycleMatch,
        concurrentRoomArchiveTaskSingleWinner,
        contentImages: totalContentImages,
        contentMs: Number(contentMs.toFixed(1)),
        contentImagesPerSecond: Math.round((totalContentImages * 1_000) / contentMs),
        catalogQueries: totalReads * 2,
        catalogMs: Number(catalogMs.toFixed(1)),
        catalogQueriesPerSecond: Math.round((totalReads * 2 * 1_000) / catalogMs),
        ratePlans: databaseCount * 12,
        inventoryDaysConfigured: databaseCount * 12 * 3,
        restrictionDaysConfigured: databaseCount * 7,
        calendarConfigMs: Number(calendarConfigMs.toFixed(1)),
        calendarRowsPerSecond: Math.round((databaseCount * (12 * 3 + 7) * 1_000) / calendarConfigMs),
        reservations: totalReservations,
        quotes: totalReservations,
        quoteMs: Number(quoteMs.toFixed(1)),
        quotesPerSecond: Math.round((totalReservations * 1_000) / quoteMs),
        quoteIsReadOnly,
        bookingMs: Number(bookingMs.toFixed(1)),
        bookingsPerSecond: Math.round((totalReservations * 1_000) / bookingMs),
        onlineReservations: databaseCount * onlineReservationsPerDatabase,
        onlineBookingMs: Number(onlineBookingMs.toFixed(1)),
        onlineBookingsPerSecond: Math.round(
          (databaseCount * onlineReservationsPerDatabase * 1_000) / onlineBookingMs,
        ),
        reservationAmendments: databaseCount * amendmentIndexes.length,
        amendmentMs: Number(amendmentMs.toFixed(1)),
        amendmentsPerSecond: amendmentIndexes.length
          ? Math.round((databaseCount * amendmentIndexes.length * 1_000) / amendmentMs)
          : 0,
        amendmentsMatch,
        stayDepartureAdjustments: databaseCount * departureIndexes.length,
        departureMs: Number(departureMs.toFixed(1)),
        departureAdjustmentsPerSecond: departureIndexes.length
          ? Math.round((databaseCount * departureIndexes.length * 1_000) / departureMs)
          : 0,
        departuresMatch,
        reservationNoShows: databaseCount * noShowIndexes.length,
        noShowMs: Number(noShowMs.toFixed(1)),
        noShowsPerSecond: noShowIndexes.length
          ? Math.round((databaseCount * noShowIndexes.length * 1_000) / noShowMs)
          : 0,
        noShowsMatch,
        frontDeskIdentityDocuments: databaseCount,
        frontDeskIdentityMs: Number(frontDeskIdentityMs.toFixed(1)),
        frontDeskIdentityDocumentsPerSecond: Math.round((databaseCount * 1_000) / frontDeskIdentityMs),
        frontDeskIdentitySafe,
        serviceIntentions: databaseCount * serviceIntentionsPerDatabase,
        serviceMs: Number(serviceMs.toFixed(1)),
        serviceMaterializationsPerSecond: Math.round(
          (databaseCount * serviceIntentionsPerDatabase * 1_000) / serviceMs,
        ),
        idempotentServiceCountsMatch,
        checkInChargeCheckoutCycles: totalTransitions,
        earlyCheckoutInventoryReleased,
        roomMoves: databaseCount * moveRooms.length,
        folioCorrections: databaseCount * folioCorrectionCount,
        transitionMs: Number(transitionMs.toFixed(1)),
        transitionsPerSecond: Math.round((totalTransitions * 1_000) / transitionMs),
        stayNotices: totalTransitions,
        stayNoticeMs: Number(stayNoticeMs.toFixed(1)),
        stayNoticesPerSecond: Math.round((totalTransitions * 1_000) / stayNoticeMs),
        stayNoticeEvidenceAndIsolationMatch: stayNoticeCounts.every(
          (result) => result.count === transitionCount && result.readyEvidence,
        ),
        nightAudits: databaseCount,
        auditCharges: databaseCount * (expectedAuditServices + 13),
        auditMs: Number(auditMs.toFixed(1)),
        auditChargesPerSecond: Math.round((databaseCount * (expectedAuditServices + 13) * 1_000) / auditMs),
        concurrentNightAuditSingleOccurrence: auditResults.every(
          (result) => result.charges === expectedAuditServices + 13,
        ),
        concurrentRoomClaimSingleWinner,
        concurrentInventoryClaimSingleWinner,
        concurrentServicePostSingleCharge,
        concurrentCancelCheckInConsistent,
        concurrentAmendCheckInConsistent,
        housekeepingCheckoutTasksMatch,
        housekeepingMoveTasksMatch,
        housekeepingTasksCompleted: databaseCount * housekeepingTaskCount,
        housekeepingMs: Number(housekeepingMs.toFixed(1)),
        housekeepingTasksPerSecond: Math.round(
          (databaseCount * housekeepingTaskCount * 1_000) / housekeepingMs,
        ),
        housekeepingLifecycleMatch,
        roomStatusTransitions: databaseCount * 2,
        roomStatusMs: Number(roomStatusMs.toFixed(1)),
        roomStatusTransitionsPerSecond: Math.round((databaseCount * 2 * 1_000) / roomStatusMs),
        roomStatusLifecycleMatch,
        concurrentRoomStatusTaskSingleWinner,
        folioCorrectionsMatch,
        concurrentFolioCorrectionSingleAdjustment,
        inventoryChanges: inventoryChangeCounts.reduce((sum, count) => sum + count, 0),
        durableInventoryChangesPresent,
        contentChanges: contentChangeCounts.reduce((sum, count) => sum + count, 0),
        durableContentChangesPresent,
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
            return Number(rows[0]!.n) === roomsPerDatabase + 2 + (driver === 'postgres' ? 1 : 0)
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
