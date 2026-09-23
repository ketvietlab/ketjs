import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { address, company, partner, product, uom, user } from '@ketvietlab/ketsuite'

const modules = [address, partner, company, user, uom, product]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
type Result = { ok: boolean; id?: string; values?: Row[]; errors?: Array<{ field: string; code: string }> }
const draft = (extra: Row = {}) => ({
  id: 'color',
  name: 'Color',
  displayType: 'color',
  createVariant: 'always',
  values: [
    { id: 'red', name: 'Red', htmlColor: '#ff0000' },
    { id: 'blue', name: 'Blue', htmlColor: '#0000ff' },
  ],
  ...extra,
})
const boot = async (t: TestContext) => {
  const db = sqliteAdapter()
  await db.open()
  t.after(() => db.close())
  await migrateOne(db, manifest)
  registerFunctions(modules)
  const run = async <T = Result>(fn: string, args: Row = {}, actor: string | null = null) =>
    (await callFn(fn, args, { adapter: db, manifest, scope, actor })).value as T
  const save = (args: Row = draft()) => run('product.saveAttributeDraft', args)
  const snapshot = async () => ({
    attributes: await db.all('SELECT * FROM product_attribute ORDER BY id'),
    values: await db.all('SELECT * FROM product_attribute_value ORDER BY id'),
  })
  return { db, run, save, snapshot }
}

test('attribute draft: saves ordered values atomically, preserves IDs, allocates new ones and clears colors', async (t) => {
  const { save, run } = await boot(t)
  assert.equal((await save()).ok, true)
  const saved = await save(
    draft({
      name: ' Color revised ',
      sequence: 7,
      displayType: 'pills',
      values: [
        { id: 'blue', name: ' Blue revised ', htmlColor: null, sequence: 900 },
        { name: 'Green', htmlColor: '#00FF00', sequence: -10 },
        { id: 'red', name: 'Red', htmlColor: '', sequence: 200 },
      ],
    }),
  )
  assert.equal(saved.ok, true)
  assert.ok(saved.values?.[1]?.id)
  assert.notEqual(saved.values?.[1]?.id, 'red')
  const rows = await run<Row[]>('product.listAttributeValues', { attributeId: 'color' })
  assert.deepEqual(
    rows.map((row) => [row.id, row.name, row.sequence, row.htmlColor]),
    [
      ['blue', 'Blue revised', 1, null],
      [saved.values![1]!.id, 'Green', 2, '#00FF00'],
      ['red', 'Red', 3, null],
    ],
  )
  const attributes = await run<Row[]>('product.listAttributes')
  assert.equal(attributes[0]?.name, 'Color revised')
  assert.equal(attributes[0]?.sequence, 7)
  assert.equal(attributes[0]?.displayType, 'pills')
})

test('attribute draft: removes unused values and supports an empty attribute', async (t) => {
  const { save, run } = await boot(t)
  await save()
  assert.equal((await save(draft({ values: [] }))).ok, true)
  assert.deepEqual(await run('product.listAttributeValues', { attributeId: 'color' }), [])
  assert.equal((await save(draft({ id: 'scent', name: 'Scent', values: [] }))).ok, true)
})

test('attribute draft: rejects malformed rows, duplicate names/IDs and colors without any writes', async (t) => {
  const { save, snapshot } = await boot(t)
  await save()
  const before = await snapshot()
  const cases: Array<[Row, string, string]> = [
    [{ name: '  ' }, 'name', 'required'],
    [{ displayType: 'unknown' }, 'displayType', 'displayType'],
    [{ createVariant: 'dynamic' }, 'createVariant', 'createVariant'],
    [{ values: {} }, 'values', 'values'],
    [{ values: [null] }, 'values.0', 'values'],
    [{ values: [{ id: 'red', name: '' }] }, 'values.0.name', 'required'],
    [
      {
        values: [
          { id: 'red', name: 'Red' },
          { id: 'green', name: ' red ' },
        ],
      },
      'values.1.name',
      'duplicateValue',
    ],
    [
      {
        values: [
          { id: 'red', name: 'Red' },
          { id: 'red', name: 'Green' },
        ],
      },
      'values.1.id',
      'duplicateId',
    ],
    [{ values: [{ id: 12, name: 'Red' }] }, 'values.0.id', 'valueId'],
    [{ values: [{ name: 'Red', htmlColor: 'red' }] }, 'values.0.htmlColor', 'color'],
    [{ values: [{ name: 'Red', htmlColor: 12 }] }, 'values.0.htmlColor', 'color'],
  ]
  for (const [extra, field, reason] of cases) {
    const result = await save(draft({ name: 'Should not save', ...extra }))
    assert.equal(result.ok, false, reason)
    assert.deepEqual(result.errors, [{ field, code: `product.error.attribute.${reason}` }])
    assert.deepEqual(await snapshot(), before, reason)
  }
  const duplicate = await save(draft({ id: 'another', name: ' color ', values: [] }))
  assert.equal(duplicate.errors?.[0]?.code, 'product.error.attribute.duplicateName')
  assert.deepEqual(await snapshot(), before)
})

test('attribute draft: rejects foreign IDs without reparenting or changing either attribute', async (t) => {
  const { save, snapshot } = await boot(t)
  await save()
  await save(draft({ id: 'size', name: 'Size', values: [{ id: 'small', name: 'Small' }] }))
  const before = await snapshot()
  const result = await save(draft({ name: 'Changed', values: [{ id: 'small', name: 'Stolen' }] }))
  assert.deepEqual(result.errors, [{ field: 'values.0.id', code: 'product.error.attribute.foreignValue' }])
  assert.deepEqual(await snapshot(), before)
})

