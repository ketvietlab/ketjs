import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import {
  GROUPS,
  discoverTests,
  groupForModule,
  groupForTest,
  groupsForChanges,
  permissionCoverageNeeded,
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

test('permission coverage runs for anything that can declare a function', () => {
  for (const files of [
    ['packages/ketsuite/src/modules/crm/index.ts'],
    ['packages/ketsuite/src/deployment.ts'],
    ['packages/ketjs/src/kernel/permissions.ts'],
    ['package.json'],
    ['.github/workflows/verify.yml'],
    // Editing the job's own tests changes the question it asks.
    ['test/permission-bundles.test.ts'],
    ['test/ketsuite-permission-catalogue.test.ts'],
    // One inert file does not excuse the branch.
    ['packages/ketsuite/src/modules/backend/design/forms.css', 'packages/ketsuite/src/modules/crm/index.ts'],
  ])
    assert.equal(permissionCoverageNeeded(files), true, files.join(', '))
})

test('permission coverage is skipped for changes that declare nothing', () => {
  for (const files of [
    ['packages/ketsuite/src/modules/backend/design/forms.css'],
    ['packages/ketsuite/src/modules/backend/messages.ts'],
    ['packages/ketsuite/src/ui/client/table-selection-view.tsx'],
    ['packages/ketsuite/src/ui/navigation.tsx'],
    ['docs/architecture.md'],
    ['README.md'],
    ['test/ui-modal-unsaved.test.tsx'],
  ])
    assert.equal(permissionCoverageNeeded(files), false, files.join(', '))
})

test('a diff that could not be read still runs it', () => {
  // An empty list is what a broken base revision looks like, not proof that
  // nothing changed.
  assert.equal(permissionCoverageNeeded([]), true)
  assert.equal(permissionCoverageNeeded(['']), true)
})

test('the two files the skip rule trusts really do declare nothing', () => {
  // `messages.ts` being a translations record and `ui/` being components are
  // conventions, and the skip rule is only sound while they hold. Asserted
  // against the tree so the day one of them declares a function, this says so
  // rather than the gate going quietly blind.
  const declaring = /defineFn\(|defineModule\(|^\s*permissions:\s*\{|^\s*functions:\s*\{/mu
  const sources = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sources(`${directory}/${entry.name}`)
        : /\.tsx?$/u.test(entry.name)
          ? [`${directory}/${entry.name}`]
          : [],
    )
  const suspects = [
    ...sources('packages/ketsuite/src/ui'),
    ...readdirSync('packages/ketsuite/src/modules', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/ketsuite/src/modules/${entry.name}/messages.ts`)
      .filter((path) => {
        try {
          readFileSync(path)
          return true
        } catch {
          return false
        }
      }),
  ]
  assert.ok(suspects.length > 20, 'the sweep found the files it is about')
  assert.deepEqual(
    suspects.filter((path) => declaring.test(readFileSync(path, 'utf8'))),
    [],
  )
})
