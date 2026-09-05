import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { allEpicsScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/all-epics.tsx'

const messages: Record<string, string> = {
  'backend.table.columns': 'Columns',
  'backend.table.selectAll': 'Select all',
  'backend.table.selectRow': 'Select row',
  'flow_backend.empty.hint': 'No records yet.',
  'flow_backend.empty.title': 'Nothing here yet',
  'flow_backend.epics.emptyDocument': 'No brief yet.',
  'flow_backend.field.description': 'Description',
  'flow_backend.field.project': 'Project',
  'flow_backend.field.title': 'Title',
  'flow_backend.menu.epics': 'Epics',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'en'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('flow all epics: ListPage preserves project identity, list state and localized destinations', () => {
  const html = renderToString(
    allEpicsScreen(
      translate,
      {
        chrome: {
          search: {
            name: 'q',
            value: 'release',
            placeholder: 'Search epics…',
            keep: { lang: 'en', filter: 'project:platform', group: 'project' },
          },
          pager: {
            from: 1,
            to: 2,
            total: 4,
            next: '/admin/flow/epics?q=release&filter=project%3Aplatform&group=project&page=2&lang=en',
          },
        },
        extras: { 'topbar.end': <span data-test="flow-extension">Extension</span> },
      },
      {
        title: 'All epics',
        locale: '?lang=en',
        total: 4,
        epics: [
          {
            id: 'release/one',
            projectId: 'platform/core',
            projectName: 'Internal platform',
            title: 'First release',
            previewText: 'Safer deployments',
          },
          {
            id: 'release-two',
            projectId: 'sales',
            projectName: 'Sales workspace',
            title: 'Second release',
            previewText: '',
          },
        ],
      },
    ),
  )
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="list-page"/)
  assert.doesNotMatch(
    html,
    /data-ui="record-workspace"|data-ui="form-page"|data-ui="modal-layer"|livedoc\.editor/,
  )
  assert.match(textContent, /data-ui="list-page-title">All epics/)
  assert.match(textContent, /data-ui="list-page-footer">All epics: 4/)
  assert.match(html, /name="q"[^>]*value="release"/)
  assert.match(html, /name="lang" value="en"/)
  assert.match(html, /name="filter" value="project:platform"/)
  assert.match(html, /name="group" value="project"/)
  assert.match(html, /href="\/admin\/flow\/epics\/release%2Fone\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/epics\/release-two\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform%2Fcore\/epics\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/sales\/epics\?lang=en"/)
  assert.match(
    html,
    /href="\/admin\/flow\/epics\?q=release&amp;filter=project%3Aplatform&amp;group=project&amp;page=2&amp;lang=en"/,
  )
  assert.match(textContent, /Internal platform/)
  assert.match(textContent, /Sales workspace/)
  assert.match(textContent, /Safer deployments/)
  assert.match(textContent, /No brief yet/)
  assert.match(html, /data-test="flow-extension"/)
})

test('flow all epics: empty state remains inside ListPage', () => {
  const html = renderToString(
    allEpicsScreen(translate, {}, { title: 'All epics', epics: [], locale: '?lang=en' }),
  )
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="list-page"/)
  assert.match(textContent, /All epics: 0/)
  assert.match(textContent, /Nothing here yet/)
  assert.match(textContent, /No records yet/)
})
