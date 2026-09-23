import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, tableNameFor } from '@ketvietlab/ketjs'
import type { Adapter, Row, Translator } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import address from '../packages/ketsuite/src/modules/address/index.ts'
import company from '../packages/ketsuite/src/modules/company/index.ts'
import mail from '../packages/ketsuite/src/modules/mail/index.ts'
import partner from '../packages/ketsuite/src/modules/partner/index.ts'
import storage from '../packages/ketsuite/src/modules/storage/index.ts'
import user from '../packages/ketsuite/src/modules/user/index.ts'
import activity from '../packages/ketsuite/src/modules/activity/index.ts'
import calendar from '../packages/ketsuite/src/modules/calendar/index.ts'
import { renderToString } from '@ketvietlab/ketjs-view'
import crm from '../packages/ketsuite/src/modules/crm/index.ts'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'
import { completeCollectionRows } from '../packages/ketsuite/src/modules/crm_backend/collection-rows.ts'
import { collectionSearchFrame } from '../packages/ketsuite/src/modules/backend/collection-search.ts'
import { configurationScreen } from '../packages/ketsuite/src/modules/crm_backend/screens/configuration.tsx'
import { plannerScreen } from '../packages/ketsuite/src/modules/crm_backend/screens/activity-planner.tsx'
import { leaderboardScreen } from '../packages/ketsuite/src/modules/crm_backend/screens/leaderboard.tsx'

const declaration = defineDeployment({
  name: 'platform_collection_pagination',
  modules: [address, partner, company, storage, user, mail, activity, calendar, crm, flow],
  headless: true,
  serve: { sessions: { anonymous: { company: 'acme' } } },
})
const stamp = '2026-09-19T00:00:00.000Z'
const scope = { company: 'acme', companies: ['acme'], branches: null }
const key = (index: number) => String(index).padStart(3, '0')
const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = translate.has

