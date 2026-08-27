import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { roleScreen } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('role detail uses FormPage with external identity save and grouped permissions', () => {
  const html = renderToString(
    roleScreen(
      translate,
      { id: 'manager/a', name: 'Manager', description: 'Operations' },
      {
        mode: 'detail',
        action: '/admin/roles/manager%2Fa?lang=en',
        cancelHref: '/admin/roles?lang=en',
        permissionsAction: '/admin/roles/manager%2Fa/permissions?lang=en',
        permissions: [
          {
            key: 'sale:read',
            module: 'sale',
            moduleLabel: 'Sales',
            task: 'read',
            label: 'Read',
            checked: true,
          },
        ],
      },
    ),
  )
  assert.match(html, /data-ui="form-page" data-scope="role-form-page"/)
  assert.match(html, /form="role-record-form"/)
  assert.match(html, /action="\/admin\/roles\/manager%2Fa\?lang=en"/)
  assert.match(html, /action="\/admin\/roles\/manager%2Fa\/permissions\?lang=en"/)
  assert.match(html, /name="action" value="save"/)
  assert.match(html, /name="permission\.sale:read"[^>]*checked/)
})

test('role create preserves stable identity and rejected values without permission sections', () => {
  const html = renderToString(
    roleScreen(
      translate,
      { id: 'draft-id', name: 'Draft role', description: 'Rejected value' },
      {
        mode: 'create',
        action: '/admin/roles/new?lang=en',
        cancelHref: '/admin/roles?lang=en',
        errors: ['name: duplicate'],
      },
    ),
  )
  assert.match(html, /name="id" value="draft-id"/)
  assert.match(html, /name="name"[^>]*value="Draft role"/)
  assert.match(html, /data-ui="form-errors" role="alert"/)
  assert.doesNotMatch(html, /name="permission\./)
})
