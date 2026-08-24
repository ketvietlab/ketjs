import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bootWorker,
  callFn,
  compose,
  createQueue,
  defineDeployment,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope })

const seedLongStay = async (adapter: Adapter): Promise<void> => {
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Nguyễn An' }, adapter)
  await call('uom.saveUnit', { id: 'unit', name: 'Lần', relativeFactor: '1' }, adapter)
  await call(
    'product.saveTemplate',
    {
      id: 'breakfast-template',
      name: 'Bữa sáng',
      type: 'service',
      uomId: 'unit',
      listPrice: '10',
      saleOk: true,
    },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'breakfast', templateId: 'breakfast-template', defaultCode: 'BF', combinationKey: '' },
    adapter,
  )
  await call(
    'hospitality_core.saveProperty',
    {
      id: 'hotel',
      code: 'HCM',
      name: 'Két Hotel',
      accommodationType: 'hotel',
      timezone: 'UTC',
      allowMonthly: true,
      allowWeekly: true,
      longStayBillOnCheckIn: true,
    },
    adapter,
  )
  await call(
    'hospitality_core.saveRoomType',
    {
      id: 'studio',
      propertyId: 'hotel',
      code: 'STD',
      name: 'Studio',
      baseRate: '300',
      allowMonthly: true,
      allowWeekly: true,
    },
    adapter,
  )
  await call(
    'hospitality_core.saveRoom',
    { id: '101', propertyId: 'hotel', roomTypeId: 'studio', code: '101', name: '101' },
    adapter,
  )
  const reservation = await call(
    'hospitality_core.createReservation',
    {
      id: 'monthly',
      propertyId: 'hotel',
      roomTypeId: 'studio',
      partnerId: 'guest',
      bookingType: 'monthly',
      billingMode: 'recurring',
      checkIn: '2026-06-01T14:00:00.000Z',
      checkOut: '2026-09-15T12:00:00.000Z',
      rate: '300',
      createdAt: '2026-05-20T00:00:00.000Z',
    },
    adapter,
  )
  assert.equal((reservation.value as Row).ok, true, JSON.stringify(reservation.value))
  const checkedIn = await call(
    'hospitality_core.checkIn',
    {
      stayId: 'monthly:stay',
      roomId: '101',
      assignmentId: 'monthly:assignment',
      at: '2026-06-01T14:00:00.000Z',
    },
    adapter,
  )
  assert.equal((checkedIn.value as Row).ok, true, JSON.stringify(checkedIn.value))
  const extra = await call(
    'hospitality_core.saveExtraLine',
    {
      id: 'breakfast-nightly',
      reservationId: 'monthly',
      productId: 'breakfast',
      recurrence: 'per_night',
    },
    adapter,
  )
  assert.equal((extra.value as Row).ok, true, JSON.stringify(extra.value))
}

