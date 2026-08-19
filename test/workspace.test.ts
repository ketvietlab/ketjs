import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storefront, admin, workspace } from '../examples/workspace.ts'
import {
  agentDescriptor,
  agentTools,
  compose,
  composeWorkspace,
  compositionSchema,
  defineApp,
  defineModule,
} from 'ketjs'
import { catalog, defaultTheme as theme, inventory } from 'ketsuite'

test('umbrella: one codebase composes several apps from overlapping modules', () => {
  const ws = workspace()
  assert.deepEqual(Object.keys(ws.apps).sort(), ['admin', 'storefront'])
  assert.deepEqual(ws.shared, ['catalog', 'inventory'])
  assert.deepEqual(ws.soloed.admin, ['checkout'])
  assert.ok(
    !('checkout.placeOrder' in ws.apps.storefront!.functions),
    'storefront must not expose admin-only functions',
  )
  assert.ok('checkout.placeOrder' in ws.apps.admin!.functions)
})

test('umbrella: apps sharing a datastore get one union schema', () => {
  const ws = workspace()
  const main = ws.datastores.main!
  assert.deepEqual(main.apps.sort(), ['admin', 'storefront'])
  assert.ok('catalog_product' in main.schema.tables)
  assert.ok(
    'checkout_order' in main.schema.tables,
    'a table only one app knows about still lives in the shared store',
  )
  assert.ok('leadTimeDays' in main.schema.tables.catalog_product!.columns)
})

test('umbrella: two apps disagreeing about the same table is a build error', () => {
  const catalogV1 = defineModule({
    name: 'catalog',
    models: { Product: { scope: 'shared', fields: { id: 'id', price: 'int' } } },
  })
  const catalogV2 = defineModule({
    name: 'catalog',
    models: { Product: { scope: 'shared', fields: { id: 'id', price: 'text' } } },
  })
  const a = defineApp({ name: 'a', modules: [catalogV1], datastore: 'main', headless: true })
  const b = defineApp({ name: 'b', modules: [catalogV2], datastore: 'main', headless: true })
  assert.throws(() => composeWorkspace([a, b]), /E_DATASTORE_COLUMN_CLASH|is int .* but text/)
})

test('umbrella: separate datastores keep separate schemas', () => {
  const ws = composeWorkspace([
    defineApp({ name: 'one', modules: [catalog, inventory], theme, datastore: 'shop' }),
    defineApp({ name: 'two', modules: [catalog], datastore: 'analytics', headless: true }),
  ])
  assert.deepEqual(Object.keys(ws.datastores).sort(), ['analytics', 'shop'])
  assert.equal('leadTimeDays' in ws.datastores.analytics!.schema.tables.catalog_product!.columns, false)
})

test('umbrella: a headless app renders nothing and may not install a theme', () => {
  assert.equal(storefront.headless ?? false, false)
  assert.equal(admin.headless, true)
  assert.throws(
    () => defineApp({ name: 'x', modules: [catalog], theme, headless: true }),
    /headless but installs a theme/,
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

test('agent: one descriptor answers "what is this app and what may I do"', () => {
  const d = agentDescriptor(compose([catalog, inventory, theme]))
  assert.ok(d.tools.length > 0)
  assert.equal(d.models['catalog.Product']!.leadTimeDays, 'int? (by inventory)')
  assert.ok('catalog.product' in d.views)
})
