import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
  translator,
} from '@ketvietlab/ketjs'
import type { Adapter, KetError, Row } from '@ketvietlab/ketjs'
import { product, uom } from '@ketvietlab/ketsuite'

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
  assert.deepEqual((full[0]!.variants as Row[]).map((v) => v.defaultCode).sort(), ['AO-M', 'AO-S'])
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
  await call('product.saveAttribute', { id: 'a-color', name: 'Màu' }, db)
  await call('product.saveAttributeValue', { id: 'av-red', attributeId: 'a-color', name: 'Đỏ' }, db)
  await call(
    'product.saveAttributeLine',
    { id: 'tpl:color', templateId: 'tpl', attributeId: 'a-color', valueIds: ['av-red'] },
    db,
  )
  await call('product.generateVariants', { templateId: 'tpl' }, db)

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

test('product: list, count and database grouping share the same URL filter state', async () => {
  const db = await boot()
  for (const row of [
    { id: 'g1', name: 'Desk', type: 'goods', listPrice: 100 },
    { id: 'g2', name: 'Door', type: 'goods', listPrice: 30 },
    { id: 's1', name: 'Design', type: 'service', listPrice: 200 },
  ])
    await call('product.saveTemplate', row, db)
  const state = {
    q: 'd',
    presets: [],
    filters: [{ kind: 'rule', field: 'listPrice', operator: 'gte', value: 50 }],
    groupBy: [{ key: 'type' }],
    sort: [{ key: 'name', dir: 'asc' }],
    openGroups: [],
    groupPages: {},
    page: 1,
    includeArchived: false,
  }
  const rows = (await call('product.listTemplates', { state }, db)).value as Row[]
  const count = (await call('product.countTemplates', { state }, db)).value as { count: number }
  const groups = (await call('product.groupTemplates', { state, timezone: 'Asia/Ho_Chi_Minh' }, db))
    .value as Array<{
    key: unknown[]
    count: number
  }>
  assert.deepEqual(
    rows.map((row) => row.id),
    ['s1', 'g1'],
  )
  assert.equal(count.count, 2)
  assert.deepEqual(groups, [
    { key: ['goods'], count: 1, aggregates: {} },
    { key: ['service'], count: 1, aggregates: {} },
  ])
  await db.close()
})

test('product: timestamp fields are added without inventing history for old migrations', async () => {
  assert.equal(manifest.models['product.Template']!.timestamps, true)
  assert.equal(manifest.models['product.Product']!.timestamps, true)
  assert.equal(manifest.models['product.Template']!.fields.createdAt!.optional, true)
  const db = await boot()
  await call('product.saveTemplate', { id: 'timed', name: 'Timed', type: 'goods' }, db)
  const row = ((await call('product.listTemplates', {}, db)).value as Row[])[0]!
  assert.equal(typeof row.createdAt, 'string')
  assert.equal(row.createdAt, row.updatedAt)
  await db.close()
})

/**
 * A session can read several companies while writing to exactly one. Every
 * company-scoped lookup below therefore has to name the active company: reads
 * span the readable set, writes are pinned, and a lookup that ignores the
 * difference finds a row it can never write.
 */
const BOTH = { company: 'acme', companies: ['acme', 'globex'], branches: null }

const seedVariant = async (db: Adapter): Promise<void> => {
  await call('uom.saveUnit', { id: 'ea', name: 'Each', relativeFactor: '1' }, db)
  await call('product.saveTemplate', { id: 'tpl', name: 'Tpl', type: 'goods', uomId: 'ea' }, db)
  await call('product.saveVariant', { id: 'var', templateId: 'tpl' }, db)
}

test('product: a cost is written to the active company, not to whichever one is readable', async () => {
  const db = await boot()
  await seedVariant(db)
  // globex prices the shared variant first.
  await call('product.setCost', { productId: 'var', standardPrice: '99' }, db, OTHER)
  // acme now prices it while globex is still in its readable set.
  const mine = await call('product.setCost', { productId: 'var', standardPrice: '42' }, db, BOTH)
  assert.equal((mine.value as { ok: boolean }).ok, true)

  const acme = (await call('product.getVariant', { id: 'var' }, db, BOTH)).value as {
    cost: Row | null
  }
  const globex = (await call('product.getVariant', { id: 'var' }, db, OTHER)).value as {
    cost: Row | null
  }
  assert.equal(Number(acme.cost?.standardPrice), 42, 'the active company stores its own price')
  assert.equal(Number(globex.cost?.standardPrice), 99, "and does not overwrite its sibling's")
  await db.close()
})

