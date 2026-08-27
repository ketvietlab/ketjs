import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { branchFormScreen } from '../packages/ketsuite/src/modules/company_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const company = {
  id: 'company/a',
  code: 'ACME',
  name: 'ACME Legal',
  partnerId: 'party',
  currency: 'VND',
  active: true,
  version: 1,
}

test('branch detail uses full-route FormPage with external save and lifecycle actions', () => {
  const html = renderToString(
    branchFormScreen(
      translate,
      company,
      { id: 'branch/a', name: 'North', code: 'NORTH', parentId: 'root', active: false },
      {
        mode: 'detail',
        action: '/admin/companies/company%2Fa/branches/branch%2Fa?lang=en',
        archiveAction: '/admin/companies/company%2Fa/branches/branch%2Fa/archive?lang=en',
        cancelHref: '/admin/companies/company%2Fa?lang=en',
        parents: [{ value: 'root', label: 'Root' }],
      },
    ),
  )

  assert.match(html, /data-ui="form-page" data-scope="branch-form-page"/)
  assert.match(html, /form="branch-record-form"/)
  assert.match(html, /name="action" value="save"/)
  assert.match(html, /name="id" value="branch\/a"/)
  assert.match(html, /name="action" value="restore"/)
  assert.match(html, /data-tone="neutral" data-value="archived"/)
  assert.match(html, /href="\/admin\/companies\/company%2Fa\?lang=en"/)
  assert.doesNotMatch(html, /data-ui="modal-layer"|data-has-aside="true"/)
})

test('branch create preserves a rejected parent and stable command id', () => {
  const html = renderToString(
    branchFormScreen(
      translate,
      company,
      { id: 'draft-id', name: 'Draft', code: 'DRAFT', parentId: 'missing-parent' },
      {
        mode: 'create',
        action: '/admin/companies/company%2Fa/branches/new?lang=en',
        cancelHref: '/admin/companies/company%2Fa?lang=en',
        parents: [{ value: 'root', label: 'Root' }],
        errors: ['parentId: missing'],
      },
    ),
  )
  assert.match(html, /name="id" value="draft-id"/)
  assert.match(html, /<option value="missing-parent" selected="true">missing-parent<\/option>/)
  assert.match(html, /data-ui="form-errors" role="alert"/)
})
