// What the project screens read, at a size where reading everything shows.
//
// These are correctness tests for the shape of the reads rather than timings:
// a wall clock says different things on different machines, but "the figures are
// right when the project has twelve thousand issues" and "the timeline stops and
// says it stopped" hold everywhere. The numbers themselves are in bench/flow.bench.ts.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, tableNameFor } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'

const app = defineDeployment({
  name: 'flow_read_costs',
  modules: [address, partner, company, storage, user, mail, flow],
  headless: true,
  serve: { sessions: { anonymous: { company: 'acme' } } },
})

const stamp = '2026-09-05T00:00:00.000Z'

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

const boot = async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
  await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
  await e2e.fixture.call('user.createUser', {
    id: 'u1',
    login: 'u1',
    password: 'test-password',
    name: 'Lê Minh',
    defaultCompanyId: 'acme',
  })
  await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
  await e2e.client.login({ login: 'u1', password: 'test-password' })
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await e2e.client.call<T>(name, input)).value
  return { e2e, call }
}

/** Projects, one done column and one open column each, and issues split between them. */
const seed = async (
  e2e: Awaited<ReturnType<typeof boot>>['e2e'],
  projects: number,
  perProject: number,
  doneEvery: number,
) => {
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
        `c-open-${index}`,
        `p${index}`,
        'todo',
        'To do',
        10,
        0,
        1,
      ]).concat(
        Array.from({ length: projects }, (_, index) => [
          'acme',
          `c-done-${index}`,
          `p${index}`,
          'done',
          'Done',
          20,
          1,
          1,
        ]),
      ),
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
        'active',
        'version',
        'createdAt',
        'updatedAt',
      ],
      Array.from({ length: projects * perProject }, (_, index) => {
        const owner = Math.floor(index / perProject)
        const done = index % doneEvery === 0
        return [
          'acme',
          `i${index}`,
          `p${owner}`,
          done ? `c-done-${owner}` : `c-open-${owner}`,
          `Issue ${index}`,
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
}

test('project figures are counted, not tallied from every row in the company', async () => {
  const { e2e, call } = await boot()
  try {
    const projects = 20
    const perProject = 600
    await seed(e2e, projects, perProject, 4)

    const stats = (await call<Row[]>('flow.project.stats', {
      projectIds: Array.from({ length: projects }, (_, index) => `p${index}`),
    })) as Row[]
    assert.equal(stats.length, projects)
    for (const row of stats) {
      assert.equal(Number(row.total), perProject, `${String(row.id)} total`)
      assert.equal(Number(row.done), perProject / 4, `${String(row.id)} done`)
      assert.equal(String(row.state), 'active')
    }

    // An archived issue leaves both figures, which is the reading the counts
    // have to make rather than the reading a full scan happened to make.
    const held = (
      (await call<{ rows: Row[] }>('flow.issue.list', { projectId: 'p0', limit: 1 })) as {
        rows: Row[]
      }
    ).rows[0]!
    await call('flow.issue.archive', {
      id: String(held.id),
      expectedVersion: held.version,
      idempotencyKey: 'read-costs-archive',
    })
    const after = ((await call<Row[]>('flow.project.stats', { projectIds: ['p0'] })) as Row[])[0]!
    assert.equal(Number(after.total), perProject - 1)
  } finally {
    await e2e.close()
  }
})

test('a project with no issues is still counted, and counted as empty', async () => {
  const { e2e, call } = await boot()
  try {
    await seed(e2e, 3, 0, 4)
    const stats = (await call<Row[]>('flow.project.stats', {
      projectIds: ['p0', 'p1', 'p2'],
    })) as Row[]
    assert.equal(stats.length, 3)
    // A grouped count returns no row for a project with nothing in it, so the
    // tally has to start from the ids rather than from what came back.
    for (const row of stats) {
      assert.equal(Number(row.total), 0)
      assert.equal(Number(row.done), 0)
      assert.equal(String(row.state), 'empty')
    }
  } finally {
    await e2e.close()
  }
})
