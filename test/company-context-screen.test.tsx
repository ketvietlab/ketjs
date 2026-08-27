import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { contextScreen } from '../packages/ketsuite/src/modules/company_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('working context uses FormPage with one external primary form action', () => {
  const html = renderToString(
    contextScreen(translate, {}, {
      companies: [{ id: 'acme', code: 'ACME', name: 'ACME' }],
      branches: [{ id: 'root:acme', companyId: 'acme', code: 'ROOT', name: 'Root', isRoot: true }],
      selectedCompanies: ['acme'],
      selectedBranches: ['root:acme'],
      companyId: 'acme',
      branchId: 'root:acme',
      action: '/admin/context?lang=en',
    }),
  )
  assert.match(html, /data-ui="form-page" data-scope="working-context-page"/)
  assert.match(html, /id="working-context-form"/)
  assert.match(html, /name="action" value="save"/)
  assert.match(html, /type="submit"[^>]*form="working-context-form"/)
  assert.match(html, /name="company\.acme"[^>]*checked/)
  assert.match(html, /name="branch\.root:acme"[^>]*checked/)
})
