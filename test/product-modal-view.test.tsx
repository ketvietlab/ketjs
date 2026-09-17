import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { FieldOption } from '@ketvietlab/design-system'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import {
  templateModalDefinition,
  type TemplateModalData,
  type TemplateRecord,
} from '../packages/ketsuite/src/modules/product_backend/modal/product-modal-view.tsx'

type Options = {
  creating?: boolean
  state?: Record<string, string>
  dialog?: { name: string; params: Record<string, string> } | null
}

const contextOf = (
  data: TemplateModalData,
  options: Options = {},
): RecordModalContext<TemplateModalData> => ({
  kind: 'product.template',
  id: options.creating ? 'new' : data.record.id,
  creating: options.creating === true,
  tab: '',
  data,
  t: (key) => key,
  fieldError: () => null,
  draft: (_name, fallback = '') => fallback,
  draftChecked: (_name, _value, fallback = false) => fallback,
  busy: false,
  dialog: options.dialog ?? null,
  href: () => '',
  state: (key, fallback = '') => options.state?.[key] ?? fallback,
})

const record = (overrides: Partial<TemplateRecord> = {}): TemplateRecord => ({
  id: 'tpl-1',
  name: 'Áo thun',
  type: 'goods',
  categoryId: null,
  brandId: null,
  uomId: 'unit',
  origin: null,
  description: null,
  listPrice: '100000',
  saleOk: true,
  purchaseOk: true,
  defaultCode: null,
  barcode: null,
  active: true,
  isStorable: false,
  tracking: 'none',
  taxId: null,
  ...overrides,
})

const templateData = (overrides: Partial<TemplateModalData> = {}): TemplateModalData => ({
  record: record(),
  variants: [],
  hasVariants: false,
  attributeLines: [],
  attributes: [],
  attributeValuesByAttribute: {},
  types: ['goods', 'service'],
  categories: [],
  uoms: [{ value: 'unit', label: 'Cái' }],
  brands: [],
  taxes: [],
  stockEnabled: true,
  taxEnabled: true,
  permissions: {
    save: true,
    archive: true,
    generateVariants: true,
    saveAttributeLine: true,
    removeAttributeLine: true,
    saveVariant: true,
    configureStock: true,
    setTax: true,
  },
  lang: 'vi',
  ...overrides,
})

const generalTab = templateModalDefinition.tabs!.find((tab) => tab.id === 'general')!.view
const variantsTab = templateModalDefinition.tabs!.find((tab) => tab.id === 'variants')!.view
const variantDialog = templateModalDefinition.dialogs!.variant!.view
const commands = templateModalDefinition.commands!

const render = (child: JSXChild): string => renderToString(child as TemplateResult)

test('product modal: General offers a save button plus tracking/tax buttons only when installed and permitted', () => {
  const full = render(generalTab(contextOf(templateData())))
  assert.match(full, /name="__command" value="save"/)
  assert.match(full, /name="__command" value="configureStock"/)
  assert.match(full, /name="__command" value="setTax"/)
  assert.match(full, /name="isStorable"/)
  assert.match(full, /name="taxId"/)

  const bare = render(generalTab(contextOf(templateData({ stockEnabled: false, taxEnabled: false }))))
  assert.doesNotMatch(bare, /name="__command" value="configureStock"/)
  assert.doesNotMatch(bare, /name="__command" value="setTax"/)
  assert.doesNotMatch(bare, /name="isStorable"/)
  assert.doesNotMatch(bare, /name="taxId"/)
})

test('product modal: a reader without save permission sees a read-only General form and no buttons', () => {
  const data = templateData({ permissions: { ...templateData().permissions, save: false } })
  const html = render(generalTab(contextOf(data)))
  assert.doesNotMatch(html, /type="submit"/)
  assert.match(html, /product_backend\.readOnly\.title/)
  assert.match(html, /<input[^>]*name="name"[^>]*disabled/)
})

