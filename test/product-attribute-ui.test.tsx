import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString, type TemplateResult } from '@ketvietlab/ketjs-view'
import { ReorderList, HOOKS } from '@ketvietlab/design-system'
import {
  attributesListPage,
  type AttributeListRow,
} from '../packages/ketsuite/src/modules/product_backend/screens/attributes.tsx'
import {
  attributeModalDefinition as definition,
  type AttributeModalData,
} from '../packages/ketsuite/src/modules/product_backend/modal/attribute-modal-view.tsx'
import { ATTRIBUTE_RECORD_MODAL_LABELS } from '../packages/ketsuite/src/modules/product/attribute-modal-labels.ts'
import { RECORD_MODAL_LABELS } from '../packages/ketsuite/src/ui/client/record-modal.tsx'
import type { RecordModalContext } from '../packages/ketsuite/src/ui/client/record-modal.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = translate.has
const data: AttributeModalData = {
  record: {
    id: 'material',
    name: 'Material',
    displayType: 'color',
    createVariant: 'always',
    sequence: 8,
    values: [
      { id: 'linen', name: 'Linen', sequence: 1, htmlColor: '#abcdef' },
      { id: 'cotton', name: 'Cotton', sequence: 2, htmlColor: '#123456' },
    ],
  },
  permissions: { save: true },
  lang: 'en',
}
const context = (
  options: {
    draft?: Record<string, string>
    order?: string[]
    errors?: Record<string, string>
    save?: boolean
  } = {},
): RecordModalContext<AttributeModalData> => ({
  id: 'material',
  kind: 'product.attribute',
  creating: false,
  tab: '',
  data: { ...data, permissions: { save: options.save !== false } },
  t: (key) => key,
  fieldError: (name) => options.errors?.[name] ?? null,
  draft: (name, fallback = '') => options.draft?.[name] ?? fallback,
  draftChecked: (_name, _value, fallback = false) => fallback,
  busy: false,
  dialog: null,
  href: () => '',
  state: (key, fallback = '') =>
    key === 'attributeValuesOrder' && options.order ? JSON.stringify(options.order) : fallback,
})
const body = (c = context()) => renderToString(definition.body!(c) as TemplateResult)

