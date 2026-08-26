import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import * as Y from 'yjs'
import { sweepLive } from '../packages/ketsuite/src/modules/livedoc/sync.ts'
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

    assert.equal(
      codeOf(await call('flow.page.move', { id: 'a', parentPageId: 'a' })),
      'flow.error.pageSelfParent',
    )
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
    assert.deepEqual(
      visible.map((row) => String(row.id)),
      ['under'],
      'the archived page is gone',
    )
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
    assert.deepEqual(
      scoped.map((row) => String(row.id)),
      ['one'],
    )

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

/**
 * Sibling order is the order somebody put things in, which is the whole reason
 * `sequence` exists — every page used to be created at the same value, leaving
 * the tree sorted by title and the column doing nothing.
 */
test('flow pages: new pages queue after their siblings, and can be nudged past them', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await created(call, page('zulu', 'Zulu'))
    await created(call, page('alpha', 'Alpha'))
    await created(call, page('mike', 'Mike'))

    const order = async () =>
      (await call<Row[]>('flow.page.list', { projectId: 'proj1' })).map((row) => String(row.id))

    assert.deepEqual(await order(), ['zulu', 'alpha', 'mike'], 'creation order, not the alphabet')

    await call('flow.page.reorder', { id: 'mike', direction: 'up' })
    assert.deepEqual(await order(), ['zulu', 'mike', 'alpha'])

    await call('flow.page.reorder', { id: 'mike', direction: 'up' })
    assert.deepEqual(await order(), ['mike', 'zulu', 'alpha'])

    // Off the end is not a failure — there is simply nothing to swap with.
    const past = await call<{ ok: boolean; moved: boolean }>('flow.page.reorder', {
      id: 'mike',
      direction: 'up',
    })
    assert.equal(past.ok, true)
    assert.equal(past.moved, false)
    assert.deepEqual(await order(), ['mike', 'zulu', 'alpha'], 'and nothing moved')

    // Ordering is per branch: a child never trades places with an uncle.
    await created(call, page('child', 'Child', 'zulu'))
    await call('flow.page.reorder', { id: 'child', direction: 'up' })
    const parents = new Map(
      (await call<Row[]>('flow.page.list', { projectId: 'proj1' })).map((row) => [
        String(row.id),
        row.parentPageId,
      ]),
    )
    assert.equal(parents.get('child'), 'zulu', 'still under its own parent')
  } finally {
    await e2e.close()
  }
})

/**
 * The seam's real test: four models now hold a document, and each one's
 * flatten has to land on its own row through its own commit function.
 */
