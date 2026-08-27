import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { userFormScreen } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('user detail uses FormPage with access body and one-third security/session rail', () => {
  const html = renderToString(
    userFormScreen(
      translate,
      {
        id: 'user/a', login: 'ada', name: 'Ada', email: 'ada@example.test', accessKind: 'internal',
        securityVersion: 1, passwordReady: true, active: true, superuser: false,
        memberships: [{ companyId: 'acme' }], branchMemberships: [{ branchId: 'root:acme' }],
        assignments: [{ roleId: 'manager' }],
      },
      {
        mode: 'detail', action: '/admin/users/user%2Fa?lang=en', cancelHref: '/admin/users?lang=en',
        companies: [{ value: 'acme', label: 'ACME' }],
        branches: [{ value: 'root:acme', label: 'Root', companyId: 'acme' }],
        roles: [{ value: 'manager', label: 'Manager' }],
        companiesAction: '/admin/users/user%2Fa/companies?lang=en',
        branchesAction: '/admin/users/user%2Fa/branches?lang=en',
        rolesAction: '/admin/users/user%2Fa/roles?lang=en',
        tokenAction: '/admin/users/user%2Fa/token?lang=en',
        sessionAction: (row) => `/admin/users/user%2Fa/sessions/${row.id}?lang=en`,
        sessions: [{ id: 'session-1', current: false, company: 'acme', branch: 'root:acme', createdAt: 1, expiresAt: 2 }],
      },
    ),
  )
  assert.match(html, /data-ui="form-page" data-scope="user-form-page" data-has-aside="true"/)
  assert.match(html, /form="user-record-form"/)
  assert.match(html, /name="action" value="save"/)
  assert.match(html, /action="\/admin\/users\/user%2Fa\/companies\?lang=en"/)
  assert.match(html, /action="\/admin\/users\/user%2Fa\/sessions\/session-1\?lang=en"/)
  assert.match(html, /name="action" value="revoke"/)
  assert.doesNotMatch(html, /data-ui="modal-layer"/)
})

test('user create keeps stable hidden identity, rejected values and no aside', () => {
  const html = renderToString(
    userFormScreen(
      translate,
      { id: 'draft-id', login: 'draft', name: 'Draft User', email: 'bad@example.test' },
      {
        mode: 'create', action: '/admin/users/new?lang=en', cancelHref: '/admin/users?lang=en',
        companies: [], branches: [], roles: [], errors: ['login: duplicate'],
      },
    ),
  )
  assert.match(html, /data-has-aside="false"/)
  assert.match(html, /name="id" value="draft-id"/)
  assert.match(html, /name="login"[^>]*value="draft"/)
  assert.match(html, /data-ui="form-errors" role="alert"/)
})
