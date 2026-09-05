import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { modalForm, modalSheet } from '@ketvietlab/ketsuite/backend'

const island = readFileSync('packages/ketsuite/src/ui/client/table-selection-view.tsx', 'utf8')

test('modal: a sheet that was not asked to guard says nothing', () => {
  const html = renderToString(
    modalSheet({
      id: 'reader',
      title: 'Bài viết',
      closeHref: '/admin/crm/tickets',
      closeLabel: 'Đóng',
      body: 'nội dung',
    }),
  )
  // A modal that only shows things has nothing that could be unsaved, so it
  // carries no prompt and the island leaves it alone.
  assert.doesNotMatch(html, /data-unsaved-prompt/u)
})

test('modal: a sheet that asks carries the words the browser will show', () => {
  const html = renderToString(
    modalForm({
      id: 'edit',
      title: 'Sửa',
      closeHref: '/admin/crm/cases/1',
      closeLabel: 'Hủy',
      unsavedPrompt: 'Đóng lại sẽ mất phần bạn đang nhập. Vẫn đóng?',
      form: {
        id: 'edit-form',
        action: '/admin/crm/cases/1',
        fields: [{ name: 'note', label: 'Ghi chú' }],
        submit: 'Lưu',
        submitVariant: 'primary',
        cancelHref: '/admin/crm/cases/1',
        cancelLabel: 'Hủy',
      },
    }),
  )
  assert.match(html, /data-unsaved-prompt="Đóng lại sẽ mất phần bạn đang nhập. Vẫn đóng\?"/u)
  // The prompt lives on the layer the island reads, beside the close controls.
  assert.match(html, /data-ui="modal-layer"[^>]*data-unsaved-prompt/u)
  assert.match(html, /data-ui="modal-close"/u)
  assert.match(html, /data-ui="modal-backdrop"/u)
})

test('modal: closing stays a link, so it works with scripting off', () => {
  const html = renderToString(
    modalForm({
      id: 'edit',
      title: 'Sửa',
      closeHref: '/admin/crm/cases/1',
      closeLabel: 'Hủy',
      unsavedPrompt: 'x',
      form: {
        id: 'f',
        action: '/a',
        fields: [],
        submit: 'Lưu',
        submitVariant: 'primary',
        cancelHref: '/admin/crm/cases/1',
        cancelLabel: 'Hủy',
      },
    }),
  )
  // The guard is a guard, not a lock: both ways out are still anchors pointing
  // at the close URL, which is what makes the modal work without JavaScript.
  const closers = [...html.matchAll(/<a[^>]*data-ui="modal-(close|backdrop)"[^>]*href="([^"]+)"/gu)]
  assert.equal(closers.length, 2)
  for (const match of closers) assert.equal(match[2], '/admin/crm/cases/1')
})

test('modal guard: dirt is measured against what the server rendered', () => {
  // Server-rendered forms carry their own baseline, so the default is exactly
  // the state the reader was handed. Anything else would need bookkeeping the
  // page has no way to keep across a full round trip.
  assert.match(island, /field\.checked !== field\.defaultChecked/u)
  assert.match(island, /field\.value !== field\.defaultValue/u)
  assert.match(island, /area\.value !== area\.defaultValue/u)
  assert.match(island, /option\.selected !== option\.defaultSelected/u)
  // Hidden inputs carry route state, not typing, and a disabled control is not
  // something the reader changed.
  assert.match(island, /input:not\(\[type="hidden"\]\)/u)
  assert.match(island, /if \(field\.disabled\) continue/u)
})

test('modal guard: an unedited modal closes without asking', () => {
  // A confirm on every close is a confirm nobody reads.
  assert.match(island, /if \(!modalHasDraft\(modal\)\) return true/u)
  // And a screen that never declared a prompt is not guarded into one.
  assert.match(island, /if \(!message\) return true/u)
})

test('modal guard: it runs on every way out, before the navigation layer', () => {
  // Escape, the X and the backdrop are three doors out of the same room.
  assert.match(island, /if \(!mayLeaveModal\(modal\)\) return\n/u)
  assert.match(island, /'\[data-ui="modal-close"\], \[data-ui="modal-backdrop"\]'/u)
  // Capture phase: the close controls are ordinary links, so the guard has to
  // see the click before whatever handles navigation does. Formatting moves, so
  // read the call rather than its indentation.
  const clickListener = island.slice(island.indexOf("addEventListener(\n    'click'"))
  assert.ok(clickListener.startsWith('addEventListener('), 'the guard listens for clicks')
  assert.match(
    clickListener
      .slice(0, clickListener.indexOf("document.addEventListener('keydown'"))
      .replace(/\s+/gu, ' '),
    / true, \)/u,
    'registered on the capture phase',
  )
})