test('hospitality night audit: queue worker catches up rent and nightly services without duplicates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-hospitality-night-audit-'))
  const file = join(dir, 'hospitality.db')
  const app = defineDeployment({
    name: 'hospitality_night_audit_test',
    modules,
    headless: true,
    serve: {},
    worker: { queues: { maintenance: 1 } },
  })
  const producer = sqliteAdapter(file)
  await producer.open()
  let worker: Awaited<ReturnType<typeof bootWorker>> | null = null
  try {
    await seedLongStay(producer)
    const initialRoomCharges = await producer.all(
      `SELECT "serviceDate", amount FROM hospitality_core_charge WHERE type = 'room'`,
    )
    assert.deepEqual(
      initialRoomCharges.map((row) => ({ serviceDate: row.serviceDate, amount: Number(row.amount) })),
      [{ serviceDate: '2026-06-01', amount: 300 }],
    )
    assert.equal(
      (await producer.all(`SELECT "nextBillDate" FROM hospitality_core_stay WHERE id = 'monthly:stay'`))[0]!
        .nextBillDate,
      '2026-07-01',
    )

    const preview = (
      await call(
        'hospitality_core.previewNightAudit',
        { propertyId: 'hotel', auditDate: '2026-08-20' },
        producer,
      )
    ).value as Row
    assert.deepEqual(
      {
        inHouseCount: preview.inHouseCount,
        serviceDue: preview.serviceDue,
        rentDue: preview.rentDue,
        estimatedAmount: preview.estimatedAmount,
      },
      { inHouseCount: 1, serviceDue: 1, rentDue: 2, estimatedAmount: '610' },
    )

    const first = (
      await call(
        'hospitality_core.requestNightAudit',
        { propertyId: 'hotel', auditDate: '2026-08-20' },
        producer,
      )
    ).value as Row
    const duplicate = (
      await call(
        'hospitality_core.requestNightAudit',
        { propertyId: 'hotel', auditDate: '2026-08-20' },
        producer,
      )
    ).value as Row
    assert.equal(first.ok, true)
    assert.equal(first.existing, false)
    assert.equal(duplicate.existing, true)
    assert.equal(duplicate.jobId, first.jobId)
    const queue = await createQueue(producer)
    assert.equal((await queue.get(String(first.jobId)))?.state, 'available')
    await producer.close()

    worker = await bootWorker(app, {
      env: { KET_SQLITE: file, KET_COMPANY: 'acme', KET_QUEUE_NOTIFY: '0' },
      log: () => {},
    })
    assert.equal(await worker.drain(), 2, 'night audit and post-check-in stay-notice preparation both run')

    const inspector = sqliteAdapter(file)
    await inspector.open()
    const run = (
      await inspector.all(`SELECT * FROM hospitality_core_night_audit_run WHERE id = ?`, ['hotel:2026-08-20'])
    )[0]!
    assert.deepEqual(
      {
        state: run.state,
        attempt: run.attempt,
        inHouseCount: run.inHouseCount,
        servicePosted: run.servicePosted,
        rentPosted: run.rentPosted,
        totalAmount: Number(run.totalAmount),
      },
      {
        state: 'completed',
        attempt: 1,
        inHouseCount: 1,
        servicePosted: 1,
        rentPosted: 2,
        totalAmount: 610,
      },
    )
    assert.equal(
      Number(
        (
          await inspector.all(
            `SELECT COUNT(*) AS n FROM hospitality_core_charge WHERE "nightAuditRunId" = ?`,
            ['hotel:2026-08-20'],
          )
        )[0]!.n,
      ),
      3,
    )
    assert.equal(
      (await inspector.all(`SELECT "nextBillDate" FROM hospitality_core_stay WHERE id = 'monthly:stay'`))[0]!
        .nextBillDate,
      '2026-08-30',
    )
    assert.equal(
      Number(
        (
          await inspector.all(`SELECT "amountTotal" FROM hospitality_core_folio WHERE id = 'monthly:folio'`)
        )[0]!.amountTotal,
      ),
      910,
    )

    registerFunctions(modules)
    const rerun = (
      await call(
        'hospitality_core.requestNightAudit',
        { propertyId: 'hotel', auditDate: '2026-08-20' },
        inspector,
      )
    ).value as Row
    assert.equal(rerun.existing, false, 'completed queue uniqueness must not suppress a rerun')
    await inspector.close()
    assert.equal(await worker.drain(), 1)

    const after = sqliteAdapter(file)
    await after.open()
    const afterRun = (
      await after.all(
        `SELECT attempt, "servicePosted", "rentPosted", "totalAmount" FROM hospitality_core_night_audit_run WHERE id = ?`,
        ['hotel:2026-08-20'],
      )
    )[0]!
    assert.deepEqual(
      { ...afterRun, totalAmount: Number(afterRun.totalAmount) },
      { attempt: 2, servicePosted: 1, rentPosted: 2, totalAmount: 610 },
    )
    assert.equal((await after.all('SELECT COUNT(*) AS n FROM hospitality_core_charge'))[0]!.n, 4)
    assert.equal(
      Number(
        (await after.all(`SELECT "amountTotal" FROM hospitality_core_folio WHERE id = 'monthly:folio'`))[0]!
          .amountTotal,
      ),
      910,
    )
    await after.close()
  } finally {
    await worker?.close()
    await producer.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})

test('hospitality night audit: a property can defer the first long-stay charge to the worker', async () => {
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, manifest)
    registerFunctions(modules)
    await call('partner.savePartner', { id: 'guest', kind: 'person', name: 'Guest' }, adapter)
    await call(
      'hospitality_core.saveProperty',
      {
        id: 'hotel',
        code: 'HAN',
        name: 'Hà Nội Hotel',
        accommodationType: 'hotel',
        timezone: 'UTC',
        allowWeekly: true,
        longStayBillOnCheckIn: false,
      },
      adapter,
    )
    await call(
      'hospitality_core.saveRoomType',
      {
        id: 'weekly',
        propertyId: 'hotel',
        code: 'WK',
        name: 'Weekly',
        baseRate: '70',
        allowWeekly: true,
      },
      adapter,
    )
    await call(
      'hospitality_core.saveRoom',
      { id: '201', propertyId: 'hotel', roomTypeId: 'weekly', code: '201', name: '201' },
      adapter,
    )
    await call(
      'hospitality_core.createReservation',
      {
        id: 'weekly-stay',
        propertyId: 'hotel',
        roomTypeId: 'weekly',
        partnerId: 'guest',
        bookingType: 'weekly',
        billingMode: 'recurring',
        checkIn: '2026-08-01T14:00:00.000Z',
        checkOut: '2026-08-22T12:00:00.000Z',
        rate: '70',
      },
      adapter,
    )
    await call(
      'hospitality_core.checkIn',
      { stayId: 'weekly-stay:stay', roomId: '201', at: '2026-08-01T14:00:00.000Z' },
      adapter,
    )
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM hospitality_core_charge'))[0]!.n, 0)
    assert.equal(
      (
        await adapter.all(`SELECT "nextBillDate" FROM hospitality_core_stay WHERE id = 'weekly-stay:stay'`)
      )[0]!.nextBillDate,
      '2026-08-01',
    )
    const preview = (
      await call(
        'hospitality_core.previewNightAudit',
        { propertyId: 'hotel', auditDate: '2026-08-01' },
        adapter,
      )
    ).value as Row
    assert.equal(preview.rentDue, 1)
    const future = (
      await call(
        'hospitality_core.requestNightAudit',
        { propertyId: 'hotel', auditDate: '2999-01-01' },
        adapter,
      )
    ).value as Row
    assert.equal(future.ok, false)
    assert.equal((future.errors as Row[])[0]?.messageKey, 'hospitality_core.validation.audit_future')
  } finally {
    await adapter.close()
  }
})
