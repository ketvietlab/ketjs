import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { bootDeployment, callFn } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { recordTabsFor } from '../packages/ketsuite/src/modules/product/product-record-tabs.ts'

const companyScope = (company: string, branch = `root:${company}`) => ({
  company,
  companies: [company],
  branch,
  branches: [branch],
})

type Context = {
  data: {
    record: Row
    hasVariants: boolean
    variantSetup: Row | null
    types: string[]
    categories: Row[]
    uoms: Row[]
    stockEnabled: boolean
    taxEnabled: boolean
    permissions: Record<string, boolean>
    lang: string
  }
  messages: Record<string, string>
} | null

const boot = async (t: TestContext) => {
  const booted = await bootDeployment(ketsuite, {
    env: { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_SECRET: 'product-modal-context' },
    port: 0,
    log: () => {},
  })
  t.after(() => booted.close())
  const adapter = booted.adapter!
  const run = <T>(fn: string, args: Record<string, unknown> = {}, actor: string | null = 'root') =>
    callFn(fn, args, { adapter, manifest: booted.manifest, scope: companyScope('acme'), actor }).then(
      (r) => r.value as T,
    )

  await run('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, null)
  await run('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, null)
  await run(
    'user.createUser',
    { id: 'root', login: 'root', password: 'correct horse', name: 'Root', superuser: true },
    null,
  )
  await run('user.createUser', { id: 'staff', login: 'staff', name: 'Staff' }, null)
  await run('user.createUser', { id: 'nobody', login: 'nobody', name: 'Không quyền' }, null)
  await run('user.grantCompany', { id: 'staff:acme', userId: 'staff', companyId: 'acme' })
  await run('user.grantCompany', { id: 'nobody:acme', userId: 'nobody', companyId: 'acme' })

  // "staff" may read and edit templates; "nobody" holds a company but no role at all.
  await run('user.saveRole', { id: 'catalog-editor', name: 'Catalog editor' })
  for (const fnKey of [
    'product.getTemplate',
    'product.saveTemplate',
    'product.archiveTemplate',
    'product.generateVariants',
    'product.saveAttributeLine',
    'product.removeAttributeLine',
    'product.saveVariant',
    'product.saveVariantSetup',
    'stock.configureProduct',
  ])
    await run('user.grantFunction', { id: `catalog-editor:${fnKey}`, roleId: 'catalog-editor', fnKey })
  await run('user.assignRole', { id: 'staff:catalog-editor', userId: 'staff', roleId: 'catalog-editor' })

  await run('user.saveRole', { id: 'catalog-reader', name: 'Catalog reader' })
  await run('user.grantFunction', {
    id: 'catalog-reader:product.getTemplate',
    roleId: 'catalog-reader',
    fnKey: 'product.getTemplate',
  })

  await run('uom.saveUnit', { id: 'unit', name: 'Cái', relativeFactor: '1' })
  await run('product.saveCategory', { id: 'cat-1', name: 'Đồ nam' })
  return { run }
}

test('product modal context: the create form offers defaults and every choice a superuser may use', async (t) => {
  const { run } = await boot(t)
  const result = await run<Context>('product.templateModalContext', {})

  assert.ok(result, 'a superuser gets the create context')
  const context = result.data
  assert.equal(context.record.id, '')
  assert.equal(context.record.name, '')
  assert.equal(context.record.type, 'goods')
  assert.equal(context.record.active, true)
  assert.equal(context.hasVariants, false)
  assert.equal(context.variantSetup, null)
  assert.ok(context.categories.some((c) => c.value === 'cat-1'))
  assert.ok(context.uoms.some((u) => u.value === 'unit'))
  assert.equal(context.stockEnabled, true, 'the stock module is part of this deployment')
  assert.equal(context.permissions.save, true)
  assert.equal(context.permissions.archive, true)
  assert.equal(context.permissions.delete, true)
  assert.equal(context.permissions.configureStock, true)
})

test('product modal context: creating is refused to a viewer who may not save a template', async (t) => {
  const { run } = await boot(t)

  assert.equal(await run<Context>('product.templateModalContext', {}, 'nobody'), null)
})

test('product modal context: an existing template carries its attributes-and-variants setup', async (t) => {
  const { run } = await boot(t)
  await run('product.saveTemplate', {
    id: 'tpl',
    name: 'Áo thun',
    type: 'goods',
    uomId: 'unit',
    categoryId: 'cat-1',
    listPrice: '150000',
  })
  await run('product.saveAttribute', { id: 'color', name: 'Màu' })
  await run('product.saveAttributeValue', { id: 'red', attributeId: 'color', name: 'Đỏ' })
  await run('product.saveAttributeValue', { id: 'blue', attributeId: 'color', name: 'Xanh' })
  await run('product.saveAttributeLine', {
    id: 'tpl:color',
    templateId: 'tpl',
    attributeId: 'color',
    valueIds: ['red', 'blue'],
  })
  await run('product.generateVariants', { templateId: 'tpl' })
  await run('stock.configureProduct', { templateId: 'tpl', isStorable: true, tracking: 'lot' })

  const result = await run<Context>('product.templateModalContext', { id: 'tpl' })
  assert.ok(result)
  const context = result.data
  assert.equal(context.record.name, 'Áo thun')
  assert.equal(context.record.categoryId, 'cat-1')
  assert.equal(context.record.isStorable, true)
  assert.equal(context.record.tracking, 'lot')
  assert.equal(context.hasVariants, true)
  const setup = context.variantSetup!
  assert.equal((setup.variants as Row[]).length, 2)
  assert.equal((setup.lines as Row[]).length, 1)
  assert.equal((setup.lines as Row[])[0]?.attributeId, 'color')
  assert.equal(((setup.lines as Row[])[0]!.values as Row[]).length, 2)
  assert.deepEqual((setup.variants as Row[]).map((variant) => (variant.valueIds as Row).color).sort(), [
    'blue',
    'red',
  ])
  // Nothing in this deployment fills template.recordTabs.
  assert.deepEqual((context as Row).extensionTabs, [])
  // The modal's text travels with its data, so the view never shows a message key.
  assert.equal(result.messages['product_backend.tabs.general'], 'Thông tin chung')
})

test('product modal context: reading is refused to a viewer who holds no product function at all, and to a stranger', async (t) => {
  const { run } = await boot(t)
  await run('product.saveTemplate', { id: 'tpl', name: 'Áo thun', type: 'goods', uomId: 'unit' })

  assert.equal(await run<Context>('product.templateModalContext', { id: 'tpl' }, 'nobody'), null)
  assert.equal(await run<Context>('product.templateModalContext', { id: 'ghost' }), null, 'no such template')
})

test('product modal context: a reader without save rights still opens the record, read-only', async (t) => {
  const { run } = await boot(t)
  await run('product.saveTemplate', { id: 'tpl', name: 'Áo thun', type: 'goods', uomId: 'unit' })
  await run('user.createUser', { id: 'reader', login: 'reader', name: 'Reader' }, null)
  await run('user.grantCompany', { id: 'reader:acme', userId: 'reader', companyId: 'acme' })
  await run('user.assignRole', { id: 'reader:catalog-reader', userId: 'reader', roleId: 'catalog-reader' })

  const result = await run<Context>('product.templateModalContext', { id: 'tpl' }, 'reader')
  assert.ok(result, 'a reader may open the record')
  assert.equal(result.data.record.name, 'Áo thun')
  assert.equal(result.data.permissions.save, false)
  assert.equal(result.data.permissions.archive, false)
  assert.equal(result.data.permissions.delete, false)
})

type SaveResult = {
  ok: boolean
  created?: number
  archived?: number
  setup?: { lines: Row[]; variants: Row[] }
  errors?: Array<{ field: string; code: string }>
}

const teeCatalogue = async (run: Awaited<ReturnType<typeof boot>>['run']) => {
  await run('product.saveTemplate', {
    id: 'tee',
    name: 'Áo thun',
    type: 'goods',
    uomId: 'unit',
    listPrice: '200000',
  })
  await run('product.saveAttribute', { id: 'color', name: 'Màu', sequence: 1 })
  await run('product.saveAttribute', { id: 'size', name: 'Size', sequence: 2 })
  for (const [id, attributeId, name] of [
    ['red', 'color', 'Đỏ'],
    ['black', 'color', 'Đen'],
    ['s', 'size', 'S'],
    ['l', 'size', 'L'],
  ])
    await run('product.saveAttributeValue', { id, attributeId, name })
}

const teeLines = [
  {
    attributeId: 'color',
    values: [
      { valueId: 'red', priceExtra: '0' },
      { valueId: 'black', priceExtra: '0' },
    ],
  },
  {
    attributeId: 'size',
    values: [
      { valueId: 's', priceExtra: '0' },
      { valueId: 'l', priceExtra: '20000' },
    ],
  },
]
const variant = (color: string, size: string, extra: Record<string, unknown> = {}) => ({
  id: null,
  valueIds: { color, size },
  weight: '0',
  volume: '0',
  active: true,
  ...extra,
})

test('variant setup: one save writes lines, price extras and variants, and generating afterwards finds the same rows', async (t) => {
  const { run } = await boot(t)
  await teeCatalogue(run)

  const saved = await run<SaveResult>('product.saveVariantSetup', {
    templateId: 'tee',
    lines: teeLines,
    variants: [variant('red', 's', { defaultCode: 'TEE-RS' }), variant('red', 'l'), variant('black', 's')],
  })
  assert.equal(saved.ok, true, JSON.stringify(saved.errors))
  assert.equal(saved.created, 3)
  const setup = saved.setup!
  const large = (setup.lines[1]!.values as Row[]).find((value) => value.valueId === 'l')
  assert.equal(large?.priceExtra, '20000')
  assert.equal(setup.variants.filter((row) => row.active).length, 3)

  // The combination keys match generateVariants' own, so it only adds black·L.
  const generated = await run<{ created: number }>('product.generateVariants', { templateId: 'tee' })
  assert.equal(generated.created, 1)

  const context = await run<Context>('product.templateModalContext', { id: 'tee' })
  assert.equal(context!.data.hasVariants, true)
  assert.equal((context!.data.variantSetup!.variants as Row[]).length, 4)
})

test('variant setup: a duplicate combination is refused on both rows and nothing is written', async (t) => {
  const { run } = await boot(t)
  await teeCatalogue(run)

  const refused = await run<SaveResult>('product.saveVariantSetup', {
    templateId: 'tee',
    lines: teeLines,
    variants: [variant('red', 's'), variant('black', 'l'), variant('red', 's')],
  })
  assert.equal(refused.ok, false)
  assert.deepEqual(
    refused
      .errors!.filter((issue) => issue.code === 'duplicate_combination')
      .map((issue) => issue.field)
      .sort(),
    ['variants.0.combination', 'variants.2.combination'],
  )
  const context = await run<Context>('product.templateModalContext', { id: 'tee' })
  assert.deepEqual(context!.data.variantSetup!.lines, [])
  assert.deepEqual(context!.data.variantSetup!.variants, [])
})

test('variant setup: the combination key follows the stored line ids, so generating after a save adds nothing', async (t) => {
  const { run } = await boot(t)
  await teeCatalogue(run)
  // Two attributes on the same sequence: only the line id breaks the tie, and these
  // ids are not the ones `saveVariantSetup` would mint, so it has to read them.
  await run('product.saveAttribute', { id: 'color', name: 'Màu', sequence: 5 })
  await run('product.saveAttribute', { id: 'size', name: 'Size', sequence: 5 })
  await run('product.saveAttributeLine', {
    id: 'legacy-9-color',
    templateId: 'tee',
    attributeId: 'color',
    valueIds: ['red', 'black'],
  })
  await run('product.saveAttributeLine', {
    id: 'legacy-1-size',
    templateId: 'tee',
    attributeId: 'size',
    valueIds: ['s', 'l'],
  })

  const saved = await run<SaveResult>('product.saveVariantSetup', {
    templateId: 'tee',
    lines: teeLines,
    variants: [variant('red', 's'), variant('black', 'l')],
  })
  assert.equal(saved.ok, true, JSON.stringify(saved.errors))

  const generated = await run<{ ok: boolean; created?: number }>('product.generateVariants', {
    templateId: 'tee',
  })
  assert.equal(generated.ok, true)
  assert.equal(generated.created, 2, 'only the two combinations nobody saved yet')
  const context = await run<Context>('product.templateModalContext', { id: 'tee' })
  const rows = (context!.data.variantSetup!.variants ?? []) as Row[]
  assert.equal(
    rows.filter((row) => row.active).length,
    4,
    'the saved rows were found again, not archived and re-created',
  )
})

test('variant setup: a variant left out is archived, never deleted, and the default variant sells again once none remain', async (t) => {
  const { run } = await boot(t)
  await teeCatalogue(run)
  const first = await run<SaveResult>('product.saveVariantSetup', {
    templateId: 'tee',
    lines: teeLines,
    variants: [variant('red', 's'), variant('black', 'l')],
  })
  const [redS, blackL] = first.setup!.variants

  // Swap the two rows' combinations while dropping neither: the unique index must not trip.
  const swapped = await run<SaveResult>('product.saveVariantSetup', {
    templateId: 'tee',
    lines: teeLines,
    variants: [
      { ...redS, valueIds: { color: 'black', size: 'l' } },
      { ...blackL, valueIds: { color: 'red', size: 's' } },
    ],
  })
  assert.equal(swapped.ok, true, JSON.stringify(swapped.errors))

  const dropped = await run<SaveResult>('product.saveVariantSetup', {
    templateId: 'tee',
    lines: [],
    variants: [],
  })
  assert.equal(dropped.ok, true, JSON.stringify(dropped.errors))
  assert.equal(dropped.archived, 2)
  assert.equal(dropped.setup!.variants.length, 2, 'archived, still there')
  assert.ok(dropped.setup!.variants.every((row) => row.active === false))
  const context = await run<Context>('product.templateModalContext', { id: 'tee' })
  assert.equal(context!.data.hasVariants, false, 'General shows the default variant again')
})

test('product modal context: a module filling template.recordTabs adds a tab labelled by its own message', () => {
  const manifest = {
    fills: [
      {
        joint: 'product_backend:template.recordTabs',
        by: 'cosmetic_usage_care',
        template: '{% island "cosmetic-care.product-cycle-record" %}',
      },
      {
        joint: 'product_backend:template.tabs',
        by: 'cosmetic_usage_care',
        template: '{% island "cosmetic-care.product-cycle-tab" %}',
      },
      { joint: 'product_backend:template.recordTabs', by: 'plain_markup', template: '<p>not an island</p>' },
      {
        joint: 'product_backend:template.recordTabs',
        by: 'unlabelled',
        template: '{% island "unlabelled.panel" %}',
      },
    ],
    messages: {
      vi: { 'cosmetic_usage_care.productTemplateTab': 'Chu kỳ sử dụng' },
      en: { 'cosmetic_usage_care.productTemplateTab': 'Usage cycle' },
    },
  } as unknown as Parameters<typeof recordTabsFor>[0]['manifest']
  assert.deepEqual(recordTabsFor({ manifest }, 'vi'), [
    { id: 'cosmetic_usage_care', label: 'Chu kỳ sử dụng', island: 'cosmetic-care.product-cycle-record' },
    { id: 'unlabelled', label: 'unlabelled', island: 'unlabelled.panel' },
  ])
  assert.equal(recordTabsFor({ manifest }, 'en')[0]?.label, 'Usage cycle')
})
