import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose } from '@ketvietlab/ketjs'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { userModalMessages } from '../packages/ketsuite/src/modules/user/modal-messages.ts'

test('user record refusals resolve to business guidance in Vietnamese and English', () => {
  const manifest = compose(ketsuite.modules, { headless: true })
  for (const lang of ['vi', 'en']) {
    const messages = userModalMessages({ manifest }, lang)
    for (const code of [
      'E_ROLE_NOT_ASSIGNABLE',
      'E_DIRECTORY_VALUE_UNKNOWN',
      'E_AUTHORIZATION_REVISION_CONFLICT',
      'E_SELF_AUTHORIZATION_FORBIDDEN',
    ]) {
      assert.ok(messages[code])
      assert.doesNotMatch(messages[code]!, /E_|tenant|revision|function|request|membership/u)
    }
  }
})
