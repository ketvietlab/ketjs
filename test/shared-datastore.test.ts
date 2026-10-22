import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bootDeployment,
  compose,
  composeWorkspace,
  defineDeployment,
  defineModule,
  migrateOne,
  sqliteAdapter,
  verifyPhysicalSchema,
} from '@ketvietlab/ketjs'
import type { DeploymentSpec, KetModule } from '@ketvietlab/ketjs'

/**
 * Two deployments bound to one datastore. The workspace promised a checked union
 * schema, but each process migrated to its own manifest against a single marker,
 * so the smaller deployment booting after the larger one planned to drop the
 * larger one's tables and refused to start.
 */
const notes = (scope: 'company' | 'shared') =>
  defineModule({
    name: 'notes',
    models: { Note: { scope, fields: { id: 'id', title: 'text' } } },
  })
const tags = defineModule({
  name: 'tags',
  depends: ['notes'],
  models: { Tag: { scope: 'company', fields: { id: 'id', label: 'text' } } },
  extend: { 'notes.Note': { pinned: 'bool?' } },
})

const deployment = (name: string, modules: KetModule[]): DeploymentSpec =>
  defineDeployment({ name, modules, headless: true, datastore: 'main' })

test('shared datastore: the smaller deployment boots after the larger one', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ket-shared-store-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const env = { KET_SQLITE: join(directory, 'main.db'), KET_LOG: 'null' }
  const big = deployment('backoffice', [notes('company'), tags])
  const small = deployment('portal', [notes('company')])
  composeWorkspace([big, small])

  for (const spec of [big, small, big, small]) {
    const booted = await bootDeployment(spec, { env, port: 0 })
    await booted.close()
  }

  const adapter = sqliteAdapter(env.KET_SQLITE)
  await adapter.open()
  t.after(() => adapter.close())
  const tables = Object.keys(await adapter.introspect())
  assert.ok(tables.includes('tags_tag'), 'the larger deployment keeps its table')
  const columns = Object.keys((await adapter.introspect())['notes_note'] ?? {})
  assert.ok(
    columns.some((column) => /pinned/.test(column)),
    'and its extension column',
  )
  const recorded = await adapter.all('SELECT deployment FROM ket_migration_deployment ORDER BY deployment')
  assert.deepEqual(
    recorded.map((row) => row['deployment']),
    ['backoffice', 'portal'],
  )

  const portal = compose([notes('company')], { headless: true })
  assert.equal((await verifyPhysicalSchema(adapter, portal, { deployment: 'portal' })).ok, true)
  assert.equal(
    (await verifyPhysicalSchema(adapter, portal)).ok,
    false,
    'without the deployment, the manifest is taken as the whole database',
  )
})

test('shared datastore: a model scoped differently by two deployments is refused', async (t) => {
  assert.throws(
    () =>
      composeWorkspace([
        deployment('backoffice', [notes('company')]),
        deployment('portal', [notes('shared')]),
      ]),
    (error: { items?: Array<{ code: string }> }) =>
      error.items?.some((item) => item.code === 'E_DATASTORE_SCOPE_CLASH') === true,
  )

  // The same disagreement between processes that were never composed together.
  const adapter = sqliteAdapter()
  await adapter.open()
  t.after(() => adapter.close())
  await migrateOne(adapter, compose([notes('company')], { headless: true }), { deployment: 'backoffice' })
  await assert.rejects(
    () => migrateOne(adapter, compose([notes('shared')], { headless: true }), { deployment: 'portal' }),
    (error: { code?: string }) => error.code === 'E_DATASTORE_SCOPE_CLASH',
  )
})

test('shared datastore: one deployment alone still drops what it removed, when allowed', async (t) => {
  const adapter = sqliteAdapter()
  await adapter.open()
  t.after(() => adapter.close())
  await migrateOne(adapter, compose([notes('company'), tags], { headless: true }), { deployment: 'solo' })
  await assert.rejects(() =>
    migrateOne(adapter, compose([notes('company')], { headless: true }), { deployment: 'solo' }),
  )
  const ops = await migrateOne(adapter, compose([notes('company')], { headless: true }), {
    deployment: 'solo',
    allowDestructive: true,
  })
  assert.ok(ops.some((op) => op.op === 'DROP_TABLE'))
})
