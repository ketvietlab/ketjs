import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { presetsScreen } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('permission presets use FormPage and preserve rejected selections', () => {
  const html = renderToString(
    presetsScreen(
      translate,
      {},
      {
        modules: [{ value: 'sale', label: 'Sales' }],
        action: '/admin/permission-presets?lang=en',
        values: { module: 'sale', level: 'manager' },
        errors: ['level: invalid'],
      },
    ),
  )
  assert.match(html, /data-ui="form-page" data-scope="permission-preset-page"/)
  assert.match(html, /form="permission-preset-form"/)
  assert.match(html, /action="\/admin\/permission-presets\?lang=en"/)
  assert.match(html, /name="action" value="save"/)
  assert.match(html, /option value="sale" selected/)
  assert.match(html, /option value="manager" selected/)
  assert.match(html, /data-ui="form-errors" role="alert"/)
})
