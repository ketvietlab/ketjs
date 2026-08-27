import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { allPagesScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/all-pages.tsx'

const messages: Record<string, string> = {
  'backend.table.columns': 'Columns',
  'backend.table.selectAll': 'Select all',
  'backend.table.selectRow': 'Select row',
  'flow_backend.empty.hint': 'No records yet.',
  'flow_backend.empty.title': 'Nothing here yet',
  'flow_backend.field.description': 'Description',
  'flow_backend.field.project': 'Project',
  'flow_backend.field.updatedAt': 'Updated',
  'flow_backend.pages.emptyDocument': 'Empty document.',
  'flow_backend.pages.name': 'Document name',
  'flow_backend.pages.title': 'Docs',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'en'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('flow all pages: ListPage preserves cross-project identity, list state and localized destinations', () => {
  const html = renderToString(
    allPagesScreen(
      translate,
      {
        chrome: {
          search: {
            name: 'q',
            value: 'guide',
            placeholder: 'Search documents…',
            keep: { lang: 'en', filter: 'project:platform', group: 'project' },
          },
          pager: {
            from: 1,
            to: 2,
            total: 4,
            next: '/admin/flow/pages?q=guide&filter=project%3Aplatform&group=project&page=2&lang=en',
          },
        },
        extras: { 'topbar.end': <span data-test="flow-extension">Extension</span> },
      },
      {
        title: 'All docs',
        locale: '?lang=en',
        pages: [
          {
            id: 'guide',
            projectId: 'platform',
            projectName: 'Internal platform',
            title: 'Product guide',
            previewText: 'Architecture and setup',
            updatedAt: '2026-08-27T01:00:00Z',
          },
          {
            id: 'guide-sales',
            projectId: 'sales',
            projectName: 'Sales workspace',
            title: 'Product guide',
            previewText: '',
            updatedAt: '2026-08-26T01:00:00Z',
          },
        ],
      },
    ),
  )
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="list-page"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="form-page"|livedoc\.editor/)
  assert.match(textContent, /data-ui="list-page-title">All docs/)
  assert.match(textContent, /data-ui="list-page-status">All docs: 2/)
  assert.match(html, /name="q"[^>]*value="guide"/)
  assert.match(html, /name="lang" value="en"/)
  assert.match(html, /name="filter" value="project:platform"/)
  assert.match(html, /name="group" value="project"/)
  assert.match(html, /href="\/admin\/flow\/pages\/guide\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/pages\/guide-sales\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/pages\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/sales\/pages\?lang=en"/)
  assert.match(
    html,
    /href="\/admin\/flow\/pages\?q=guide&amp;filter=project%3Aplatform&amp;group=project&amp;page=2&amp;lang=en"/,
  )
  assert.match(textContent, /Internal platform/)
  assert.match(textContent, /Sales workspace/)
  assert.match(textContent, /Architecture and setup/)
  assert.match(textContent, /Empty document/)
  assert.match(html, /data-test="flow-extension"/)
})

test('flow all pages: task-specific empty state remains inside ListPage', () => {
  const html = renderToString(
    allPagesScreen(translate, {}, { title: 'All docs', pages: [], locale: '?lang=en' }),
  )
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="list-page"/)
  assert.match(textContent, /All docs: 0/)
  assert.match(textContent, /Nothing here yet/)
  assert.match(textContent, /No records yet/)
})
