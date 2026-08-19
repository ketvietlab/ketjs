import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn, compose, defineFn, defineModule, eq, from, migrateOne,
  registerFunctions, sqliteAdapter,
} from 'ketjs'
import type { Adapter, Ctx, KetError, Row } from 'ketjs'

/** Every request acts as some company; these tests act as one. */
const SCOPE = { company: 'acme', branches: null }

/**
 * The shape product will use: a template with many variants, each variant pointing
 * back. Declared once, on the module that owns both.
 */
const product = defineModule({
  name: 'product',
  models: {
    Template: { scope: 'shared', fields: { id: 'id', name: 'text' } },
    Product: { scope: 'shared', fields: { id: 'id', templateId: 'ref:product.Template', sku: 'text' } },
  },
  relations: {
    'product.Template': { variants: { hasMany: 'product.Product', by: 'templateId' } },
    'product.Product': { template: { belongsTo: 'product.Template', by: 'templateId' } },
  },
  functions: {
    templates: defineFn({
      input: { withVariants: 'bool?' },
      effects: ['read:product.Template', 'read:product.Product'],
      handler: async (ctx: Ctx, a) => {
        const T = ctx.table('product.Template')
        const q = from(T)
        return ctx.db.all(a.withVariants === true ? q.preload('variants') : q)
      },
    }),
    variants: defineFn({
      input: {},
      effects: ['read:product.Product', 'read:product.Template'],
      handler: async (ctx: Ctx) => ctx.db.all(from(ctx.table('product.Product')).preload('template')),
    }),
    undeclared: defineFn({
      input: {},
      effects: ['read:product.Template'],
      handler: async (ctx: Ctx) => ctx.db.all(from(ctx.table('product.Template')).preload('variants')),
    }),
    ghost: defineFn({
      input: {},
      effects: ['read:product.Template'],
      handler: async (ctx: Ctx) => ctx.db.all(from(ctx.table('product.Template')).preload('nowhere')),
    }),
  },
})

const manifest = compose([product], { headless: true })

async function boot(): Promise<Adapter> {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions([product])
  await db.run('INSERT INTO product_template (id, name) VALUES (?, ?)', ['t1', 'Áo thun'])
  await db.run('INSERT INTO product_template (id, name) VALUES (?, ?)', ['t2', 'Quần'])
  for (const [id, t, sku] of [['p1', 't1', 'AO-S'], ['p2', 't1', 'AO-M'], ['p3', 't2', 'QU-32']]) {
    await db.run('INSERT INTO product_product (id, "templateId", sku) VALUES (?, ?, ?)', [id, t, sku])
  }
  return db
}

const fails = (fn: () => unknown): KetError => {
  try { fn() } catch (e) { return e as KetError }
  throw new Error('expected a contract violation')
}

test('relations: declared, and composed with the module that declared them', () => {
  assert.deepEqual(manifest.relations['product.Template']!.variants,
    { kind: 'hasMany', target: 'product.Product', by: 'templateId', declaredBy: 'product' })
  assert.equal(manifest.relations['product.Product']!.template!.kind, 'belongsTo')
})

test('relations: a key that does not exist is a build error, not an empty result', () => {
  const typo = defineModule({
    name: 'typo',
    models: { A: { scope: 'shared', fields: { id: 'id' } }, B: { scope: 'shared', fields: { id: 'id', aId: 'ref:typo.A' } } },
    relations: { 'typo.A': { bs: { hasMany: 'typo.B', by: 'a_id' } } },
  })
  const e = fails(() => compose([typo], { headless: true }))
  assert.match(e.message, /E_RELATION_NO_KEY/)
  assert.match(e.message, /travels on "typo.B.a_id", which does not exist/)
})

test('relations: reaching a module you do not depend on is refused', () => {
  const outsider = defineModule({
    name: 'outsider',
    models: { X: { scope: 'shared', fields: { id: 'id', templateId: 'text' } } },
    relations: { 'outsider.X': { t: { belongsTo: 'product.Template', by: 'templateId' } } },
  })
  assert.match(fails(() => compose([product, outsider], { headless: true })).message, /E_RELATION_NOT_DEPENDED/)
})

test('relations: a shared model may not reach a company-scoped one', () => {
  const leaky = defineModule({
    name: 'leaky',
    models: {
      Public: { scope: 'shared', fields: { id: 'id' } },
      Private: { scope: 'company', fields: { id: 'id', publicId: 'ref:leaky.Public' } },
    },
    relations: { 'leaky.Public': { privates: { hasMany: 'leaky.Private', by: 'publicId' } } },
  })
  const e = fails(() => compose([leaky], { headless: true }))
  assert.match(e.message, /E_RELATION_WIDENS_SCOPE/)
  assert.match(e.message, /a shared row would expose rows of every company/)
})

