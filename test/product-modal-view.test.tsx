import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countingHost, mount, renderToString } from '@ketvietlab/ketjs-view'
import type { HostNode } from '@ketvietlab/ketjs-view'
import { createVariantAttributeForm } from '../packages/ketsuite/src/ui/client/variant-attribute-create.tsx'
import { relationSelectDemoConfig } from '../packages/design-system/src/interactions/relation-select/demo.ts'
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

test('variant editor: quick creation preserves input on failure and reuses IDs on retry before selecting the new values', async (t) => {
  class Input {
    name: string
    value: string
    constructor(name: string, value: string) {
      this.name = name
      this.value = value
    }
  }
  class Target {
    closest() {
      return { name: 'createAttribute', disabled: false }
    }
  }
  let click: (event: { target: Target }) => void = () => {}
  const calls: Record<string, unknown>[] = []
  const added: unknown[] = []
  let fail = true
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)))
    if (fail) throw new Error('offline')
    return Response.json({ value: { ok: true } })
  })
  const globals = globalThis as unknown as Record<string, unknown>
  const replacements = {
    Element: Target,
    HTMLInputElement: Input,
    HTMLTextAreaElement: Input,
    document: { getElementById: () => null, dispatchEvent: () => true },
  }
  const previous = Object.fromEntries(Object.keys(replacements).map((key) => [key, globals[key]]))
  Object.assign(globals, replacements)
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve))
  }
  const form = createVariantAttributeForm({
    id: 'quick',
    kind: 'product.template',
    enabled: true,
    disabled: () => false,
    t: (key) => key,
    added: (attribute) => added.push(attribute),
  })
  const host = countingHost()
  const root = host.root()
  const mounted = mount(host, root, () => <>{form.view()}</>)
  const lifetime = new AbortController()
  form.attach(
    {
      addEventListener: (_name: string, handler: typeof click) => {
        click = handler
      },
    } as unknown as HTMLElement,
    lifetime.signal,
  )
  const wrapper = (): HostNode => root.children!.find((node) => node.tag === 'div')!
  const type = (name: string, value: string) =>
    host.fire(wrapper(), 'input', { target: new Input(name, value) })
  const submit = async () => {
    host.fire(wrapper(), 'submit', { preventDefault() {}, stopPropagation() {} })
    await settle()
  }
  try {
    click({ target: new Target() })
    type('attributeName', ' Capacity ')
    type('attributeValues', '30 ml\n30 ml')
    await submit()
    assert.equal(calls.length, 0, 'duplicate values must not write anything')
    assert.match(render(form.view()), /attributeValuesDuplicate/)
    type('attributeValues', '30 ml\n50 ml')
    await submit()
    assert.match(render(form.view()), /attributeCreateFailed/)
    assert.match(render(form.view()), /Capacity/)
    assert.match(render(form.view()), /30 ml/)
    assert.equal(added.length, 0)
    fail = false
    await submit()
    assert.deepEqual(calls[1], calls[0], 'retry reuses IDs, avoiding duplicate shared attributes')
    assert.equal(added.length, 1)
    assert.equal(form.open(), false)
    assert.deepEqual(
      (added[0] as { values: Array<{ name: string }> }).values.map((value) => value.name),
      ['30 ml', '50 ml'],
    )
  } finally {
    lifetime.abort()
    mounted.dispose()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key]
      else globals[key] = value
    }
  }
})

