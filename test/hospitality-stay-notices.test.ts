import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  bootWorker,
  callFn,
  compose,
  createQueue,
  defineApp,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { address, company, hospitalityCore, partner, product, storage, uom } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import {
  stayNoticeDueAt,
  stayNoticeDurationValid,
} from '../packages/ketsuite/src/modules/hospitality_core/stay-notices.ts'

const modules = [address, partner, company, storage, backend, uom, product, hospitalityCore]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (
  name: string,
  args: Record<string, unknown>,
  adapter: Adapter,
  actor: string | null = 'frontdesk',
) => callFn(name, args, { adapter, manifest, scope, actor })

const seedStay = async (adapter: Adapter): Promise<void> => {
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'primary', kind: 'person', name: 'Nguyễn An' }, adapter)
  await call('partner.savePartner', { id: 'companion', kind: 'person', name: 'Trần Bình' }, adapter)
  await call(
    'hospitality_core.saveProperty',
    {
      id: 'hotel',
      code: 'HCM',
      name: 'Két Hotel',
      accommodationType: 'hotel',
      timezone: 'Asia/Ho_Chi_Minh',
      street1: '123 Nguyễn Huệ',
      locality: 'Thành phố Hồ Chí Minh',
    },
    adapter,
  )
  await call(
    'hospitality_core.saveRoomType',
    { id: 'deluxe', propertyId: 'hotel', code: 'DLX', name: 'Deluxe', baseRate: '100' },
    adapter,
  )
  await call(
    'hospitality_core.saveRoom',
    { id: '101', propertyId: 'hotel', roomTypeId: 'deluxe', code: '101', name: '101' },
    adapter,
  )
  const booked = await call(
    'hospitality_core.createReservation',
    {
      id: 'late-arrival',
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      partnerId: 'primary',
      bookingType: 'nightly',
      checkIn: '2026-08-20T16:30:00.000Z',
      checkOut: '2026-08-22T05:00:00.000Z',
      rate: '100',
    },
    adapter,
  )
  assert.equal((booked.value as Row).ok, true, JSON.stringify(booked.value))
  const checkedIn = await call(
    'hospitality_core.checkIn',
    {
      stayId: 'late-arrival:stay',
      roomId: '101',
      assignmentId: 'late-arrival:assignment',
      at: '2026-08-20T16:30:00.000Z',
    },
    adapter,
  )
  assert.equal((checkedIn.value as Row).ok, true, JSON.stringify(checkedIn.value))
}

test('hospitality stay notices: deadline follows the property-local 23:00 rule', () => {
  assert.equal(stayNoticeDueAt('2026-08-20T15:59:00.000Z', 'Asia/Ho_Chi_Minh'), '2026-08-20T16:00:00.000Z')
  assert.equal(stayNoticeDueAt('2026-08-20T16:00:00.000Z', 'Asia/Ho_Chi_Minh'), '2026-08-21T01:00:00.000Z')
  assert.equal(stayNoticeDurationValid('2026-08-01T07:00:00.000Z', '2026-08-31T07:00:00.000Z'), true)
  assert.equal(stayNoticeDurationValid('2026-08-01T07:00:00.000Z', '2026-08-31T07:00:01.000Z'), false)
})

