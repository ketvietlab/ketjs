import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMenu, compose } from '@ketvietlab/ketjs'
import { createKetsuiteDeployment } from '../packages/ketsuite/src/deployment.ts'

const deployment = createKetsuiteDeployment()
const manifest = compose([
  ...deployment.modules,
  ...(deployment.theme ? [deployment.theme] : []),
  ...(deployment.themes ?? []),
])

const configurationGroups = new Set([
  'admin.config',
  'accounting.configuration',
  'hospitality.configuration',
  'pos.configGroup',
  'stock.config',
  'website.configuration',
])

test('KétSuite sidebar is two levels except multi-screen configuration groups', () => {
  for (const [id, entry] of Object.entries(manifest.menus)) {
    if (!entry.parent) continue
    const parent = manifest.menus[entry.parent]
    assert.ok(parent, `${id} has an unknown parent`)
    if (parent.parent) {
      assert.ok(configurationGroups.has(entry.parent), `${id} creates an unexpected third level`)
      assert.equal(manifest.menus[parent.parent]!.parent, undefined, `${id} creates a fourth level`)
    }
    if (!entry.path) {
      assert.ok(configurationGroups.has(id), `${id} is an unnecessary intermediate heading`)
      assert.ok(Object.values(manifest.menus).filter((child) => child.parent === id).length >= 2, id)
    }
  }
  for (const id of configurationGroups) {
    assert.ok(manifest.menus[id], `${id} must retain its configuration group`)
  }
})

test('Product shows templates and attributes directly, with a two-level active trail', () => {
  const tree = buildMenu(manifest, { active: '/admin/product/templates' })
  const product = tree.find((node) => node.id === 'product')!
  assert.ok(product.active)
  assert.deepEqual(
    product.children.map((node) => node.id),
    ['product.templates', 'product.attributes'],
  )
  assert.equal(product.children[0]!.path, '/admin/product/templates')
  assert.ok(product.children[0]!.active)
  assert.equal(product.children[1]!.active, false)
})

test('flattened Product menus retain permission filtering and search', () => {
  const allowed = buildMenu(manifest, { allow: ['product.listAttributes'] })
  assert.deepEqual(
    allowed.find((node) => node.id === 'product')?.children.map((node) => node.id),
    ['product.attributes'],
  )
  assert.equal(
    buildMenu(manifest, { allow: [] }).some((node) => node.id === 'product'),
    false,
  )
  const searched = buildMenu(manifest, {
    q: 'Mẫu sản phẩm',
    translate: (key) => (key === 'product_backend.menu.templates' ? 'Mẫu sản phẩm' : key),
  })
  assert.deepEqual(
    searched.find((node) => node.id === 'product')?.children.map((node) => node.id),
    ['product.templates'],
  )
})

test('hotel operational screens are direct while configuration keeps its children', () => {
  const tree = buildMenu(manifest)
  const hotel = tree.find((node) => node.id === 'hospitality')!.children.map((node) => node.id)
  assert.ok(hotel.includes('hospitality.billing'))
  assert.ok(hotel.indexOf('hospitality.billing') < hotel.indexOf('hospitality.cleaningTasks'))
  assert.ok(hotel.indexOf('hospitality.cleaningTasks') < hotel.indexOf('hospitality.configuration'))
  assert.equal(manifest.menus['hospitality.billingRules']!.parent, 'hospitality.configuration')
  assert.equal(manifest.menus['admin.companies']!.parent, 'admin.config')
  const limited = buildMenu(manifest, { allow: ['hospitality_billing.listChargeRules'] })
  const configuration = limited.find((node) => node.id === 'hospitality')!.children[0]!
  assert.equal(configuration.id, 'hospitality.configuration')
  assert.deepEqual(
    configuration.children.map((node) => node.id),
    ['hospitality.billingRules'],
  )
})
