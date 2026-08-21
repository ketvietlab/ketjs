import { test } from 'node:test'
import assert from 'node:assert/strict'
import { type KetError, compose, defineModule, defineTheme, diffManifests } from '@ketvietlab/ketjs'

const base = defineModule({
  name: 'base',
  models: { Thing: { scope: 'shared', fields: { id: 'id', title: 'text' } } },
  joints: { 'thing.footer': {} },
})

const fails = (fn: () => unknown): KetError => {
  try {
    fn()
  } catch (e) {
    return e as KetError
  }
  throw new Error('expected a contract violation, got none')
}
const codes = (e: KetError): string[] => (e.items ?? []).map((i) => i.code)

test('lego: a module adds a typed field to another module model, with provenance', () => {
  const ext = defineModule({ name: 'ext', depends: ['base'], extend: { 'base.Thing': { extra: 'int?' } } })
  const m = compose([base, ext])
  const f = m.models['base.Thing']!.fields
  assert.equal(f.extra!.base, 'int')
  assert.equal(f.extra!.optional, true)
  assert.equal(f.extra!.by, 'ext') // who contributed it is recorded
  assert.equal(f.title!.by, 'base')
})

test('lego: filling a joint nobody published is a build error, not a blank spot', () => {
  const bad = defineModule({ name: 'bad', depends: ['base'], fills: { 'base:thing.header': '<b>x</b>' } })
  const e = fails(() => compose([base, bad]))
  assert.ok(codes(e).includes('E_FILL_UNKNOWN_JOINT'))
  assert.match(e.items![0]!.hint!, /published joints/)
})

test('lego: extending a model you do not depend on is refused', () => {
  const sneaky = defineModule({ name: 'sneaky', extend: { 'base.Thing': { x: 'int?' } } })
  assert.ok(codes(fails(() => compose([base, sneaky]))).includes('E_EXTEND_NOT_DEPENDED'))
})

test('lego: two modules cannot contribute the same field name', () => {
  const a = defineModule({ name: 'a', depends: ['base'], extend: { 'base.Thing': { note: 'text?' } } })
  const b = defineModule({ name: 'b', depends: ['base'], extend: { 'base.Thing': { note: 'text?' } } })
  const e = fails(() => compose([base, a, b]))
  assert.ok(codes(e).includes('E_FIELD_COLLISION'))
  assert.match(e.items![0]!.message, /already contributed by "a"/)
})

test('lego: a field added to somebody else model must be optional', () => {
  const a = defineModule({ name: 'a', depends: ['base'], extend: { 'base.Thing': { qty: 'int' } } })
  assert.ok(codes(fails(() => compose([base, a]))).includes('E_EXTEND_REQUIRES_OPTIONAL'))
})

test('lego: dependency cycles are named, not hung on', () => {
  const x = defineModule({ name: 'x', depends: ['y'] })
  const y = defineModule({ name: 'y', depends: ['x'] })
  const e = fails(() => compose([x, y])) as KetError
  assert.equal(e.code, 'E_DEPENDENCY_CYCLE')
  assert.match(e.message, /x -> y -> x|y -> x -> y/)
})

test('lego: composition order is deterministic', () => {
  const a = defineModule({ name: 'aa', depends: ['base'] })
  const b = defineModule({ name: 'bb', depends: ['base'] })
  assert.deepEqual(compose([a, b, base]).order, compose([b, base, a]).order)
})

test('theming: a theme may not declare models or server functions', () => {
  const e = fails(() =>
    defineTheme({ name: 't', models: { X: { scope: 'shared', fields: { id: 'id' } } } }),
  ) as KetError
  assert.equal(e.code, 'E_THEME_OVERREACH')
})

test('theming: app requires a region no theme provides -> build error', () => {
  const needsUi = defineModule({ name: 'ui', requires: ['layout'] })
  assert.ok(codes(fails(() => compose([needsUi]))).includes('E_REGION_MISSING'))
})

test('theming: view models cannot expose fields that do not exist', () => {
  const v = defineModule({
    name: 'v',
    depends: ['base'],
    views: { t: { of: 'base.Thing', fields: ['title', 'ghost'] } },
  })
  const e = fails(() => compose([base, v]))
  assert.ok(codes(e).includes('E_VIEW_UNKNOWN_FIELD'))
  assert.match(e.items![0]!.hint!, /available: id, title/)
})

test('upgrade diff: a removed joint names who was standing on it', () => {
  const filler = defineModule({ name: 'filler', depends: ['base'], fills: { 'base:thing.footer': 'x' } })
  const before = compose([base, filler])
  const base2 = defineModule({
    name: 'base',
    version: '2.0.0',
    models: { Thing: { scope: 'shared', fields: { id: 'id', title: 'text' } } },
  })
  const after = { ...compose([base2]), fills: before.fills }
  const items = diffManifests(before, after)
  const j = items.find((i) => i.code === 'JOINT_REMOVED')!
  assert.equal(j.severity, 'breaking')
  assert.match(j.hint!, /still filled by: filler/)
})

test('upgrade diff: a removed field names the view that reads it', () => {
  const v = defineModule({
    name: 'v',
    depends: ['base'],
    views: { t: { of: 'base.Thing', fields: ['title'] } },
  })
  const before = compose([base, v])
  const base2 = defineModule({ name: 'base', models: { Thing: { scope: 'shared', fields: { id: 'id' } } } })
  const v2 = defineModule({
    name: 'v',
    depends: ['base'],
    views: { t: { of: 'base.Thing', fields: ['id'] } },
  })
  const after = compose([base2, v2])
  after.views['v.t'] = { of: 'base.Thing', fields: ['title'], by: 'v' }
  const f = diffManifests(before, after).find((i) => i.code === 'FIELD_REMOVED')!
  assert.match(f.hint!, /read by view/)
})

test('errors carry a code and a hint, so an agent can act on them', () => {
  const e = fails(() =>
    compose([base, defineModule({ name: 'z', depends: ['base'], fills: { 'base:nope': 'x' } })]),
  )
  const d = e.items![0]!
  assert.equal(typeof d.code, 'string')
  assert.equal(typeof d.hint, 'string')
  assert.equal(d.module, 'z')
})

test('lego: a required reference to one own model is a contradiction, and is refused', () => {
  const tree = defineModule({
    name: 'tree',
    models: { Node: { scope: 'shared', fields: { id: 'id', parentId: 'ref:tree.Node' } } },
  })
  const e = fails(() => compose([tree]))
  assert.ok(codes(e).includes('E_SELF_REF_REQUIRED'))
  assert.match(e.items![0]!.hint!, /the first row could never satisfy it/)
})
