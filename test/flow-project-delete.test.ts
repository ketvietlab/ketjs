// What deleting a project has to be true about.
//
// Archiving is reversible and cheap to get wrong. This is neither, so the four
// things the W7 gate asks for are each their own test: nothing is left behind,
// the authority is not the configuration one, a purge that dies can finish, and
// the record of the request exists before anything is destroyed.
//
// See FLW-DEC-018.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, defineModule, tableNameFor } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'

/**
 * A door into the queue, for the one test that needs to run a purge twice.
 *
 * Only `project.delete` enqueues a purge, and it refuses the second time —
 * the project it was asked about is gone. That is correct behaviour and it is
 * also what makes "run it again" untestable through the product, so the test
 * deployment gets a function whose whole job is to put the same work back on
 * the queue. It is not in the shipped module and could not be: enqueueing a
 * purge without the confirmation and the audit row is exactly what the real
 * function exists to prevent.
 */
const requeue = defineModule({
  name: 'flow_delete_fixture',
  depends: ['flow'],
  functions: {
    purgeAgain: {
      input: { projectId: 'id', deletionId: 'id', key: 'text' },
      output: { id: 'id' },
      effects: ['enqueue:flow.purgeProject'],
      handler: (ctx: Ctx, args: Row) =>
        ctx.jobs.enqueue(
          'flow.purgeProject',
          { projectId: String(args.projectId), deletionId: String(args.deletionId) },
          { uniqueKey: String(args.key) },
        ),
    },
  },
})

const app = defineDeployment({
  name: 'flow_project_delete',
  modules: [address, partner, company, storage, user, mail, flow, requeue],
  headless: true,
  // The purge runs on `maintenance`, the same queue storage sweeps on: this is
  // background work by nature, and it should not sit in front of anything a
  // person is waiting for.
  worker: { queues: { maintenance: 1 } },
  serve: { sessions: { anonymous: { company: 'acme' } } },
})

type Deployment = Awaited<ReturnType<typeof createTestDeployment>>

/** Every Flow table a project's rows can hide in, and how each names it. */
const projectTables = [
  ['flow.Project', 'id'],
  ['flow.Column', 'projectId'],
  ['flow.IssueType', 'projectId'],
  ['flow.FieldDef', 'projectId'],
  ['flow.ProjectMember', 'projectId'],
  ['flow.BoardScope', 'projectId'],
  ['flow.Epic', 'projectId'],
  ['flow.Sprint', 'projectId'],
  ['flow.Issue', 'projectId'],
  ['flow.Page', 'projectId'],
] as const

/** Rows that reach a project through an issue rather than naming it. */
const issueTables = ['flow.IssueFieldValue', 'flow.IssueDependency', 'flow.IssueTag'] as const

/**
 * A project with one of everything in it.
 *
 * The point of seeding this much is that "nothing orphaned" is only a claim
 * worth testing when there was something in every table to begin with — a
 * purge that leaves `flow_issue_tag` behind passes a test whose project never
 * had a tag on anything.
 */
