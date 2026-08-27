import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stageKinds } from '../packages/ketsuite/src/modules/crm/operations.ts'

test('CRM stage kinds accept adapter JSON arrays and serialized JSON', () => {
  assert.deepEqual(stageKinds({ allowedKinds: ['lead', 'opportunity', 'lead'] }), ['lead', 'opportunity'])
  assert.deepEqual(stageKinds({ allowedKinds: '["lead","opportunity","lead"]' }), ['lead', 'opportunity'])
  assert.deepEqual(stageKinds({ allowedKinds: '{not-json}' }), [])
})
