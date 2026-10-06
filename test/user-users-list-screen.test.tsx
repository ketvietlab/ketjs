import { withoutGlobalSearchDialog } from './helpers/shell.ts'
import { withGrid } from './helpers/user-grid.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { usersGrid, usersScreen } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'
import type { UserListRow } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'
import type { Frame, TableSelection } from '../packages/ketsuite/src/ui/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const person = (id: string, extra: Partial<UserListRow> = {}): UserListRow => ({
  id,
  login: 'ada',
  name: 'Ada Lovelace',
  accessKind: 'internal',
  securityVersion: 1,
  passwordReady: true,
  active: true,
  superuser: false,
  detailHref: `/admin/users?record=user.user%3A${encodeURIComponent(id)}`,
  ...extra,
})

const bulk: TableSelection = {
  formId: 'user-people-bulk',
  action: '/admin/users/bulk',
  hidden: { returnTo: '/admin/users' },
  actions: [
    { id: 'activate', label: 'user_backend.action.activateSelected' },
    { id: 'deactivate', label: 'user_backend.action.deactivateSelected', tone: 'danger' },
  ],
}

const render = (
  frame: Frame,
  rows: UserListRow[],
  options: { total: number; createHref: string | null; selection?: TableSelection | null },
) =>
  renderToString(
    withGrid(
      translate,
      frame,
      usersGrid,
      { rows, rowHrefTemplate: '/admin/users?record=user.user%3A{id}&lang=en', selection: options.selection },
      (prepared, grid) =>
        usersScreen(translate, prepared, {
          grid,
          empty: !rows.length,
          total: options.total,
          createHref: options.createHref,
        }),
    ),
  )

test('users list is the KetTable island inside public ListPage chrome, with encoded row navigation', () => {
  const html = render(
    {
      chrome: {
        search: { name: 'q', value: 'Ada', placeholder: 'Search users' },
        pager: { from: 31, to: 31, total: 31, prev: '/admin/users?q=Ada&lang=en', next: null },
      },
    },
    [person('user/a', { passwordReady: false, active: false })],
    { total: 31, createHref: '/admin/users/new?lang=en' },
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="list-chrome" data-layout="command"/)
  assert.match(html, /name="q"[^>]*value="Ada"/)
  assert.match(html, /31-31 \/ 31/)
  assert.match(
    html,
    /data-ket-island="backend\.ket-table"|data-island="backend\.ket-table"|data-ui="ket-table"/,
  )
  assert.match(
    html,
    /data-ui="kt-row-link"[^>]*href="\/admin\/users\?record=user\.user%3Auser%2Fa&amp;lang=en"/,
  )
  assert.match(html, /href="\/admin\/users\/new\?lang=en"/)
  // The search-filter bar owns the archived toggle, so the header keeps only
  // the create action before the controls and the table.
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?href="\/admin\/users\/new\?lang=en"[\s\S]*?<\/header>[\s\S]*?data-ui="list-page-controls"[\s\S]*?data-ui="ket-table"/,
  )
  assert.equal((html.match(/href="\/admin\/users\/new\?lang=en"/g) ?? []).length, 1)
  assert.match(html, /user_backend\.state\.archived/)
  assert.match(html, /user_backend\.login\.preparing/)
  assert.match(html, /user_backend\.login\.never/)
  // Without a bulk form there is nothing to check a row for.
  assert.doesNotMatch(html, /data-ui="kt-row-select"|data-ui="bulk-form"/)
  assert.doesNotMatch(withoutGlobalSearchDialog(html), /data-ui="form-page"|data-ui="modal-layer"/)
})

test('a viewer who may change people checks rows into the bulk form that makes them active or inactive', () => {
  const html = render({}, [person('ada'), person('grace', { name: 'Grace', superuser: true })], {
    total: 2,
    createHref: null,
    selection: bulk,
  })
  assert.match(html, /data-ui="kt-select-all"/)
  assert.equal((html.match(/data-ui="kt-row-select"/g) ?? []).length, 2)
  // Each checkbox is announced by the person's name, not their record id.
  assert.match(html, /data-ui="kt-row-select"[^>]*aria-label="[^"]*: Grace"/)
  assert.doesNotMatch(html, /aria-label="[^"]*: grace"/)
  assert.match(
    html,
    /<form data-ui="bulk-form" id="user-people-bulk" method="post" action="\/admin\/users\/bulk" hidden(?:="true")?>/,
  )
  assert.match(html, /name="action" value="activate"[\s\S]*?user_backend\.action\.activateSelected/)
  assert.match(html, /data-tone="danger"[^>]*name="action" value="deactivate"/)
  // Full authority is said on the row that holds it, and only there.
  assert.equal((html.match(/user_backend\.field\.superuser/g) ?? []).length, 1)
})

test('a bar selection replaces the filter row beside the checkboxes instead of joining the header', () => {
  const html = render({}, [person('ada')], {
    total: 1,
    createHref: '/admin/users/new',
    selection: { ...bulk, presentation: 'bar' },
  })
  const header = html.slice(
    html.indexOf('data-ui="list-page-header"'),
    html.indexOf('data-ui="list-page-toolbar"'),
  )
  assert.ok(header.length > 0)
  assert.doesNotMatch(header, /data-ui="bulk-form"|data-ui="bulk-actions"/)
  // The bar waits hidden in the toolbar, ahead of the filters it stands in for.
  assert.match(
    html,
    /data-ui="list-page-toolbar"[\s\S]*?<div data-ui="list-page-selection" hidden[^>]*>[\s\S]*?id="user-people-bulk"[\s\S]*?data-ui="list-page-controls"/,
  )
  assert.match(html, /data-ui="bulk-count">(?:<!--k\[-->)?0</)
  assert.match(
    html,
    /type="button"[^>]*form="user-people-bulk"[^>]*name="clear-selection"|name="clear-selection"[^>]*form="user-people-bulk"/,
  )
  assert.doesNotMatch(html, /<details[^>]*data-ui="bulk-actions"/)
})

test('users list keeps ListPage identity and empty state without decorative pager', () => {
  const html = render({}, [], { total: 0, createHref: '/admin/users/new' })
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /user_backend\.users\.empty/)
  assert.doesNotMatch(html, /data-ui="kt-grid"|data-ui="pager"/)
})

test('users list offers no create action to a viewer who may not create a user', () => {
  const html = render(
    { chrome: { search: { name: 'q', value: '', placeholder: 'Search users' } } },
    [person('ada')],
    {
      total: 1,
      createHref: null,
    },
  )
  // Title, then controls, then the table — the order holds without the action.
  assert.match(
    html,
    /data-ui="list-page-title-row"[\s\S]*?<\/header>[\s\S]*?data-ui="list-page-controls"[\s\S]*?data-ui="ket-table"/,
  )
  assert.doesNotMatch(html, /user_backend\.action\.createUser/)
  assert.doesNotMatch(html, /record=user\.user%3Anew|\/admin\/users\/new/)
})
