import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { collectionSearchFrame } from '../packages/ketsuite/src/modules/backend/collection-search.ts'
import { employeesListScreen } from '../packages/ketsuite/src/modules/hr_backend/screens/employees-list.tsx'
import { usersScreen } from '../packages/ketsuite/src/modules/user_backend/screens/users-list.tsx'
import { projectsListScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/projects-list.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = translate.has

const links = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map(
    (match) => new URL(match[1].replaceAll('&amp;', '&'), 'https://ket.test'),
  )

test('employee complete collection pages actual rows and preserves search and locale in column choices', () => {
  const rows = Array.from({ length: 35 }, (_, index) => ({
    id: `employee-${index + 1}`,
    code: `employee ${String(index + 1).padStart(2, '0')}`,
    name: `Person ${index + 1}`,
    branch: 'Main',
    timezone: 'Asia/Ho_Chi_Minh',
    active: true,
    editHref: `/admin/hr?edit=employee-${index + 1}&lang=vi`,
  }))
  const render = (url: URL) =>
    renderToString(
      employeesListScreen(
        translate,
        {
          rows,
          createHref: '/admin/hr?create=1&lang=vi',
          action: '/admin/hr?lang=vi',
        },
        collectionSearchFrame(url, {}, 'Search employees'),
      ),
    )
  const html = render(new URL('https://ket.test/admin/hr?q=employee&lang=vi&page=2'))
  assert.match(html, /31-35 \/ 35/)
  assert.doesNotMatch(html, />employee 01</)
  assert.match(html, />employee 31</)
  assert.match(html, /data-row-href="\/admin\/hr\?edit=employee-31&amp;lang=vi"/)
  const hiddenTimezone = links(html).find(
    (url) =>
      url.searchParams.has('columns') && !url.searchParams.get('columns')!.split(',').includes('timezone'),
  )
  assert.ok(hiddenTimezone)
  assert.equal(hiddenTimezone.searchParams.get('page'), '2')
  assert.equal(hiddenTimezone.searchParams.get('q'), 'employee')
  assert.equal(hiddenTimezone.searchParams.get('lang'), 'vi')
  assert.doesNotMatch(render(hiddenTimezone), /data-col="timezone"/)
  assert.ok(html.indexOf('data-ui="chrome-search"') < html.indexOf('data-ui="pager"'))
  assert.ok(html.indexOf('data-ui="pager"') < html.indexOf('data-ui="ket-table"'))
})

test('users already paged by the route retain their row and exact total with toolbar columns', () => {
  const url = new URL('https://ket.test/admin/users?archived=1&lang=en&page=2')
  const html = renderToString(
    usersScreen(
      translate,
      collectionSearchFrame(
        url,
        {
          chrome: {
            pager: { from: 31, to: 31, total: 31, prev: '/admin/users?archived=1&lang=en', next: null },
          },
        },
        'Search users',
      ),
      {
        rows: [
          {
            id: 'user-31',
            login: 'ada',
            name: 'Ada',
            accessKind: 'internal',
            securityVersion: 1,
            passwordReady: true,
            active: false,
            superuser: false,
            detailHref: '/admin/users/user-31?lang=en',
          },
        ],
        total: 31,
        createHref: '/admin/users/new?lang=en',
        toggleHref: '/admin/users?lang=en',
        includeArchived: true,
      },
    ),
  )
  assert.match(html, /31-31 \/ 31/)
  assert.match(html, /data-row-href="\/admin\/users\/user-31\?lang=en"/)
  assert.ok(links(html).some((target) => target.searchParams.has('columns')))
})

test('projects existing page controls sit above the table in the shared command bar', () => {
  const html = renderToString(
    projectsListScreen(
      translate,
      {},
      {
        rows: [{ id: 'p31', key: 'P31', name: 'Project 31', total: 0, done: 0, state: 'empty' }],
        projectCount: 31,
        issueCount: 0,
        issuesDone: 0,
        activeCount: 0,
        activity: [],
        tab: 'all',
        tabs: [],
        pager: { from: 31, to: 31, total: 31, prev: '/admin/flow/projects?lang=vi', next: null },
      },
    ),
  )
  assert.equal(html.match(/data-ui="pager"/g)?.length, 1)
  assert.match(html, /31-31 \/ 31/)
  assert.ok(html.indexOf('data-ui="pager"') < html.indexOf('data-ui="ket-table"'))
})
