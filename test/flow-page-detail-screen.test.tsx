import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { pageDetailScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/page-detail.tsx'

const messages: Record<string, string> = {
  'flow_backend.action.archive': 'Archive',
  'flow_backend.action.cancel': 'Cancel',
  'flow_backend.action.more': 'More actions',
  'flow_backend.action.save': 'Save',
  'flow_backend.empty.hint': 'No records yet.',
  'flow_backend.empty.title': 'Nothing here yet',
  'flow_backend.error.invalid': 'That value will not do.',
  'flow_backend.pages.addChild': 'Add child document',
  'flow_backend.pages.backToList': 'Back to documents',
  'flow_backend.pages.childName': 'Child document name',
  'flow_backend.pages.children': 'Child documents',
  'flow_backend.pages.document': 'Content',
  'flow_backend.pages.emptyDocument': 'Empty document.',
  'flow_backend.pages.move': 'Move',
  'flow_backend.pages.moveSubmit': 'Move',
  'flow_backend.pages.name': 'Document name',
  'flow_backend.pages.orderDown': 'Move down',
  'flow_backend.pages.orderUp': 'Move up',
  'flow_backend.pages.parent': 'Under',
  'flow_backend.pages.root': '— Top level —',
  'flow_backend.pages.trail': 'Document path',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'en'
translate.has = (key) => key in messages
translate.resolves = translate.has

const page = {
  id: 'setup',
  projectId: 'platform',
  projectName: 'Internal platform',
  title: 'Local setup',
  version: 4,
  parentPageId: 'guide',
  trail: [{ id: 'guide', title: 'Product guide' }],
  children: [
    { id: 'macos', title: 'macOS', previewText: 'Install the toolchain' },
    { id: 'linux', title: 'Linux', previewText: '' },
  ],
}

const baseOptions = {
  page,
  editor: <div data-island="livedoc.editor">Collaborative document</div>,
  titleFields: [{ name: 'title', label: 'Document name', value: 'Local setup', required: true }],
  childFields: [{ name: 'title', label: 'Child document name', value: '', required: true }],
  moveFields: [
    {
      name: 'parentPageId',
      label: 'Under',
      type: 'select' as const,
      value: 'guide',
      options: [
        { value: '', label: '— Top level —' },
        { value: 'guide', label: 'Product guide' },
      ],
    },
  ],
  locale: '?lang=en',
  childId: 'child-page-once',
  idempotencyKey: 'page-detail-once',
  orderUpIdempotencyKey: 'page-order-up-once',
  orderDownIdempotencyKey: 'page-order-down-once',
}

test('flow page detail: FormPage preserves Live Doc, versioned title save, trail and operational actions', () => {
  const html = renderToString(pageDetailScreen(translate, {}, baseOptions))
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="form-page" data-scope="flow-page-detail-form-page"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="modal-layer"/)
  assert.match(textContent, /data-ui="form-page-title">Local setup/)
  assert.match(textContent, /data-ui="form-page-description">Internal platform/)
  assert.match(html, /data-island="livedoc.editor"/)
  assert.match(textContent, /Collaborative document/)
  assert.match(html, /id="flow-page-detail-form"/)
  assert.match(html, /type="submit" form="flow-page-detail-form"/)
  assert.match(html, /action="\/admin\/flow\/pages\/setup\?lang=en"/)
  assert.match(html, /name="expectedVersion" value="4"/)
  assert.match(html, /name="idempotencyKey" value="page-detail-once"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/pages\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/pages\/guide\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/pages\/macos\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/pages\/linux\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/pages\/setup\?lang=en&amp;dialog=addChild"/)
  assert.match(html, /href="\/admin\/flow\/pages\/setup\?lang=en&amp;dialog=move"/)
  for (const action of ['orderUp', 'orderDown', 'archive']) {
    assert.match(html, new RegExp(`name="action" value="${action}"`))
  }
  assert.match(html, /name="idempotencyKey" value="page-order-up-once"/)
  assert.match(html, /name="idempotencyKey" value="page-order-down-once"/)
  assert.match(textContent, /Install the toolchain/)
  assert.match(textContent, /Empty document/)
})

test('flow page detail: rejected child creation stays in its URL-owned modal', () => {
  const html = renderToString(
    pageDetailScreen(
      translate,
      {},
      {
        ...baseOptions,
        dialog: 'addChild',
        childFields: [
          { name: 'title', label: 'Child document name', value: 'Rejected draft', required: true },
        ],
        errors: { action: 'addChild', messages: ['Child could not be created'] },
      },
    ),
  )

  assert.match(html, /data-ui="form-page"/)
  assert.match(html, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(html, /id="flow-page-addChild-form"/)
  assert.match(html, /action="\/admin\/flow\/pages\/setup\?lang=en&amp;dialog=addChild"/)
  assert.match(html, /name="action" value="addChild"/)
  assert.match(html, /name="childId" value="child-page-once"/)
  assert.match(html, /name="idempotencyKey" value="page-detail-once"/)
  assert.match(html, /name="title"[^>]*value="Rejected draft"/)
  assert.match(html, /Child could not be created/)
  assert.match(html, /data-ui="modal-close" href="\/admin\/flow\/pages\/setup\?lang=en"/)
})

test('flow page detail: rejected move retains its parent choice without changing the Live Doc', () => {
  const html = renderToString(
    pageDetailScreen(
      translate,
      {},
      {
        ...baseOptions,
        dialog: 'move',
        moveFields: [
          {
            name: 'parentPageId',
            label: 'Under',
            type: 'select',
            value: 'missing',
            options: [{ value: 'missing', label: 'missing' }],
          },
        ],
        errors: { action: 'move', messages: ['Parent does not exist'] },
      },
    ),
  )

  assert.match(html, /id="flow-page-move-form"/)
  assert.match(html, /name="action" value="move"/)
  assert.match(html, /<option value="missing" selected="true">/)
  assert.match(html, /Parent does not exist/)
  assert.match(html, /data-island="livedoc.editor"/)
})
