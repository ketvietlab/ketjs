import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, composeWorkspace, defineDeployment, defineModule } from '@ketvietlab/ketjs'
import type { KetModule, ModuleSpec } from '@ketvietlab/ketjs'

/**
 * Declarations that composed without complaint and then misbehaved: a scoped
 * model spelling its own companyId, a field named __proto__ that vanished, a
 * function name with a space in its URL, menus hanging under each other so none
 * of them rendered, and a second deployment silently replacing a first.
 */
const codes = (run: () => unknown): string[] => {
  try {
    run()
    return []
  } catch (error) {
    return ((error as { items?: Array<{ code: string }> }).items ?? []).map((item) => item.code)
  }
}
const one = (spec: ModuleSpec) =>
  codes(() => compose([defineModule(spec)], { headless: true, companies: true }))

test('compose validation: a scoped model cannot declare its own tenant columns', () => {
  assert.deepEqual(
    one({ name: 'notes', models: { Note: { scope: 'company', fields: { id: 'id', companyId: 'text?' } } } }),
    ['E_SCOPE_FIELD_RESERVED'],
  )
  assert.deepEqual(
    one({
      name: 'notes',
      models: { Note: { scope: 'company+branch', fields: { id: 'id', branchId: 'text' } } },
    }),
    ['E_SCOPE_FIELD_RESERVED'],
  )
  assert.deepEqual(
    one({
      name: 'auth',
      models: { Membership: { scope: 'shared', fields: { id: 'id', companyId: 'text' } } },
    }),
    [],
    'a shared model may still name a company',
  )
})

test('compose validation: a field name is a plain identifier', () => {
  const fields = (name: string) => JSON.parse(`{"id":"id","${name}":"text?"}`) as Record<string, string>
  for (const name of ['__proto__', 'constructor', 'has space', 'a-b', '1st'])
    assert.deepEqual(
      one({ name: 'notes', models: { Note: { scope: 'shared', fields: fields(name) } } }),
      ['E_FIELD_NAME'],
      name,
    )
  const base = defineModule({ name: 'base', models: { Thing: { scope: 'shared', fields: { id: 'id' } } } })
  const extension = (name: string) =>
    defineModule({
      name: 'ext',
      depends: ['base'],
      extend: { 'base.Thing': JSON.parse(`{"${name}":"text?"}`) } as never,
    })
  assert.deepEqual(
    codes(() => compose([base, extension('__proto__')], { headless: true, companies: true })),
    ['E_FIELD_NAME'],
  )
  assert.deepEqual(
    codes(() => compose([base, extension('toString')], { headless: true, companies: true })),
    [],
    'not a collision',
  )
})

test('compose validation: a function name may have dots but no spaces', () => {
  const fn = { input: {}, effects: [], handler: () => null }
  assert.deepEqual(one({ name: 'flow', functions: { 'screen.list': fn, 'screen.help-text': fn } }), [])
  for (const name of ['has space', 'a/b', '.lead', 'trail.', 'a..b'])
    assert.deepEqual(one({ name: 'flow', functions: { [name]: fn } }), ['E_FUNCTION_NAME'], name)
})

test('compose validation: menus hanging under each other in a cycle are refused', () => {
  assert.deepEqual(
    one({
      name: 'nav',
      menus: {
        a: { label: 'A', parent: 'c' },
        b: { label: 'B', parent: 'a' },
        c: { label: 'C', parent: 'b' },
        d: { label: 'D', parent: 'a' },
        root: { label: 'Root' },
      },
    }),
    ['E_MENU_CYCLE'],
  )
  assert.deepEqual(one({ name: 'nav', menus: { a: { label: 'A', parent: 'a' } } }), ['E_MENU_CYCLE'])
})

test('compose validation: two deployments cannot share a name', () => {
  const app = defineModule({ name: 'app' }) as KetModule
  const deployment = defineDeployment({ name: 'erp', modules: [app], headless: true, companies: true })
  assert.deepEqual(
    codes(() => composeWorkspace([deployment, deployment])),
    ['E_DEPLOYMENT_DUPLICATE'],
  )
})