async function boot(t: { after(fn: () => unknown): void }): Promise<Deployment> {
  // A worker, because the whole point of this wave is that the deleting is
  // done by the queue rather than in the request that asked for it.
  const e2e = await createTestDeployment(app)
  t.after(() => e2e.close?.())
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input)

  await fixture('partner.savePartner', { id: 'p-acme', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'p-u1', kind: 'person', name: 'Lê Minh' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'p-acme', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'u1',
    login: 'u1',
    password: 'test-password',
    name: 'Lê Minh',
    partnerId: 'p-u1',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
  await e2e.client.login({ login: 'u1', password: 'test-password' })

  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await e2e.client.call<T>(name, input)).value

  await call('flow.project.save', {
    values: { id: 'doomed', key: 'DOOM', name: 'Dự án sắp xóa' },
    idempotencyKey: 'project-doomed',
  })
  // A second project, so every assertion below can tell "the project went" from
  // "the table went".
  await call('flow.project.save', {
    values: { id: 'keeper', key: 'KEEP', name: 'Dự án giữ lại' },
    idempotencyKey: 'project-keeper',
  })
  for (const projectId of ['doomed', 'keeper'])
    await call('flow.column.save', {
      values: { id: `${projectId}-todo`, projectId, code: 'todo', name: 'Cần làm' },
      idempotencyKey: `column-${projectId}`,
    })

  await call('flow.issueType.save', {
    values: { id: 'doomed-task', projectId: 'doomed', code: 'task', name: 'Công việc' },
    idempotencyKey: 'type-doomed',
  })
  await call('flow.field.save', {
    id: 'doomed-field',
    projectId: 'doomed',
    code: 'severity',
    name: 'Mức độ',
    kind: 'text',
    idempotencyKey: 'field-doomed',
  })
  await call('flow.epic.save', {
    values: { id: 'doomed-epic', projectId: 'doomed', title: 'Chặng' },
    idempotencyKey: 'epic-doomed',
  })
  await call('flow.sprint.save', {
    id: 'doomed-sprint',
    projectId: 'doomed',
    name: 'Chặng chạy',
    idempotencyKey: 'sprint-doomed',
  })
  await call('flow.page.save', {
    id: 'doomed-page',
    projectId: 'doomed',
    title: 'Ghi chép',
    idempotencyKey: 'page-doomed',
  })
  await call('flow.tag.save', { id: 'urgent', name: 'Gấp' })

  for (const [id, title] of [
    ['doomed-1', 'Việc một'],
    ['doomed-2', 'Việc hai'],
  ] as const)
    await call('flow.issue.save', {
      id,
      projectId: 'doomed',
      columnId: 'doomed-todo',
      typeId: 'doomed-task',
      epicId: 'doomed-epic',
      title,
      tagIds: ['urgent'],
      fields: { severity: 'cao' },
      idempotencyKey: `issue-${id}`,
    })
  await call('flow.issue.save', {
    id: 'keeper-1',
    projectId: 'keeper',
    columnId: 'keeper-todo',
    title: 'Việc của dự án giữ lại',
    idempotencyKey: 'issue-keeper',
  })
  await call('flow.issue.dependency.add', {
    id: 'doomed-dep',
    issueId: 'doomed-2',
    dependsOnIssueId: 'doomed-1',
    relation: 'blocks',
    idempotencyKey: 'dependency-doomed',
  })
  // A comment, so the issue grows a mail thread with a message and a follower.
  await call('flow.issue.comment', {
    id: 'doomed-comment',
    issueId: 'doomed-1',
    body: 'Ghi chú trước khi xóa',
    idempotencyKey: 'comment-doomed',
  })
  // And the board, so `flow_board_scope` is not empty either.
  await call('flow.board.remember', { projectId: 'doomed' })

  // A real file with real bytes behind it. Asserting that an attachment row is
  // gone proves nothing if the project never had one, and asserting the row is
  // gone proves nothing about the bytes — which are the part somebody asking
  // for a deletion actually means.
  const form = new FormData()
  form.set('resModel', 'flow.Issue')
  form.set('resId', 'doomed-1')
  form.set('file', new File(['bằng chứng đính kèm'], 'ghi-chu.txt', { type: 'text/plain' }))
  const uploaded = await e2e.client.request('/files', { method: 'POST', body: form })
  assert.equal(uploaded.status, 201, await uploaded.clone().text())
  return e2e
}

/** The id of the file seeded above, so a test can ask whether it still exists. */
const attachmentId = async (e2e: Deployment) =>
  e2e.fixture.withTenant('acme', async ({ adapter }) => {
    const rows = await adapter.all(
      `SELECT "id" FROM ${adapter.quoteIdent(tableNameFor('storage.Attachment'))} WHERE "resId" = ?`,
      ['doomed-1'] as never[],
    )
    return rows[0] ? String(rows[0].id) : ''
  })

