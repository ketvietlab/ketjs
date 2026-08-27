import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { settingsScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const options = {
  endpoint: '/admin/flow/projects/platform/settings?lang=en',
  columns: [{ id: 'todo', name: 'To do', code: 'todo', sequence: 10, terminalState: false }],
  types: [],
  fields: [],
  tags: [],
  createHref: {
    column: '/admin/flow/projects/platform/settings?lang=en&dialog=column',
    type: '/admin/flow/projects/platform/settings?lang=en&dialog=type',
    field: '/admin/flow/projects/platform/settings?lang=en&dialog=field',
    tag: '/admin/flow/projects/platform/settings?lang=en&dialog=tag',
  },
  editColumnHref: () => '/admin/flow/projects/platform/settings?lang=en&editColumnId=todo',
  editTypeHref: () => '#',
  editFieldHref: () => '#',
  editTagHref: () => '#',
  brief: 'Project brief',
}

test('project settings keeps specialized collections and opens short editors in a modal', () => {
  const closed = renderToString(settingsScreen(translate, {}, 'Platform', options))
  assert.match(closed, /Project brief/)
  assert.match(closed, /data-ui="table"/)
  assert.doesNotMatch(closed, /data-ui="modal-layer"|data-ui="list-page"|data-ui="form-page"/)

  const open = renderToString(
    settingsScreen(translate, {}, 'Platform', {
      ...options,
      editor: {
        kind: 'column',
        title: 'Columns',
        action: options.endpoint,
        closeHref: options.endpoint,
        fields: [{ name: 'name', label: 'Name', value: 'Draft' }],
        errors: ['name: invalid'],
        recordId: 'draft-id',
        idempotencyKey: 'draft-key',
      },
    }),
  )
  assert.match(open, /data-ui="modal-layer"/)
  assert.match(open, /name="action" value="saveColumn"/)
  assert.match(open, /name="id" value="draft-id"/)
  assert.match(open, /name="idempotencyKey" value="draft-key"/)
  assert.match(open, /data-ui="form-errors" role="alert"/)
})
