import test from 'node:test'
import assert from 'node:assert/strict'
import {
  registerFlowExtension,
  flowExtensions,
  extensionRoutes,
  extensionErrors,
} from '@ketvietlab/flow-client/extensions.mjs'
import { routes } from '@ketvietlab/flow-client/routes.mjs'
const create = () => ({})
test('invalid registration is atomic and cannot shadow a core route, another extension or an error', () => {
  for (const extension of [
    { name: 'bad-tab', create, routes: { probe: { tab: { group: 'invalid' } } } },
    { name: 'twice', create, routes: { probe: {} }, forms: { probe: {} } },
    { name: 'shadow', create, routes: { 'my-work': {} } },
    { name: 'no-factory' },
  ])
    assert.throws(() => registerFlowExtension(extension))
  assert.equal(flowExtensions().length, 0)
  assert.equal(routes.probe, undefined)
  assert.deepEqual(extensionRoutes, {})
  registerFlowExtension({
    name: 'first',
    create,
    routes: { probe: { title: 'Probe', pattern: 'workspace' } },
    errors: { privateCode: 'probe.error' },
  })
  assert.throws(() =>
    registerFlowExtension({ name: 'second', create, errors: { privateCode: 'other.error' } }),
  )
  assert.throws(() => registerFlowExtension({ name: 'second', create, routes: { probe: {} } }))
  assert.throws(() => registerFlowExtension({ name: 'first', create }))
  assert.equal(extensionErrors.privateCode, 'probe.error')
  const returned = flowExtensions()
  returned.length = 0
  assert.equal(flowExtensions().length, 1)
})