test('product: two companies can hold the same unit for one shared variant', async () => {
  const db = await boot()
  await seedVariant(db)
  const first = await call('product.addProductUom', { productId: 'var', uomId: 'ea' }, db)
  const second = await call('product.addProductUom', { productId: 'var', uomId: 'ea' }, db, OTHER)
  assert.equal((first.value as { ok: boolean }).ok, true)
  assert.equal((second.value as { ok: boolean }).ok, true)
  assert.notEqual(
    (first.value as { id: string }).id,
    (second.value as { id: string }).id,
    'a tenant-global id would have collided on the primary key',
  )
  for (const scope of [SCOPE, OTHER]) {
    const seen = (await call('product.getVariant', { id: 'var' }, db, scope)).value as { uoms: Row[] }
    assert.equal(seen.uoms.length, 1, 'each company sees only its own unit')
  }
  await db.close()
})

test('product: setting a variant unit replaces the previous one instead of adding to it', async () => {
  const db = await boot()
  await seedVariant(db)
  await call('uom.saveUnit', { id: 'box', name: 'Box', relativeUomId: 'ea', relativeFactor: '12' }, db)

  await call('product.setProductUom', { productId: 'var', uomId: 'ea' }, db)
  await call('product.setProductUom', { productId: 'var', uomId: 'box' }, db)
  const after = (await call('product.getVariant', { id: 'var' }, db)).value as { uoms: Row[] }
  assert.equal(after.uoms.length, 1, 'switching the unit does not accumulate rows')
  assert.equal(after.uoms[0]!.uomId, 'box')

  // The form's empty option means "no unit", so a null clears it.
  await call('product.setProductUom', { productId: 'var', uomId: null }, db)
  const cleared = (await call('product.getVariant', { id: 'var' }, db)).value as { uoms: Row[] }
  assert.deepEqual(cleared.uoms, [])
  await db.close()
})

test('product: a partial list state narrows nothing rather than throwing', async () => {
  const db = await boot()
  await call('product.saveTemplate', { id: 'p1', name: 'One', type: 'goods' }, db)
  await call('product.saveTemplate', { id: 'p2', name: 'Two', type: 'service' }, db)
  for (const state of [{}, { filters: null }, { sort: [] }, { groupBy: 'nonsense' }]) {
    const rows = (await call('product.listTemplates', { state }, db)).value as Row[]
    assert.equal(rows.length, 2, `state ${JSON.stringify(state)} should list everything`)
    const count = (await call('product.countTemplates', { state }, db)).value as { count: number }
    assert.equal(count.count, 2)
  }
  await db.close()
})

test('product: a search term is matched literally, wildcards included', async () => {
  const db = await boot()
  await call('product.saveTemplate', { id: 'a', name: 'Discount 50% off', type: 'goods' }, db)
  await call('product.saveTemplate', { id: 'b', name: 'Discount 5000 off', type: 'goods' }, db)
  const hits = (await call('product.listTemplates', { search: '50%' }, db)).value as Row[]
  assert.deepEqual(
    hits.map((row) => row.id),
    ['a'],
    'an unescaped % would have matched both',
  )
  await db.close()
})

