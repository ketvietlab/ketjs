import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, formatMissing, missingMessages } from 'ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

test('crm i18n: every installed CRM screen and message has vi/en parity', () => {
  const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : [])]
  const gaps = missingMessages(compose(modules), ['vi', 'en'])
  assert.deepEqual(gaps, {}, formatMissing(gaps))
})
