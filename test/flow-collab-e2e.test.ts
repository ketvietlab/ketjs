import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import * as Y from 'yjs'
import flow from '../packages/ketsuite/src/modules/flow/index.ts'
import flowBackend from '../packages/ketsuite/src/modules/flow_backend/index.ts'

const app = defineDeployment({
  name: 'flow_collab_headless_e2e',
  modules: [address, partner, company, storage, user, mail, backend, flow, flowBackend],
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
    assert.ok(content.topic.startsWith('flow:acme:issue-1:'))
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
