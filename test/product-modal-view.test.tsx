import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import {
  createVariantEditorView,
  type VariantEditorSetup,
} from '../packages/ketsuite/src/ui/client/variant-editor-view.tsx'
import {
  templateModalDefinition,
  type TemplateModalData,
  type TemplateRecord,
} from '../packages/ketsuite/src/modules/product_backend/modal/product-modal-view.tsx'

type Options = {
  creating?: boolean
  state?: Record<string, string>
  dialog?: { name: string; params: Record<string, string> } | null
  tab?: string
}

const contextOf = (
  data: TemplateModalData,
  options: Options = {},
): RecordModalContext<TemplateModalData> => ({
  kind: 'product.template',
  id: options.creating ? 'new' : data.record.id,
  creating: options.creating === true,
  tab: options.tab ?? '',
  data,
  t: (key) => key,
  outcome: () => null,
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
  images: [],
  hasVariants: false,
  variantSetup: null,
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
    delete: true,
    saveVariantSetup: true,
    configureStock: true,
    setTax: true,
  },
  lang: 'vi',
  ...overrides,
})

const generalTab = templateModalDefinition.tabs!.find((tab) => tab.id === 'general')!.view
const variantsTab = templateModalDefinition.tabs!.find((tab) => tab.id === 'variants')!.view
const commands = templateModalDefinition.commands!

const render = (child: JSXChild): string => renderToString(child as TemplateResult)

