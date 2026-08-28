import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compose,
  defineModule,
  migrateOne,
  schemaFromManifest,
  sqliteAdapter,
  verifyPhysicalSchema,
} from '@ketvietlab/ketjs'

const manifestWith = (value: 'text' | 'text?') =>
  compose(
    [
      defineModule({
        name: 'schema_verify',
        models: {
          Entry: {
            scope: 'shared',
            fields: { id: 'id', value },
          },
        },
      }),
    ],
    { headless: true },
  )

test('schema verification is read-only when the marker, catalog, and manifest agree', async () => {
  const manifest = manifestWith('text')
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, manifest, { now: () => '2026-08-28T00:00:00.000Z' })
    const markerBefore = await adapter.all('SELECT schema, applied_at FROM ket_migration WHERE id = 1')

    const report = await verifyPhysicalSchema(adapter, manifest)

    assert.equal(report.ok, true)
    assert.equal(report.markerMatchesManifest, true)
    assert.deepEqual(report.markerIssues, [])
    assert.deepEqual(report.manifestIssues, [])
    assert.deepEqual(report.applied, schemaFromManifest(manifest))
    assert.deepEqual(
      await adapter.all('SELECT schema, applied_at FROM ket_migration WHERE id = 1'),
      markerBefore,
      'verification must not rewrite the applied-schema marker',
    )
  } finally {
    await adapter.close()
  }
})

test('schema verification detects a required marker backed by a nullable physical column', async () => {
  const optional = manifestWith('text?')
  const required = manifestWith('text')
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, optional, { now: () => '2026-08-28T00:00:00.000Z' })
    await adapter.run('UPDATE ket_migration SET schema = ? WHERE id = 1', [
      JSON.stringify(schemaFromManifest(required)),
    ])
    const markerBefore = await adapter.all('SELECT schema, applied_at FROM ket_migration WHERE id = 1')

    const report = await verifyPhysicalSchema(adapter, required)

    assert.equal(report.ok, false)
    assert.equal(report.markerMatchesManifest, true)
    assert.deepEqual(report.markerIssues, ['column schema_verify_entry.value is nullable; expected NOT NULL'])
    assert.deepEqual(report.manifestIssues, report.markerIssues)
    assert.deepEqual(
      await adapter.all('SELECT schema, applied_at FROM ket_migration WHERE id = 1'),
      markerBefore,
      'detecting legacy drift must not repair or advance the marker',
    )
  } finally {
    await adapter.close()
  }
})

test('schema verification distinguishes a clean marker from the pending manifest target', async () => {
  const optional = manifestWith('text?')
  const required = manifestWith('text')
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await migrateOne(adapter, optional)

    const report = await verifyPhysicalSchema(adapter, required)

    assert.equal(report.ok, false)
    assert.equal(report.markerMatchesManifest, false)
    assert.deepEqual(report.markerIssues, [])
    assert.deepEqual(report.manifestIssues, [
      'column schema_verify_entry.value is nullable; expected NOT NULL',
    ])
  } finally {
    await adapter.close()
  }
})

test('schema verification reports a missing marker even when the physical target is present', async () => {
  const manifest = manifestWith('text')
  const adapter = sqliteAdapter()
  await adapter.open()
  try {
    await adapter.exec(`CREATE TABLE "schema_verify_entry" (
      "id" TEXT PRIMARY KEY,
      "value" TEXT NOT NULL
    )`)

    const report = await verifyPhysicalSchema(adapter, manifest)

    assert.equal(report.ok, false)
    assert.equal(report.applied, null)
    assert.equal(report.markerMatchesManifest, false)
    assert.deepEqual(report.markerIssues, ['applied-schema marker is missing'])
    assert.deepEqual(report.manifestIssues, [])
  } finally {
    await adapter.close()
  }
})
