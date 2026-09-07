import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compose,
  defineModule,
  projectBrowserRows,
  projectBrowserScreen,
  type KetError,
} from '@ketvietlab/ketjs'

const host = (reverseFieldOrder = false) => {
  const output = reverseFieldOrder
    ? { name: 'text' as const, id: 'id' as const }
    : { id: 'id' as const, name: 'text' as const }
  const fields = reverseFieldOrder
    ? { name: 'text' as const, id: 'id' as const }
    : { id: 'id' as const, name: 'text' as const }
  return defineModule({
    name: 'directory',
    functions: {
      list: {
        output,
        handler: () => [],
      },
    },
    browser: {
      widgets: { text: { props: { value: 'text' }, builtin: 'text' } },
      resources: {
        rows: {
          source: 'list',
          needs: 'list',
          phase: 'primary',
          key: 'id',
          fields,
        },
      },
      screens: {
        partners: {
          kind: 'list',
          contract: '1.0.0',
          primary: 'rows',
          rowKey: 'id',
          title: 'screen.title',
          columns: [
            {
              id: 'name',
              label: 'field.name',
              resource: 'rows',
              widget: 'text',
              bind: { value: 'name' },
            },
          ],
          joints: { columns: { kind: 'columns', contract: '1.0.0', multiple: true } },
        },
      },
    },
  })
}

const bridge = (overrides: Record<string, unknown> = {}) =>
  defineModule({
    name: 'balance_bridge',
    depends: ['directory'],
    assets: new URL('./fixtures/', import.meta.url),
    functions: {
      balances: {
        input: { ids: 'json' },
        output: { id: 'id', value: 'decimal', currency: 'text' },
        handler: () => [],
      },
    },
    browser: {
      widgets: {
        money: {
          props: { value: 'decimal', currency: 'text' },
          ssrBuiltin: 'money',
          client: 'money.mjs',
        },
      },
      resources: {
        balances: {
          source: 'balances',
          needs: 'balances',
          phase: 'deferred',
          key: 'id',
          fields: { id: 'id', value: 'decimal', currency: 'text' },
          batch: { input: 'ids', max: 100 },
          cache: { scope: 'context', ttlMs: 5_000 },
        },
      },
      fills: {
        'directory.partners:columns': {
          compatible: '^1.0.0',
          columns: [
            {
              id: 'balance',
              label: 'field.balance',
              resource: 'balances',
              widget: 'money',
              bind: { value: 'value', currency: 'currency' },
              operations: ['display'],
            },
          ],
        },
      },
      ...overrides,
    },
  })

const errors = (run: () => unknown): string[] => {
  try {
    run()
  } catch (error) {
    return ((error as KetError).items ?? []).map((item) => item.code)
  }
  throw new Error('expected composition to fail')
}

test('browser plan: a bridge composes without a host import and changes the revision', () => {
  const without = compose([host()])
  const withBridge = compose([bridge(), host()])
  assert.deepEqual(
    without.browser.screens['directory.partners']!.columns.map(({ id }) => id),
    ['name'],
  )
  assert.deepEqual(
    withBridge.browser.screens['directory.partners']!.columns.map(({ id }) => id),
    ['name', 'balance'],
  )
  assert.notEqual(without.browser.revision, withBridge.browser.revision)
  assert.equal(withBridge.browser.fills[0]?.by, 'balance_bridge')
  assert.equal(withBridge.browser.widgets['balance_bridge.money']?.ssrBuiltin, 'money')
})

test('browser plan: revision is canonical across declaration key order', () => {
  assert.equal(compose([host()]).browser.revision, compose([host(true)]).browser.revision)
})

test('browser plan: permission projection removes a rejected optional fetch and its widget', async () => {
  const manifest = compose([host(), bridge()])
  const plan = await projectBrowserScreen(manifest, 'directory.partners', {
    allows: (name) => name !== 'balance_bridge.balances',
    translate: (key) => `translated:${key}`,
  })
  assert.ok(plan)
  assert.deepEqual(
    plan.screen.columns.map(({ id }) => id),
    ['name'],
  )
  assert.deepEqual(Object.keys(plan.resources), ['directory.rows'])
  assert.deepEqual(Object.keys(plan.widgets), ['directory.text'])
  assert.equal(plan.resources['directory.rows']?.endpoint, undefined)
  assert.equal(plan.screen.title, 'translated:directory.screen.title')
})

