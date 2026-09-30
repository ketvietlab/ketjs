import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { assembleFunctions, functions } from '../packages/ketsuite/src/modules/flow/functions/index.ts'
import * as flowPublic from '../packages/ketsuite/src/modules/flow/index.ts'

// Captured from origin/integration 0a718a1d before the capability refactor.
// Do not regenerate just to make a descriptor change pass: review the API/permission change.
const baseline = JSON.parse(readFileSync('test/fixtures/flow/function-contracts.json', 'utf8'))

test('Flow keeps every registered key and complete non-handler descriptor from the pre-refactor baseline', () => {
  const descriptors = Object.fromEntries(
    Object.entries(functions).map(([key, { handler, ...spec }]) => {
      assert.ok(handler.name.endsWith('Handler'), `${key} must use a named handler`)
      return [key, spec]
    }),
  )
  assert.deepEqual(JSON.parse(JSON.stringify(descriptors)), baseline)
  assert.deepEqual(flowPublic.default.functions, functions)
})

test('Flow assembly refuses duplicate keys before a capability can overwrite another', () => {
  const first = { 'issue.save': functions['issue.save']! }
  const second = { 'issue.save': functions['issue.move']! }
  assert.throws(() => assembleFunctions([first, second]), /Duplicate Flow function: issue.save/)
  assert.equal(assembleFunctions([first])['issue.save'], first['issue.save'])
})

test('Flow domain exports remain available to transactional consumers after removing operations.ts', () => {
  for (const name of [
    'addComment',
    'addDependency',
    'assignSprint',
    'closeSprint',
    'commandRecordId',
    'groupIssues',
    'issueDetail',
    'listIssues',
    'moveIssue',
    'saveIssue',
    'startSprint',
  ] as const)
    assert.equal(typeof flowPublic[name], 'function', name)
  assert.equal(flowPublic.FIELD_FILTER_MATCHES, 900)
})