test('hospitality stay notices: physical SQLite worker prepares, repairs and records evidence without PII payloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ket-hospitality-stay-notices-'))
  const file = join(dir, 'hospitality.db')
  const app = defineApp({
    name: 'hospitality_stay_notice_test',
    modules,
    headless: true,
    serve: { bootstrap: ['hospitality_core'] },
    worker: { queues: { maintenance: 1 } },
  })
  const producer = sqliteAdapter(file)
  await producer.open()
  let worker: Awaited<ReturnType<typeof bootWorker>> | null = null
  try {
    await seedStay(producer)
    const queue = await createQueue(producer)
    const queued = (await queue.list({ state: 'available' })).find(
      (row) => row.job === 'hospitality_core.prepareStayNotices',
    )
    assert.ok(queued)
    assert.deepEqual(queued.args, { stayId: 'late-arrival:stay' })

    const draft = await call(
      'hospitality_core.createReservation',
      {
        id: 'future-arrival',
        propertyId: 'hotel',
        roomTypeId: 'deluxe',
        partnerId: 'companion',
        bookingType: 'nightly',
        checkIn: '2026-09-20T07:00:00.000Z',
        checkOut: '2026-09-21T05:00:00.000Z',
        rate: '100',
      },
      producer,
    )
    assert.equal((draft.value as Row).ok, true)
    const premature = await call(
      'hospitality_core.requestStayNoticeRefresh',
      { stayId: 'future-arrival:stay' },
      producer,
    )
    assert.equal((premature.value as Row).ok, false)
    assert.equal(
      ((premature.value as Row).errors as Row[])[0]?.messageKey,
      'hospitality_core.validation.stay_notice_stay_state',
    )
    await producer.close()

    worker = await bootWorker(app, {
      env: { KET_SQLITE: file, KET_COMPANY: 'acme', KET_QUEUE_NOTIFY: '0' },
      log: () => {},
    })
    assert.equal(await worker.drain(), 1)

    const inspector = sqliteAdapter(file)
    await inspector.open()
    registerFunctions(modules)
    const attention = (
      await inspector.all('SELECT * FROM hospitality_core_stay_notice WHERE id = ?', [
        'late-arrival:stay:notice:late-arrival:guest',
      ])
    )[0]!
    assert.deepEqual(
      {
        state: attention.state,
        dueAt: attention.dueAt,
        issueCodes: JSON.parse(String(attention.issueCodes)),
        documentLast4: attention.documentLast4,
      },
      {
        state: 'attention',
        dueAt: '2026-08-21T01:00:00.000Z',
        issueCodes: ['document_missing'],
        documentLast4: null,
      },
    )

    const savedDocument = await call(
      'hospitality_core.saveGuestDocument',
      {
        id: 'primary-document',
        stayId: 'late-arrival:stay',
        partnerId: 'primary',
        type: 'cccd',
        number: '079203001234',
        fullName: 'Nguyễn An',
        dateOfBirth: '1990-05-12T00:00:00.000Z',
        ocrState: 'done',
      },
      inspector,
    )
    assert.equal((savedDocument.value as Row).ok, true, JSON.stringify(savedDocument.value))
    await inspector.close()
    assert.equal(await worker.drain(), 1)

    const readyAdapter = sqliteAdapter(file)
    await readyAdapter.open()
    registerFunctions(modules)
    const listed = (await call('hospitality_core.listStayNotices', { propertyId: 'hotel' }, readyAdapter))
      .value as Row[]
    assert.deepEqual(
      listed.map((row) => ({
        state: row.state,
        reason: row.reason,
        documentType: row.documentType,
        last4: row.documentLast4,
      })),
      [{ state: 'ready', reason: null, documentType: 'cccd', last4: '1234' }],
    )
    const storedReady = (
      await readyAdapter.all('SELECT * FROM hospitality_core_stay_notice WHERE id = ?', [listed[0]!.id])
    )[0]!
    assert.doesNotMatch(JSON.stringify(storedReady), /079203001234/)
    assert.doesNotMatch(JSON.stringify(storedReady), /1990-05-12/)
    assert.equal('number' in storedReady, false)

    const missingReason = (
      await call(
        'hospitality_core.recordStayNoticeSubmission',
        { id: listed[0]!.id, reason: '', channel: 'online', evidenceRef: 'DVC-NO-REASON' },
        readyAdapter,
        'frontdesk-user',
      )
    ).value as Row
    assert.equal(missingReason.ok, false)
    assert.equal(
      (missingReason.errors as Row[])[0]?.messageKey,
      'hospitality_core.validation.stay_notice_reason',
    )

    const unsigned = (
      await call(
        'hospitality_core.recordStayNoticeSubmission',
        {
          id: listed[0]!.id,
          reason: 'tourism',
          channel: 'online',
          evidenceRef: 'DVC-UNSIGNED',
        },
        readyAdapter,
        null,
      )
    ).value as Row
    assert.equal(unsigned.ok, false)
    assert.equal(
      (unsigned.errors as Row[])[0]?.messageKey,
      'hospitality_core.validation.authentication_required',
    )

    const submitted = (
      await call(
        'hospitality_core.recordStayNoticeSubmission',
        {
          id: listed[0]!.id,
          reason: 'business',
          channel: 'online',
          evidenceRef: 'DVC-2026-0001',
        },
        readyAdapter,
        'frontdesk-user',
      )
    ).value as Row
    assert.equal(submitted.ok, true, JSON.stringify(submitted))
    const firstEvidence = (
      await readyAdapter.all(
        'SELECT state, "packageHash", "submittedBy", "receiptRef" FROM hospitality_core_stay_notice WHERE id = ?',
        [listed[0]!.id],
      )
    )[0]!
    assert.equal(firstEvidence.state, 'submitted')
    assert.match(String(firstEvidence.packageHash), /^[a-f0-9]{64}$/)
    assert.equal(firstEvidence.submittedBy, 'frontdesk-user')
    assert.equal(firstEvidence.receiptRef, 'DVC-2026-0001')

    const repeated = (
      await call(
        'hospitality_core.recordStayNoticeSubmission',
        {
          id: listed[0]!.id,
          reason: 'tourism',
          channel: 'phone',
          evidenceRef: 'must-not-overwrite',
        },
        readyAdapter,
        'another-user',
      )
    ).value as Row
    assert.equal(repeated.ok, true)
    assert.deepEqual(
      {
        ...(
          await readyAdapter.all(
            'SELECT reason, "receiptRef" FROM hospitality_core_stay_notice WHERE id = ?',
            [listed[0]!.id],
          )
        )[0],
      },
      { reason: 'business', receiptRef: 'DVC-2026-0001' },
    )

    const confirmed = (
      await call(
        'hospitality_core.confirmStayNotice',
        { id: listed[0]!.id, receiptRef: 'DVC-2026-0001' },
        readyAdapter,
        'supervisor-user',
      )
    ).value as Row
    assert.equal(confirmed.state, 'confirmed')
    assert.equal(
      (
        await readyAdapter.all('SELECT state, "confirmedBy" FROM hospitality_core_stay_notice WHERE id = ?', [
          listed[0]!.id,
        ])
      )[0]!.confirmedBy,
      'supervisor-user',
    )

    await call(
      'hospitality_core.addStayGuest',
      {
        id: 'companion-guest',
        stayId: 'late-arrival:stay',
        partnerId: 'companion',
        displayName: 'Trần Bình',
      },
      readyAdapter,
    )
    await call(
      'hospitality_core.saveGuestDocument',
      {
        id: 'companion-document',
        stayId: 'late-arrival:stay',
        partnerId: 'companion',
        type: 'passport',
        number: 'P1234567',
        fullName: 'Trần Bình',
        dateOfBirth: '1988-04-20T00:00:00.000Z',
        ocrState: 'done',
      },
      readyAdapter,
    )
    await readyAdapter.close()
    assert.equal(await worker.drain(), 1)

    const finalAdapter = sqliteAdapter(file)
    await finalAdapter.open()
    registerFunctions(modules)
    const finalRows = (await call('hospitality_core.listStayNotices', { propertyId: 'hotel' }, finalAdapter))
      .value as Row[]
    assert.deepEqual(
      finalRows
        .map((row) => ({ guest: row.guestName, state: row.state, last4: row.documentLast4 }))
        .sort((left, right) => String(left.guest).localeCompare(String(right.guest), 'vi')),
      [
        { guest: 'Nguyễn An', state: 'confirmed', last4: '1234' },
        { guest: 'Trần Bình', state: 'ready', last4: '4567' },
      ],
    )
    assert.doesNotMatch(JSON.stringify(finalRows), /079203001234|P1234567/)
    await finalAdapter.close()
  } finally {
    await worker?.close()
    await producer.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
})