test('preload: hasMany costs two queries, never one per row', async () => {
  const db = await boot()
  let queries = 0
  const counting = { ...db, all: (s: string, p?: unknown[]) => { if (s.startsWith('SELECT')) queries++; return db.all(s, p) } }

  const rows = (await callFn('product.templates', { withVariants: true }, { adapter: counting, manifest, scope: SCOPE })).value as Row[]
  assert.equal(queries, 2, 'the parents, then the children by id — not one query per template')

  const t1 = rows.find(r => r.id === 't1')!
  assert.deepEqual((t1.variants as Row[]).map(v => v.sku).sort(), ['AO-M', 'AO-S'])
  assert.deepEqual((rows.find(r => r.id === 't2')!.variants as Row[]).map(v => v.sku), ['QU-32'])
  await db.close()
})

test('preload: belongsTo attaches the parent to each child', async () => {
  const db = await boot()
  const rows = (await callFn('product.variants', {}, { adapter: db, manifest, scope: SCOPE })).value as Row[]
  assert.equal((rows.find(r => r.id === 'p1')!.template as Row).name, 'Áo thun')
  assert.equal((rows.find(r => r.id === 'p3')!.template as Row).name, 'Quần')
  await db.close()
})

test('preload: a parent with no children gets an empty list, not undefined', async () => {
  const db = await boot()
  await db.run('INSERT INTO product_template (id, name) VALUES (?, ?)', ['t3', 'Mũ'])
  const rows = (await callFn('product.templates', { withVariants: true }, { adapter: db, manifest, scope: SCOPE })).value as Row[]
  assert.deepEqual(rows.find(r => r.id === 't3')!.variants, [])
  await db.close()
})

test('preload: reading the far side needs a declared effect, like any other read', async () => {
  const db = await boot()
  await assert.rejects(
    () => callFn('product.undeclared', {}, { adapter: db, manifest, scope: SCOPE }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_EFFECT_NOT_DECLARED')
      assert.match((e as Error).message, /read on product\.Product/)
      return true
    })
  await db.close()
})

test('preload: asking for a relation nobody declared says which exist', async () => {
  const db = await boot()
  await assert.rejects(
    () => callFn('product.ghost', {}, { adapter: db, manifest, scope: SCOPE }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_UNKNOWN_RELATION')
      assert.match((e as { hint: string }).hint, /declared: variants/)
      return true
    })
  await db.close()
})

test('preload: children go through the scope, so a relation is not a way around it', async () => {
  const scoped = defineModule({
    name: 'shop',
    models: {
      Order: { scope: 'company', fields: { id: 'id', ref: 'text' } },
      Line: { scope: 'company', fields: { id: 'id', orderId: 'ref:shop.Order', qty: 'int' } },
    },
    relations: { 'shop.Order': { lines: { hasMany: 'shop.Line', by: 'orderId' } } },
    functions: {
      orders: defineFn({
        input: {},
        effects: ['read:shop.Order', 'read:shop.Line'],
        handler: async (ctx: Ctx) => ctx.db.all(from(ctx.table('shop.Order')).preload('lines')),
      }),
      seed: defineFn({
        input: { order: 'id', line: 'id' },
        effects: ['write:shop.Order', 'write:shop.Line'],
        handler: async (ctx: Ctx, a) => {
          await ctx.db.insert('shop.Order', { id: a.order, ref: String(a.order) } as Row)
          await ctx.db.insert('shop.Line', { id: a.line, orderId: a.order, qty: 1 } as Row)
        },
      }),
    },
  })
  const m = compose([scoped], { headless: true })
  const db = sqliteAdapter(); await db.open(); await migrateOne(db, m); registerFunctions([scoped])

  await callFn('shop.seed', { order: 'o-a', line: 'l-a' }, { adapter: db, manifest: m, scope: { company: 'acme' } })
  await callFn('shop.seed', { order: 'o-b', line: 'l-b' }, { adapter: db, manifest: m, scope: { company: 'globex' } })

  // Hand-place a line of globex under an order of acme: the relation would carry it
  // across if the child query were not scoped too.
  await db.run('UPDATE shop_line SET "orderId" = ? WHERE id = ?', ['o-a', 'l-b'])

  const acme = (await callFn('shop.orders', {}, { adapter: db, manifest: m, scope: { company: 'acme' } })).value as Row[]
  assert.deepEqual((acme[0]!.lines as Row[]).map(l => l.id), ['l-a'],
    'the other company\'s row does not arrive through the relation')
  await db.close()
})
