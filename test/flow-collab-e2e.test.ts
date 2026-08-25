import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import * as Y from 'yjs'
import { resolveUserSession } from '@ketvietlab/ketsuite'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'
import livedoc from '../packages/ketsuite/src/modules/livedoc/index.ts'
import flowBackend from '../packages/ketsuite/src/modules/flow_backend/index.ts'
import { sweepLive } from '../packages/ketsuite/src/modules/livedoc/sync.ts'

const app = defineDeployment({
  name: 'flow_collab_headless_e2e',
  modules: [address, partner, company, storage, user, mail, backend, livedoc, flow, flowBackend],
  headless: true,
  serve: {
    sessions: { anonymous: { company: 'acme' } },
  },
})

/** A fresh Yjs update containing one text run, as an independent client would produce it. */
function updateInserting(text: string): string {
  const doc = new Y.Doc()
  const run = new Y.XmlText()
  doc.getXmlFragment('content').insert(0, [run])
  run.insert(0, text)
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
}

test('flow collab headless E2E: content, push, live relay and an explicit leave flattens', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
    await e2e.fixture.call('partner.savePartner', { id: 'p-user', kind: 'person', name: 'Nguyễn Minh' })
    await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
    await e2e.fixture.call('user.createUser', {
      id: 'u1',
      login: 'u1',
      password: 'test-password',
      name: 'Nguyễn Minh',
      partnerId: 'p-user',
      defaultCompanyId: 'acme',
    })
    await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
    await e2e.client.login({ login: 'u1', password: 'test-password' })
    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value

    await call('flow.project.save', {
      values: { id: 'proj1', key: 'PRJ', name: 'Flagship' },
      idempotencyKey: 'project-save-1',
    })
    await call('flow.column.save', {
      values: { id: 'col-todo', projectId: 'proj1', code: 'todo', name: 'To do' },
      idempotencyKey: 'column-save-1',
    })
    await call('flow.issue.save', {
      id: 'issue-1',
      projectId: 'proj1',
      columnId: 'col-todo',
      title: 'Write the collaborative editor',
      idempotencyKey: 'issue-save-1',
    })

    const content = await e2e.client.json<{ snapshot: string; topic: string }>(
      '/admin/flow/issues/issue-1/content',
    )
    // company, model and record — see the DocRef note in modules/livedoc/sync.ts.
    assert.ok(content.topic.startsWith('doc:acme:flow.Issue:issue-1:'))
    const emptyDoc = new Y.Doc()
    Y.applyUpdate(emptyDoc, Buffer.from(content.snapshot, 'base64'))
    assert.equal(emptyDoc.getXmlFragment('content').toString(), '')

    // Node buffers HTTP response headers until the first body write, so a
    // request to a stream with nothing queued yet does not resolve until
    // something is pushed — start it, then push, then await it, exactly as a
    // real browser client's fetch()/EventSource would race the two anyway.
    const controller = new AbortController()
    const livePromise = e2e.client.get(
      `/admin/flow/issues/issue-1/live?topic=${encodeURIComponent(content.topic)}`,
      { signal: controller.signal },
    )
    await new Promise((resolve) => setTimeout(resolve, 100))

    const pushed = await e2e.client.request('/admin/flow/issues/issue-1/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update: updateInserting('hello from client A') }),
    })
    assert.equal(pushed.status, 200)

    const live = await livePromise
    assert.equal(live.status, 200)
    assert.match(live.headers.get('content-type') ?? '', /text\/event-stream/)
    const reader = live.body!.getReader()

    const decoder = new TextDecoder()
    const { value } = await reader.read()
    const frame = decoder.decode(value)
    assert.match(frame, /^id: \d+\ndata: /)
    assert.ok(frame.includes('"update"'))

    controller.abort()

    // A transport-level disconnect is not a reliable flatten trigger (an
    // aborted fetch does not run the relay generator's cleanup, in-process
    // or not — verified directly against this same route). The explicit
    // "I'm done editing" beacon is what Phase 4's client actually calls.
    const left = await e2e.client.request('/admin/flow/issues/issue-1/leave', { method: 'POST' })
    assert.equal(left.status, 200)

    const flattened = await call<Row>('flow.issue.get', { id: 'issue-1' })
    assert.equal(flattened.previewText, 'hello from client A')
    assert.ok(flattened.contentAttachmentId)

    const list = await call<Row>('flow.issue.list', { projectId: 'proj1' })
    assert.equal(list.total, 1)
    assert.equal((list.rows as Row[])[0]?.previewText, 'hello from client A')
  } finally {
    await e2e.close()
  }
})