test('product modal: identity fields move off General once a template has variants', () => {
  const withoutVariants = render(generalTab(contextOf(templateData())))
  assert.match(withoutVariants, /name="defaultCode"/)
  assert.match(withoutVariants, /name="barcode"/)

  const withVariants = render(generalTab(contextOf(templateData({ hasVariants: true }))))
  assert.doesNotMatch(withVariants, /name="defaultCode"/)
  assert.doesNotMatch(withVariants, /name="barcode"/)
})

test("product modal: the attribute-line form offers only the selected attribute's own values", () => {
  const attributes: FieldOption[] = [
    { value: 'color', label: 'Màu' },
    { value: 'size', label: 'Size' },
  ]
  const data = templateData({
    attributes,
    attributeValuesByAttribute: {
      color: [
        { value: 'red', label: 'Đỏ' },
        { value: 'blue', label: 'Xanh' },
      ],
      size: [{ value: 'm', label: 'M' }],
    },
  })
  const byDefault = render(variantsTab(contextOf(data)))
  assert.match(byDefault, /name="value_red"/)
  assert.match(byDefault, /name="value_blue"/)
  assert.doesNotMatch(byDefault, /name="value_m"/)

  const switched = render(variantsTab(contextOf(data, { state: { attributeId: 'size' } })))
  assert.match(switched, /name="value_m"/)
  assert.doesNotMatch(switched, /name="value_red"/)
})

test('product modal: Variants offers to generate them until the template has some, then lists and opens each in a dialog', () => {
  const none = render(variantsTab(contextOf(templateData())))
  assert.match(none, /name="__command" value="generateVariants"/)
  assert.match(none, /product_backend\.variants\.empty/)

  const withVariants = templateData({
    hasVariants: true,
    variants: [{ id: 'v1', defaultCode: 'AO-DO', values: [{ value: 'Đỏ' }], active: true }],
  })
  const html = render(variantsTab(contextOf(withVariants)))
  assert.match(html, /data-record-dialog="variant"/)
  assert.match(html, /data-record-param-id="v1"/)
})

test('product modal: the variant dialog edits the variant named by the dialog params', () => {
  const data = templateData({
    variants: [{ id: 'v1', defaultCode: 'AO-DO', barcode: '123', weight: 0.2, volume: 0.1 }],
  })
  const html = render(variantDialog(contextOf(data, { dialog: { name: 'variant', params: { id: 'v1' } } })))
  assert.match(html, /name="__command" value="variantSave"/)
  assert.match(html, /name="defaultCode"/)
  assert.doesNotMatch(html, /name="standardPrice"|name="uomId"/, 'cost and unit stay on the old variant page')

  const missing = render(
    variantDialog(contextOf(data, { dialog: { name: 'variant', params: { id: 'ghost' } } })),
  )
  assert.doesNotMatch(missing, /name="__command"/)
})

test("product modal: header names archive vs restore by the record's state, and stays empty while creating", () => {
  const active = render(templateModalDefinition.header!(contextOf(templateData())))
  assert.match(active, /name="__command" value="archive"/)
  assert.match(active, /product_backend\.archive\.action/)
  assert.doesNotMatch(active, /product_backend\.archive\.restore/)

  const archived = render(
    templateModalDefinition.header!(contextOf(templateData({ record: record({ active: false }) }))),
  )
  assert.match(archived, /product_backend\.archive\.restore/)

  const noPermission = render(
    templateModalDefinition.header!(
      contextOf(templateData({ permissions: { ...templateData().permissions, archive: false } })),
    ),
  )
  assert.doesNotMatch(noPermission, /name="__command"/)

  assert.equal(templateModalDefinition.header!(contextOf(templateData(), { creating: true })), '')
})

test('product modal: creating renders the create form; an existing record has no body of its own', () => {
  const html = render(templateModalDefinition.body!(contextOf(templateData(), { creating: true })))
  assert.match(html, /name="__command" value="create"/)
  assert.match(html, /name="name"/)
  assert.match(html, /name="type"/)

  assert.equal(templateModalDefinition.body!(contextOf(templateData())), '')
})

