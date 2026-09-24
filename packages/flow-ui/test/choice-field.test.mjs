import { setFlowLocale } from '../src/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowChoiceField } from '../src/workspace.mjs'
import { FlowStatus, FlowPriority } from '../src/index.mjs'
test('rich choices retain custom status colors, canonical icons and selected semantics', () => {
  const out = renderToStaticString(
    FlowChoiceField({
      id: 'status',
      label: 'Trạng thái',
      value: 'custom-review',
      options: [
        {
          value: 'custom-review',
          label: 'Chờ duyệt riêng',
          content: FlowStatus({ status: 'review', color: 'red', label: 'Chờ duyệt riêng' }),
        },
        {
          value: 'complete',
          label: 'Xong',
          content: FlowStatus({ status: 'done', color: 'green', label: 'Xong' }),
        },
      ],
      onChange: () => {},
    }),
  )
  assert.match(out, /aria-labelledby="status-label status-value"/)
  assert.match(out, /aria-haspopup="listbox"/)
  assert.match(out, /role="listbox"/)
  assert.equal((out.match(/data-status="review" data-color="red"/g) ?? []).length, 2)
  assert.match(out, /aria-label="Chờ duyệt riêng" aria-selected="true" tabindex="0"/)
  assert.match(out, /aria-label="Xong" aria-selected="false" tabindex="-1"/)
})
test('readonly priority retains its colored flag and disables all selection controls', () => {
  const out = renderToStaticString(
    FlowChoiceField({
      id: 'priority',
      label: 'Ưu tiên',
      value: 'urgent',
      disabled: true,
      options: [{ value: 'urgent', label: 'Khẩn cấp', content: FlowPriority({ priority: 'urgent' }) }],
      onChange: () => {},
    }),
  )
  assert.equal((out.match(/data-priority="urgent"/g) ?? []).length, 2)
  assert.equal((out.match(/disabled="true"/g) ?? []).length, 2)
  assert.match(out, /data-flow="icon"/)
})
test('compact list choices keep full accessible names and use the same colored options as the sidebar', () => {
  const out = renderToStaticString(
    FlowChoiceField({
      id: 'list-status',
      label: 'Trạng thái KV-142',
      size: 'sm',
      value: 'custom',
      options: [
        {
          value: 'custom',
          label: 'Kiểm chứng',
          content: FlowStatus({ status: 'review', label: 'Kiểm chứng', color: 'red' }),
        },
      ],
      onChange: () => {},
    }),
  )
  assert.match(out, /data-choice-size="sm"/)
  assert.match(out, /aria-labelledby="list-status-label list-status-value"/)
  assert.equal((out.match(/data-color="red"/g) ?? []).length, 2)
})
test('unavailable choices expose a separate explanation and cannot select a different value', () => {
  const out = renderToStaticString(
    FlowChoiceField({
      id: 'pending',
      label: 'Status',
      value: 'review',
      options: [
        { value: 'review', label: 'Review', content: 'Review' },
        {
          value: 'progress',
          label: 'Progress',
          content: 'Progress',
          disabled: true,
          description: 'Waiting for reviewer',
        },
      ],
      onChange: () => {},
    }),
  )
  assert.match(out, /aria-label="Progress"[^>]*disabled="true"/)
  assert.match(out, /<span data-flow="choice-copy">Progress<small>Waiting for reviewer<\/small><\/span>/)
  assert.doesNotMatch(out, /<span id="pending-value">[^<]*Waiting/)
})