/**
 * The description is a Yjs document, so it is written over `/push` and
 * `/leave` rather than through `issue.save`. Those routes used to authorize
 * with `flow.issue.get`, which made the description the one piece of Flow data
 * a read-only role could rewrite.
 */
const guarded = defineDeployment({
  name: 'flow_collab_permissions',
  modules: [address, partner, company, storage, user, mail, backend, livedoc, flow, flowBackend],
  headless: true,
  serve: {
    sessions: { anonymous: { company: 'acme' } },
    resolveSession: resolveUserSession,
    permissions: (ctx, userId, url, req) =>
      ctx
        .callUnchecked('user.permitted', { userId }, url, req)
        .then((result) =>
          (result as { superuser: boolean; functions?: string[] }).superuser
            ? null
            : (result as { functions: string[] }).functions,
        ),
  },
})

const seedCompany = async (e2e: Awaited<ReturnType<typeof createTestDeployment>>) => {
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input)
  await fixture('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'p-author', kind: 'person', name: 'Nguyễn Minh' })
  await fixture('partner.savePartner', { id: 'p-reader', kind: 'person', name: 'Trần Lan' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'author',
    login: 'author',
    password: 'test-password',
    name: 'Nguyễn Minh',
    partnerId: 'p-author',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'author:acme', userId: 'author', companyId: 'acme' })
  await fixture('user.createUser', {
    id: 'reader',
    login: 'reader',
    password: 'test-password',
    name: 'Trần Lan',
    partnerId: 'p-reader',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'reader:acme', userId: 'reader', companyId: 'acme' })
  await fixture('user.saveRole', { id: 'flow-reader', name: 'Flow reader' })
  for (const [index, fnKey] of ['flow.issue.get', 'flow.issue.list'].entries())
    await fixture('user.grantFunction', { id: `grant-${index}`, roleId: 'flow-reader', fnKey })
  await fixture('user.assignRole', { id: 'assign-reader', userId: 'reader', roleId: 'flow-reader' })
}

test('flow collab: reading an issue does not grant rewriting its description', async () => {
  const e2e = await createTestDeployment(guarded, { worker: false })
  try {
    await seedCompany(e2e)
    await e2e.client.login({ login: 'author', password: 'test-password' })
    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value
    await call('flow.project.save', {
      values: { id: 'proj1', key: 'PRJ', name: 'Flagship' },
      idempotencyKey: 'project-save-1',
    })
    await call('flow.column.save', {
      values: { id: 'col-todo', projectId: 'proj1', code: 'todo', name: 'To do' },
      idempotencyKey: 'column-save-1',
    })
    await call('flow.issue.save', {
      id: 'issue-guarded',
      projectId: 'proj1',
      columnId: 'col-todo',
      title: 'Q4 plan',
      idempotencyKey: 'issue-save-guarded',
    })
    const push = (update: string) =>
      e2e.client.request('/admin/flow/issues/issue-guarded/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ update }),
      })

    await e2e.client.json('/admin/flow/issues/issue-guarded/content')
    assert.equal((await push(updateInserting('the approved plan'))).status, 200)
    assert.equal(
      (await e2e.client.request('/admin/flow/issues/issue-guarded/leave', { method: 'POST' })).status,
      200,
    )

    await e2e.client.login({ login: 'reader', password: 'test-password' })
    assert.equal((await e2e.client.request('/admin/flow/issues/issue-guarded/content')).status, 200)
    assert.equal((await push(updateInserting('rewritten'))).status, 403)
    assert.equal(
      (await e2e.client.request('/admin/flow/issues/issue-guarded/leave', { method: 'POST' })).status,
      403,
    )

    await e2e.client.login({ login: 'author', password: 'test-password' })
    assert.equal(
      (await call<Row>('flow.issue.get', { id: 'issue-guarded' })).previewText,
      'the approved plan',
    )

    // The key exists so it can be granted, not to lock editing away.
    await e2e.fixture.call('user.grantFunction', {
      id: 'grant-edit',
      roleId: 'flow-reader',
      fnKey: 'flow.issue.editDescription',
    })
    await e2e.client.login({ login: 'reader', password: 'test-password' })
    assert.equal((await push(updateInserting('an edit'))).status, 200)
  } finally {
    await e2e.close()
  }
})

