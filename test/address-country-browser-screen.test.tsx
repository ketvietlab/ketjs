import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { countryScreen } from '../packages/ketsuite/src/modules/address_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('country browser keeps specialized hierarchy with encoded locale-safe navigation', () => {
  const html = renderToString(
    countryScreen(
      translate,
      {
        countryCode: 'VN/a',
        status: { countryCode: 'VN/a', version: '2025', recommended: true, installed: true },
        divisions: [{ id: 'division/a', code: '01', officialName: 'Division A', kind: 'province', level: 1 }],
      },
      {},
      'lang=en',
    ),
  )
  assert.match(html, /href="\/admin\/addresses\/VN%2Fa\?parentId=division%2Fa&amp;lang=en"/)
  assert.match(html, /address_backend\.divisions\.rootHint/)
  assert.doesNotMatch(html, /data-ui="list-page"/)
})
