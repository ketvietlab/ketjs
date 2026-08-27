import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { catalogsScreen } from '../packages/ketsuite/src/modules/address_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('address catalogs use ListPage with encoded navigation and install action', () => {
  const html = renderToString(
    catalogsScreen(translate, {}, {
      rows: [
        {
          countryCode: 'VN/a',
          version: '2025-07-01',
          recommended: true,
          installed: false,
          detailHref: '/admin/addresses/VN%2Fa?lang=en',
          installAction: '/admin/addresses/VN%2Fa/install?lang=en',
        },
      ],
    }),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-row-href="\/admin\/addresses\/VN%2Fa\?lang=en"/)
  assert.match(html, /action="\/admin\/addresses\/VN%2Fa\/install\?lang=en"/)
  assert.match(html, /name="action" value="2025-07-01"/)
})