test('variant editor: quick creation is absent without its separate permission', () => {
  const form = createVariantAttributeForm({
    id: 'quick',
    kind: 'product.template',
    enabled: false,
    disabled: () => false,
    t: (key) => key,
    added: () => assert.fail('readers cannot create attributes'),
  })
  assert.equal(form.view(), null)
})

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
    relationLabels: relationSelectDemoConfig.labels,
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
  assert.match(html, /data-ui="relation-select"/, 'attributes use the shared searchable relation selector')
  assert.doesNotMatch(html, /data-ui="variant-editor-add-attribute"/, 'no parallel native attribute picker')
  // Step 1 ticks values in a design-system checkbox group; step 2 rows open with a disclosure button.
  assert.match(html, /stepAttributes/)
  assert.match(html, /stepVariants/)
  assert.match(html, /data-kind="checkbox-group"/)
  assert.match(html, /name="values\|color\[\]" value="red" checked/)
  assert.match(html, /name="variantAction" value="toggleRow\|v1"[^>]*aria-expanded="false"/)
  assert.match(html, /name="variantAction" value="generate"/, 'the missing notice offers to create them')
  assert.match(html, /Đỏ \/ L/, 'a row reads as its combination')
  assert.doesNotMatch(html, /name="combo\|/, 'a collapsed row shows its combination as text, not selects')
})

