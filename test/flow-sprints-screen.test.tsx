import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { sprintsScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const options = {
  projectName: 'Platform',
  sprints: [
    { id: 'sprint/a', name: 'Sprint A', state: 'planned', startDate: '2026-08-01', endDate: '2026-08-14' },
  ],
  action: '/admin/flow/projects/platform/sprints?lang=en',
  createHref: '/admin/flow/projects/platform/sprints?dialog=create&lang=en',
  closeHref: '/admin/flow/projects/platform/sprints?lang=en',
  recordId: 'draft-id',
  idempotencyKey: 'draft-key',
  transitionKey: () => 'transition-key',
}

test('sprint collection remains specialized and opens short creation in a modal', () => {
  const closed = renderToString(sprintsScreen(translate, {}, options))
  assert.match(closed, /data-ui="table"/)
  assert.match(closed, /name="action" value="start"/)
  assert.match(closed, /name="idempotencyKey" value="transition-key"/)
  assert.doesNotMatch(closed, /data-ui="modal-layer"|data-ui="list-page"|data-ui="form-page"/)

  const open = renderToString(
    sprintsScreen(
      translate,
      {},
      {
        ...options,
        createOpen: true,
        createValues: { name: 'Draft sprint' },
        createErrors: ['name: invalid'],
      },
    ),
  )
  assert.match(open, /data-ui="modal-layer"/)
  assert.match(open, /id="flow-sprint-create-form"/)
  assert.match(open, /name="id" value="draft-id"/)
  assert.match(open, /name="idempotencyKey" value="draft-key"/)
  assert.match(open, /name="name"[^>]*value="Draft sprint"/)
  assert.match(open, /data-ui="form-errors" role="alert"/)
})