test('attribute list uses four real table columns, bounded previews, URL paging and permission-controlled create', () => {
  const rows: AttributeListRow[] = Array.from({ length: 35 }, (_, index) => ({
    id: `attr-${index}`,
    name: `Attribute ${index}`,
    displayType: 'color',
    createVariant: 'always',
    values: Array.from({ length: 5 }, (_, value) => ({ id: `v${value}`, name: `Value ${value}` })),
  }))
  const frame = {
    collectionUrl: '/admin/product/attributes?page=2&lang=en',
    chrome: { create: { label: 'Create', path: '/admin/product/attributes?record=product.attribute%3Anew' } },
  }
  const html = renderToString(attributesListPage(translate, rows, frame))
  assert.match(html, /data-ui="ket-table"/)
  for (const key of ['name', 'values', 'displayType', 'createVariant'])
    assert.match(html, new RegExp(`data-col="${key}"`))
  assert.match(html, /\+2/)
  assert.match(html, /record=product.attribute%3Aattr-30/)
  assert.doesNotMatch(html, /record=product.attribute%3Aattr-0(?:&|"|%)/)
  assert.match(html, /data-ui="list-page-header"[\s\S]*?record=product.attribute%3Anew[\s\S]*?<\/header>/)
  assert.doesNotMatch(html, /data-ui="record-form"/)
  const noCreate = renderToString(attributesListPage(translate, rows, { ...frame, chrome: { create: null } }))
  assert.doesNotMatch(noCreate, /record=product.attribute%3Anew/)
  const searched = renderToString(
    attributesListPage(translate, rows, {
      ...frame,
      collectionUrl: '/admin/product/attributes?q=Attribute+34',
    }),
  )
  assert.match(searched, /record=product.attribute%3Aattr-34/)
  assert.doesNotMatch(searched, /record=product.attribute%3Aattr-0(?:&|"|%)/)
})

test('attribute editor is one untabbed form with one atomic Save and no false dirty on untouched color values', () => {
  assert.equal(definition.tabs, undefined)
  assert.equal(definition.commands!.save!.fn, 'product.saveAttributeDraft')
  assert.equal(definition.commands!.save!.also, undefined)
  assert.equal(definition.commands!.save!.after, 'close')
  const html = body()
  assert.equal(html.match(/<form /g)?.length, 1)
  assert.doesNotMatch(html, /data-record-dirty="true"/)
  assert.match(
    html,
    /type="color"[^>]*name="attributeValue.linen.htmlColor"|name="attributeValue.linen.htmlColor"[^>]*type="color"/,
  )
  const footer = renderToString(definition.actions!(context()) as TemplateResult)
  assert.equal(footer.match(/type="submit"/g)?.length, 1)
  assert.match(footer, /form="product-attribute-draft"/)
})

test('stable value fields retain names and colors after reorder and refusal; command saves ordered whole draft', () => {
  const c = context({
    order: ['cotton', 'linen'],
    draft: {
      name: 'Textile',
      'attributeValue.cotton.name': 'Cotton edited',
      'attributeValue.linen.name': 'Linen edited',
    },
    errors: { 'attributeValue.cotton.name': 'Duplicate value' },
  })
  const html = body(c)
  assert.match(html, /data-record-dirty="true"/)
  assert.ok(html.indexOf('data-reorder-id="cotton"') < html.indexOf('data-reorder-id="linen"'))
  assert.match(html, /Cotton edited/)
  assert.match(html, /Linen edited/)
  assert.match(html, /Duplicate value/)
  const form = new FormData()
  form.set('name', 'Textile')
  form.set('displayType', 'color')
  form.set('createVariant', 'always')
  form.set('attributeValue.cotton.htmlColor', '#123456')
  form.set('attributeValue.linen.htmlColor', '#abcdef')
  const payload = definition.commands!.save!.input(form, c, {})
  assert.deepEqual(payload.values, [
    { id: 'cotton', name: 'Cotton edited', htmlColor: '#123456', sequence: 0 },
    { id: 'linen', name: 'Linen edited', htmlColor: '#abcdef', sequence: 1 },
  ])
  assert.equal(payload.name, 'Textile')
  form.set('attributeValuesOrder', JSON.stringify(['cotton', 'linen']))
  const map = definition.commands!.save!.issueField!
  assert.equal(
    map('values.0.name', form, context({ order: ['linen', 'cotton'] })),
    'attributeValue.cotton.name',
  )
  assert.equal(map('values.1.htmlColor', form, c), 'attributeValue.linen.htmlColor')
  assert.equal(map('values', form, c), 'attributeValuesOrder')
})

test('removing values and previously typed top fields remain dirty through view changes', () => {
  assert.match(body(context({ order: ['cotton'] })), /data-record-dirty="true"/)
  assert.match(body(context({ draft: { name: 'Changed' } })), /data-record-dirty="true"/)
  const runtime = readFileSync('packages/ketsuite/src/ui/client/record-modal.tsx', 'utf8')
  assert.match(runtime, /layer.querySelector\('\[data-record-dirty="true"\]'\)/)
  assert.match(runtime, /\['relation-native', 'reorder-list-value'\]/)
  assert.match(runtime, /keepAllDrafts\(\)[\s\S]*?viewState.set/)
})

test('read-only attribute has disabled value controls and no Save command button', () => {
  const c = context({ save: false })
  const html = body(c)
  assert.match(html, /name="attributeValue.linen.name"[^>]*disabled/)
  assert.doesNotMatch(renderToString(definition.actions!(c) as TemplateResult), /type="submit"/)
})

test('ReorderList exports its semantic and CSS contract, including native order and accessible alternatives to drag', () => {
  const html = renderToString(
    <ReorderList
      id="test"
      name="order"
      label="Values"
      labels={{ add: 'Add', remove: 'Remove', up: 'Up', down: 'Down', drag: 'Drag', empty: 'Empty' }}
      items={[
        { id: 'a', content: 'Alpha' },
        { id: 'b', content: 'Beta' },
      ]}
    />,
  )
  assert.match(html, /<ol data-ui="reorder-list-rows" aria-label="Values"/)
  assert.match(html, /data-ui="reorder-list-value" type="hidden" name="order"/)
  assert.match(html, /data-reorder-action="up"/)
  assert.match(html, /data-reorder-action="down"/)
  assert.match(html, /draggable/)
  for (const hook of [
    'reorder-list',
    'reorder-list-value',
    'reorder-list-rows',
    'reorder-list-row',
    'reorder-list-content',
    'reorder-list-controls',
  ]) {
    assert.ok(HOOKS.includes(hook))
    assert.ok(
      readFileSync('packages/design-system/src/interactions/reorder-list/styles.css', 'utf8').includes(
        `[data-ui="${hook}"]`,
      ),
    )
  }
  assert.match(
    readFileSync('packages/design-system/src/interactions/reorder-list/index.tsx', 'utf8'),
    /each\([\s\S]*?item\) => item.id/,
  )
})

test('attribute modal localizes runtime copy before loading and after context arrives', () => {
  assert.equal(typeof definition.labels, 'function')
  const early = typeof definition.labels === 'function' ? definition.labels() : definition.labels!
  assert.equal(early['recordModal.loading'], 'Đang tải…')
  assert.equal(early['recordModal.notFound'], ATTRIBUTE_RECORD_MODAL_LABELS.vi['recordModal.notFound'])
  for (const lang of ['vi', 'en'] as const) {
    assert.deepEqual(
      Object.keys(ATTRIBUTE_RECORD_MODAL_LABELS[lang]).sort(),
      Object.keys(RECORD_MODAL_LABELS).sort(),
    )
    const c = context()
    c.t = (key) => ATTRIBUTE_RECORD_MODAL_LABELS[lang][key] ?? key
    const html = renderToString(definition.actions!(c) as TemplateResult)
    assert.ok(html.includes(lang === 'vi' ? 'Đóng' : 'Close'))
    assert.doesNotMatch(html, /recordModal.close/)
  }
})