test('product modal commands: create mints its own id and opens the created record on General', () => {
  assert.equal(commands.create!.after, 'open')
  assert.equal(commands.create!.openTab, 'general')
  assert.equal(commands.create!.created!({ id: 'tpl-9' }), 'tpl-9')
  assert.equal(commands.create!.created!({}), null)

  const form = new FormData()
  form.set('name', 'Áo mới')
  form.set('type', 'goods')
  form.set('listPrice', '250000')
  const input = commands.create!.input(form, contextOf(templateData(), { creating: true }), {})
  assert.equal(input.name, 'Áo mới')
  assert.equal(input.type, 'goods')
  assert.equal(input.listPrice, '250000')
  assert.equal(typeof input.id, 'string')
  assert.notEqual(input.id, '')
})

test('product modal commands: save carries defaultCode/barcode only for a single-variant template', () => {
  const form = new FormData()
  form.set('name', 'Áo thun')
  form.set('type', 'goods')
  form.set('defaultCode', 'AO-01')
  form.set('barcode', '8900000000000')
  form.set('saleOk', '1')

  const single = commands.save!.input(form, contextOf(templateData()), {})
  assert.equal(single.defaultCode, 'AO-01')
  assert.equal(single.barcode, '8900000000000')
  assert.equal(single.saleOk, true)
  assert.equal(single.purchaseOk, false)

  const withVariants = commands.save!.input(form, contextOf(templateData({ hasVariants: true })), {})
  assert.equal(Object.hasOwn(withVariants, 'defaultCode'), false)
  assert.equal(Object.hasOwn(withVariants, 'barcode'), false)
  assert.equal(commands.save!.after, 'refresh')
})

test('product modal commands: stock config, tax, archive and generate carry the record id with no extra form fields', () => {
  const stockForm = new FormData()
  stockForm.set('isStorable', '1')
  stockForm.set('tracking', 'lot')
  assert.deepEqual(commands.configureStock!.input(stockForm, contextOf(templateData()), {}), {
    templateId: 'tpl-1',
    isStorable: true,
    tracking: 'lot',
  })

  const taxForm = new FormData()
  taxForm.set('taxId', 'vat-10')
  assert.deepEqual(commands.setTax!.input(taxForm, contextOf(templateData()), {}), {
    templateId: 'tpl-1',
    taxId: 'vat-10',
  })

  assert.deepEqual(commands.archive!.input(new FormData(), contextOf(templateData()), {}), {
    id: 'tpl-1',
    active: false,
  })
  assert.deepEqual(
    commands.archive!.input(
      new FormData(),
      contextOf(templateData({ record: record({ active: false }) })),
      {},
    ),
    { id: 'tpl-1', active: true },
  )
  assert.deepEqual(commands.generateVariants!.input(new FormData(), contextOf(templateData()), {}), {
    templateId: 'tpl-1',
  })
})

test('product modal commands: an attribute line saves only the checked values of its own attribute', () => {
  const data = templateData({
    attributeValuesByAttribute: {
      color: [
        { value: 'red', label: 'Đỏ' },
        { value: 'blue', label: 'Xanh' },
      ],
    },
  })
  const form = new FormData()
  form.set('attributeId', 'color')
  form.set('value_red', '1')
  const input = commands.saveAttributeLine!.input(form, contextOf(data), {})
  assert.equal(input.templateId, 'tpl-1')
  assert.equal(input.attributeId, 'color')
  assert.deepEqual(input.valueIds, ['red'])

  const removeForm = new FormData()
  removeForm.set('id', 'tpl-1:color')
  assert.deepEqual(commands.removeAttributeLine!.input(removeForm, contextOf(data), {}), {
    id: 'tpl-1:color',
  })
})

test('product modal commands: a variant save reads its id from the open dialog, not the form', () => {
  const form = new FormData()
  form.set('defaultCode', 'AO-UPDATED')
  form.set('weight', '0.3')
  const input = commands.variantSave!.input(
    form,
    contextOf(templateData(), { dialog: { name: 'variant', params: { id: 'v1' } } }),
    {},
  )
  assert.equal(input.id, 'v1')
  assert.equal(input.templateId, 'tpl-1')
  assert.equal(input.defaultCode, 'AO-UPDATED')
  assert.equal(input.weight, '0.3')
  assert.equal(commands.variantSave!.after, 'reload')
})
