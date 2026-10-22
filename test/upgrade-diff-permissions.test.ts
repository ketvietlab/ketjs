import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, defineModule, diffManifests } from '@ketvietlab/ketjs'
import type { FnSpec, ModuleSpec } from '@ketvietlab/ketjs'

/**
 * An upgrade can widen who may call a function, or what a call may do, without a
 * single grant changing. The diff reported none of it: a function becoming
 * anonymous, moving from internal to HTTP, being offered to agents, gaining a
 * write effect, or a bundle granting more all produced findings = [].
 */
const models = { Order: { scope: 'company' as const, fields: { id: 'id', note: 'text?' } } }
const shop = (fn: Partial<FnSpec>, extra: Partial<ModuleSpec> = {}) =>
  compose(
    [
      defineModule({
        name: 'shop',
        models,
        functions: { place: { input: {}, effects: ['read:shop.Order'], handler: () => null, ...fn } },
        ...extra,
      }),
    ],
    { headless: true, companies: true },
  )
const codes = (before: ReturnType<typeof shop>, after: ReturnType<typeof shop>) =>
  diffManifests(before, after).map((item) => `${item.severity}:${item.code}`)

test('upgrade diff: widening who may call a function is reported', () => {
  const base = shop({ exposure: 'internal' })
  assert.deepEqual(codes(base, shop({ exposure: 'internal', anonymous: true })), ['risky:ANONYMOUS_GAINED'])
  assert.deepEqual(codes(base, shop({ exposure: 'http' })), ['risky:FUNCTION_HTTP_EXPOSED'])
  assert.deepEqual(codes(base, shop({ exposure: 'internal', agent: true })), ['risky:AGENT_GAINED'])
  assert.deepEqual(
    codes(base, shop({ exposure: 'internal', effects: ['read:shop.Order', 'write:shop.Order'] })),
    ['risky:EFFECTS_WIDENED'],
  )
  assert.deepEqual(codes(base, shop({ exposure: 'internal' })), [], 'an unchanged function has no findings')
})

test('upgrade diff: a new anonymous function and a widened bundle are reported', () => {
  const handler = () => null
  const permissions = (grants: string[]) => ({
    posture: 'permission-bearing' as const,
    owner: 'shop',
    bundles: { 'shop.view': { labels: { en: 'View shop' } } },
    functions: Object.fromEntries(
      grants.map((fn) => [fn, { risk: 'read' as const, bundles: ['shop.view'], owner: 'shop' }]),
    ),
    exemptions: {},
  })
  const before = compose(
    [
      defineModule({
        name: 'shop',
        functions: { list: { handler } },
        permissions: permissions(['shop.list']),
      }),
    ],
    { headless: true, companies: true },
  )
  const after = compose(
    [
      defineModule({
        name: 'shop',
        functions: { list: { handler }, export: { handler }, hook: { anonymous: true, handler } },
        permissions: {
          ...permissions(['shop.list', 'shop.export']),
          exemptions: { 'shop.hook': { reason: 'anonymous', authority: 'signed webhook' } },
        },
      }),
    ],
    { headless: true, companies: true },
  )
  assert.deepEqual(codes(before, after).sort(), ['risky:BUNDLE_WIDENED', 'risky:FUNCTION_ADDED_ANONYMOUS'])
  assert.match(
    diffManifests(before, after).find((item) => item.code === 'BUNDLE_WIDENED')?.message ?? '',
    /shop\.view.*shop\.export/,
  )
})