test('variant editor: ticking values, generating the missing combinations and fixing extras keep one draft', () => {
  class FakeElement {
    button: unknown
    constructor(button: unknown = null) {
      this.button = button
    }
    closest() {
      return this.button
    }
  }
  class FakeInput extends FakeElement {
    name: string
    value: string
    type: string
    checked: boolean
    constructor(name: string, value: string, type = 'text', checked = false) {
      super()
      this.name = name
      this.value = value
      this.type = type
      this.checked = checked
    }
  }
  class FakeSelect extends FakeElement {}
  const globals = globalThis as unknown as Record<string, unknown>
  const replacements = {
    Element: FakeElement,
    HTMLInputElement: FakeInput,
    HTMLSelectElement: FakeSelect,
  }
  const previous = Object.fromEntries(Object.keys(replacements).map((key) => [key, globals[key]]))
  Object.assign(globals, replacements)
  const setup = teeSetup()
  setup.catalogue = [
    {
      attributeId: 'color',
      name: 'Màu',
      createVariant: 'always',
      values: [
        { valueId: 'red', name: 'Đỏ' },
        { valueId: 'black', name: 'Đen' },
        { valueId: 'white', name: 'Trắng' },
      ],
    },
    {
      attributeId: 'size',
      name: 'Size',
      createVariant: 'always',
      values: [
        { valueId: 's', name: 'S' },
        { valueId: 'l', name: 'L' },
      ],
    },
  ]
  // One row per combination already exists except the duplicate, so only new values are missing.
  setup.variants = [
    ['red', 's'],
    ['red', 'l'],
    ['black', 's'],
    ['black', 'l'],
  ].map(([color, size]) => ({
    id: `${color}-${size}`,
    valueIds: { color: color!, size: size! },
    defaultCode: null,
    barcode: null,
    weight: '0',
    volume: '0',
    active: true,
    images: [],
  }))
  const view = createVariantEditorView({
    id: 'editor',
    kind: 'product.template',
    setup,
    editable: true,
    saveFunction: 'product.saveVariantSetup',
    labels: {
      missing: '{count} missing',
      generate: 'Create {count}',
      valuesSelected: '{count}/{total} selected',
      invalidNumber: 'bad number',
      rowInvalid: 'row bad',
      incomplete: 'incomplete',
      new: 'new',
      summaryInvalid: 'fix numbers',
    },
    relationLabels: relationSelectDemoConfig.labels,
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
  const host = countingHost()
  const root = host.root()
  const mounted = mount(host, root, () => view.view())
  const editor = (): HostNode => root.children!.find((node) => node.tag === 'div')!
  const html = () => render(view.view())
  const tick = (attributeId: string, valueId: string, checked: boolean) =>
    host.fire(editor(), 'change', {
      target: new FakeInput(`values|${attributeId}[]`, valueId, 'checkbox', checked),
    })
  const press = (value: string) =>
    host.fire(editor(), 'click', {
      target: new FakeElement({ name: 'variantAction', value, disabled: false }),
    })
  try {
    assert.match(html(), /2\/3 selected/)
    assert.doesNotMatch(html(), /missing/, 'every ticked combination has a row')

    tick('color', 'white', true)
    assert.match(html(), /name="values\|color\[\]" value="white" checked/)
    assert.match(html(), /3\/3 selected/)
    assert.match(html(), /2 missing/, 'white·S and white·L')
    assert.match(html(), /Create 2/)

    press('generate')
    assert.doesNotMatch(html(), /missing/)
    assert.equal((html().match(/data-ui="variant-editor-row"/g) ?? []).length, 6)
    assert.match(html(), /Trắng \/ S/)
    assert.match(html(), /Trắng \/ L/)
    assert.equal((html().match(/>new</g) ?? []).length, 2)

    // Unticking a value in use leaves its rows without a combination instead of deleting them.
    tick('color', 'white', false)
    assert.equal((html().match(/>incomplete</g) ?? []).length, 2)
    tick('color', 'white', true)
    assert.doesNotMatch(html(), />incomplete</)

    // Price extras keep typed text, flag it, and put it back on Reset.
    host.fire(editor(), 'input', { target: new FakeInput('extra|size|l', 'abc') })
    assert.match(html(), /bad number/)
    assert.match(html(), /fix numbers/)
    host.fire(editor(), 'input', { target: new FakeInput('extra|size|l', '25000') })
    assert.match(html(), /225\.000/, 'L now adds 25.000 to the 200.000 list price')

    press('reset')
    assert.match(html(), /2\/3 selected/)
    assert.equal((html().match(/data-ui="variant-editor-row"/g) ?? []).length, 4)
    assert.match(html(), /220\.000/)

    // A row opens to edit its combination and fields, announced on its toggle.
    press('toggleRow|red-s')
    assert.match(html(), /value="toggleRow\|red-s"[^>]*aria-expanded="true" aria-controls="editor-row-red-s"/)
    assert.match(html(), /name="combo\|red-s\|color"/)
    assert.match(html(), /name="field\|red-s\|defaultCode"/)
    // Every row's Sửa/Lưu trữ repeat the same words, so each is described by its combination.
    assert.match(html(), /<strong id="editor-row-red-s-title"[^>]*>(?:<!--k\[-->)*Đỏ \/ S</)
    assert.equal((html().match(/aria-describedby="editor-row-red-s-title"/g) ?? []).length, 2)

    // A bad weight stays flagged on the row after it is closed, not only inside it.
    host.fire(editor(), 'input', { target: new FakeInput('field|red-s|weight', '1,5') })
    press('toggleRow|red-s')
    assert.doesNotMatch(html(), /name="field\|red-s\|weight"/)
    assert.match(html(), />row bad</)
    assert.match(html(), /fix numbers/)

    // A saved row takes its image through the design-system drop zone, with the drop hint inside it.
    press('toggleRow|black-l')
    assert.match(
      html(),
      /<div data-ui="drop-zone">(?:<!--k\[-->)*<input data-ui="field-control" id="editor-row-black-l-image" type="file" name="image\|black-l"/,
    )
    assert.match(html(), /<div data-ui="upload-status">(?:<!--k\[-->)*dropImage</)
    assert.doesNotMatch(html(), /data-ui="file-upload"/)
  } finally {
    mounted.dispose()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globals[key]
      else globals[key] = value
    }
  }
})

test('variant editor: a viewer without the save permission reads the setup but cannot change it', () => {
  const view = createVariantEditorView({
    id: 'editor',
    kind: 'product.template',
    setup: teeSetup(),
    editable: false,
    saveFunction: 'product.saveVariantSetup',
    labels: {},
    relationLabels: relationSelectDemoConfig.labels,
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
  assert.match(html, /readOnly/)
  assert.doesNotMatch(html, /data-ui="relation-select"/, 'no attribute picker')
  assert.doesNotMatch(html, /value="(generate|addRow|reset|selectAll\||removeLine\||removeRow\|)/)
  assert.match(html, /name="values\|color\[\]" value="red" checked="true" disabled/)
  assert.match(html, /value="toggleRow\|v1"/, 'rows can still be opened to read')
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
