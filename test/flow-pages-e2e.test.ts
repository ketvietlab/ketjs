import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import * as Y from 'yjs'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'
import livedoc from '../packages/ketsuite/src/modules/livedoc/index.ts'
import flowBackend from '../packages/ketsuite/src/modules/flow_backend/index.ts'

const app = defineDeployment({
  name: 'flow_pages_e2e',
  modules: [address, partner, company, storage, user, mail, backend, livedoc, flow, flowBackend],
  headless: true,
  serve: { sessions: { anonymous: { company: 'acme' } } },
})

type Client = Awaited<ReturnType<typeof createTestDeployment>>

const seed = async (e2e: Client) => {
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
  return call
}

const page = (id: string, title: string, parentPageId?: string) => ({
  id,
  projectId: 'proj1',
  title,
  ...(parentPageId ? { parentPageId } : {}),
  // `commandKey` refuses anything under eight characters, and a refused save
  // is silent unless the caller looks — see `created` below.
  idempotencyKey: `page-save-${id}`,
})

/** Saves a page and insists it worked, so a later assertion cannot fail for the wrong reason. */
const created = async (
  call: <T>(name: string, input: Record<string, unknown>) => Promise<T>,
  values: Record<string, unknown>,
): Promise<void> => {
  const result = await call<{ ok: boolean; errors?: unknown }>('flow.page.save', values)
  assert.equal(result.ok, true, JSON.stringify(result.errors))
}

/**
 * The tree is the feature, so it is what the first test is about: a page knows
 * its parent, its children, and the trail back to the root.
 */
test('flow pages: a document tree keeps its shape, its counts and its trail', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await created(call, page('handbook', 'Sổ tay'))
    await created(call, page('onboarding', 'Onboarding', 'handbook'))
    await created(call, page('architecture', 'Kiến trúc', 'handbook'))
    await created(call, page('week-one', 'Tuần đầu', 'onboarding'))

    const rows = await call<Row[]>('flow.page.list', { projectId: 'proj1' })
    assert.equal(rows.length, 4)
    const counted = new Map(rows.map((row) => [String(row.id), Number(row.childCount)]))
    assert.equal(counted.get('handbook'), 2)
    assert.equal(counted.get('onboarding'), 1)
    assert.equal(counted.get('week-one'), 0)

    const detail = (await call<{ value: Row }>('flow.page.get', { id: 'week-one' })).value
    assert.deepEqual(
      (detail.trail as Array<{ id: string }>).map((step) => step.id),
      ['handbook', 'onboarding'],
      'the trail runs root-first, so a breadcrumb reads in order',
    )
    assert.equal(detail.projectName, 'Flagship')

    const parent = (await call<{ value: Row }>('flow.page.get', { id: 'handbook' })).value
    assert.deepEqual(
      (parent.children as Row[]).map((child) => String(child.id)).sort(),
      ['architecture', 'onboarding'],
      'only direct children, not the whole branch',
    )
  } finally {
    await e2e.close()
  }
})

/**
 * A tree that can be made to contain itself is a hung request, not a bad screen
 * — every one of these is checked before the first write, because `ctx.tx`
 * rolls back on a thrown exception and not on a returned `invalid`.
 */
test('flow pages: the tree refuses to eat itself', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await created(call, page('a', 'A'))
    await created(call, page('b', 'B', 'a'))
    await created(call, page('c', 'C', 'b'))

    const codeOf = (result: unknown) =>
      ((result as { errors?: Array<{ code: string }> }).errors ?? [])[0]?.code

    assert.equal(codeOf(await call('flow.page.move', { id: 'a', parentPageId: 'a' })), 'flow.error.pageSelfParent')
    assert.equal(codeOf(await call('flow.page.move', { id: 'a', parentPageId: 'c' })), 'flow.error.pageCycle')
    assert.equal(
      codeOf(await call('flow.page.move', { id: 'a', parentPageId: 'nope' })),
      'flow.error.notFound',
    )

    // A second project's page is not somewhere this one may go.
    await call('flow.project.save', {
      values: { id: 'proj2', key: 'OTH', name: 'Other' },
      idempotencyKey: 'project-save-2',
    })
    await created(call, {
      id: 'elsewhere',
      projectId: 'proj2',
      title: 'Elsewhere',
      idempotencyKey: 'page-save-elsewhere',
    })
    assert.equal(
      codeOf(await call('flow.page.move', { id: 'a', parentPageId: 'elsewhere' })),
      'flow.error.pageProjectMismatch',
    )

    // None of the refusals moved anything.
    const rows = await call<Row[]>('flow.page.list', { projectId: 'proj1' })
    const parents = new Map(rows.map((row) => [String(row.id), row.parentPageId]))
    assert.equal(parents.get('a'), null)
    assert.equal(parents.get('b'), 'a')
    assert.equal(parents.get('c'), 'b')
  } finally {
    await e2e.close()
  }
})

