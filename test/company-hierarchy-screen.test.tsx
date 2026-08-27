import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { hierarchyScreen } from '../packages/ketsuite/src/modules/company_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('company hierarchy remains specialized with encoded rows, lifecycle state and navigation', () => {
  const html = renderToString(
    hierarchyScreen(
      translate,
      {},
      {
        rows: [
          {
            id: 'child/a',
            code: 'CHILD',
            name: 'Child',
            partnerId: 'party',
            parentId: 'root',
            currency: 'VND',
            active: false,
            version: 1,
            depth: 1,
            parentName: 'Root',
            detailHref: '/admin/companies/child%2Fa?lang=en',
          },
        ],
        companiesHref: '/admin/companies?lang=en',
        createHref: '/admin/companies/new?lang=en',
      },
    ),
  )
  assert.match(html, /data-row-href="\/admin\/companies\/child%2Fa\?lang=en"/)
  assert.match(html, /— Child/)
  assert.match(html, /data-tone="neutral" data-value="archived"/)
  assert.match(html, /href="\/admin\/companies\?lang=en"/)
  assert.match(html, /href="\/admin\/companies\/new\?lang=en"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
})
