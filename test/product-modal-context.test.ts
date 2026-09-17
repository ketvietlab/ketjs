import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { bootDeployment, callFn } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const companyScope = (company: string, branch = `root:${company}`) => ({
  company,
  companies: [company],
  branch,
  branches: [branch],
})

type Context = {
  data: {
    record: Row
    variants: Row[]
    hasVariants: boolean
    attributeLines: Row[]
    attributes: Row[]
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
  assert.deepEqual(context.variants, [])
  assert.deepEqual(context.attributeLines, [])
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

test('product modal context: an existing template carries its variants and attribute lines', async (t) => {
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
  assert.equal(context.variants.length, 2)
  assert.equal(context.attributeLines.length, 1)
  assert.equal(context.attributeLines[0]?.attributeId, 'color')
  assert.equal((context.attributeLines[0]!.values as Row[]).length, 2)
  // Only attributes that actually generate variants belong on this tab.
  assert.deepEqual(
    context.attributes.map((a) => a.value),
    ['color'],
  )
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
