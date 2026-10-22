import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createQueue, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { adminUrl, live } from './postgres-live.ts'

/**
 * Companies pooled in one database share the ket_job table. The queue's unique
 * key used to be global to it, so a second company enqueueing `invoice:1` got the
 * first company's job back as "existing" and its own work was never stored.
 */
const OLD_INDEX = `CREATE UNIQUE INDEX ket_job_unique_active ON ket_job (job, unique_key)
  WHERE unique_key IS NOT NULL AND state IN ('available', 'scheduled', 'executing', 'retryable')`

/** Leave a database as a previous release created it: the queue table with the old index. */
const previousRelease = async (open: () => Adapter) => {
  const adapter = open()
  await adapter.open()
  try {
    await createQueue(adapter)
    await adapter.exec('DROP INDEX ket_job_unique_company')
    await adapter.exec(OLD_INDEX)
  } finally {
    await adapter.close()
  }
}

const exercise = async (adapter: Adapter) => {
  const queue = await createQueue(adapter)
  const enqueue = (company: string | null) =>
    queue.enqueue('billing.issue', { order: '1' }, { uniqueKey: 'invoice:1', scope: { company } })

  const acme = await enqueue('acme')
  const beta = await enqueue('beta')
  assert.equal(beta.existing, false, 'another company is not coalesced into the first')
  assert.notEqual(beta.id, acme.id, 'and is never handed the first company job id')

  const acmeAgain = await enqueue('acme')
  assert.deepEqual(acmeAgain, { id: acme.id, existing: true }, 'the same company still coalesces')
  const system = await enqueue(null)
  assert.equal(system.existing, false)
  assert.deepEqual(
    await enqueue(null),
    { id: system.id, existing: true },
    'jobs without a company share one key space',
  )

  const stored = await adapter.all("SELECT company_id FROM ket_job WHERE unique_key = 'invoice:1'")
  assert.deepEqual(stored.map((row) => String(row['company_id'] ?? '-')).sort(), ['-', 'acme', 'beta'])
}

test('queue: a unique key is unique within one company on SQLite', async (t) => {
  const adapter = sqliteAdapter()
  await adapter.open()
  t.after(() => adapter.close())
  await exercise(adapter)
})

test('queue: an upgraded database replaces the company-blind unique index', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ket-queue-unique-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = join(directory, 'app.db')
  await previousRelease(() => sqliteAdapter(file))
  const adapter = sqliteAdapter(file)
  await adapter.open()
  t.after(() => adapter.close())
  await exercise(adapter)
  const indexes = await adapter.all(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ket_job'",
  )
  assert.equal(
    indexes.some((row) => row['name'] === 'ket_job_unique_active'),
    false,
  )
})

test('queue: a unique key is unique within one company on PostgreSQL', live, async () => {
  const name = `queue_unique_${randomUUID().replaceAll('-', '')}`
  const admin = postgresAdapter(adminUrl.toString())
  await admin.open()
  try {
    await admin.exec(`CREATE DATABASE "${name}"`)
    const url = new URL(adminUrl)
    url.pathname = `/${name}`
    await previousRelease(() => postgresAdapter(url.toString()))
    const adapter = postgresAdapter(url.toString())
    await adapter.open()
    try {
      await exercise(adapter)
    } finally {
      await adapter.close()
    }
  } finally {
    await admin.exec(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.close()
  }
})