test('attribute draft: refuses removal of used values and policy changes, preserves generated variants', async (t) => {
  const { save, run, snapshot, db } = await boot(t)
  await save()
  await run('product.saveTemplate', { id: 'shirt', name: 'Shirt', type: 'goods' })
  await run('product.saveAttributeLine', {
    id: 'shirt:color',
    templateId: 'shirt',
    attributeId: 'color',
    valueIds: ['red'],
  })
  await run('product.generateVariants', { templateId: 'shirt' })
  const before = await snapshot()
  const variants = await db.all('SELECT * FROM product_product ORDER BY id')
  const removed = await save(draft({ name: 'Changed', values: [{ id: 'blue', name: 'Blue' }] }))
  assert.deepEqual(removed.errors, [{ field: 'values', code: 'product.error.attribute.valueInUse' }])
  const changed = await save(draft({ createVariant: 'no_variant' }))
  assert.deepEqual(changed.errors, [{ field: 'createVariant', code: 'product.error.attribute.policyInUse' }])
  assert.deepEqual(await snapshot(), before)
  assert.deepEqual(await db.all('SELECT * FROM product_product ORDER BY id'), variants)
  assert.equal((await save(draft({ name: 'Allowed rename', displayType: 'radio' }))).ok, true)
})

test('attribute draft: late database failure rolls back parent edits, new rows and deletions', async (t) => {
  const { save, db, snapshot } = await boot(t)
  await save()
  const before = await snapshot()
  await db.exec(`CREATE TRIGGER refuse_blue_delete BEFORE DELETE ON product_attribute_value
    WHEN OLD.id = 'blue' BEGIN SELECT RAISE(ABORT, 'forced attribute rollback'); END`)
  await assert.rejects(
    save(draft({ name: 'Changed', values: [{ id: 'green', name: 'Green' }] })),
    /forced attribute rollback/,
  )
  assert.deepEqual(await snapshot(), before)
})

test('attribute draft: shared attributes remain visible across companies', async (t) => {
  const { save, db } = await boot(t)
  await save()
  const result = await callFn(
    'product.listAttributes',
    {},
    { adapter: db, manifest, scope: { company: 'other', branches: null } },
  )
  assert.equal((result.value as Row[])[0]?.name, 'Color')
})

test('attribute modal context: defaults, ordered colors, missing records and effective read/save permissions', async (t) => {
  const { run, save } = await boot(t)
  for (const [fn, args] of [
    ['partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }],
    ['company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }],
    ['user.createUser', { id: 'root', login: 'root', name: 'Root', superuser: true }],
    ['user.createUser', { id: 'reader', login: 'reader', name: 'Reader' }],
    ['user.createUser', { id: 'nobody', login: 'nobody', name: 'Nobody' }],
    ['user.grantCompany', { id: 'reader:acme', userId: 'reader', companyId: 'acme' }],
    ['user.grantCompany', { id: 'nobody:acme', userId: 'nobody', companyId: 'acme' }],
    ['user.saveRole', { id: 'reader-role', name: 'Reader' }],
    ['user.grantFunction', { id: 'reader:list', roleId: 'reader-role', fnKey: 'product.listAttributes' }],
    ['user.assignRole', { id: 'reader:role', userId: 'reader', roleId: 'reader-role' }],
  ] as const)
    assert.equal((await run(fn, args)).ok, true, fn)
  type Context = {
    data: { record: Row; permissions: { save: boolean }; lang: string }
    messages: Record<string, string>
  } | null
  const creating = await run<Context>('product.attributeModalContext', { locale: 'en' }, 'root')
  assert.ok(creating)
  assert.deepEqual(creating.data.record, {
    id: '',
    name: '',
    displayType: 'select',
    createVariant: 'always',
    sequence: 10,
    values: [],
  })
  assert.equal(creating.data.permissions.save, true)
  assert.equal(creating.data.lang, 'en')
  assert.equal(creating.messages['recordModal.close'], 'Close')
  assert.equal(creating.messages['recordModal.loading'], 'Loading…')
  assert.equal(creating.messages['recordModal.unsaved'], 'Discard unsaved changes?')
  assert.ok(creating.messages['product.error.attribute.valueInUse'])
  await save(
    draft({
      values: [
        { id: 'blue', name: 'Blue', htmlColor: '#0000ff' },
        { id: 'red', name: 'Red', htmlColor: '#ff0000' },
      ],
    }),
  )
  const editing = await run<Context>('product.attributeModalContext', { id: 'color' }, 'reader')
  assert.ok(editing)
  assert.equal(editing.data.permissions.save, false)
  assert.equal(editing.data.lang, 'vi')
  assert.equal(editing.messages['recordModal.close'], 'Đóng')
  assert.equal(editing.messages['recordModal.loading'], 'Đang tải…')
  assert.equal(editing.messages['recordModal.unsaved'], 'Bỏ các thay đổi chưa lưu?')
  assert.equal(editing.messages['recordModal.errorTitle'], 'Chưa lưu được')
  assert.deepEqual(
    (editing.data.record.values as Row[]).map((row) => [row.id, row.htmlColor, row.sequence]),
    [
      ['blue', '#0000ff', 1],
      ['red', '#ff0000', 2],
    ],
  )
  assert.equal(await run('product.attributeModalContext', {}, 'reader'), null)
  assert.equal(await run('product.attributeModalContext', { id: 'color' }, 'nobody'), null)
  assert.equal(await run('product.attributeModalContext', { id: 'missing' }, 'root'), null)
  assert.equal(await run('product.attributeModalContext', { id: 'color' }), null)
})
