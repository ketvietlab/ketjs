import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storefront, admin, workspace } from '../examples/workspace.ts'
import {
  agentDescriptor,
  agentTools,
  compose,
  composeWorkspace,
  compositionSchema,
  defineDeployment,
  defineModule,
} from '@ketvietlab/ketjs'
import { catalog, defaultTheme as theme, inventory } from '@ketvietlab/ketsuite'

test('umbrella: one codebase composes several deployments from overlapping modules', () => {
  const ws = workspace()
  assert.deepEqual(Object.keys(ws.deployments).sort(), ['admin', 'storefront'])
  assert.deepEqual(ws.shared, ['catalog', 'inventory'])
  assert.deepEqual(ws.soloed.admin, ['checkout'])
  assert.ok(
    !('checkout.placeOrder' in ws.deployments.storefront!.functions),
    'storefront must not expose admin-only functions',
  )
  assert.ok('checkout.placeOrder' in ws.deployments.admin!.functions)
})

test('umbrella: deployments sharing a datastore get one union schema', () => {
  const ws = workspace()
  const main = ws.datastores.main!
  assert.deepEqual(main.deployments.sort(), ['admin', 'storefront'])
  assert.ok('catalog_product' in main.schema.tables)
  assert.ok(
    'checkout_order' in main.schema.tables,
    'a table only one deployment knows about still lives in the shared store',
  )
  assert.ok('leadTimeDays' in main.schema.tables.catalog_product!.columns)
})

test('umbrella: two deployments disagreeing about the same table is a build error', () => {
  const catalogV1 = defineModule({
    name: 'catalog',
    models: { Product: { scope: 'shared', fields: { id: 'id', price: 'int' } } },
  })
  const catalogV2 = defineModule({
    name: 'catalog',
    models: { Product: { scope: 'shared', fields: { id: 'id', price: 'text' } } },
  })
  const a = defineDeployment({ name: 'a', modules: [catalogV1], datastore: 'main', headless: true })
  const b = defineDeployment({ name: 'b', modules: [catalogV2], datastore: 'main', headless: true })
  assert.throws(() => composeWorkspace([a, b]), /E_DATASTORE_COLUMN_CLASH|is int .* but text/)
})

test('umbrella: shared columns must agree on nullability and reference target', () => {
  const deployment = (name: string, value: string, owner: string) =>
    defineDeployment({
      name,
      datastore: 'main',
      headless: true,
      modules: [
        defineModule({
          name: 'shared_contract',
          models: {
            OwnerA: { scope: 'shared', fields: { id: 'id' } },
            OwnerB: { scope: 'shared', fields: { id: 'id' } },
            Entry: { scope: 'shared', fields: { id: 'id', value, owner } },
          },
        }),
      ],
    })

  assert.throws(
    () =>
      composeWorkspace([
        deployment('required', 'text', 'ref:shared_contract.OwnerA'),
        deployment('optional', 'text?', 'ref:shared_contract.OwnerA'),
      ]),
    /E_DATASTORE_COLUMN_CLASH|text.*text\?/,
  )
  assert.throws(
    () =>
      composeWorkspace([
        deployment('owner_a', 'text', 'ref:shared_contract.OwnerA'),
        deployment('owner_b', 'text', 'ref:shared_contract.OwnerB'),
      ]),
    /E_DATASTORE_COLUMN_CLASH|OwnerA.*OwnerB/,
  )
})

test('umbrella: shared datastore indexes are unioned and same-name conflicts are rejected', () => {
  const deployment = (name: string, indexes: Record<string, { fields: string[]; unique?: boolean }>) =>
    defineDeployment({
      name,
      datastore: 'main',
      headless: true,
      modules: [
        defineModule({
          name: 'indexed',
          models: {
            Entry: { scope: 'shared', fields: { id: 'id', code: 'text', label: 'text' }, indexes },
          },
        }),
      ],
    })

  const union = composeWorkspace([
    deployment('without_index', {}),
    deployment('with_index', { code_unique: { fields: ['code'], unique: true } }),
  ])
  assert.deepEqual(union.datastores.main?.schema.tables.indexed_entry?.indexes.code_unique, {
    fields: ['code'],
    unique: true,
    by: 'indexed',
  })

  assert.throws(
    () =>
      composeWorkspace([
        deployment('code_index', { lookup: { fields: ['code'], unique: true } }),
        deployment('label_index', { lookup: { fields: ['label'] } }),
      ]),
    /E_DATASTORE_INDEX_CLASH|index "indexed_entry.lookup"/,
  )
})

test('umbrella: separate datastores keep separate schemas', () => {
  const ws = composeWorkspace([
    defineDeployment({ name: 'one', modules: [catalog, inventory], theme, datastore: 'shop' }),
    defineDeployment({ name: 'two', modules: [catalog], datastore: 'analytics', headless: true }),
  ])
  assert.deepEqual(Object.keys(ws.datastores).sort(), ['analytics', 'shop'])
  assert.equal('leadTimeDays' in ws.datastores.analytics!.schema.tables.catalog_product!.columns, false)
})

test('umbrella: a headless deployment renders nothing and may not select a theme', () => {
  assert.equal(storefront.headless ?? false, false)
  assert.equal(admin.headless, true)
  assert.throws(
    () => defineDeployment({ name: 'x', modules: [catalog], theme, headless: true }),
    /headless but selects a theme/,
  )
})

test('agent: only functions marked agent:true are exposed, with their effects', () => {
  const m = compose([catalog, inventory, theme])
  const tools = agentTools(m)
  const names = tools.map((t) => t.name).sort()
  assert.ok(names.includes('catalog__getProduct'))
  const create = tools.find((t) => t.name === 'catalog__createProduct')!
  assert.equal(create.mutates, true)
  assert.equal(create.idempotent, true)
  assert.equal(create.dryRunnable, true)
  assert.deepEqual(create.inputSchema.required.sort(), ['id', 'priceCents', 'slug', 'title'])
  assert.equal(create.inputSchema.properties.priceCents!.type, 'integer')
  const read = tools.find((t) => t.name === 'catalog__getProduct')!
  assert.equal(read.mutates, false)
})

test('agent: the composition schema is the safe write surface', () => {
  const m = compose([catalog, inventory, theme])
  const cs = compositionSchema(m)
  assert.ok('catalog:product.detail.footer' in cs.joints)
  assert.deepEqual(cs.joints['catalog:product.detail.footer']!.filledBy, ['inventory'])
  assert.ok(cs.regions['product.detail']!.providedBy.includes('theme_default'))
  assert.ok(cs.tokens.includes('color-accent'))
})

test('agent: one descriptor answers "what is this deployment and what may I do"', () => {
  const d = agentDescriptor(compose([catalog, inventory, theme]))
  assert.ok(d.tools.length > 0)
  assert.equal(d.models['catalog.Product']!.leadTimeDays, 'int? (by inventory)')
  assert.ok('catalog.product' in d.views)
})
