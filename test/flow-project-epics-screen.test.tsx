import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  epicsScreen,
  projectEpicCreateFields,
} from '../packages/ketsuite/src/modules/flow_backend/screens/project-epics.tsx'

const messages: Record<string, string> = {
  'backend.brand': 'Administration',
  'flow_backend.action.archive': 'Archive',
  'flow_backend.action.cancel': 'Cancel',
  'flow_backend.action.create': 'Create',
  'flow_backend.empty.hint': 'No records yet.',
  'flow_backend.empty.title': 'Nothing here yet',
  'flow_backend.epics.issueCount': '{count} issues',
  'flow_backend.epics.map': 'Map',
  'flow_backend.error.invalid': 'Unable to complete',
  'flow_backend.field.color': 'Color',
  'flow_backend.field.title': 'Title',
  'flow_backend.menu.epics': 'Epics',
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

const epics = [
  {
    id: 'release-one',
    projectId: 'platform',
    title: 'First release',
    totalCount: 3,
    issuesHref: '/admin/flow/projects/platform/issues?filter=epic-one',
  },
]

const options = {
  projectName: 'Internal platform',
  epics,
  action: '/admin/flow/projects/platform/epics?lang=en',
  closeHref: '/admin/flow/projects/platform/epics?lang=en',
  createAction: '/admin/flow/projects/platform/epics?lang=en&create=1',
  createHref: '/admin/flow/projects/platform/epics?lang=en&create=1',
  createFields: projectEpicCreateFields(translate),
  recordId: 'epic-record-once',
  idempotencyKey: 'epic-create-once',
  locale: '?lang=en',
}

test('flow project epics: specialized cards preserve project identity, backlog progress and dependency paths', () => {
  const html = renderToString(epicsScreen(translate, {}, options))
  const textContent = html.replace(/<!--k\[?-->/g, '')

  assert.match(html, /data-ui="board-page"[^>]*data-variant="operational"/)
  assert.match(html, /data-ui="board-page-context"[\s\S]*?data-ui="breadcrumbs"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="modal-layer"/)
  assert.match(textContent, /data-ui="board-page-title">Internal platform/)
  assert.match(textContent, /data-ui="board-page-eyebrow">Epics/)
  assert.match(html, /data-ui="kanban"/)
  assert.match(html, /data-ui="kanban-card" data-interactive="true"/)
  assert.match(html, /href="\/admin\/flow\/epics\/release-one\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/issues\?filter=epic-one&amp;lang=en"/)
  assert.match(textContent, /3 issues/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/epics\/release-one\/map\?lang=en"/)
  assert.match(html, /action="\/admin\/flow\/projects\/platform\/epics\?lang=en"/)
  assert.match(html, /name="action" value="archive"/)
  assert.match(html, /name="id" value="release-one"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/epics\?lang=en&amp;create=1"/)
})

test('flow project epics: rejected two-field create stays in its URL-owned modal with retry state', () => {
  const html = renderToString(
    epicsScreen(
      translate,
      {},
      {
        ...options,
        createOpen: true,
        createFields: projectEpicCreateFields(translate, {
          title: 'Draft release',
          color: '#123456',
        }),
        createErrors: ['Title is required'],
      },
    ),
  )

  assert.match(html, /data-ui="board-page"[^>]*data-variant="operational"/)
  assert.match(html, /data-ui="kanban"/)
  assert.match(html, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(html, /id="flow-project-epic-create-form"/)
  assert.match(html, /action="\/admin\/flow\/projects\/platform\/epics\?lang=en&amp;create=1"/)
  assert.match(html, /name="action" value="save"/)
  assert.match(html, /name="id" value="epic-record-once"/)
  assert.match(html, /name="idempotencyKey" value="epic-create-once"/)
  assert.match(html, /name="title"[^>]*value="Draft release"/)
  assert.match(html, /name="color"[^>]*value="#123456"/)
  assert.match(html, /Title is required/)
  assert.match(html, /data-ui="modal-close" href="\/admin\/flow\/projects\/platform\/epics\?lang=en"/)
})

test('flow project epics: archive refusal is visible without turning creation into a modal', () => {
  const html = renderToString(
    epicsScreen(
      translate,
      {},
      {
        ...options,
        errors: ['That epic is not in this project'],
      },
    ),
  )

  assert.match(html, /data-ui="notice" data-tone="danger"/)
  assert.match(html, /That epic is not in this project/)
  assert.match(html, /data-ui="kanban"/)
  assert.doesNotMatch(html, /data-ui="modal-layer"/)
})
