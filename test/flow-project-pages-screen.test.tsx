import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  pagesScreen,
  projectPageCreateFields,
} from '../packages/ketsuite/src/modules/flow_backend/screens/project-pages.tsx'

const messages: Record<string, string> = {
  'backend.brand': 'Administration',
  'flow_backend.action.cancel': 'Cancel',
  'flow_backend.empty.hint': 'No records yet.',
  'flow_backend.empty.title': 'Nothing here yet',
  'flow_backend.pages.childCount': '{count} child documents',
  'flow_backend.pages.create': 'Create document',
  'flow_backend.pages.emptyDocument': 'Empty document.',
  'flow_backend.pages.name': 'Document name',
  'flow_backend.pages.parent': 'Under',
  'flow_backend.pages.root': '— Top level —',
  'flow_backend.pages.title': 'Documents',
}

const translate = ((key: string, values?: Record<string, unknown>) => {
  const message = messages[key] ?? key
  return Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    message,
  )
}) as Translator
translate.locale = 'en'
translate.has = (key) => key in messages
translate.resolves = translate.has

const pages = [
  {
    id: 'guide',
    title: 'Product guide',
    previewText: 'The product handbook',
    childCount: 1,
  },
  {
    id: 'setup',
    parentPageId: 'guide',
    title: 'Local setup',
    previewText: '',
    childCount: 0,
  },
]

test('flow project pages: specialized tree keeps hierarchy, identity, counts and localized destinations', () => {
  const html = renderToString(
    pagesScreen(
      translate,
      {},
      {
        projectName: 'Internal platform',
        pages,
        createHref: '/admin/flow/projects/platform/pages?q=guide&lang=en&create=1',
        createFields: projectPageCreateFields(translate, pages),
        createAction: '/admin/flow/projects/platform/pages?q=guide&lang=en&create=1',
        closeHref: '/admin/flow/projects/platform/pages?q=guide&lang=en',
        locale: '?lang=en',
        recordId: 'page-record-once',
        idempotencyKey: 'page-create-once',
      },
    ),
  )
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="list-page"[^>]*data-variant="operational"/)
  assert.doesNotMatch(html, /data-ui="form-page"|data-ui="modal-layer"/)
  assert.match(textContent, /data-ui="list-page-title">Internal platform/)
  assert.match(textContent, /Documents/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/pages\?q=guide&amp;lang=en&amp;create=1"/)
  assert.match(html, /data-ui="doc-tree"/)
  assert.match(html, /data-ui="doc-branch"/)
  assert.match(html, /href="\/admin\/flow\/pages\/guide\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/pages\/setup\?lang=en"/)
  assert.match(textContent, /1 child documents/)
  assert.match(textContent, /The product handbook/)
  assert.match(textContent, /Empty document/)
  assert.doesNotMatch(html, /flow-project-page-create-form/)
})

test('flow project pages: two-field create action is a URL-owned modal retaining rejected values', () => {
  const html = renderToString(
    pagesScreen(
      translate,
      {},
      {
        projectName: 'Internal platform',
        pages,
        createHref: '/admin/flow/projects/platform/pages?lang=en&create=1',
        createFields: projectPageCreateFields(translate, pages, {
          title: 'Draft runbook',
          parentPageId: 'missing',
        }),
        createAction: '/admin/flow/projects/platform/pages?lang=en&create=1',
        closeHref: '/admin/flow/projects/platform/pages?lang=en',
        locale: '?lang=en',
        createOpen: true,
        errors: ['That parent page is unavailable'],
        recordId: 'page-record-once',
        idempotencyKey: 'page-create-once',
      },
    ),
  )

  assert.match(html, /data-ui="list-page"[^>]*data-variant="operational"/)
  assert.match(html, /data-ui="doc-tree"/)
  assert.match(html, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(html, /id="flow-project-page-create-form"/)
  assert.match(html, /action="\/admin\/flow\/projects\/platform\/pages\?lang=en&amp;create=1"/)
  assert.match(html, /name="action" value="save"/)
  assert.match(html, /name="id" value="page-record-once"/)
  assert.match(html, /name="idempotencyKey" value="page-create-once"/)
  assert.match(html, /name="title"[^>]*value="Draft runbook"/)
  assert.match(html, /<option value="missing" selected="true">/)
  assert.match(html, /That parent page is unavailable/)
  assert.match(html, /data-ui="modal-close" href="\/admin\/flow\/projects\/platform\/pages\?lang=en"/)
})