test('browser plan: a separate requirement cannot expose a denied source endpoint', async () => {
  const manifest = compose([
    host(),
    bridge({
      resources: {
        balances: {
          source: 'balances',
          needs: 'directory.list',
          phase: 'deferred',
          key: 'id',
          fields: { id: 'id', value: 'decimal', currency: 'text' },
          batch: { input: 'ids', max: 100 },
        },
      },
    }),
  ])
  const plan = await projectBrowserScreen(manifest, 'directory.partners', {
    allows: (name) => name !== 'balance_bridge.balances',
  })
  assert.ok(plan)
  assert.deepEqual(
    plan.screen.columns.map(({ id }) => id),
    ['name'],
  )
  assert.ok(!Object.hasOwn(plan.resources, 'balance_bridge.balances'))
})

test('browser plan: rejecting the primary resource rejects the whole screen', async () => {
  const manifest = compose([host()])
  assert.equal(await projectBrowserScreen(manifest, 'directory.partners', { allows: () => false }), null)
})

test('browser plan: row projection cannot leak undeclared fields', () => {
  const resource = compose([host()]).browser.resources['directory.rows']!
  assert.deepEqual(projectBrowserRows(resource, [{ id: 'p1', name: 'Ada', secret: 'no' }]), [
    { id: 'p1', name: 'Ada' },
  ])
  assert.throws(() => projectBrowserRows(resource, [{ id: 'p1' }, { id: 'p1' }]), /duplicate/)
  assert.throws(() => projectBrowserRows(resource, [{ id: 1 }, { id: '1' }]), /duplicate/)
})

test('browser plan: a generic joined endpoint cannot expose undeclared output fields', () => {
  const leakyBridge = defineModule({
    name: 'leaky_bridge',
    depends: ['directory'],
    functions: {
      values: {
        input: { ids: 'json' },
        output: { id: 'id', value: 'text', secret: 'text' },
        handler: () => [],
      },
    },
    browser: {
      resources: {
        values: {
          source: 'values',
          needs: 'values',
          phase: 'deferred',
          key: 'id',
          fields: { id: 'id', value: 'text' },
          batch: { input: 'ids', max: 100 },
        },
      },
    },
  })
  assert.ok(errors(() => compose([host(), leakyBridge])).includes('E_BROWSER_RESOURCE_OUTPUT'))
})

test('browser plan: missing dependencies, resources, widgets and incompatible fills fail at compose', () => {
  const bridgeDeclaration = bridge()
  const noDependency = defineModule({
    name: 'no_dependency',
    assets: bridgeDeclaration.assets ?? undefined,
    functions: bridgeDeclaration.functions,
    browser: bridgeDeclaration.browser,
  })
  assert.ok(errors(() => compose([host(), noDependency])).includes('E_BROWSER_DEPENDENCY'))

  const badResource = bridge({
    fills: {
      'directory.partners:columns': {
        compatible: '^1.0.0',
        columns: [
          {
            id: 'ghost',
            label: 'ghost',
            resource: 'missing',
            widget: 'money',
            bind: { value: 'value', currency: 'currency' },
          },
        ],
      },
    },
  })
  assert.ok(errors(() => compose([host(), badResource])).includes('E_BROWSER_RESOURCE_MISSING'))

  const badWidget = bridge({
    fills: {
      'directory.partners:columns': {
        compatible: '^1.0.0',
        columns: [
          {
            id: 'ghost',
            label: 'ghost',
            resource: 'balances',
            widget: 'missing',
            bind: {},
          },
        ],
      },
    },
  })
  assert.ok(errors(() => compose([host(), badWidget])).includes('E_BROWSER_WIDGET_MISSING'))

  const incompatible = bridge({
    fills: {
      'directory.partners:columns': { compatible: '^2.0.0', columns: [] },
    },
  })
  assert.ok(errors(() => compose([host(), incompatible])).includes('E_BROWSER_FILL_INCOMPATIBLE'))
})

test('browser plan: duplicate column identities are a build error', () => {
  const duplicate = bridge({
    fills: {
      'directory.partners:columns': {
        compatible: '^1.0.0',
        columns: [
          {
            id: 'name',
            label: 'field.balance',
            resource: 'balances',
            widget: 'money',
            bind: { value: 'value', currency: 'currency' },
          },
        ],
      },
    },
  })
  assert.ok(errors(() => compose([host(), duplicate])).includes('E_BROWSER_COLUMN_DUPLICATE'))
})