/**
 * The route's own permission check is the whole security policy for these
 * `exposure: 'internal'` helpers, which is why they are reached unchecked —
 * `ctx.call` asks for a grant on a function nobody would think to name.
 *
 * The snapshot lookup used to be a checked call and passed anyway, because
 * hydrate returns before reaching it whenever some other session already
 * loaded the document. Cold, it refused: a reader-role viewer opening an issue
 * this process had not touched got `E_FN_NOT_PERMITTED` for
 * `livedoc.sync.resolveSnapshotKey`.
 */
test('flow collab: a reader can open a document this process has to load first', async () => {
  const e2e = await createTestDeployment(guarded, { worker: false })
  try {
    await seedCompany(e2e)
    await e2e.client.login({ login: 'author', password: 'test-password' })
    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value
    await call('flow.project.save', {
      values: { id: 'proj1', key: 'PRJ', name: 'Flagship' },
      idempotencyKey: 'project-save-1',
    })
    await call('flow.column.save', {
      values: { id: 'col-todo', projectId: 'proj1', code: 'todo', name: 'To do' },
      idempotencyKey: 'column-save-1',
    })
    await call('flow.issue.save', {
      id: 'issue-cold',
      projectId: 'proj1',
      columnId: 'col-todo',
      title: 'Q4 plan',
      idempotencyKey: 'issue-save-cold',
    })
    await e2e.client.json('/admin/flow/issues/issue-cold/content')
    await e2e.client.request('/admin/flow/issues/issue-cold/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update: updateInserting('the approved plan') }),
    })
    await e2e.client.request('/admin/flow/issues/issue-cold/leave', { method: 'POST' })

    // Nothing live left, so opening it has to read the stored snapshot back.
    assert.ok(sweepLive(Date.now() + 60 * 60 * 1000) >= 1)

    await e2e.client.login({ login: 'reader', password: 'test-password' })
    const opened = await e2e.client.request('/admin/flow/issues/issue-cold/content')
    assert.equal(opened.status, 200)
    const body = (await opened.json()) as { snapshot: string; viewerId: string | null }
    assert.ok(body.snapshot.length > 0)
    // And it knows which presence frames are its own before it can hear any.
    assert.equal(body.viewerId, 'reader')
  } finally {
    await e2e.close()
  }
})

test('flow collab: a beacon for a document this process no longer holds saves nothing', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
    await e2e.fixture.call('partner.savePartner', { id: 'p-user', kind: 'person', name: 'Nguyễn Minh' })
    await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
    await e2e.fixture.call('user.createUser', {
      id: 'u1',
      login: 'u1',
      password: 'test-password',
      name: 'Nguyễn Minh',
      partnerId: 'p-user',
      defaultCompanyId: 'acme',
    })
    await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
    await e2e.client.login({ login: 'u1', password: 'test-password' })
    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value
    await call('flow.project.save', {
      values: { id: 'proj1', key: 'PRJ', name: 'Flagship' },
      idempotencyKey: 'project-save-1',
    })
    await call('flow.column.save', {
      values: { id: 'col-todo', projectId: 'proj1', code: 'todo', name: 'To do' },
      idempotencyKey: 'column-save-1',
    })
    await call('flow.issue.save', {
      id: 'issue-2',
      projectId: 'proj1',
      columnId: 'col-todo',
      title: 'Long-lived issue',
      idempotencyKey: 'issue-save-2',
    })

    await e2e.client.json('/admin/flow/issues/issue-2/content')
    await e2e.client.request('/admin/flow/issues/issue-2/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update: updateInserting('everything we agreed') }),
    })
    await e2e.client.request('/admin/flow/issues/issue-2/leave', { method: 'POST' })
    assert.equal((await call<Row>('flow.issue.get', { id: 'issue-2' })).previewText, 'everything we agreed')

    // What a restart leaves behind: the durable snapshot, and no live doc. A
    // flattened document is safe to drop, so the sweeper drops it — and the
    // tab-close beacon that arrives afterwards must not persist the blank
    // document it would otherwise find.
    assert.ok(sweepLive(Date.now() + 60 * 60 * 1000) >= 1)
    const beacon = await e2e.client.request('/admin/flow/issues/issue-2/leave', { method: 'POST' })
    assert.equal(beacon.status, 200)
    assert.deepEqual(await beacon.json(), { ok: true, flattened: false })
    assert.equal((await call<Row>('flow.issue.get', { id: 'issue-2' })).previewText, 'everything we agreed')

    // And reopening it hydrates back to the same text rather than a blank page.
    const content = await e2e.client.json<{ snapshot: string }>('/admin/flow/issues/issue-2/content')
    const reopened = new Y.Doc()
    Y.applyUpdate(reopened, Buffer.from(content.snapshot, 'base64'))
    assert.equal(
      ((reopened.getXmlFragment('content').get(0) as Y.XmlText).toDelta() as Array<{ insert: string }>)
        .map((op) => op.insert)
        .join(''),
      'everything we agreed',
    )
  } finally {
    await e2e.close()
  }
})

