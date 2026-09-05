import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const post = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' as const }
const hidden = (html: string, name: string): string => {
  const match = html.match(new RegExp(`name="${name}" value="([^"]*)"`))
  assert.ok(match, `missing ${name}`)
  return match[1]!
}

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Admin',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  await app.client.call('flow.project.save', {
    values: { id: 'platform', key: 'PLAT', name: 'Platform' },
    idempotencyKey: 'project-platform',
  })
  return app
}

test('project settings route preserves stable rejected modal state and explicit commands', async (t) => {
  const app = await boot(t)
  const path = '/admin/flow/projects/platform/settings?dialog=column&lang=en'
  const opened = await (await app.client.get(path)).text()
  assert.match(opened, /data-ui="modal-layer"/)
  const id = hidden(opened, 'id')
  const idempotencyKey = hidden(opened, 'idempotencyKey')

  const rejected = await app.client.post(
    path,
    new URLSearchParams({ action: 'saveColumn', id, idempotencyKey, name: '', sequence: '30' }),
    post,
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.equal(hidden(rejectedHtml, 'id'), id)
  assert.equal(hidden(rejectedHtml, 'idempotencyKey'), idempotencyKey)
  assert.match(rejectedHtml, /data-ui="form-errors" role="alert"/)
  assert.equal((await app.client.post(path, new URLSearchParams({ action: 'unknown' }), post)).status, 400)
})

test('project settings route edits the project record and archives it', async (t) => {
  const app = await boot(t)
  const path = '/admin/flow/projects/platform/settings?lang=en'
  const opened = await (await app.client.get(path)).text()
  // The three fields only the create form has ever offered.
  assert.match(opened, /name="name"[^>]*value="Platform"/)
  assert.match(opened, /name="key"[^>]*value="PLAT"/)
  assert.match(opened, /value="archiveProject"/)

  const renamed = await app.client.request(path, {
    ...post,
    method: 'POST',
    body: new URLSearchParams({
      action: 'saveProject',
      name: 'Internal platform',
      key: 'PLAT',
      description: 'What we build on.',
      idempotencyKey: 'settings-profile-1',
    }),
  })
  assert.equal(renamed.status, 303)
  assert.match(await (await app.client.get(path)).text(), /name="name"[^>]*value="Internal platform"/)

  const archived = await app.client.request(path, {
    ...post,
    method: 'POST',
    body: new URLSearchParams({ action: 'archiveProject' }),
  })
  assert.equal(archived.status, 303)
  // Off the ordinary list, and findable in the tab that says so.
  const list = '/admin/flow/projects?lang=en'
  assert.doesNotMatch(await (await app.client.get(list)).text(), /Internal platform/)
  assert.match(await (await app.client.get(`${list}&archived=1`)).text(), /Internal platform/)

  const restored = await app.client.request(path, {
    ...post,
    method: 'POST',
    body: new URLSearchParams({ action: 'restoreProject' }),
  })
  assert.equal(restored.status, 303)
  assert.match(await (await app.client.get(list)).text(), /Internal platform/)
})

test('project settings route says how far the tag buttons reach before they are pressed', async (t) => {
  const app = await boot(t)
  const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
    (await app.client.call<T>(name, input)).value
  await call('flow.column.save', {
    values: { id: 'todo', projectId: 'platform', code: 'todo', name: 'To do', sequence: 10 },
    idempotencyKey: 'column-todo',
  })
  await call('flow.tag.save', { id: 'tech-debt', name: 'tech debt' })
  for (const id of ['issue-a', 'issue-b'])
    await call('flow.issue.save', {
      id,
      projectId: 'platform',
      columnId: 'todo',
      title: id,
      tagIds: ['tech-debt'],
      idempotencyKey: `issue-${id}`,
    })

  const html = await (await app.client.get('/admin/flow/projects/platform/settings?lang=en')).text()
  // Tags are company-scope by design; this block is inside one project's
  // settings, so the reach of the button has to be on screen beside it.
  assert.match(html, /Tags belong to the company, not to this project/)
  assert.match(html, /2 issues/)
})

/**
 * The members block, which is the screen half of FLW-DEC-012.
 *
 * Worth a route test rather than a screen test alone: what makes this block
 * correct is not how it looks but that pressing its buttons changes who can
 * read the project, and only a rendered page posting back to itself shows that.
 */
test('project settings route shows who is on the project and changes it', async (t) => {
  const app = await boot(t)
  const path = '/admin/flow/projects/platform/settings?lang=en'

  // Whoever made the project is on it — otherwise nobody would be, and the
  // project would be unreadable by the person who just made it.
  const opened = await (await app.client.get(path)).text()
  assert.match(opened, /Members/)
  assert.match(opened, /Only members can read this project/)
  assert.match(opened, /Admin/)

  await app.fixture.call<Row>(
    'user.createUser',
    { id: 'mai', login: 'mai', password: 'correct horse', name: 'Mai' },
    { scope: { company: 'acme', branch: 'root:acme', branches: ['root:acme'] } },
  )
  await app.fixture.call<Row>(
    'user.grantCompany',
    { id: 'mai:acme', userId: 'mai', companyId: 'acme' },
    { scope: { company: 'acme', branch: 'root:acme', branches: ['root:acme'] } },
  )

  const idempotencyKey = hidden(opened, 'idempotencyKey')
  const added = await app.client.post(
    path,
    new URLSearchParams({ action: 'addMember', userId: 'mai', idempotencyKey }),
    post,
  )
  assert.equal(added.status, 303)
  const withMai = await (await app.client.get(path)).text()
  assert.match(withMai, /Mai/)

  // And off again. The row is gone from the block, which is the same thing as
  // saying the project is gone from her.
  const removed = await app.client.post(
    path,
    new URLSearchParams({ action: 'removeMember', userId: 'mai' }),
    post,
  )
  assert.equal(removed.status, 303)
  const without = await (await app.client.get(path)).text()
  assert.doesNotMatch(without, /Mai/)
})