test('product: relation pickers get the search and limit they always send', async () => {
  const db = await boot()
  for (const [id, name] of [
    ['cat-root', 'Trang phục'],
    ['cat-shirt', 'Áo sơ mi'],
  ] as const)
    await call(
      'product.saveCategory',
      { id, name, ...(id === 'cat-shirt' ? { parentId: 'cat-root' } : {}) },
      db,
    )
  await call('product.saveAttribute', { id: 'size', name: 'Kích cỡ' }, db)
  await call('product.saveAttributeValue', { id: 'size-m', attributeId: 'size', name: 'M' }, db)
  await call('product.saveAttributeValue', { id: 'size-l', attributeId: 'size', name: 'L' }, db)
  await call('uom.saveUnit', { id: 'ea', name: 'Each', relativeFactor: '1' }, db)

  // The picker sends both on every keystroke; an unknown input is a hard error,
  // so accepting them is what makes these functions usable as a listFunction.
  for (const [fn, args] of [
    ['product.listCategories', { search: '', limit: 80 }],
    ['product.listAttributes', { search: '', limit: 80 }],
    ['product.listAttributeValues', { search: '', limit: 80 }],
    ['uom.listUnits', { search: '', limit: 80 }],
  ] as const) {
    const rows = (await call(fn, args, db)).value as Row[]
    assert.ok(Array.isArray(rows), `${fn} should accept search and limit`)
  }

  const narrowed = (await call('product.listCategories', { search: 'sơ mi' }, db)).value as Row[]
  assert.deepEqual(
    narrowed.map((row) => row.id),
    ['cat-shirt'],
  )
  const capped = (await call('product.listAttributeValues', { limit: 1 }, db)).value as Row[]
  assert.equal(capped.length, 1)
  const scoped = (await call('product.listAttributeValues', { attributeId: 'size' }, db)).value as Row[]
  assert.deepEqual(scoped.map((row) => row.id).sort(), ['size-l', 'size-m'])
  await db.close()
})

test('product: a category carries its ancestry so a flat picker stays unambiguous', async () => {
  const db = await boot()
  await call('product.saveCategory', { id: 'top', name: 'Trang phục' }, db)
  await call('product.saveCategory', { id: 'mid', name: 'Áo', parentId: 'top' }, db)
  await call('product.saveCategory', { id: 'leaf', name: 'Sơ mi', parentId: 'mid' }, db)
  const rows = (await call('product.listCategories', {}, db)).value as Row[]
  const paths = new Map(rows.map((row) => [String(row.id), String(row.path)]))
  assert.equal(paths.get('leaf'), 'Trang phục / Áo / Sơ mi')
  assert.equal(paths.get('top'), 'Trang phục')
  // Searching matches the ancestry too, so typing a parent finds its children.
  const byParent = (await call('product.listCategories', { search: 'Trang phục' }, db)).value as Row[]
  assert.equal(byParent.length, 3)
  await db.close()
})

test('product: the unit picker can be held to one tree', async () => {
  const db = await boot()
  await call('uom.saveUnit', { id: 'ea', name: 'Each', relativeFactor: '1' }, db)
  await call('uom.saveUnit', { id: 'box', name: 'Box', relativeUomId: 'ea', relativeFactor: '12' }, db)
  await call('uom.saveUnit', { id: 'kg', name: 'Kilogram', relativeFactor: '1' }, db)
  const tree = (await call('uom.listUnits', { rootId: 'ea', search: '', limit: 80 }, db)).value as Row[]
  assert.deepEqual(
    tree.map((row) => row.id).sort(),
    ['box', 'ea'],
    'a unit from another tree would be refused by setProductUom, so it is not offered',
  )
  await db.close()
})

test('product: a variant keeps its unit barcode when the unit itself changes', async () => {
  const db = await boot()
  await seedVariant(db)
  await call('uom.saveUnit', { id: 'box', name: 'Box', relativeUomId: 'ea', relativeFactor: '12' }, db)
  await call('product.setProductUom', { productId: 'var', uomId: 'ea', barcode: 'SKU-1' }, db)

  // The row holding SKU-1 is the one this call replaces, so it must not be read
  // as a collision with itself.
  const moved = await call('product.setProductUom', { productId: 'var', uomId: 'box', barcode: 'SKU-1' }, db)
  assert.equal((moved.value as { ok: boolean; errors?: unknown }).ok, true, JSON.stringify(moved.value))
  const after = (await call('product.getVariant', { id: 'var' }, db)).value as { uoms: Row[] }
  assert.equal(after.uoms.length, 1)
  assert.equal(after.uoms[0]!.uomId, 'box')
  assert.equal(after.uoms[0]!.barcode, 'SKU-1')

  // A barcode held by a different variant is still a genuine collision.
  await call('product.saveVariant', { id: 'var2', templateId: 'tpl' }, db)
  const clash = await call('product.setProductUom', { productId: 'var2', uomId: 'ea', barcode: 'SKU-1' }, db)
  assert.equal((clash.value as { ok: boolean }).ok, false)
  await db.close()
})
