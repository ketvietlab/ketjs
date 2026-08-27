import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { rolesScreen } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('roles list uses ListPage with row navigation and collection actions', () => {
  const html = renderToString(
    rolesScreen(
      translate,
      {},
      {
        rows: [
          {
            id: 'manager/a',
            name: 'Manager',
            description: 'Operational manager',
            detailHref: '/admin/roles/manager%2Fa?lang=en',
          },
        ],
        createHref: '/admin/roles/new?lang=en',
        presetsHref: '/admin/permission-presets?lang=en',
      },
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-row-href="\/admin\/roles\/manager%2Fa\?lang=en"/)
  assert.match(html, /href="\/admin\/roles\/new\?lang=en"/)
  assert.match(html, /href="\/admin\/permission-presets\?lang=en"/)
  assert.doesNotMatch(html, /data-ui="form-page"/)
})