/**
 * `Y.XmlText.prototype.toString()` renders every formatting attribute as a
 * wrapping XML tag, so a bold run reached `previewText` — the list column and
 * the search field — as `Deploy <bold>the release</bold> on Friday`.
 */
test('flow collab: previewText is what the user typed, not the mark markup', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
    await e2e.fixture.call('partner.savePartner', { id: 'p-user', kind: 'person', name: 'Nguyễn Minh' })
    await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
    await e2e.fixture.call('user.createUser', {
      id: 'u1',
      login: 'u1',
      password: 'test-password',
      name: 'Nguyễn Minh',
      partnerId: 'p-user',
      defaultCompanyId: 'acme',
    })
    await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
    await e2e.client.login({ login: 'u1', password: 'test-password' })
    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value
    await call('flow.project.save', {
      values: { id: 'proj1', key: 'PRJ', name: 'Flagship' },
      idempotencyKey: 'project-save-1',
    })
    await call('flow.column.save', {
      values: { id: 'col-todo', projectId: 'proj1', code: 'todo', name: 'To do' },
      idempotencyKey: 'column-save-1',
    })
    await call('flow.issue.save', {
      id: 'issue-3',
      projectId: 'proj1',
      columnId: 'col-todo',
      title: 'Release notes',
      idempotencyKey: 'issue-save-3',
    })

    // Exactly what the toolbar produces: insert, then format a range.
    const doc = new Y.Doc()
    const run = new Y.XmlText()
    doc.getXmlFragment('content').insert(0, [run])
    run.insert(0, 'Deploy the release on Friday')
    run.format(7, 11, { bold: true })

    await e2e.client.json('/admin/flow/issues/issue-3/content')
    await e2e.client.request('/admin/flow/issues/issue-3/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') }),
    })
    await e2e.client.request('/admin/flow/issues/issue-3/leave', { method: 'POST' })

    assert.equal(
      (await call<Row>('flow.issue.get', { id: 'issue-3' })).previewText,
      'Deploy the release on Friday',
    )
    const search = (q: string) => ({
      q,
      presets: [],
      filters: [],
      groupBy: [],
      sort: [{ key: 'updatedAt', dir: 'desc' as const }],
      openGroups: [],
      groupPages: {},
      page: 1,
      includeArchived: false,
    })
    // A phrase spanning the mark boundary matches; the attribute name does not.
    assert.equal((await call<Row>('flow.issue.list', { listState: search('Deploy the release') })).total, 1)
    assert.equal((await call<Row>('flow.issue.list', { listState: search('bold') })).total, 0)
  } finally {
    await e2e.close()
  }
})

/**
 * The editor writes a flat list of `block` elements, each holding one text run,
 * rather than the single top-level run the first version of it produced. The
 * flatten path reads whatever shape it is handed, so a heading and two list
 * items have to come out of it as the lines somebody typed — that string is the
 * list column and the search field.
 */
