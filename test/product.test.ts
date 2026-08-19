import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  defineModule,
  migrateOne,
  registerFunctions,
  restrictManifest,
  sqliteAdapter,
  translator,
} from 'ketjs'
import type { Adapter, KetError, Row } from 'ketjs'
import { product, uom } from 'ketsuite'

/** Products are shared master data, so the company in scope should not matter. */
const SCOPE = { company: 'acme', branches: null }
const OTHER = { company: 'globex', branches: null }

const manifest = compose([uom, product], { headless: true })
const call = (fn: string, args: Record<string, unknown>, db: Adapter, scope = SCOPE) =>
  callFn(fn, args, { adapter: db, manifest, scope })

async function boot(): Promise<Adapter> {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions([uom, product])
  return db
}

test('product: the type vocabulary is product-shaped, not stock-shaped', async () => {
  const db = await boot()
  for (const type of ['goods', 'service']) {
    const r = await call('product.saveTemplate', { id: `t-${type}`, name: type, type }, db)
    assert.equal((r.value as { ok: boolean }).ok, true)
  }
  const bad = await call('product.saveTemplate', { id: 't-x', name: 'X', type: 'storable' }, db)
  const v = bad.value as { ok: boolean; errors: Array<{ field: string; message: string }> }
  assert.equal(v.ok, false)
  assert.match(v.errors[0]!.message, /phải là một trong: goods, service/)
  await db.close()
})

test('product: stock extends the template rather than the type enum carrying its concern', () => {
  const stock = defineModule({
    name: 'stock',
    depends: ['product'],
    extend: { 'product.Template': { tracked: 'bool?' } },
  })
  const withStock = compose([uom, product, stock], { headless: true })
  const fields = withStock.models['product.Template']!.fields
  assert.equal(fields.tracked!.by, 'stock')
  assert.equal(fields.type!.by, 'product')

  // And without stock installed the template still means something.
  assert.equal('tracked' in manifest.models['product.Template']!.fields, false)
  assert.equal(manifest.models['product.Template']!.fields.type!.by, 'product')
})

test('product: a template carries its variants, on request', async () => {
  const db = await boot()
  await call('product.saveTemplate', { id: 'tpl', name: 'Áo thun', type: 'goods' }, db)
  await call('product.saveVariant', { id: 'v-s', templateId: 'tpl', sku: 'AO-S' }, db)
  await call('product.saveVariant', { id: 'v-m', templateId: 'tpl', sku: 'AO-M' }, db)

  const bare = (await call('product.listTemplates', {}, db)).value as Row[]
  assert.equal(bare[0]!.variants, undefined, 'nothing arrives unless it was asked for')

  const full = (await call('product.listTemplates', { withVariants: true }, db)).value as Row[]
  assert.deepEqual((full[0]!.variants as Row[]).map((v) => v.sku).sort(), ['AO-M', 'AO-S'])
  await db.close()
})

test('product: a variant without a template is refused, not stored as an orphan', async () => {
  const db = await boot()
  const r = await call('product.saveVariant', { id: 'v1', templateId: 'nowhere', sku: 'X' }, db)
  const v = r.value as { ok: boolean; errors: Array<{ field: string }> }
  assert.equal(v.ok, false)
  assert.equal(v.errors[0]!.field, 'templateId')
  assert.equal((await db.all('SELECT * FROM product_product', [])).length, 0)
  await db.close()
})

test('product: master data is shared, so another company sees the same catalogue', async () => {
  const db = await boot()
  await call('product.saveTemplate', { id: 'tpl', name: 'Cà phê', type: 'goods' }, db, SCOPE)
  const seenByOther = (await call('product.listTemplates', {}, db, OTHER)).value as Row[]
  assert.deepEqual(
    seenByOther.map((t) => t.name),
    ['Cà phê'],
  )

  const cols = (await db.introspect())['product_template']!
  assert.equal('companyId' in cols, false, 'shared data carries no company column at all')
  await db.close()
})

test('product: categories nest, and a category cannot parent itself', async () => {
  const db = await boot()
  await call('product.saveCategory', { id: 'root', name: 'Đồ uống' }, db)
  await call('product.saveCategory', { id: 'hot', name: 'Nóng', parentId: 'root' }, db)
  await call('product.saveCategory', { id: 'cold', name: 'Lạnh', parentId: 'root' }, db)

  const cats = (await call('product.listCategories', {}, db)).value as Row[]
  const root = cats.find((c) => c.id === 'root')!
  assert.deepEqual((root.children as Row[]).map((c) => c.name).sort(), ['Lạnh', 'Nóng'])

  const loop = await call('product.saveCategory', { id: 'root', name: 'Đồ uống', parentId: 'root' }, db)
  assert.equal((loop.value as { ok: boolean }).ok, false)
  await db.close()
})

test('product: a template carries its category, and the category its children', async () => {
  const db = await boot()
  await call('product.saveCategory', { id: 'c1', name: 'Áo' }, db)
  await call('product.saveTemplate', { id: 'tpl', name: 'Áo thun', type: 'goods', categoryId: 'c1' }, db)
  const t = (await call('product.getTemplate', { id: 'tpl' }, db)).value as Row
  assert.equal((t.category as Row).name, 'Áo')
  assert.deepEqual(t.variants, [])
  await db.close()
})

