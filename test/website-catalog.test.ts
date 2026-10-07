import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
  tableNameFor,
} from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createCommerceDeployment } from '@ketvietlab/ketsuite/deployment'

const deployment = createCommerceDeployment()
const manifest = compose([...deployment.modules, deployment.theme!])
const scope = { company: 'catalog-a', branches: null }
async function boot() {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(deployment.modules)
  const call = async (name: string, input: Row, company = scope.company) =>
    (
      await callFn(name, input, {
        adapter: db,
        manifest,
        actor: 'catalog-actor',
        scope: { ...scope, company },
      })
    ).value as Row
  for (const id of ['catalog-a', 'catalog-b']) {
    await call('partner.savePartner', { id: `${id}-partner`, kind: 'company', name: id })
    await call('company.saveCompany', { id, code: id, partnerId: `${id}-partner`, currency: 'VND' })
    await call(
      'website.saveSite',
      { id: `site-${id}`, name: id, title: id, theme: 'theme_paper', defaultLocale: 'vi', active: true },
      id,
    )
  }
  return { db, call }
}
const productInput = {
  id: 'service-a',
  name: 'In túi giấy',
  type: 'service',
  description: 'In màu theo yêu cầu',
}
test('commerce catalog: durable binding, live owner data, company/site boundary and CAS', async (t) => {
  const { db, call } = await boot()
  t.after(() => db.close())
  assert.equal((await call('product.saveTemplate', productInput)).ok, true)
  let binding = await call('website_catalog.addProduct', {
    siteId: 'site-catalog-a',
    productId: productInput.id,
  })
  assert.equal(binding.visible, false)
  assert.equal(
    (await call('website_catalog.addProduct', { siteId: 'site-catalog-a', productId: productInput.id })).id,
    binding.id,
  )
  assert.equal(
    await call('website_catalog.publicProduct', { siteId: 'site-catalog-a', path: binding.path }),
    null,
  )
  await assert.rejects(
    call('website_catalog.getBinding', { siteId: 'site-catalog-a', id: binding.id }, 'catalog-b'),
  )
  const stale = binding.revisionId
  binding = await call('website_catalog.saveBinding', {
    siteId: 'site-catalog-a',
    id: binding.id,
    expectedRevisionId: stale,
    visible: true,
    path: '/p/tui-giay',
    templateId: binding.templateId,
    action: 'quote',
    categoryIds: [],
  })
  await assert.rejects(
    call('website_catalog.saveBinding', {
      siteId: 'site-catalog-a',
      id: binding.id,
      expectedRevisionId: stale,
      visible: false,
      path: '/p/tui-giay',
      templateId: binding.templateId,
      action: 'quote',
      categoryIds: [],
    }),
    /Conflict/,
  )
  const original = await call('product.getTemplate', { id: productInput.id })
  assert.equal(
    (
      await call('product.saveTemplate', {
        ...productInput,
        name: 'In túi mới',
        expectedRevisionId: original.revisionId,
      })
    ).ok,
    true,
  )
  assert.equal(
    (await call('website_catalog.publicProduct', { siteId: 'site-catalog-a', path: '/p/tui-giay' })).name,
    'In túi mới',
  )
  const entry = await call('website_catalog.getEntryByPath', {
    siteId: 'site-catalog-a',
    path: '/p/tui-giay',
  })
  assert.equal(entry.type, 'website.product')
  assert.equal(entry.title, 'In túi mới')
  const current = await call('product.getTemplate', { id: productInput.id })
  await call('product.archiveTemplate', {
    id: productInput.id,
    active: false,
    expectedRevisionId: current.revisionId,
    confirmed: true,
  })
  assert.equal(
    await call('website_catalog.getEntryByPath', { siteId: 'site-catalog-a', path: '/p/tui-giay' }),
    null,
  )
})
test('commerce catalog: standard builder overrides content only and reset inherits source', async (t) => {
  const { db, call } = await boot()
  t.after(() => db.close())
  await call('product.saveTemplate', productInput)
  const b = await call('website_catalog.addProduct', { siteId: 'site-catalog-a', productId: productInput.id })
  const input = { siteId: 'site-catalog-a', id: b.id, mode: 'product' }
  let doc = await call('website_catalog.getBuilder', input),
    entry = doc.entry as Row
  const layout = structuredClone(entry.layout) as Row[]
  const slots = layout[0]!.slots as Record<string, Row[]>
  ;(slots.right![0]!.settings as Row).heading = 'Tên riêng website'
  await call('website_catalog.saveBuilder', { ...input, layout, expectedRevisionId: entry.revisionId })
  let binding = await call('website_catalog.getBinding', { siteId: input.siteId, id: b.id })
  assert.equal((binding.effectiveProduct as Row).name, 'Tên riêng website')
  assert.equal((binding.product as Row).name, productInput.name)
  doc = await call('website_catalog.getBuilder', input)
  entry = doc.entry as Row
  const bad = structuredClone(entry.layout) as Row[]
  ;(bad[0]!.settings as Row).gap = 'compact'
  await assert.rejects(
    call('website_catalog.saveBuilder', { ...input, layout: bad, expectedRevisionId: entry.revisionId }),
    /bố cục|nội dung/,
  )
  await call('website_catalog.saveBuilder', {
    ...input,
    layout: (entry.catalog as Row).sourceLayout,
    expectedRevisionId: entry.revisionId,
  })
  binding = await call('website_catalog.getBinding', { siteId: input.siteId, id: b.id })
  assert.equal((binding.effectiveProduct as Row).name, productInput.name)
})
test('commerce catalog: normalized membership, hidden ancestors, image ownership and bounded picker', async (t) => {
  const { db, call } = await boot()
  t.after(() => db.close())
  const linked: string[] = []
  for (let i = 0; i < 31; i++) {
    const id = `product-${i}`
    await call('product.saveTemplate', { ...productInput, id, name: `Dịch vụ ${String(i).padStart(2, '0')}` })
    await call('website_catalog.addProduct', { siteId: 'site-catalog-a', productId: id })
    linked.push(id)
  }
  const pick = await call('website_catalog.productCandidates', { siteId: 'site-catalog-a', page: 1 })
  assert.equal((pick.rows as Row[]).length, 24)
  assert.equal(pick.total, 31)
  assert.equal(pick.pages, 2)
  const selected = await call('website_catalog.productCandidates', {
    siteId: 'site-catalog-a',
    mode: 'selected',
    selectedIds: [linked[30]],
    page: 1,
  })
  assert.equal((selected.rows as Row[])[0]!.id, linked[30])
  assert.equal(selected.total, 1)
  const defaults = {
    siteId: 'site-catalog-a',
    kind: 'category',
    position: 0,
    visible: false,
    includeChildren: true,
    mode: 'manual',
    productIds: [],
    primarySort: 'manual',
    indexing: 'index',
  }
  const parent = await call('website_catalog.saveCategory', {
    ...defaults,
    id: 'parent',
    title: 'Cha',
    slug: 'cha',
  })
  const child = await call('website_catalog.saveCategory', {
    ...defaults,
    id: 'child',
    title: 'Con',
    slug: 'con',
    parentId: 'parent',
    visible: true,
    productIds: [linked[0]],
  })
  assert.deepEqual(
    (await call('website_catalog.categoryProducts', { siteId: defaults.siteId, id: child.id })).rows,
    [],
  )
  await assert.rejects(
    call('website_catalog.saveCategory', {
      ...defaults,
      id: 'parent',
      title: 'Cha',
      slug: 'cha',
      parentId: 'child',
      expectedRevisionId: parent.revisionId,
    }),
    /vòng lặp/,
  )
  await assert.rejects(
    call('website_catalog.saveCategory', {
      ...defaults,
      id: 'bad-image',
      title: 'Ảnh giả',
      slug: 'anh-gia',
      thumbnail: '/website/catalog/files/fake',
    }),
    /Ảnh/,
  )
  await assert.rejects(
    call('website_catalog.archiveCategory', {
      siteId: defaults.siteId,
      id: parent.id,
      expectedRevisionId: parent.revisionId,
      confirmed: true,
    }),
    /danh mục con/,
  )
})

