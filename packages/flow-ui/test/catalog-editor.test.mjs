import { setFlowLocale } from '../src/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowColorPicker, FlowCatalogEditor, FLOW_TAG_COLORS } from '../src/workspace.mjs'

test('fixed palette exposes named native radio choices, one selection and a form value', () => {
  const out = renderToStaticString(
    FlowColorPicker({ id: 'task-color', name: 'color', label: 'Màu nhãn', value: 'red' }),
  )
  assert.match(out, /<legend>Màu nhãn<\/legend>/)
  assert.equal((out.match(/type="radio"/g) ?? []).length, FLOW_TAG_COLORS.length)
  assert.equal((out.match(/checked="true"/g) ?? []).length, 1)
  assert.match(out, /name="color" value="red" aria-label="Đỏ" checked="true"/)
  for (const color of FLOW_TAG_COLORS) assert.match(out, new RegExp(`data-color="${color.value}"`))
  assert.doesNotMatch(out, /<select|type="color"/)
})
test('catalog respects used status locks, read-only palette and unique radio groups', () => {
  const items = [
    { id: 'review', title: 'Chờ duyệt', kind: 'review', color: 'yellow', locked: true, lockedKind: true },
    { id: 'done', title: 'Xong', kind: 'done', color: 'green' },
  ]
  const out = renderToStaticString(
    FlowCatalogEditor({
      id: 'workflow',
      status: true,
      items,
      kindOptions: [
        { value: 'review', label: 'Chờ duyệt' },
        { value: 'done', label: 'Xong' },
      ],
      onChange() {},
    }),
  )
  assert.match(out, /<select(?=[^>]*aria-label="Nhóm trạng thái · Chờ duyệt")(?=[^>]*disabled="true")[^>]*>/)
  assert.match(out, /disabled="true"[^>]*aria-label="Xóa Chờ duyệt"/)
  assert.match(out, /name="workflow-review-color"/)
  assert.match(out, /name="workflow-done-color"/)
  const readonly = renderToStaticString(
    FlowCatalogEditor({ id: 'labels', items, disabled: true, onChange() {} }),
  )
  assert.equal((readonly.match(/data-flow="color-picker"[^>]*disabled="true"/g) ?? []).length, 2)
  assert.doesNotMatch(readonly, /<select/)
})