/**
 * How many rows a model holds for one id, read straight from the store.
 *
 * Through the adapter rather than through a Flow function on purpose: what is
 * under test is whether the rows are gone, and a read that goes through the
 * membership gate would answer "gone" for a project it simply cannot see.
 */
const countFor = async (e2e: Deployment, model: string, column: string, id: string) =>
  e2e.fixture.withTenant('acme', async ({ adapter }) => {
    const rows = await adapter.all(
      `SELECT COUNT(*) AS n FROM ${adapter.quoteIdent(tableNameFor(model))} WHERE ${adapter.quoteIdent(column)} = ?`,
      [id] as never[],
    )
    return Number(rows[0]?.n ?? 0)
  })

test('deleting a project leaves nothing of it in any table', async (t) => {
  const e2e = await boot(t)
  const fileId = await attachmentId(e2e)
  assert.ok(fileId, 'the project really has a file on it')
  assert.equal((await e2e.client.request(`/files/${fileId}`)).status, 200)

  // Everything is really there first. Without this the test below passes on a
  // project that never had the rows it claims to have deleted.
  for (const [table, column] of projectTables)
    assert.ok((await countFor(e2e, table, column, 'doomed')) > 0, `${table} has rows to delete`)
  for (const table of issueTables) {
    const held =
      (await countFor(e2e, table, 'issueId', 'doomed-1')) +
      (await countFor(e2e, table, 'issueId', 'doomed-2'))
    assert.ok(held > 0, `${table} has rows to delete`)
  }

  const asked = (await e2e.client.call<Row>('flow.project.delete', {
    projectId: 'doomed',
    confirmName: 'Dự án sắp xóa',
    reason: 'yêu cầu của khách',
    idempotencyKey: 'delete-doomed',
  })) as Row
  assert.equal((asked.value as Row).ok, true)
  assert.equal(await e2e.drainJobs(), 1)

  for (const [table, column] of projectTables)
    assert.equal(await countFor(e2e, table, column, 'doomed'), 0, `${table} keeps nothing`)
  for (const table of issueTables)
    for (const issueId of ['doomed-1', 'doomed-2'])
      assert.equal(await countFor(e2e, table, 'issueId', issueId), 0, `${table} keeps nothing`)

  // The thread, its message and its follower, which belong to mail.
  assert.equal(await countFor(e2e, 'mail.Thread', 'resId', 'doomed-1'), 0)
  // And the file, row and bytes both. The download answering 404 is the part
  // that says the object really left the store rather than being unreferenced.
  assert.equal(await countFor(e2e, 'storage.Attachment', 'resId', 'doomed-1'), 0)
  assert.equal((await e2e.client.request(`/files/${fileId}`)).status, 404)

  // The other project is untouched — the purge deleted a project, not a table.
  assert.equal(await countFor(e2e, 'flow.Project', 'id', 'keeper'), 1)
  assert.equal(await countFor(e2e, 'flow.Issue', 'projectId', 'keeper'), 1)

  // The company-wide tag survives its assignments: a tag belongs to the
  // company, not to the project that happened to use it (FLW-DEC-006).
  assert.equal(await countFor(e2e, 'flow.Tag', 'id', 'urgent'), 1)
})

