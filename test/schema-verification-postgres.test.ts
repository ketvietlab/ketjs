import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { compose, defineModule, migrateOne, verifyPhysicalSchema } from '@ketvietlab/ketjs'
import type { Adapter, IndexDef } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { adminUrl, live } from './postgres-live.ts'

// `schema_verify_count_conversion_revision__<index>`: past 63 bytes for both names
// below, and identical in the first 63, which is all PostgreSQL keeps.
const LONG = 'product_revision_by_company'
const TWIN = 'product_revision_by_counter'

const manifestWith = (indexes: Record<string, IndexDef>) =>
  compose(
    [
      defineModule({
        name: 'schema_verify',
        models: {
          CountConversionRevision: {
            scope: 'shared',
            fields: { id: 'id', productId: 'text', revision: 'int' },
            indexes,
          },
        },
      }),
    ],
    { headless: true },
  )

const withDatabase = async (body: (adapter: Adapter) => Promise<void>): Promise<void> => {
  const name = `schema_verify_${randomUUID().replaceAll('-', '')}`
  const admin = postgresAdapter(adminUrl.toString())
  await admin.open()
  let adapter: Adapter | undefined
  try {
    await admin.exec(`CREATE DATABASE "${name}"`)
    const url = new URL(adminUrl)
    url.pathname = `/${name}`
    adapter = postgresAdapter(url.toString())
    await adapter.open()
    await body(adapter)
  } finally {
    await adapter?.close()
    await admin.exec(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.close()
  }
}

test('schema verification finds an index PostgreSQL stored under a shortened name', live, async () => {
  await withDatabase(async (adapter) => {
    const manifest = manifestWith({ [LONG]: { fields: ['productId', 'revision'], unique: true } })
    await migrateOne(adapter, manifest)
    const [held] = await adapter.all(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'schema_verify_count_conversion_revision' AND indexname <> 'schema_verify_count_conversion_revision_pkey'",
    )
    assert.equal(String(held?.indexname).length, 63, 'PostgreSQL kept only the first 63 bytes')

    const report = await verifyPhysicalSchema(adapter, manifest)
    assert.deepEqual(report.manifestIssues, [])
    assert.equal(report.ok, true)
  })
})

test('schema verification names two indexes PostgreSQL would store under one name', live, async () => {
  await withDatabase(async (adapter) => {
    await migrateOne(adapter, manifestWith({ [LONG]: { fields: ['productId'] } }))
    const report = await verifyPhysicalSchema(
      adapter,
      manifestWith({ [LONG]: { fields: ['productId'] }, [TWIN]: { fields: ['revision'] } }),
    )
    assert.equal(report.ok, false)
    assert.ok(
      report.manifestIssues.some((issue) =>
        issue.startsWith(
          `indexes schema_verify_count_conversion_revision__${LONG} and schema_verify_count_conversion_revision__${TWIN} share the name`,
        ),
      ),
      report.manifestIssues.join('\n'),
    )
  })
})