test('flow docs: a project brief and an epic carry their own Live Doc', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await call('flow.epic.save', {
      values: { id: 'epic1', projectId: 'proj1', title: 'Rollout' },
      idempotencyKey: 'epic-save-1',
    })

    const write = async (base: string, id: string, text: string) => {
      await e2e.client.json(`${base}/${id}/content`)
      const doc = new Y.Doc()
      const run = new Y.XmlText()
      doc.getXmlFragment('content').insert(0, [run])
      run.insert(0, text)
      await e2e.client.request(`${base}/${id}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') }),
      })
      await e2e.client.request(`${base}/${id}/leave`, { method: 'POST' })
    }

    await write('/admin/flow/projects', 'proj1', 'Nền tảng nội bộ')
    await write('/admin/flow/epics', 'epic1', 'Đưa lên production')

    const project = await call<Row>('flow.project.get', { id: 'proj1' })
    assert.equal(project.previewText, 'Nền tảng nội bộ')
    assert.ok(project.contentAttachmentId, 'the brief is reachable again after a restart')
    assert.equal(project.name, 'Flagship', 'and the short summary is untouched')

    const epic = (await call<{ value: Row }>('flow.epic.get', { id: 'epic1' })).value
    assert.equal(epic.previewText, 'Đưa lên production')
    assert.ok(epic.contentAttachmentId)

    // Each owner's topic names its own model, so two records sharing an id
    // cannot share a document.
    const projectTopic = (await e2e.client.json<{ topic: string }>('/admin/flow/projects/proj1/content'))
      .topic
    assert.match(projectTopic, /^doc:acme:flow\.Project:proj1:/)
    const epicTopic = (await e2e.client.json<{ topic: string }>('/admin/flow/epics/epic1/content')).topic
    assert.match(epicTopic, /^doc:acme:flow\.Epic:epic1:/)
  } finally {
    await e2e.close()
  }
})

/**
 * The state a wiki written before `sequence` meant anything is in: every page
 * shares one value. Reordering used to nudge the pair apart by a step, which
 * with three tied pages put the moved one below every sequence in the branch —
 * the top of the list, not one place up. Two tied pages hid it, because there
 * "one place up" and "the top" are the same position.
 */
test('flow pages: reordering a branch that shares one sequence moves one place, not to the top', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    // Written the way rows predating the ordering work are: all at one value.
    for (const [id, title] of [
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'C'],
    ] as const) {
      await created(call, { ...page(id, title), sequence: 10 })
    }
    const order = async () =>
      (await call<Row[]>('flow.page.list', { projectId: 'proj1' })).map((row) => String(row.id))
    assert.deepEqual(await order(), ['a', 'b', 'c'], 'tied rows fall back to title order')

    await call('flow.page.reorder', { id: 'c', direction: 'up' })
    assert.deepEqual(await order(), ['a', 'c', 'b'], 'one place, still below a')

    // The branch is spread out now, so every later move is an ordinary swap.
    const spread = await call<Row[]>('flow.page.list', { projectId: 'proj1' })
    assert.equal(new Set(spread.map((row) => Number(row.sequence))).size, 3, 'no ties left')

    await call('flow.page.reorder', { id: 'c', direction: 'up' })
    assert.deepEqual(await order(), ['c', 'a', 'b'])
    await call('flow.page.reorder', { id: 'c', direction: 'down' })
    assert.deepEqual(await order(), ['a', 'c', 'b'], 'and down again returns it')
  } finally {
    await e2e.close()
  }
})

/**
 * A page arriving in a branch it was not in joins the end of it. Keeping the
 * sequence it held somewhere else drops it at an arbitrary point in the new
 * branch, or ties it with whatever already holds that number.
 */
test('flow pages: a page moved into another branch lands at the end of it', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await created(call, page('home', 'Home'))
    await created(call, page('first', 'First', 'home'))
    await created(call, page('second', 'Second', 'home'))
    await created(call, page('stray', 'Stray'))

    await call('flow.page.move', { id: 'stray', parentPageId: 'home' })
    const under = (await call<Row[]>('flow.page.list', { projectId: 'proj1' }))
      .filter((row) => row.parentPageId === 'home')
      .map((row) => String(row.id))
    assert.deepEqual(under, ['first', 'second', 'stray'], 'after the siblings it joined')
  } finally {
    await e2e.close()
  }
})

/**
 * An attachment belongs to the record it documents, not to the bytes.
 *
 * Looked up by `storeKey` — which is the content's own hash — the second record
 * to flatten identical bytes was handed the first record's attachment row. Two
 * documents opened and never typed into serialise to exactly the same bytes, so
 * this was not a rare collision: both pages then pointed at one row naming only
 * one of them, invisible to anything listing the other's attachments and
 * orphaned if the first record's were ever cleaned up.
 */
test('flow docs: each record owns the attachment that records its document', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await created(call, page('blank-a', 'Blank A'))
    await created(call, page('blank-b', 'Blank B'))

    // Opened and left without typing — the case that collides.
    for (const id of ['blank-a', 'blank-b']) {
      await e2e.client.json(`/admin/flow/pages/${id}/content`)
      await e2e.client.request(`/admin/flow/pages/${id}/leave`, { method: 'POST' })
    }

    const attachmentOf = async (id: string) =>
      String((await call<{ value: Row }>('flow.page.get', { id })).value.contentAttachmentId ?? '')
    const a = await attachmentOf('blank-a')
    const b = await attachmentOf('blank-b')
    assert.ok(a && b, 'both flattened')
    assert.notEqual(a, b, 'identical bytes, but an attachment each')

    // Re-flattening keeps the row it already owns rather than growing another.
    await e2e.client.json('/admin/flow/pages/blank-a/content')
    await e2e.client.request('/admin/flow/pages/blank-a/leave', { method: 'POST' })
    assert.equal(await attachmentOf('blank-a'), a, 'and the same one on the next flatten')
  } finally {
    await e2e.close()
  }
})

/**
 * A push that arrives before anyone asked for the document — after a restart,
 * from a retrying editor, from any API caller — has to load what is stored
 * before merging into it.
 *
 * It could not, for three of the four owners. `…editContent` declared
 * `output: { value: 'json?' }` and returned the row un-nested, so the output
 * projection kept nothing and handed back `{}`. That is truthy, so the write
 * permission passed, but `attachmentOf` read `undefined` and hydration
 * concluded the document had never been written. The push then merged into a
 * blank document and the flatten wrote it over the real one.
 */
test('flow docs: a cold push loads the stored document before merging into it', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await created(call, page('cold', 'Runbook'))
    const push = async (text: string) => {
      const doc = new Y.Doc()
      const run = new Y.XmlText()
      doc.getXmlFragment('content').insert(0, [run])
      run.insert(0, text)
      await e2e.client.request('/admin/flow/pages/cold/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') }),
      })
      await e2e.client.request('/admin/flow/pages/cold/leave', { method: 'POST' })
    }
    const preview = async () =>
      String((await call<{ value: Row }>('flow.page.get', { id: 'cold' })).value.previewText ?? '')

    await e2e.client.json('/admin/flow/pages/cold/content')
    await push('nội dung đã lưu')
    assert.equal(await preview(), 'nội dung đã lưu')

    // What a restart, or the idle sweep, leaves behind: nothing in memory.
    sweepLive(Date.now() + 60 * 60 * 1000)

    await push('gõ thêm')
    const after = await preview()
    assert.match(after, /nội dung đã lưu/, 'the stored document survived the cold push')
    assert.match(after, /gõ thêm/, 'and the new edit is in there too')
  } finally {
    await e2e.close()
  }
})

/**
 * The same, for the owners that reach their attachment through a `value`
 * wrapper and the ones that do not — the two shapes `attachmentOf` handles.
 */
test('flow docs: a cold push loads a project brief and an epic too', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await call('flow.epic.save', {
      values: { id: 'epic1', projectId: 'proj1', title: 'Rollout' },
      idempotencyKey: 'epic-save-1',
    })
    const push = async (base: string, id: string, text: string) => {
      const doc = new Y.Doc()
      const run = new Y.XmlText()
      doc.getXmlFragment('content').insert(0, [run])
      run.insert(0, text)
      await e2e.client.request(`${base}/${id}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64') }),
      })
      await e2e.client.request(`${base}/${id}/leave`, { method: 'POST' })
    }

    await e2e.client.json('/admin/flow/projects/proj1/content')
    await push('/admin/flow/projects', 'proj1', 'bản gốc')
    await e2e.client.json('/admin/flow/epics/epic1/content')
    await push('/admin/flow/epics', 'epic1', 'bản gốc')

    sweepLive(Date.now() + 60 * 60 * 1000)

    await push('/admin/flow/projects', 'proj1', 'thêm vào')
    await push('/admin/flow/epics', 'epic1', 'thêm vào')

    const project = await call<Row>('flow.project.get', { id: 'proj1' })
    assert.match(String(project.previewText), /bản gốc/)
    const epic = (await call<{ value: Row }>('flow.epic.get', { id: 'epic1' })).value
    assert.match(String(epic.previewText), /bản gốc/)
  } finally {
    await e2e.close()
  }
})

/**
 * A search has to be the query's business, not a filter over what it returned.
 *
 * Applied afterwards, the row limit was spent on pages that were then thrown
 * away: across projects, ordered by `updatedAt`, anything outside the most
 * recently touched window became unfindable and the screen showed an empty
 * result rather than saying it had stopped looking.
 */
test('flow pages: search reaches past the row limit', async () => {
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    const call = await seed(e2e)
    await created(call, page('needle', 'Runbook for the pager'))
    // Enough later pages to push the one above out of a small window.
    for (let i = 0; i < 12; i++) await created(call, page(`filler-${i}`, `Filler ${i}`))

    const found = await call<Row[]>('flow.page.list', {
      projectId: 'proj1',
      search: 'pager',
      limit: 5,
    })
    assert.deepEqual(
      found.map((row) => String(row.id)),
      ['needle'],
      'the match is found even though it is not in the first five rows',
    )

    // And the count beside a node describes the branch, not the search.
    await created(call, page('kid', 'Something else', 'needle'))
    const again = await call<Row[]>('flow.page.list', { projectId: 'proj1', search: 'pager' })
    assert.equal(Number(again[0]?.childCount), 1, 'a child the search did not match still counts')
  } finally {
    await e2e.close()
  }
})
