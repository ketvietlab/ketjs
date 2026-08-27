import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { usersScreen } from '../packages/ketsuite/src/modules/user_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('users list uses public ListPage chrome, exact status and encoded row navigation', () => {
  const html = renderToString(
    usersScreen(
      translate,
      {
        chrome: {
          search: { name: 'q', value: 'Ada', placeholder: 'Search users' },
          pager: { from: 31, to: 31, total: 31, prev: '/admin/users?q=Ada&lang=en', next: null },
        },
      },
      {
        rows: [
          {
            id: 'user/a',
            login: 'ada',
            name: 'Ada Lovelace',
            accessKind: 'internal',
            securityVersion: 1,
            passwordReady: false,
            active: false,
            superuser: false,
            detailHref: '/admin/users/user%2Fa?lang=en',
          },
        ],
        total: 31,
        createHref: '/admin/users/new?lang=en',
        toggleHref: '/admin/users?q=Ada&lang=en',
        includeArchived: true,
      },
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-ui="list-chrome" data-layout="command"/)
  assert.match(html, /name="q"[^>]*value="Ada"/)
  assert.match(html, /31-31 \/ 31/)
  assert.match(html, /data-row-href="\/admin\/users\/user%2Fa\?lang=en"/)
  assert.match(html, /href="\/admin\/users\/new\?lang=en"/)
  assert.match(html, /data-tone="neutral" data-value="archived"/)
  assert.doesNotMatch(html, /data-ui="form-page"|data-ui="modal-layer"/)
})

test('users list keeps ListPage identity and empty state without decorative pager', () => {
  const html = renderToString(
    usersScreen(
      translate,
      {},
      {
        rows: [],
        total: 0,
        createHref: '/admin/users/new',
        toggleHref: '/admin/users?archived=1',
        includeArchived: false,
      },
    ),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /user_backend\.users\.empty/)
  assert.doesNotMatch(html, /data-ui="table"|data-ui="pager"/)
})
