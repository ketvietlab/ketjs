// Every figure on a Flow list screen, checked past the cap that used to hide it.
//
// Each case is written at a size above the limit it is about, because below the
// limit the old code and the new one agree. Rows are inserted straight into the
// datastore rather than through a thousand function calls: the subject here is
// what a query answers at scale, not what a save does.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, tableNameFor } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'
import { FIELD_FILTER_MATCHES } from '../packages/ketsuite/src/modules/flow/index.ts'
import { emptyIssueListState } from '../packages/ketsuite/src/modules/flow/search.ts'

const app = defineDeployment({
  name: 'flow_truthful_figures',
  modules: [address, partner, company, storage, user, mail, flow],
  headless: true,
  serve: { sessions: { anonymous: { company: 'acme' } } },
})

const insert = async (
  adapter: Adapter,
  model: string,
  columns: readonly string[],
  values: readonly unknown[][],
): Promise<void> => {
  const sql = `INSERT INTO ${adapter.quoteIdent(tableNameFor(model))} (${columns
    .map((name) => adapter.quoteIdent(name))
    .join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  for (const row of values) await adapter.run(sql, row as never[])
}

const stamp = '2026-09-05T00:00:00.000Z'

const boot = async (timezone?: string) => {
  const e2e = await createTestDeployment(app, { worker: false })
  await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
  await e2e.fixture.call('company.saveCompany', {
    id: 'acme',
    partnerId: 'p-company',
    currency: 'VND',
    ...(timezone ? { accountingTimezone: timezone } : {}),
  })
  await e2e.fixture.call('user.createUser', {
    id: 'u1',
    login: 'u1',
    password: 'test-password',
    name: 'Lê Minh',
    defaultCompanyId: 'acme',
  })
  await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
  // These cases seed rows straight into the store rather than through
  // `project.save`, so nobody is a member of anything. The company-wide grant
  // says what is true: this test is about read costs and figures, not about who
  // may see which project — that has its own file.
  // As 'u1', because granting is a command and a command needs an actor.
  await e2e.fixture.call(
    'flow.project.access.grant',
    { userId: 'u1', idempotencyKey: 'read-scope-grant' },
    { actor: 'u1', scope: { company: 'acme' } },
  )
  await e2e.client.login({ login: 'u1', password: 'test-password' })
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await e2e.client.call<T>(name, input)).value
  return { e2e, call }
}

const project = async (
  call: <T = Row>(name: string, input?: Record<string, unknown>) => Promise<T>,
  id: string,
  key: string,
  name: string,
) => {
  const saved = await call<Row>('flow.project.save', {
    values: { id, key, name },
    idempotencyKey: `seed-project-${id}`,
  })
  assert.equal(saved.ok, true, JSON.stringify(saved.errors ?? saved))
}

test('a custom-field filter that stops short says so instead of answering', async () => {
  const { e2e, call } = await boot()
  try {
    await project(call, 'p1', 'PRJ', 'Flagship')
    const column = await call<Row>('flow.column.save', {
      values: { id: 'c-todo', projectId: 'p1', code: 'todo', name: 'To do', sequence: 10 },
      idempotencyKey: 'seed-column-todo',
    })
    assert.equal(column.ok, true)
    const field = await call<Row>('flow.field.save', {
      id: 'f-env',
      projectId: 'p1',
      code: 'environment',
      name: 'Environment',
      kind: 'select',
      config: { options: [{ code: 'prod', label: 'Production' }] },
      idempotencyKey: 'seed-field-environment',
    })
    assert.equal(field.ok, true, JSON.stringify(field.errors ?? field))

    // One more than the cap, so the filter has to stop and admit it. At the cap
    // exactly it would answer completely and prove nothing.
    const count = FIELD_FILTER_MATCHES + 1
    await e2e.fixture.withTenant('', async ({ adapter }) => {
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
          'active',
          'version',
          'createdAt',
          'updatedAt',
        ],
        Array.from({ length: count }, (_, index) => [
          'acme',
          `i${index}`,
          'p1',
          'c-todo',
          `Issue ${index}`,
          'normal',
          `thread:flow.Issue:i${index}`,
          1,
          1,
          stamp,
          stamp,
        ]),
      )
      await insert(
        adapter,
        'flow.IssueFieldValue',
        ['companyId', 'id', 'issueId', 'fieldId', 'value'],
        Array.from({ length: count }, (_, index) => ['acme', `v${index}`, `i${index}`, 'f-env', 'prod']),
      )
    })

    const filtered = await call<Row>('flow.issue.list', {
      projectId: 'p1',
      listState: {
        ...emptyIssueListState(),
        filters: [{ kind: 'rule', field: 'field:environment', operator: 'equals', value: 'prod' }],
      },
      limit: 20,
    })
    assert.equal(filtered.fieldFilterTruncated, true, 'the domain reports the filter stopped short')
    // And the same run without the field rule is complete, so the flag is about
    // this filter rather than about the size of the project.
    const whole = await call<Row>('flow.issue.list', {
      projectId: 'p1',
      listState: emptyIssueListState(),
      limit: 20,
    })
    assert.equal(whole.fieldFilterTruncated, undefined)
    assert.equal(Number(whole.total), count)
  } finally {
    await e2e.close()
  }
})

test('the all-documents list counts every document and names every project', async () => {
  const { e2e, call } = await boot()
  try {
    // Past both old caps at once: more projects than `project.list` returned, and
    // more documents than the route used to read.
    const projects = 250
    const pages = 600
    await e2e.fixture.withTenant('', async ({ adapter }) => {
      await insert(
        adapter,
        'flow.Project',
        ['companyId', 'id', 'key', 'name', 'active'],
        Array.from({ length: projects }, (_, index) => [
          'acme',
          `p${index}`,
          `K${index}`,
          // Named so that ordering by name puts the owning project of the newest
          // documents last — exactly where a 200-row cap would have dropped it.
          `Project ${String(index).padStart(4, '0')}`,
          1,
        ]),
      )
      await insert(
        adapter,
        'flow.Page',
        ['companyId', 'id', 'projectId', 'title', 'sequence', 'active', 'version', 'createdAt', 'updatedAt'],
        Array.from({ length: pages }, (_, index) => [
          'acme',
          `pg${index}`,
          `p${projects - 1 - (index % projects)}`,
          `Doc ${index}`,
          10,
          1,
          1,
          stamp,
          // Descending, so the first page of the list is the highest-numbered
          // projects — the ones the old lookup never reached.
          new Date(Date.parse(stamp) + index * 1000).toISOString(),
        ]),
      )
    })

    const listed = await call<{ rows: Row[]; total: number }>('flow.page.listAll', { limit: 50 })
    assert.equal(listed.total, pages, 'the total is a count, not the length of a slice')
    assert.equal(listed.rows.length, 50)
    for (const row of listed.rows)
      assert.notEqual(row.projectName, '', `${String(row.id)} must name its project`)

    // And the pager can walk to the end rather than stopping at a read limit.
    const last = await call<{ rows: Row[]; total: number }>('flow.page.listAll', {
      cursor: pages - 10,
      limit: 50,
    })
    assert.equal(last.total, pages)
    assert.equal(last.rows.length, 10)
  } finally {
    await e2e.close()
  }
})

test('"my projects" is asked of every project, not of the last page of my issues', async () => {
  const { e2e, call } = await boot()
  try {
    const projects = 12
    const perProject = 25
    await e2e.fixture.withTenant('', async ({ adapter }) => {
      await insert(
        adapter,
        'flow.Project',
        ['companyId', 'id', 'key', 'name', 'active'],
        Array.from({ length: projects }, (_, index) => [
          'acme',
          `p${index}`,
          `K${index}`,
          `Project ${index}`,
          1,
        ]),
      )
      await insert(
        adapter,
        'flow.Column',
        ['companyId', 'id', 'projectId', 'code', 'name', 'sequence', 'terminalState', 'active'],
        Array.from({ length: projects }, (_, index) => [
          'acme',
          `c${index}`,
          `p${index}`,
          'todo',
          'To do',
          10,
          0,
          1,
        ]),
      )
      // Three hundred issues, all mine, ordered so the oldest — and therefore the
      // ones a 200-row page by `updatedAt` would drop — are the first project's.
      await insert(
        adapter,
        'flow.Issue',
        [
          'companyId',
          'id',
          'projectId',
          'columnId',
          'title',
          'assigneeUserId',
          'priority',
          'threadId',
          'active',
          'version',
          'createdAt',
          'updatedAt',
        ],
        Array.from({ length: projects * perProject }, (_, index) => {
          const owner = Math.floor(index / perProject)
          return [
            'acme',
            `i${index}`,
            `p${owner}`,
            `c${owner}`,
            `Issue ${index}`,
            'u1',
            'normal',
            `thread:flow.Issue:i${index}`,
            1,
            1,
            stamp,
            new Date(Date.parse(stamp) + index * 1000).toISOString(),
          ]
        }),
      )
    })

    const mine = (await call<Row[]>('flow.project.list', { mine: true, limit: 200 })) as Row[]
    assert.equal(mine.length, projects, 'every project I have work in, not the newest two hundred issues')
    assert.deepEqual(
      mine.map((row) => String(row.id)).sort(),
      Array.from({ length: projects }, (_, index) => `p${index}`).sort(),
    )
    // The unfiltered list is unchanged by the new argument.
    const all = (await call<Row[]>('flow.project.list', { limit: 200 })) as Row[]
    assert.equal(all.length, projects)
  } finally {
    await e2e.close()
  }
})

test('overdue is counted against the company’s day, not against UTC', async () => {
  // 2026-09-05T02:00:00Z is 09:00 on the 5th in Ho Chi Minh City and still the
  // 5th in UTC, so both agree. The interesting instant is the other side of
  // local midnight: at 17:30Z it is already the 6th where the company is.
  const { e2e, call } = await boot('Asia/Ho_Chi_Minh')
  try {
    await project(call, 'p1', 'PRJ', 'Flagship')
    const column = await call<Row>('flow.column.save', {
      values: { id: 'c-todo', projectId: 'p1', code: 'todo', name: 'To do', sequence: 10 },
      idempotencyKey: 'seed-column-todo',
    })
    assert.equal(column.ok, true)

    const localToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const yesterday = new Date(Date.parse(`${localToday}T00:00:00.000Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10)

    for (const [id, dueDate] of [
      ['due-today', localToday],
      ['due-yesterday', yesterday],
    ] as const) {
      const saved = await call<Row>('flow.issue.save', {
        id,
        projectId: 'p1',
        columnId: 'c-todo',
        title: id,
        dueDate,
        idempotencyKey: `seed-issue-${id}`,
      })
      assert.equal(saved.ok, true, JSON.stringify(saved.errors ?? saved))
    }

    // No `today` from the caller: the domain reads the company's calendar.
    const buckets = await call<Row>('flow.issue.buckets', {
      projectId: 'p1',
      listState: emptyIssueListState(),
    })
    assert.equal(buckets.today, localToday, 'the counts name the company’s civil date')
    assert.equal(Number(buckets.overdue), 1, 'yesterday is late; today is not, whatever UTC thinks')
    assert.equal(Number(buckets.total), 2)

    // A caller with a reason to ask about another day still can.
    const asOf = await call<Row>('flow.issue.buckets', {
      projectId: 'p1',
      listState: emptyIssueListState(),
      today: '2099-01-01',
    })
    assert.equal(asOf.today, '2099-01-01')
    assert.equal(Number(asOf.overdue), 2)
  } finally {
    await e2e.close()
  }
})

test('a company with no civil date of its own still gets a coherent one', async () => {
  const { e2e, call } = await boot()
  try {
    await project(call, 'p1', 'PRJ', 'Flagship')
    const buckets = await call<Row>('flow.issue.buckets', {
      projectId: 'p1',
      listState: emptyIssueListState(),
    })
    // UTC is the fallback, and it is stated rather than assumed: the screen
    // marking rows late reuses this value instead of computing its own.
    assert.equal(buckets.today, new Date().toISOString().slice(0, 10))
  } finally {
    await e2e.close()
  }
})