test('product: archiving hides a template without deleting anything', async () => {
  const db = await boot()
  await call('product.saveTemplate', { id: 'tpl', name: 'Cũ', type: 'goods' }, db)
  await call('product.archiveTemplate', { id: 'tpl', active: false }, db)

  assert.equal(((await call('product.listTemplates', {}, db)).value as Row[]).length, 0)
  assert.equal((await db.all('SELECT * FROM product_template', [])).length, 1, 'the row is still there')

  await call('product.archiveTemplate', { id: 'tpl', active: true }, db)
  assert.equal(((await call('product.listTemplates', {}, db)).value as Row[]).length, 1)
  await db.close()
})

test('product: a variant is defined by attribute values through an explicit join', async () => {
  const db = await boot()
  await call('product.saveTemplate', { id: 'tpl', name: 'Áo', type: 'goods' }, db)
  await call('product.saveVariant', { id: 'v1', templateId: 'tpl', sku: 'AO-DO-M' }, db)
  await db.run('INSERT INTO product_attribute (id, name) VALUES (?, ?)', ['a-color', 'Màu'])
  await db.run('INSERT INTO product_attribute_value (id, "attributeId", name) VALUES (?, ?, ?)', [
    'av-red',
    'a-color',
    'Đỏ',
  ])
  await db.run('INSERT INTO product_product_value (id, "productId", "attributeValueId") VALUES (?, ?, ?)', [
    'pv1',
    'v1',
    'av-red',
  ])

  assert.deepEqual(manifest.relations['product.Product']!.values, {
    kind: 'hasMany',
    target: 'product.ProductValue',
    by: 'productId',
    declaredBy: 'product',
  })
  const rows = await db.all('SELECT * FROM product_product_value', [])
  assert.equal(rows.length, 1, 'the join is a model you can see, query and migrate')
  await db.close()
})

test('product: the type labels are translated, the data is not', () => {
  for (const [locale, goods] of [
    ['vi', 'Hàng hoá'],
    ['en', 'Goods'],
  ] as const) {
    assert.equal(translator(manifest, locale)('product.type.goods'), goods)
  }
  // The stored value stays a stable key; only its label moves between languages.
  assert.equal(manifest.models['product.Template']!.fields.type!.base, 'text')
})

test('product: switching the app off takes its functions with it, not its rows', async () => {
  const db = await boot()
  await call('product.saveTemplate', { id: 'tpl', name: 'Áo', type: 'goods' }, db)
  const off = restrictManifest(manifest, new Set<string>())
  await assert.rejects(
    () => callFn('product.listTemplates', {}, { adapter: db, manifest: off, scope: SCOPE }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_APP_NOT_INSTALLED')
      return true
    },
  )
  assert.equal((await db.all('SELECT * FROM product_template', [])).length, 1)
  await db.close()
})

test('product: a required self-reference would have been refused', () => {
  const broken = defineModule({
    name: 'broken',
    models: { Node: { scope: 'shared', fields: { id: 'id', parentId: 'ref:broken.Node' } } },
  })
  const e = (() => {
    try {
      compose([broken], { headless: true })
    } catch (err) {
      return err as KetError
    }
  })()!
  assert.match(e.message, /E_SELF_REF_REQUIRED/)
  // which is why product.Category declares its parent optional
  assert.equal(manifest.models['product.Category']!.fields.parentId!.optional, true)
})

test('product: a page of templates, and a count that filters the same way', async () => {
  const db = await boot()
  for (let i = 0; i < 7; i++) {
    await call(
      'product.saveTemplate',
      { id: `t${i}`, name: `${i % 2 ? 'Xoài' : 'Nhãn'} ${String(i).padStart(2, '0')}`, type: 'goods' },
      db,
    )
  }
  const page = async (o: Record<string, unknown>) =>
    ((await call('product.listTemplates', o, db)).value as Array<{ name: string }>).map((r) => r.name)

  assert.deepEqual(await page({ limit: 3 }), ['Nhãn 00', 'Nhãn 02', 'Nhãn 04'], 'ordered by name, first page')
  assert.deepEqual(
    await page({ limit: 3, offset: 3 }),
    ['Nhãn 06', 'Xoài 01', 'Xoài 03'],
    'the second page starts where the first stopped — no row shown twice, none skipped',
  )
  assert.deepEqual(await page({ limit: 3, offset: 6 }), ['Xoài 05'], 'the last page is short')

  const total = ((await call('product.countTemplates', {}, db)).value as { count: number }).count
  assert.equal(total, 7, 'the count ignores the limit')

  // The bug this guards: a count that filters differently from the list it counts.
  assert.deepEqual(await page({ search: 'Xoài' }), ['Xoài 01', 'Xoài 03', 'Xoài 05'])
  assert.equal(
    ((await call('product.countTemplates', { search: 'Xoài' }, db)).value as { count: number }).count,
    3,
  )
})