test('commerce catalog: supermarket picker stays paged with 5,008 persisted products', async (t) => {
  const { db, call } = await boot()
  t.after(() => db.close())
  await call('product.saveTemplate', { ...productInput, id: 'bulk-source', name: 'Product 00000' })
  await call('website_catalog.addProduct', { siteId: 'site-catalog-a', productId: 'bulk-source' })
  const q = db.quoteIdent.bind(db)
  const models = ['product.Template', 'product.Product', 'website_catalog.Binding']
  const original: Row[] = []
  for (const model of models)
    original.push((await db.all(`SELECT * FROM ${q(tableNameFor(model))} LIMIT 1`))[0]!)
  await db.tx(async (tx) => {
    for (let i = 1; i < 5008; i++) {
      const suffix = String(i).padStart(5, '0'),
        productId = `bulk-${suffix}`,
        variantId = `variant-${suffix}`
      const rows: Row[] = [
        { ...original[0], id: productId, name: `Product ${suffix}` },
        { ...original[1], id: variantId, templateId: productId, defaultCode: `SKU-${suffix}` },
        { ...original[2], id: `binding-${suffix}`, productId, variantId, path: `/p/bulk-${suffix}` },
      ]
      for (let n = 0; n < rows.length; n++) {
        const row = rows[n]!,
          keys = Object.keys(row)
        await tx.run(
          `INSERT INTO ${q(tableNameFor(models[n]!))} (${keys.map(q).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
          keys.map((key) => row[key]),
        )
      }
    }
  })
  const first = await call('website_catalog.productCandidates', { siteId: 'site-catalog-a', page: 1 })
  assert.equal(first.total, 5008)
  assert.equal(first.pages, 209)
  assert.equal((first.rows as Row[]).length, 24)
  const last = await call('website_catalog.productCandidates', { siteId: 'site-catalog-a', page: 9999 })
  assert.equal(last.page, 209)
  assert.equal((last.rows as Row[]).length, 16)
  const search = await call('website_catalog.productCandidates', {
    siteId: 'site-catalog-a',
    search: 'SKU-05007',
  })
  assert.equal(search.total, 1)
  assert.equal((search.rows as Row[])[0]!.id, 'bulk-05007')
  const selected = await call('website_catalog.productCandidates', {
    siteId: 'site-catalog-a',
    mode: 'selected',
    selectedIds: ['bulk-05007', 'bulk-source'],
  })
  assert.equal(selected.total, 2)
  assert.equal((selected.rows as Row[]).length, 2)
})

test('commerce catalog: atomic Studio create, editorial override, redirect and source CAS', async (t) => {
  const { db, call } = await boot()
  t.after(() => db.close())
  const input = { ...productInput, siteId: 'site-catalog-a' }
  const binding = await call('website_catalog.createProduct', input)
  assert.equal((await call('website_catalog.createProduct', input)).id, binding.id)
  await assert.rejects(
    call('website_catalog.createProduct', { ...input, name: 'Different product' }),
    /Conflict/,
  )
  const variant = await call('product.listVariants', {})
  assert.equal((variant as unknown as Row[]).filter((v) => v.templateId === input.id).length, 1)
  await assert.rejects(call('product.archiveTemplate', { id: input.id, active: false }), /Conflict/)
  const content = [
    {
      id: 'editorial',
      type: 'website.rich_text',
      settings: {
        body: '',
        bodyDoc: JSON.stringify([{ id: 'p', type: 'p', delta: [{ insert: 'Nội dung dài theo website' }] }]),
      },
    },
  ]
  await call('website_catalog.importProductContent', {
    siteId: input.siteId,
    id: binding.id,
    expectedRevisionId: binding.revisionId,
    contentLayout: content,
  })
  let entry = (
    await call('website_catalog.getBuilder', { siteId: input.siteId, id: binding.id, mode: 'product' })
  ).entry as Row
  const edited = structuredClone(entry.layout) as Row[]
  ;(edited.at(-1)!.settings as Row).bodyDoc = JSON.stringify([
    { id: 'p', type: 'p', delta: [{ insert: 'Nội dung riêng' }] },
  ])
  await call('website_catalog.saveBuilder', {
    siteId: input.siteId,
    id: binding.id,
    mode: 'product',
    layout: edited,
    expectedRevisionId: entry.revisionId,
  })
  const result = await call('website_catalog.getBinding', { siteId: input.siteId, id: binding.id })
  assert.match(JSON.stringify((result.effectiveProduct as Row).websiteContent), /Nội dung riêng/)
  const visible = await call('website_catalog.saveBinding', {
    siteId: input.siteId,
    id: binding.id,
    expectedRevisionId: result.revisionId,
    visible: true,
    path: '/p/live-service',
    templateId: result.templateId,
    action: 'quote',
    categoryIds: [],
  })
  assert.deepEqual(
    await call('website_catalog.resolveRedirect', { siteId: input.siteId, path: binding.path }),
    { path: '/p/live-service' },
  )
  assert.ok(
    ((await call('website_catalog.sitemapEntries', { siteId: input.siteId })) as unknown as Row[]).some(
      (r) => r.path === visible.path,
    ),
  )
  const search = await call('website_catalog.searchIndexed', { siteId: input.siteId, q: 'túi' })
  assert.equal(search.total, 1)
  const source = await call('product.getTemplate', { id: input.id })
  await call('product.archiveTemplate', {
    id: input.id,
    active: false,
    expectedRevisionId: source.revisionId,
    confirmed: true,
  })
  assert.equal((await call('website_catalog.searchIndexed', { siteId: input.siteId, q: 'túi' })).total, 0)
  assert.equal(
    await call('website_catalog.resolveRedirect', { siteId: input.siteId, path: binding.path }),
    null,
  )
})

test('commerce catalog: staged content images are private, owner scoped, and cannot be claimed while deleting', async (t) => {
  const { db, call } = await boot()
  t.after(() => db.close())
  await call('product.saveTemplate', productInput)
  const b = await call('website_catalog.addProduct', { siteId: 'site-catalog-a', productId: productInput.id })
  const stage = {
    siteId: 'site-catalog-a',
    ownerId: b.id,
    resModel: 'website_catalog.Binding',
    id: 'content-image',
    name: 'image.webp',
    storeKey: 'catalog-images/catalog-a/content-image/' + 'a'.repeat(64),
    mimetype: 'image/webp',
    size: 500,
    checksum: 'a'.repeat(64),
  }
  await call('website_catalog.stageImage', stage)
  assert.equal(await call('website_catalog.imageForReader', { id: stage.id }), null)
  await call('website_catalog.completeImage', { id: stage.id })
  const layout = [
    {
      id: 'image',
      type: 'website.image',
      settings: { image: '/website/catalog/files/content-image', alt: 'Image' },
    },
  ]
  await db.run(
    `UPDATE ${db.quoteIdent(tableNameFor('website_catalog.Upload'))} SET deleting = 1 WHERE id = ?`,
    [stage.id],
  )
  assert.equal(await call('website_catalog.imageForReader', { id: stage.id }), null)
  await assert.rejects(
    call('website_catalog.importProductContent', {
      siteId: stage.siteId,
      id: b.id,
      expectedRevisionId: b.revisionId,
      contentLayout: layout,
    }),
    /Ảnh/,
  )
  await db.run(
    `UPDATE ${db.quoteIdent(tableNameFor('website_catalog.Upload'))} SET deleting = 0 WHERE id = ?`,
    [stage.id],
  )
  await call('website_catalog.importProductContent', {
    siteId: stage.siteId,
    id: b.id,
    expectedRevisionId: b.revisionId,
    contentLayout: layout,
  })
  assert.equal((await call('website_catalog.imageForReader', { id: stage.id })).public, true)
  await assert.rejects(
    call('website_catalog.stageImage', { ...stage, id: 'other-image', siteId: 'site-catalog-b' }),
    /Không|Forbidden/,
  )
})

test('commerce catalog: ERP media uses the owner contract inside one transaction and invalidates stale source edits', async (t) => {
  const { db, call } = await boot()
  t.after(() => db.close())
  await call('product.saveTemplate', productInput)
  const b = await call('website_catalog.addProduct', { siteId: 'site-catalog-a', productId: productInput.id })
  const visible = await call('website_catalog.saveBinding', {
    siteId: 'site-catalog-a',
    id: b.id,
    expectedRevisionId: b.revisionId,
    path: b.path,
    visible: true,
    templateId: b.templateId,
    action: 'quote',
    categoryIds: [],
  })
  const before = await call('product.getTemplate', { id: productInput.id })
  await call('storage.createAttachment', {
    id: 'owner-media',
    name: 'photo.webp',
    resModel: 'product.Template',
    resId: productInput.id,
    resField: 'media',
    kind: 'stored',
    storeKey: `blobs/catalog-a/aa/${'a'.repeat(64)}`,
    checksum: 'a'.repeat(64),
    mimetype: 'image/webp',
    size: 512,
    public: false,
    createdAt: new Date().toISOString(),
  })
  await call('product_media.attachMedia', {
    id: 'native-media',
    attachmentId: 'owner-media',
    templateId: productInput.id,
    alt: 'Ảnh ERP',
    sequence: 0,
  })
  const source = await call('product.getTemplate', { id: productInput.id })
  assert.notEqual(source.revisionId, before.revisionId)
  assert.equal(
    (await call('product.saveTemplate', { ...productInput, expectedRevisionId: before.revisionId })).ok,
    false,
  )
  const live = await call('website_catalog.publicProduct', { siteId: 'site-catalog-a', path: visible.path })
  assert.equal((live.gallery as Row[])[0]!.src, '/website/catalog/files/owner-media')
  await call('product_media.attachMedia', {
    id: 'native-media',
    attachmentId: 'owner-media',
    templateId: productInput.id,
    alt: 'Ảnh cập nhật',
    sequence: 0,
  })
  const updated = await call('website_catalog.publicProduct', {
    siteId: 'site-catalog-a',
    path: visible.path,
  })
  assert.equal((updated.gallery as Row[])[0]!.alt, 'Ảnh cập nhật')
  const builder = await call('website_catalog.getBuilder', {
    siteId: 'site-catalog-a',
    mode: 'product',
    id: b.id,
  })
  const entry = builder.entry as Row
  const layout = structuredClone(entry.layout) as Row[]
  const gallery = ((layout[0]!.slots as Record<string, Row[]>).left ?? []).find(
    (node) => node.type === 'website.gallery',
  )
  assert.ok(gallery)
  gallery.settings = {
    ...(gallery.settings as Row),
    images: JSON.stringify((updated.gallery as Row[]).map((image) => ({ ...image, alt: 'Riêng website' }))),
  }
  await call('website_catalog.saveBuilder', {
    siteId: 'site-catalog-a',
    mode: 'product',
    id: b.id,
    expectedRevisionId: entry.revisionId,
    layout,
  })
  await assert.rejects(call('product_media.removeMedia', { id: 'native-media' }), /Ảnh đang được dùng/)
  assert.equal(
    ((await call('product_media.listMedia', { templateId: productInput.id })) as unknown as Row[]).length,
    1,
  )
  const overridden = await call('website_catalog.getBuilder', {
    siteId: 'site-catalog-a',
    mode: 'product',
    id: b.id,
  })
  const inherited = overridden.entry as Row
  await call('website_catalog.saveBuilder', {
    siteId: 'site-catalog-a',
    mode: 'product',
    id: b.id,
    expectedRevisionId: inherited.revisionId,
    layout: (inherited.catalog as Row).sourceLayout,
  })
  await call('product_media.removeMedia', { id: 'native-media' })
  assert.equal(
    ((await call('product_media.listMedia', { templateId: productInput.id })) as unknown as Row[]).length,
    0,
  )
})

test('commerce catalog: public counts exclude masters without active variants and automatic bindings use a live variant', async (t) => {
  const { db, call } = await boot()
  t.after(() => db.close())
  await call('product.saveTemplate', productInput)
  const b = await call('website_catalog.addProduct', { siteId: 'site-catalog-a', productId: productInput.id })
  assert.equal(b.variantId, null)
  await call('website_catalog.saveBinding', {
    siteId: 'site-catalog-a',
    id: b.id,
    expectedRevisionId: b.revisionId,
    path: b.path,
    visible: true,
    templateId: b.templateId,
    action: 'quote',
    categoryIds: [],
  })
  const c = await call('website_catalog.saveCategory', {
    siteId: 'site-catalog-a',
    id: 'live-category',
    kind: 'category',
    title: 'Dịch vụ',
    slug: 'dich-vu',
    position: 0,
    visible: true,
    includeChildren: false,
    mode: 'manual',
    productIds: [productInput.id],
    primarySort: 'manual',
    indexing: 'index',
  })
  const variants = (await call('product.listVariants', {})) as unknown as Row[]
  const original = variants.find((v) => v.templateId === productInput.id)!
  const table = db.quoteIdent(tableNameFor('product.Product'))
  await db.run(`UPDATE ${table} SET active = ? WHERE id = ?`, [0, original.id])
  assert.equal((await call('website_catalog.publicList', { siteId: 'site-catalog-a' })).total, 0)
  assert.equal(
    (await call('website_catalog.categoryProducts', { siteId: 'site-catalog-a', id: c.id })).total,
    0,
  )
  await call('product.saveVariant', {
    id: 'new-live-variant',
    templateId: productInput.id,
    defaultCode: 'ACTIVE-SKU',
  })
  const list = await call('website_catalog.publicList', { siteId: 'site-catalog-a' })
  assert.equal(list.total, 1)
  assert.equal((list.rows as Row[])[0]!.sku, 'ACTIVE-SKU')
  assert.equal(
    (await call('website_catalog.categoryProducts', { siteId: 'site-catalog-a', id: c.id })).total,
    1,
  )
})

test('commerce catalog: homepage and related cards resolve live Product data and per-site overrides', async (t) => {
  const { db, call } = await boot()
  t.after(() => db.close())
  await call('product.saveTemplate', productInput)
  const b = await call('website_catalog.addProduct', { siteId: 'site-catalog-a', productId: productInput.id })
  await call('website_catalog.saveBinding', {
    siteId: 'site-catalog-a',
    id: b.id,
    expectedRevisionId: b.revisionId,
    path: b.path,
    visible: true,
    templateId: b.templateId,
    action: 'quote',
    categoryIds: [],
  })
  const placement = {
    id: 'live-card',
    type: 'website_catalog.product_card',
    settings: { productId: productInput.id, ctaLabel: 'Xem chi tiết' },
  }
  const saved = await call('website.saveEntry', {
    id: 'home-cards',
    siteId: 'site-catalog-a',
    type: 'website.page',
    slug: 'home',
    path: '/',
    title: 'Trang chủ',
    fields: {},
    layout: [placement],
  })
  await call('website.publishEntry', { id: 'home-cards', expectedRevisionId: saved.revisionId })
  await call('website_catalog.importProductContent', {
    siteId: 'site-catalog-a',
    id: b.id,
    expectedRevisionId: (await call('website_catalog.getBinding', { siteId: 'site-catalog-a', id: b.id }))
      .revisionId,
    contentLayout: [{ ...placement, id: 'related-card' }],
  })
  const source = await call('product.getTemplate', { id: productInput.id })
  await call('product.saveTemplate', {
    ...productInput,
    name: 'Tên ERP mới',
    expectedRevisionId: source.revisionId,
  })
  const home = await call('website_catalog.getEntryByPath', { siteId: 'site-catalog-a', path: '/' })
  assert.equal(((home.layout as Row[])[0]!.settings as Row).heading, 'Tên ERP mới')
  const builder = await call('website_catalog.getBuilder', {
    siteId: 'site-catalog-a',
    id: b.id,
    mode: 'product',
  })
  const entry = builder.entry as Row,
    layout = structuredClone(entry.layout) as Row[]
  const slots = layout[0]!.slots as Record<string, Row[]>
  ;(slots.right![0]!.settings as Row).heading = 'Tên riêng website'
  await call('website_catalog.saveBuilder', {
    siteId: 'site-catalog-a',
    id: b.id,
    mode: 'product',
    expectedRevisionId: entry.revisionId,
    layout,
  })
  const overridden = await call('website_catalog.getEntryByPath', { siteId: 'site-catalog-a', path: '/' })
  assert.equal(((overridden.layout as Row[])[0]!.settings as Row).heading, 'Tên riêng website')
  const related = await call('website_catalog.getEntryByPath', { siteId: 'site-catalog-a', path: b.path })
  assert.equal(
    ((related.layout as Row[]).find((node) => node.id === 'related-card')!.settings as Row).heading,
    'Tên riêng website',
  )
  const stored = await call('website.getEntry', { id: 'home-cards' })
  assert.equal(((stored.revision as Row).layout as Row[])[0]!.type, 'website_catalog.product_card')
  assert.equal((((stored.revision as Row).layout as Row[])[0]!.settings as Row).heading, undefined)
  const binding = await call('website_catalog.getBinding', { siteId: 'site-catalog-a', id: b.id })
  await call('website_catalog.saveBinding', {
    siteId: 'site-catalog-a',
    id: b.id,
    expectedRevisionId: binding.revisionId,
    path: b.path,
    visible: false,
    templateId: b.templateId,
    action: 'quote',
    categoryIds: [],
  })
  assert.deepEqual(
    (await call('website_catalog.getEntryByPath', { siteId: 'site-catalog-a', path: '/' })).layout,
    [],
  )
  await assert.rejects(
    call('website_catalog.cardData', { siteId: 'site-catalog-b', settings: placement.settings }),
    /website/,
  )
})
