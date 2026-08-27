import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { epicDetailScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/epic-detail.tsx'

const messages: Record<string, string> = {
  'flow_backend.empty.hint': 'No records yet.',
  'flow_backend.empty.title': 'Nothing here yet',
  'flow_backend.epics.document': 'Epic brief',
  'flow_backend.epics.issues': 'Issues in this epic',
  'flow_backend.epics.map': 'Map',
  'flow_backend.epics.trail': 'Epic trail',
  'flow_backend.epics.viewAllIssues': 'View all issues',
}

const translate = ((key: string, values?: Record<string, unknown>) =>
  key === 'flow_backend.epics.issueCount'
    ? `${String(values?.count ?? 0)} issues`
    : (messages[key] ?? key)) as Translator
translate.locale = 'en'
translate.has = (key) => key in messages || key === 'flow_backend.epics.issueCount'
translate.resolves = translate.has

test('flow epic detail: FormPage keeps Live Doc specialized and exposes localized project context', () => {
  const html = renderToString(
    epicDetailScreen(
      translate,
      { extras: { 'topbar.end': <span data-test="flow-extension">Extension</span> } },
      {
        epic: { id: 'release/one', projectId: 'platform/core', title: 'First release' },
        projectName: 'Internal platform',
        document: <span data-test="live-doc">Collaborative brief</span>,
        issues: [{ id: 'issue/one', title: 'Finish login', columnName: 'In progress' }],
        issueTotal: 101,
        issuesHref: '/admin/flow/projects/platform%2Fcore/issues?filter=epic',
        locale: '?lang=en',
      },
    ),
  )
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="form-page"/)
  assert.doesNotMatch(html, /data-ui="framed"|data-ui="record-workspace"|data-ui="modal-layer"/)
  assert.match(textContent, /data-ui="form-page-title">First release/)
  assert.match(textContent, /data-ui="form-page-description">Internal platform/)
  assert.match(html, /data-ui="form-page-body"[\s\S]*data-test="live-doc"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform%2Fcore\/epics\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform%2Fcore\/epics\/release%2Fone\/map\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/issues\/issue%2Fone\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform%2Fcore\/issues\?filter=epic&amp;lang=en"/)
  assert.match(textContent, /101 issues/)
  assert.match(textContent, /View all issues/)
  assert.match(textContent, /In progress/)
  assert.match(html, /data-test="flow-extension"/)
})

test('flow epic detail: empty related collection remains inside FormPage without a false view-all action', () => {
  const html = renderToString(
    epicDetailScreen(
      translate,
      {},
      {
        epic: { id: 'release', projectId: 'platform', title: 'Release' },
        projectName: 'Internal platform',
        document: <span data-test="live-doc">Collaborative brief</span>,
        issues: [],
        issueTotal: 0,
        issuesHref: '/admin/flow/projects/platform/issues',
        locale: '?lang=en',
      },
    ),
  )
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="form-page"/)
  assert.match(textContent, /0 issues/)
  assert.match(textContent, /Nothing here yet/)
  assert.match(textContent, /No records yet/)
  assert.doesNotMatch(textContent, /View all issues/)
})