test('flow collab: previewText reads a document made of blocks', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
    await e2e.fixture.call('partner.savePartner', { id: 'p-user', kind: 'person', name: 'Nguyen Minh' })
    await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
    await e2e.fixture.call('user.createUser', {
      id: 'u1',
      login: 'u1',
      password: 'test-password',
      name: 'Nguyen Minh',
      partnerId: 'p-user',
      defaultCompanyId: 'acme',
    })
    await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
    await e2e.client.login({ login: 'u1', password: 'test-password' })
    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value
    await call('flow.project.save', {
      values: { id: 'proj1', key: 'PRJ', name: 'Flagship' },
      idempotencyKey: 'project-save-1',
    })
    await call('flow.column.save', {
      values: { id: 'col-todo', projectId: 'proj1', code: 'todo', name: 'To do' },
      idempotencyKey: 'column-save-1',
    })
    await call('flow.issue.save', {
      id: 'issue-4',
      projectId: 'proj1',
      columnId: 'col-todo',
      title: 'Rollout',
      idempotencyKey: 'issue-save-4',
    })

    // Exactly what the editor builds: an element per block, each with one run.
    const doc = new Y.Doc()
    const fragment = doc.getXmlFragment('content')
    const lines: Array<[string, string]> = [
      ['h1', 'Rollout plan'],
      ['bullet', 'Freeze the branch'],
      ['check', 'Tell support'],
    ]
    lines.forEach(([type, line], index) => {
      const element = new Y.XmlElement('block')
      element.setAttribute('type', type)
      fragment.insert(index, [element])
      const run = new Y.XmlText()
      element.insert(0, [run])
      run.insert(0, line)
    })

    await e2e.client.json('/admin/flow/issues/issue-4/content')
    await e2e.client.request('/admin/flow/issues/issue-4/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') }),
    })
    await e2e.client.request('/admin/flow/issues/issue-4/leave', { method: 'POST' })

    assert.equal(
      (await call<Row>('flow.issue.get', { id: 'issue-4' })).previewText,
      'Rollout plan Freeze the branch Tell support',
    )
  } finally {
    await e2e.close()
  }
})

/**
 * A presence frame goes to everyone else in the document, so the name on it is
 * resolved from the session rather than read out of the body: a client that
 * could name itself could sit in the room as somebody else, and every other
 * screen would agree with it.
 */
test('flow collab: presence carries the name the session has, not the one the body claims', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await e2e.fixture.call('partner.savePartner', { id: 'p-company', kind: 'company', name: 'ACME' })
    await e2e.fixture.call('partner.savePartner', { id: 'p-user', kind: 'person', name: 'Nguyen Minh' })
    await e2e.fixture.call('company.saveCompany', { id: 'acme', partnerId: 'p-company', currency: 'VND' })
    await e2e.fixture.call('user.createUser', {
      id: 'u1',
      login: 'u1',
      password: 'test-password',
      name: 'Nguyen Minh',
      partnerId: 'p-user',
      defaultCompanyId: 'acme',
    })
    await e2e.fixture.call('user.grantCompany', { id: 'u1:acme', userId: 'u1', companyId: 'acme' })
    await e2e.client.login({ login: 'u1', password: 'test-password' })
    const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
      (await e2e.client.call<T>(name, input)).value
    await call('flow.project.save', {
      values: { id: 'proj1', key: 'PRJ', name: 'Flagship' },
      idempotencyKey: 'project-save-1',
    })
    await call('flow.column.save', {
      values: { id: 'col-todo', projectId: 'proj1', code: 'todo', name: 'To do' },
      idempotencyKey: 'column-save-1',
    })
    await call('flow.issue.save', {
      id: 'issue-5',
      projectId: 'proj1',
      columnId: 'col-todo',
      title: 'Rollout',
      idempotencyKey: 'issue-save-5',
    })

    const { topic } = (await e2e.client.json('/admin/flow/issues/issue-5/content')) as {
      topic: string
    }
    const controller = new AbortController()
    const livePromise = e2e.client.get(`/admin/flow/issues/issue-5/live?topic=${encodeURIComponent(topic)}`, {
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    const announced = (await e2e.client
      .request('/admin/flow/issues/issue-5/presence', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `id` and `name` are what a client would have to send to impersonate
        // somebody, so they are sent here. Neither is read.
        body: JSON.stringify({ index: 2, id: 'somebody-else', name: 'Someone Important' }),
      })
      .then((response) => response.json())) as { id: string }
    assert.equal(announced.id, 'u1')

    const live = await livePromise
    const reader = live.body!.getReader()
    const { value } = await reader.read()
    const frame = new TextDecoder().decode(value)
    const relayed = JSON.parse(frame.slice(frame.indexOf('data: ') + 6)) as {
      presence: Record<string, unknown>
    }
    assert.deepEqual(relayed.presence, { id: 'u1', name: 'Nguyen Minh', index: 2, gone: false })
    controller.abort()

    // And nothing was written to the document by saying hello.
    await e2e.client.request('/admin/flow/issues/issue-5/leave', { method: 'POST' })
    assert.equal((await call<Row>('flow.issue.get', { id: 'issue-5' })).previewText, null)
  } finally {
    await e2e.close()
  }
})