const insert = async (adapter: Adapter, model: string, columns: string[], rows: unknown[][]) => {
  const sql = `INSERT INTO ${adapter.quoteIdent(tableNameFor(model))} (${columns.map((name) => adapter.quoteIdent(name)).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  for (const row of rows) await adapter.run(sql, row as never[])
}

test('platform collections cross old caps with scoped rows, exact totals and working later pages', async (t) => {
  const app = await createTestDeployment(declaration, { worker: false })
  t.after(() => app.close())
  const call = <T,>(name: string, input: Record<string, unknown> = {}, actor: string | null = 'admin') =>
    app.fixture.call<T>(name, input, { scope, actor }).then((result) => result.value)
  await call('partner.savePartner', { id: 'company-partner', name: 'ACME', kind: 'company' }, null)
  await call('company.saveCompany', { id: 'acme', partnerId: 'company-partner', currency: 'VND' }, null)
  for (const id of ['admin', 'worker', 'other']) {
    await call(
      'user.createUser',
      {
        id,
        login: id,
        name: id,
        password: 'pagination fixture',
        superuser: id === 'admin',
        defaultCompanyId: 'acme',
      },
      null,
    )
    await call('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' }, null)
  }
  await call('crm.bootstrap.defaults', { idempotencyKey: 'pagination-defaults' })
  for (const userId of ['worker', 'other'])
    await call('crm.team.member.save', {
      id: `sales-${userId}`,
      teamId: 'crm-team-sales',
      userId,
      idempotencyKey: `member-${userId}`,
    })
  for (const id of ['own-case', 'hidden-case']) {
    const result = await call<Row>('crm.case.save', {
      id,
      name: id,
      kind: 'lead',
      teamId: 'crm-team-sales',
      assigneeUserId: id === 'own-case' ? 'worker' : 'other',
      idempotencyKey: `save-${id}`,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
  }
  await app.fixture.withTenant('', async ({ adapter }) => {
    await insert(
      adapter,
      'crm.Tag',
      ['companyId', 'id', 'name', 'active'],
      [
        ...Array.from({ length: 225 }, (_, index) => [
          'acme',
          `tag-${key(index + 1)}`,
          `Tag ${key(index + 1)}`,
          index % 2 === 0 ? 1 : 0,
        ]),
        ['foreign', 'foreign-tag', 'Tag Foreign', 1],
      ],
    )
    await insert(
      adapter,
      'user.User',
      ['id', 'login', 'name', 'active', 'superuser', 'accessKind', 'securityVersion'],
      Array.from({ length: 75 }, (_, index) => [
        `rank-user-${key(index + 1)}`,
        `rank-user-${key(index + 1)}`,
        `Rank User ${key(index + 1)}`,
        1,
        0,
        'internal',
        1,
      ]),
    )
    await insert(
      adapter,
      'crm.GamificationProfile',
      [
        'companyId',
        'id',
        'userId',
        'points',
        'assigned',
        'won',
        'lost',
        'activitiesDone',
        'streak',
        'refreshedAt',
      ],
      Array.from({ length: 75 }, (_, index) => [
        'acme',
        `rank-${key(index + 1)}`,
        `rank-user-${key(index + 1)}`,
        1000 - index,
        10,
        5,
        1,
        4,
        2,
        stamp,
      ]),
    )
    await insert(
      adapter,
      'activity.Activity',
      [
        'companyId',
        'id',
        'threadId',
        'typeId',
        'assigneeUserId',
        'summary',
        'dueDate',
        'active',
        'createdAt',
        'updatedAt',
      ],
      [
        ...Array.from({ length: 25 }, (_, index) => [
          'acme',
          `hidden-${key(index)}`,
          'hidden-thread',
          'crm-call',
          'worker',
          `Hidden ${key(index)}`,
          '2026-09-01',
          1,
          stamp,
          stamp,
        ]),
        ...Array.from({ length: 225 }, (_, index) => [
          'acme',
          `activity-${key(index + 1)}`,
          'own-thread',
          'crm-call',
          'worker',
          `Activity ${key(index + 1)}`,
          '2026-09-19',
          1,
          stamp,
          stamp,
        ]),
      ],
    )
    await insert(
      adapter,
      'crm.ActivityLink',
      ['companyId', 'id', 'activityId', 'caseId'],
      [
        ...Array.from({ length: 25 }, (_, index) => [
          'acme',
          `hidden-link-${key(index)}`,
          `hidden-${key(index)}`,
          'hidden-case',
        ]),
        ...Array.from({ length: 225 }, (_, index) => [
          'acme',
          `link-${key(index + 1)}`,
          `activity-${key(index + 1)}`,
          'own-case',
        ]),
      ],
    )
    const projects = [
      ...Array.from({ length: 100 }, (_, index) => ({
        id: `hidden-project-${key(index)}`,
        name: `A Hidden ${key(index)}`,
        active: 1,
        member: false,
        mine: false,
      })),
      ...Array.from({ length: 35 }, (_, index) => ({
        id: `ordinary-${key(index + 1)}`,
        name: `B Ordinary ${key(index + 1)}`,
        active: 1,
        member: true,
        mine: false,
      })),
      ...Array.from({ length: 35 }, (_, index) => ({
        id: `mine-${key(index + 1)}`,
        name: `C Mine ${key(index + 1)}`,
        active: 1,
        member: true,
        mine: true,
      })),
      ...Array.from({ length: 35 }, (_, index) => ({
        id: `archived-${key(index + 1)}`,
        name: `D Archived ${key(index + 1)}`,
        active: 0,
        member: true,
        mine: false,
      })),
    ]
    await insert(
      adapter,
      'flow.Project',
      ['companyId', 'id', 'key', 'name', 'active'],
      projects.map((row) => ['acme', row.id, row.id.toUpperCase(), row.name, row.active]),
    )
    await insert(
      adapter,
      'flow.ProjectMember',
      ['companyId', 'id', 'projectId', 'userId', 'addedAt'],
      projects
        .filter((row) => row.member)
        .map((row) => ['acme', `member-${row.id}`, row.id, 'worker', stamp]),
    )
    await insert(
      adapter,
      'flow.Issue',
      [
        'companyId',
        'id',
        'projectId',
        'columnId',
        'title',
        'priority',
        'threadId',
        'assigneeUserId',
        'active',
        'version',
        'createdAt',
        'updatedAt',
      ],
      projects
        .filter((row) => row.mine)
        .map((row) => [
          'acme',
          `issue-${row.id}`,
          row.id,
          'todo',
          `Issue ${row.id}`,
          'normal',
          `thread-${row.id}`,
          'worker',
          1,
          1,
          stamp,
          stamp,
        ]),
    )
  })

  await t.test('tags exhaust cursor batches beyond 200, then page complete filtered rows', async () => {
    const calls: number[] = []
    const tags = await completeCollectionRows((cursor, limit) => {
      calls.push(cursor)
      return call<Row[]>('crm.tag.list', { cursor, limit, includeArchived: true })
    })
    assert.deepEqual(calls, [0, 200])
    assert.equal(tags.length, 225)
    assert.equal(tags.at(-1)?.id, 'tag-225')
    assert.ok(!tags.some((row) => row.id === 'foreign-tag'))
    const active = await call<Row[]>('crm.tag.list', { cursor: 100, limit: 30 })
    assert.equal(active.length, 13)
    assert.ok(active.every((row) => row.active === true))
    const url = new URL('https://ket.test/admin/crm/configuration?section=tags&status=all&page=8&lang=en')
    const html = renderToString(
      configurationScreen(translate, collectionSearchFrame(url, {}, 'Search tags'), {
        section: 'tags',
        status: 'all',
        rows: tags,
        canCreate: false,
      }),
    )
    assert.match(html, /211-225 \/ 225/)
    assert.match(html, /Tag 225/)
    assert.doesNotMatch(html, />Tag 001</)
  })

  await t.test(
    'Mine activities apply case access before cursor paging and pass the old 100-row cap',
    async () => {
      const activities = await completeCollectionRows((cursor, limit) =>
        call<Row[]>('crm.activity.listMine', { cursor, limit, today: '2026-09-19' }, 'worker'),
      )
      assert.equal(activities.length, 225)
      assert.ok(activities.every((row) => row.caseId === 'own-case'))
      assert.equal(activities.at(-1)?.id, 'activity-225')
      const page = await call<Row[]>('crm.activity.listMine', { cursor: 200, limit: 30 }, 'worker')
      assert.equal(page[0]?.id, 'activity-201')
      assert.equal(page.length, 25)
      const url = new URL('https://ket.test/admin/crm/activities?tab=mine&page=8&lang=en')
      const html = renderToString(
        plannerScreen(translate, collectionSearchFrame(url, {}, 'Search activity'), {
          tab: 'mine',
          activities,
          plans: [],
          events: [],
          activityTypes: [],
        }),
      )
      assert.match(html, /211-225 \/ 225/)
      assert.match(html, /Activity 225/)
      assert.doesNotMatch(html, />Activity 001</)
    },
  )

  await t.test(
    'leaderboard returns exact totals past 50 and preserves global rank through search',
    async () => {
      const result = await call<{ profiles: Row[]; total: number }>('crm.gamification.list', {
        cursor: 60,
        limit: 30,
      })
      assert.equal(result.total, 75)
      assert.equal(result.profiles.length, 15)
      assert.equal(result.profiles[0]?.rank, 61)
      const searched = await call<{ profiles: Row[]; total: number }>('crm.gamification.list', {
        search: 'User 075',
        limit: 30,
      })
      assert.equal(searched.total, 1)
      assert.equal(searched.profiles[0]?.rank, 75)
      const html = renderToString(
        leaderboardScreen(
          translate,
          {
            collectionUrl: '/admin/crm/leaderboard?page=3',
            chrome: {
              pager: { from: 61, to: 75, total: 75, prev: '/admin/crm/leaderboard?page=2', next: null },
            },
          },
          { ...result, offset: 60 },
        ),
      )
      assert.match(html, /61-75 \/ 75/)
      assert.match(html, /Rank User 075/)
    },
  )

  await t.test(
    'Flow filters membership, Mine and archived state before both paging and counting',
    async () => {
      const all = await call<Row[]>('flow.project.list', { limit: 30 }, 'worker')
      assert.equal(all.length, 30)
      assert.equal(all[0]?.id, 'ordinary-001')
      assert.deepEqual(await call('flow.project.count', {}, 'worker'), { total: 70 })
      for (const filter of [{ mine: true }, { archivedOnly: true }]) {
        const result = await call<Row[]>('flow.project.list', { ...filter, cursor: 30, limit: 30 }, 'worker')
        assert.equal(result.length, 5)
        assert.deepEqual(await call('flow.project.count', filter, 'worker'), { total: 35 })
        assert.ok(
          result.every((row) =>
            'mine' in filter ? String(row.id).startsWith('mine-') : row.active === false,
          ),
        )
      }
      const search = { mine: true, search: 'MINE-035' }
      assert.deepEqual(await call('flow.project.count', search, 'worker'), { total: 1 })
      assert.deepEqual(
        (await call<Row[]>('flow.project.list', search, 'worker')).map((row) => row.id),
        ['mine-035'],
      )
      assert.deepEqual(await call<Row[]>('flow.project.list', { limit: 30 }, 'other'), [])
    },
  )
})
