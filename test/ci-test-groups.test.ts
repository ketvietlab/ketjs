import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GROUPS,
  discoverTests,
  groupForModule,
  groupForTest,
  groupsForChanges,
} from '../tools/ci-test-groups.mjs'

test('discovers every test in exactly one group', () => {
  const discovered = GROUPS.flatMap((group) => discoverTests(group))
  assert.equal(new Set(discovered).size, discovered.length)
  assert.ok(discovered.includes('test/ci-test-groups.test.ts'))
  assert.ok(discovered.length > 100)
})

test('classifies modules and tests without a maintained file inventory', () => {
  assert.equal(groupForModule('product_variant_activity_backend'), 'catalog')
  assert.equal(groupForModule('website_hospitality'), 'website')
  assert.equal(groupForModule('future_framework_module'), 'framework')
  assert.equal(groupForTest('test/product-new-behavior.test.ts'), 'catalog')
  assert.equal(groupForTest('test/future-framework.test.tsx'), 'framework')
})

test('selects changed domains and ignores documentation', () => {
  assert.deepEqual(
    groupsForChanges([
      'packages/ketsuite/src/modules/product/src/index.ts',
      'packages/ketsuite/src/modules/sale_backend/src/index.ts',
      'docs/src/content/docs/ketsuite/product.md',
    ]),
    ['catalog', 'orders'],
  )
})

test('selects every group for shared or unknown code', () => {
  assert.deepEqual(groupsForChanges(['packages/ketjs/src/engine.ts']), GROUPS)
  assert.deepEqual(groupsForChanges(['tools/build.mjs']), GROUPS)
  assert.deepEqual(groupsForChanges(['packages/ketsuite/src/modules/new_domain/index.ts']), GROUPS)
})

test('selects no test groups for documentation-only changes', () => {
  assert.deepEqual(groupsForChanges(['README.md', 'docs/src/content/docs/ketjs/testing.md']), [])
})