test('product modal: General has no submit button of its own — the header submits its form by id, with tracking/tax fields only when installed', () => {
  const full = render(generalTab(contextOf(templateData())))
  assert.doesNotMatch(full, /type="submit"/, 'the header owns the one Save button, not the tab body')
  assert.match(full, /id="product-template-general-form"/)
  assert.match(full, /name="isStorable"/)
  assert.match(full, /name="taxId"/)

  const bare = render(generalTab(contextOf(templateData({ stockEnabled: false, taxEnabled: false }))))
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

const teeSetup = (): VariantEditorSetup => ({
  templateId: 'tpl-1',
  listPrice: '200000',
  lines: [
    {
      attributeId: 'color',
      name: 'Màu',
      createVariant: 'always',
      displayType: 'select',
      values: [
        { valueId: 'red', name: 'Đỏ', priceExtra: '0' },
        { valueId: 'black', name: 'Đen', priceExtra: '0' },
      ],
    },
    {
      attributeId: 'size',
      name: 'Size',
      createVariant: 'always',
      displayType: 'select',
      values: [
        { valueId: 's', name: 'S', priceExtra: '0' },
        { valueId: 'l', name: 'L', priceExtra: '20000' },
      ],
    },
  ],
  catalogue: [],
  variants: [
    {
      id: 'v1',
      valueIds: { color: 'red', size: 'l' },
      defaultCode: 'TEE-RL',
      barcode: null,
      weight: '0',
      volume: '0',
      active: true,
      images: [],
    },
    {
      id: 'v2',
      valueIds: { color: 'red', size: 'l' },
      defaultCode: null,
      barcode: null,
      weight: '0',
      volume: '0',
      active: true,
      images: [],
    },
  ],
})

test('product modal: Attributes & variants mounts the editor island with the setup and whether the viewer may save', () => {
  const html = render(variantsTab(contextOf(templateData({ variantSetup: teeSetup() }))))
  assert.match(html, /data-island="product.variant-editor"/)
  assert.match(html, /&quot;saveFunction&quot;:&quot;product.saveVariantSetup&quot;/)
  assert.match(html, /&quot;editable&quot;:true/)
  assert.match(html, /&quot;save&quot;:&quot;product_backend.variantEditor.save&quot;/)

  const readOnly = render(
    variantsTab(
      contextOf(
        templateData({
          variantSetup: teeSetup(),
          permissions: { ...templateData().permissions, saveVariantSetup: false },
        }),
      ),
    ),
  )
  assert.match(readOnly, /&quot;editable&quot;:false/)
})

test('variant editor: rows price from list price plus value extras, and a shared combination is flagged on both rows', () => {
  const view = createVariantEditorView({
    id: 'editor',
    kind: 'product.template',
    setup: teeSetup(),
    editable: true,
    saveFunction: 'product.saveVariantSetup',
    labels: { duplicate: 'dup #{row}', missing: '{count} missing' },
    lightboxLabels: {
      open: 'Open {alt}',
      close: 'Close',
      previous: 'Previous',
      next: 'Next',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      counter: '{index} / {total}',
    },
    media: { upload: true, remove: true },
  })
  const html = renderToString(view.view())
  assert.match(html, /220\.000/, 'L adds 20.000 to the 200.000 list price')
  assert.match(html, /dup #2/)
  assert.match(html, /dup #1/)
  assert.match(html, /3 missing/, 'red·S, black·S and black·L have no variant yet')
})

test("product modal: the footer's More menu names archive vs restore by the record's state, and stays empty while creating", () => {
  const active = render(templateModalDefinition.actions!(contextOf(templateData())) as JSXChild)
  assert.match(active, /name="__command" value="archive"/)
  assert.match(active, /product_backend\.archive\.action/)
  assert.doesNotMatch(active, /product_backend\.archive\.restore/)
  // Delete lives in the same menu, gated by its own permission.
  assert.match(active, /name="__command" value="delete"/)
  // Its label is shortened for the footer row — the menu's own aria-label stays the fuller phrase.
  assert.match(active, /product_backend\.action\.moreShort/)
  // The trigger sits at the sheet's bottom edge, which clips overflow — opening
  // downward like the design system's default would run the panel past it.
  assert.match(active, /data-ui="menu"[^>]*data-placement="top"/)

  const archived = render(
    templateModalDefinition.actions!(
      contextOf(templateData({ record: record({ active: false }) })),
    ) as JSXChild,
  )
  assert.match(archived, /product_backend\.archive\.restore/)

  const archiveOnly = render(
    templateModalDefinition.actions!(
      contextOf(templateData({ permissions: { ...templateData().permissions, delete: false } })),
    ) as JSXChild,
  )
  assert.match(archiveOnly, /name="__command" value="archive"/)
  assert.doesNotMatch(archiveOnly, /name="__command" value="delete"/)

  const noPermission = render(
    templateModalDefinition.actions!(
      contextOf(
        templateData({ permissions: { ...templateData().permissions, archive: false, delete: false } }),
      ),
    ) as JSXChild,
  )
  // Save and Close still show — only the More menu itself has nothing left to offer.
  assert.doesNotMatch(noPermission, /name="__command" value="archive"|name="__command" value="delete"/)
  assert.doesNotMatch(noPermission, /product_backend\.action\.moreShort/)
  // No second title line — the record's own name and state already sit in the modal's chrome.
  assert.doesNotMatch(active, /data-ui="record-summary"/)
  assert.doesNotMatch(active, /product_backend\.type\.goods/)

  // Creating has no footer at all — ModalSheet renders none when `actions` is undefined,
  // not an empty bar — and the create form owns its own submit button in the body.
  assert.equal(templateModalDefinition.actions!(contextOf(templateData(), { creating: true })), undefined)
})

test('product modal: the footer carries Save (the General form, or the variant editor form on its tab) and Close beside More, outside the scrolling body', () => {
  const onGeneral = render(
    templateModalDefinition.actions!(contextOf(templateData(), { tab: 'general' })) as JSXChild,
  )
  assert.match(onGeneral, /name="__command" value="save"/)
  assert.match(onGeneral, /form="product-template-general-form"/)
  assert.doesNotMatch(onGeneral.match(/name="__command" value="save"[^>]*/)?.[0] ?? '', /disabled/)
  assert.match(onGeneral, /data-record-close="true"/)
  assert.match(onGeneral, /product_backend\.action\.close/)

  // On Attributes & variants, Save submits the editor island's own form instead, and
  // starts disabled until the island has a valid change to send.
  const onVariants = render(
    templateModalDefinition.actions!(
      contextOf(templateData({ variantSetup: teeSetup() }), { tab: 'variants' }),
    ) as JSXChild,
  )
  assert.doesNotMatch(onVariants, /name="__command" value="save"/)
  const variantSave = onVariants.match(/<button[^>]*form="product-variant-editor-[^"]*-save"[^>]*/)?.[0] ?? ''
  assert.match(variantSave, /disabled/)

  const readOnly = render(
    templateModalDefinition.actions!(
      contextOf(templateData({ permissions: { ...templateData().permissions, save: false } }), {
        tab: 'general',
      }),
    ) as JSXChild,
  )
  assert.doesNotMatch(readOnly, /name="__command" value="save"/)
  assert.match(readOnly, /data-record-close="true"/, 'Close still shows without save permission')
})

test('product modal: a tab another module adds renders its island with the template, and none while creating', () => {
  const data = templateData({
    extensionTabs: [
      { id: 'cosmetic_usage_care', label: 'Chu kỳ sử dụng', island: 'cosmetic-care.product-cycle-record' },
    ],
  })
  const [tab] = templateModalDefinition.extensionTabs!(contextOf(data))
  assert.equal(tab?.id, 'cosmetic_usage_care')
  assert.equal(tab?.label(contextOf(data)), 'Chu kỳ sử dụng')
  const html = render(tab!.view(contextOf(data)))
  assert.match(html, /<ket-island data-island="cosmetic-care\.product-cycle-record"/u)
  assert.match(
    html,
    /data-props="\{&quot;templateId&quot;:&quot;tpl-1&quot;,&quot;locale&quot;:&quot;vi&quot;\}"/u,
  )
  assert.deepEqual(templateModalDefinition.extensionTabs!(contextOf(data, { creating: true })), [])
  assert.deepEqual(templateModalDefinition.extensionTabs!(contextOf(templateData())), [])
})

test("product modal: the modal's own chrome carries the active/archived badge, not a body line", () => {
  const badge = render(templateModalDefinition.status!(contextOf(templateData())))
  assert.match(badge, /product_backend\.state\.active/)
  assert.equal(templateModalDefinition.status!(contextOf(templateData(), { creating: true })), '')
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

test('product modal commands: save runs template, stock and tax in sequence, each side call gated by its own condition', () => {
  assert.equal(commands.save!.fn, 'product.saveTemplate')
  const also = commands.save!.also!
  assert.equal(also.length, 2)
  assert.equal(also[0]!.fn, 'stock.configureProduct')
  assert.equal(also[1]!.fn, 'account.setProductTax')

  const form = new FormData()
  form.set('isStorable', '1')
  form.set('tracking', 'lot')
  form.set('taxId', 'vat-10')
  const ctx = contextOf(templateData())
  assert.deepEqual(also[0]!.input(form, ctx, {}), {
    templateId: 'tpl-1',
    isStorable: true,
    tracking: 'lot',
  })
  assert.deepEqual(also[1]!.input(form, ctx, {}), { templateId: 'tpl-1', taxId: 'vat-10' })

  // Neither side call runs without its module installed and its own permission.
  assert.equal(also[0]!.when!(ctx), true)
  assert.equal(also[1]!.when!(ctx), true)
  const noStock = contextOf(templateData({ stockEnabled: false }))
  const noPermission = contextOf(
    templateData({ permissions: { ...templateData().permissions, configureStock: false, setTax: false } }),
  )
  assert.equal(also[0]!.when!(noStock), false)
  assert.equal(also[0]!.when!(noPermission), false)
  assert.equal(also[1]!.when!(noPermission), false)
})

test('product modal commands: archive carries the record id with no extra form fields', () => {
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
})

test('product modal commands: delete removes only this template and asks before running', () => {
  assert.deepEqual(commands.delete!.input(new FormData(), contextOf(templateData()), {}), { ids: ['tpl-1'] })
  assert.equal(commands.delete!.after, 'close')
  assert.equal(typeof commands.delete!.confirm, 'function')
  assert.match(commands.delete!.confirm!(contextOf(templateData()))!, /archive\.deleteConfirm/)
})