test('the record of the request is written before anything is destroyed', async (t) => {
  const e2e = await boot(t)
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await e2e.client.call<T>(name, input)).value

  await call('flow.project.delete', {
    projectId: 'doomed',
    confirmName: 'Dự án sắp xóa',
    idempotencyKey: 'delete-doomed',
  })

  // Before the queue has run: the project is still whole and the record already
  // exists. This is the case a success-only audit row would miss entirely.
  assert.equal(await countFor(e2e, 'flow.Project', 'id', 'doomed'), 1)
  const pending = (await call<Row[]>('flow.project.deletion.list')) ?? []
  assert.equal(pending.length, 1)
  assert.equal(String(pending[0]?.state), 'requested')
  assert.equal(String(pending[0]?.projectName), 'Dự án sắp xóa')
  assert.equal(String(pending[0]?.projectKey), 'DOOM')
  assert.equal(String(pending[0]?.requestedByUserId), 'u1')

  assert.equal(await e2e.drainJobs(), 1)

  // And afterwards the record is still there, naming a project that is not.
  const done = (await call<Row[]>('flow.project.deletion.list')) ?? []
  assert.equal(String(done[0]?.state), 'done')
  assert.equal(String(done[0]?.projectName), 'Dự án sắp xóa')
  assert.ok(done[0]?.completedAt, 'and says when it finished')
  assert.equal(await countFor(e2e, 'flow.Project', 'id', 'doomed'), 0)
})

test('the typed name has to match, and a stranger cannot ask at all', async (t) => {
  const e2e = await boot(t)
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await e2e.client.call<T>(name, input)).value

  // A near miss is a miss. A confirmation that accepts one is a confirmation
  // people learn to type without reading.
  for (const confirmName of ['', 'Dự án sắp xoá', 'dự án sắp xóa', 'DOOM'])
    assert.equal(
      (
        (await call<Row>('flow.project.delete', {
          projectId: 'doomed',
          confirmName,
          idempotencyKey: `refuse-${confirmName || 'blank'}-key`,
        })) as Row
      ).ok,
      false,
      `"${confirmName}" is not the name`,
    )
  assert.equal(await countFor(e2e, 'flow.Project', 'id', 'doomed'), 1)

  // And somebody who cannot see the project cannot end it. Not found, not
  // forbidden — the same answer every other Flow read gives (FLW-DEC-012).
  await e2e.fixture.call('user.createUser', {
    id: 'u2',
    login: 'u2',
    password: 'test-password',
    name: 'Người ngoài',
    defaultCompanyId: 'acme',
  })
  await e2e.fixture.call('user.grantCompany', { id: 'u2:acme', userId: 'u2', companyId: 'acme' })
  await e2e.client.login({ login: 'u2', password: 'test-password' })
  const refused = (await call<Row>('flow.project.delete', {
    projectId: 'doomed',
    confirmName: 'Dự án sắp xóa',
    idempotencyKey: 'stranger-delete',
  })) as Row
  assert.equal(refused.ok, false)
  assert.equal(String((refused.errors as Row[])?.[0]?.code), 'flow.error.notFound')
  assert.equal(await countFor(e2e, 'flow.Project', 'id', 'doomed'), 1)
})

test('a purge that ran once can run again and ends in the same place', async (t) => {
  const e2e = await boot(t)
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await e2e.client.call<T>(name, input)).value

  const asked = (await call<Row>('flow.project.delete', {
    projectId: 'doomed',
    confirmName: 'Dự án sắp xóa',
    idempotencyKey: 'delete-doomed',
  })) as Row
  assert.equal(await e2e.drainJobs(), 1)

  // Put the same work back on the queue and let it run again. Every step is a
  // delete over an id set, so the second pass is the same statement finding
  // nothing — which is what makes a job that died halfway able to finish rather
  // than have to be unpicked by hand.
  await e2e.fixture.call(
    'flow_delete_fixture.purgeAgain',
    { projectId: 'doomed', deletionId: String(asked.id), key: 'purge-again' },
    { scope: { company: 'acme', companies: ['acme'], branches: null } },
  )
  assert.equal(await e2e.drainJobs(), 1, 'the second pass runs and does not throw')

  for (const [table, column] of projectTables)
    assert.equal(await countFor(e2e, table, column, 'doomed'), 0, `${table} still empty`)
  assert.equal(await countFor(e2e, 'flow.Project', 'id', 'keeper'), 1)
  const done = (await call<Row[]>('flow.project.deletion.list')) ?? []
  assert.equal(done.length, 1, 'and the record is still one row, not two')
  assert.equal(String(done[0]?.state), 'done')
})