/** Moving a page takes its branch with it; renaming one leaves the branch alone. */
test('flow pages: a move carries the branch, a rename does not touch it', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await created(call, page('root', 'Root'))
    await created(call, page('mid', 'Mid', 'root'))
    await created(call, page('leaf', 'Leaf', 'mid'))

    assert.equal((await call<Row>('flow.page.move', { id: 'mid', parentPageId: null })).ok, true)
    const afterMove = await call<Row[]>('flow.page.list', { projectId: 'proj1' })
    const parents = new Map(afterMove.map((row) => [String(row.id), row.parentPageId]))
    assert.equal(parents.get('mid'), null, 'mid went to the root')
    assert.equal(parents.get('leaf'), 'mid', 'and leaf came with it')

    // The title form posts a partial record — no parent field at all — so a
    // rename must not quietly reparent the page it renames.
    await created(call, {
      id: 'leaf',
      projectId: 'proj1',
      title: 'Renamed',
      idempotencyKey: 'page-rename-leaf',
    })
    const afterRename = await call<Row[]>('flow.page.list', { projectId: 'proj1' })
    const leaf = afterRename.find((row) => String(row.id) === 'leaf')
    assert.equal(leaf?.title, 'Renamed')
    assert.equal(leaf?.parentPageId, 'mid', 'renaming left it where it was')
  } finally {
    await e2e.close()
  }
})

/**
 * Archiving hides a branch without rearranging it, and restoring a page whose
 * parent is still archived brings it back somewhere a reader can reach.
 */
test('flow pages: archive hides a branch, restore never returns one to a hidden parent', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await created(call, page('top', 'Top'))
    await created(call, page('under', 'Under', 'top'))

    await call('flow.page.archive', { id: 'top' })
    const visible = await call<Row[]>('flow.page.list', { projectId: 'proj1' })
    assert.deepEqual(visible.map((row) => String(row.id)), ['under'], 'the archived page is gone')
    assert.equal(visible[0]?.parentPageId, 'top', 'but its child still points at it')

    const all = await call<Row[]>('flow.page.list', { projectId: 'proj1', includeArchived: true })
    assert.equal(all.length, 2)

    await call('flow.page.restore', { id: 'under' })
    const restored = (await call<{ value: Row }>('flow.page.get', { id: 'under' })).value
    assert.equal(restored.parentPageId, null, 'restored to the root rather than under a hidden parent')
  } finally {
    await e2e.close()
  }
})

/**
 * The whole point of the model: a page carries a Live Doc, over the same five
 * endpoints an issue's description uses, through its own owner.
 */
test('flow pages: a page holds a Live Doc that flattens onto its own row', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await created(call, page('doc', 'Runbook'))

    const content = await e2e.client.json<{ snapshot: string; topic: string }>(
      '/admin/flow/pages/doc/content',
    )
    assert.match(
      content.topic,
      /^doc:acme:flow\.Page:doc:1$/,
      'the topic names the model as well as the record — see DocRef',
    )

    const client = new Y.Doc()
    const run = new Y.XmlText()
    client.getXmlFragment('content').insert(0, [run])
    run.insert(0, 'Khởi động lại dịch vụ')
    await e2e.client.request('/admin/flow/pages/doc/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update: Buffer.from(Y.encodeStateAsUpdate(client)).toString('base64') }),
    })
    await e2e.client.request('/admin/flow/pages/doc/leave', { method: 'POST' })

    const saved = (await call<{ value: Row }>('flow.page.get', { id: 'doc' })).value
    assert.equal(saved.previewText, 'Khởi động lại dịch vụ')
    // The attachment id has to come back out of `page.get`: it is what the
    // owner's `attachmentOf` reads, and without it hydration finds no stored
    // snapshot and starts a fresh document over the real one.
    assert.ok(saved.contentAttachmentId, 'the flattened snapshot is reachable again')
    assert.ok(saved.contentUpdatedAt)

    // A page's document is its own: the issue endpoints must not reach it.
    const wrongOwner = await e2e.client.request('/admin/flow/issues/doc/content')
    assert.equal(wrongOwner.status, 403)
  } finally {
    await e2e.close()
  }
})

/** Without a project the list spans them all, which is what `/admin/flow/pages` serves. */
test('flow pages: listing without a project answers across projects', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await call('flow.project.save', {
      values: { id: 'proj2', key: 'OTH', name: 'Other' },
      idempotencyKey: 'project-save-2',
    })
    await created(call, page('one', 'One'))
    await created(call, {
      id: 'two',
      projectId: 'proj2',
      title: 'Two',
      idempotencyKey: 'page-save-two',
    })

    const scoped = await call<Row[]>('flow.page.list', { projectId: 'proj1' })
    assert.deepEqual(scoped.map((row) => String(row.id)), ['one'])

    const everywhere = await call<Row[]>('flow.page.list', {})
    assert.deepEqual(
      everywhere.map((row) => String(row.id)).sort(),
      ['one', 'two'],
      'no project named means every project',
    )
  } finally {
    await e2e.close()
  }
})
