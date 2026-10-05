import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { rolesGrid, rolesScreen } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'
import { withGrid } from './helpers/user-grid.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('roles list uses ListPage with row navigation and collection actions', () => {
  const rows = [
    {
      id: 'manager/a',
      name: 'Manager',
      description: 'Operational manager',
      mode: 'managed',
      templateVersion: 2,
      assignmentCount: 4,
      bundleCount: 3,
      healthIssues: ['stale-managed-role'],
      detailHref: '/admin/roles?record=user.role%3Amanager%252Fa&lang=en',
    },
  ]
  const html = renderToString(
    withGrid(
      translate,
      {},
      rolesGrid,
      { rows, rowHrefTemplate: '/admin/roles?record=user.role%3A{id}&lang=en' },
      (frame, grid) =>
        rolesScreen(translate, frame, {
          grid,
          empty: false,
          total: 1,
          createHref: '/admin/roles/new?lang=en',
        }),
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(
    html,
    /data-ui="kt-row-link"[^>]*href="\/admin\/roles\?record=user\.role%3Amanager%2Fa&amp;lang=en"/,
  )
  assert.match(html, /href="\/admin\/roles\/new\?lang=en"/)
  // The legacy preset path is gone: a role is built from a template, not a preset.
  assert.doesNotMatch(html, /permission-presets/)
  assert.doesNotMatch(html, />v2</)
  assert.match(html, /data-col="assignments"[\s\S]*?4/)
  assert.match(html, /data-col="areas"[\s\S]*?3/)
  // Roles are run by Két Việt: nothing to check a row for.
  assert.doesNotMatch(html, /data-ui="kt-row-select"/)
  assert.match(html, /user_backend\.roles\.stale/)
  assert.doesNotMatch(html, /data-ui="form-page"/)
})
