import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import backend from '@ketvietlab/ketsuite/backend'

const manifest = compose([backend], { headless: true })

test('saved search: state is actor-owned, strips navigation state and has one default per list', async () => {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions([backend])
  const call = (name: string, args: Record<string, unknown>, actor: string | null) =>
    callFn(name, args, { adapter: db, manifest, actor })
  const source = {
    q: 'desk',
    presets: ['goods'],
    filters: [],
    groupBy: [{ key: 'type' }],
    sort: [{ key: 'name', dir: 'asc' }],
    includeArchived: false,
    page: 9,
    openGroups: [['goods']],
    groupPages: { goods: 3 },
  }
  await call(
    'backend.saveSavedSearch',
    { id: 'one', listKey: 'product.templates', name: 'My products', state: source, default: true },
    'alice',
  )
  await call(
    'backend.saveSavedSearch',
    { id: 'two', listKey: 'product.templates', name: 'Second', state: source, default: true },
    'alice',
  )
  await call(
    'backend.saveSavedSearch',
    { id: 'other', listKey: 'product.templates', name: 'Other', state: source, default: true },
    'bob',
  )
  const alice = (await call('backend.listSavedSearches', { listKey: 'product.templates' }, 'alice'))
    .value as Array<{
    id: string
    state: Record<string, unknown>
    defaultKey?: string | null
  }>
  assert.deepEqual(
    alice.map((row) => row.id),
    ['one', 'two'],
  )
  assert.equal(alice.find((row) => row.id === 'one')!.defaultKey, null)
  assert.equal(alice.find((row) => row.id === 'two')!.defaultKey, 'alice:product.templates')
  assert.equal('page' in alice[0]!.state, false)
  assert.equal('openGroups' in alice[0]!.state, false)
  assert.deepEqual(
    (
      (await call('backend.listSavedSearches', { listKey: 'product.templates' }, 'bob')).value as Array<{
        id: string
      }>
    ).map((row) => row.id),
    ['other'],
  )
  assert.deepEqual(
    (await call('backend.listSavedSearches', { listKey: 'product.templates' }, null)).value,
    [],
  )
  await call('backend.archiveSavedSearch', { id: 'two', listKey: 'product.templates' }, 'alice')
  assert.deepEqual(
    (
      (await call('backend.listSavedSearches', { listKey: 'product.templates' }, 'alice')).value as Array<{
        id: string
      }>
    ).map((row) => row.id),
    ['one'],
  )
  await db.close()
})
