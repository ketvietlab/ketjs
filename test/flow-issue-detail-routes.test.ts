import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' }
const post = { headers: formHeaders, redirect: 'manual' as const }

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite)
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'admin-party', kind: 'person', name: 'Administrator' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    partnerId: 'admin-party',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'admin:acme',
    userId: 'admin',
    companyId: 'acme',
  })
  await app.client.login({ login: 'admin', password: 'correct horse' })

  const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
    (await app.client.call<T>(name, input)).value
  await call('flow.project.save', {
    values: { id: 'platform', key: 'PLAT', name: 'Internal platform' },
    idempotencyKey: 'project-platform',
  })
  await call('flow.column.save', {
    values: { id: 'todo', projectId: 'platform', code: 'todo', name: 'To do', sequence: 10 },
    idempotencyKey: 'column-todo',
  })
  await call('flow.column.save', {
    values: { id: 'doing', projectId: 'platform', code: 'doing', name: 'Doing', sequence: 20 },
    idempotencyKey: 'column-doing',
  })
  await call('flow.sprint.save', {
    id: 'sprint-1',
    projectId: 'platform',
    name: 'Sprint 1',
    idempotencyKey: 'sprint-1',
  })
  await call('flow.issue.save', {
    id: 'issue-login',
    projectId: 'platform',
    columnId: 'todo',
    title: 'Finish login',
    priority: 'high',
    assigneeUserId: 'admin',
    idempotencyKey: 'issue-login',
  })
  return { app, call }
}

test('flow issue detail route: FormPage preserves live collaboration, localized modal actions and safe writes', async (t) => {
  const { app, call } = await boot(t)
  const detail = '/admin/flow/issues/issue-login?lang=en'

  const page = await app.client.get(detail)
  const html = await page.text()
  const textContent = html.replace(/<!--k\[?-->/g, '')
  assert.equal(page.status, 200)
  assert.match(html, /data-ui="form-page" data-scope="flow-issue-detail-form-page"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"/)
  assert.match(textContent, /data-ui="form-page-title">Finish login/)
  assert.match(textContent, /data-ui="form-page-description">Internal platform/)
  assert.match(textContent, /data-ui="form-page-status"[^>]*>.*To do/)
  assert.match(textContent, /High/)
  assert.match(textContent, /Assignee: Administrator/)
  assert.match(html, /data-island="livedoc.editor"/)
  assert.match(html, /data-ui="form-page-aside"/)
  assert.match(html, /id="flow-issue-detail-form"/)
  assert.match(html, /action="\/admin\/flow\/issues\/issue-login\?lang=en"/)
  assert.match(html, /name="expectedVersion" value="1"/)
  assert.match(html, /name="idempotencyKey" value="[^"]+"/)
  assert.match(html, /href="\/admin\/flow\/issues\/issue-login\?lang=en&amp;dialog=move"/)
  assert.match(html, /href="\/admin\/flow\/issues\/issue-login\?lang=en&amp;dialog=assignSprint"/)
  assert.match(html, /action="\/admin\/flow\/issues\/issue-login\/attachments\?lang=en"/)

  const movePage = await app.client.get(`${detail}&dialog=move`)
  const moveHtml = await movePage.text()
  assert.equal(movePage.status, 200)
  assert.match(moveHtml, /data-ui="form-page"/)
  assert.match(moveHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(moveHtml, /id="flow-issue-move-form"/)
  assert.match(moveHtml, /action="\/admin\/flow\/issues\/issue-login\?lang=en&amp;dialog=move"/)
  assert.match(moveHtml, /name="action" value="move"/)
  assert.match(moveHtml, /name="expectedVersion" value="1"/)
  assert.match(moveHtml, /data-ui="modal-close" href="\/admin\/flow\/issues\/issue-login\?lang=en"/)

  const invalidMove = await app.client.post(
    `${detail}&dialog=move`,
    new URLSearchParams({
      action: 'move',
      columnId: 'missing',
      expectedVersion: '1',
      idempotencyKey: 'move-invalid',
    }),
    post,
  )
  const invalidMoveHtml = await invalidMove.text()
  assert.equal(invalidMove.status, 200)
  assert.match(invalidMoveHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(invalidMoveHtml, /<option value="missing" selected="true">/)
  assert.match(invalidMoveHtml, /name="idempotencyKey" value="move-invalid"/)
  assert.match(invalidMoveHtml, /That status does not belong to this project/)

  const moved = await app.client.post(
    `${detail}&dialog=move`,
    new URLSearchParams({
      action: 'move',
      columnId: 'doing',
      expectedVersion: '1',
      idempotencyKey: 'move-success',
    }),
    post,
  )
  assert.equal(moved.status, 303)
  assert.equal(moved.headers.get('location'), detail)
  const movedIssue = await call<Row>('flow.issue.get', { id: 'issue-login' })
  assert.equal(movedIssue.columnId, 'doing')
  assert.equal(movedIssue.version, 2)

  const sprintPage = await app.client.get(`${detail}&dialog=assignSprint`)
  const sprintHtml = await sprintPage.text()
  assert.equal(sprintPage.status, 200)
  assert.match(sprintHtml, /id="flow-issue-assignSprint-form"/)
  assert.match(sprintHtml, /name="sprintId"/)
  assert.match(sprintHtml, /Sprint 1/)

  const commented = await app.client.post(
    detail,
    new URLSearchParams({ action: 'comment', body: 'Ready for review', idempotencyKey: 'comment-1' }),
    post,
  )
  assert.equal(commented.status, 303)
  assert.equal(commented.headers.get('location'), detail)
  const afterComment = await (await app.client.get(detail)).text()
  assert.match(afterComment.replace(/<!--k\[?-->/g, ''), /Ready for review/)
  assert.match(afterComment, /data-island="livedoc.editor"/)

  const forged = await app.client.post(
    detail,
    new URLSearchParams({ action: 'move', columnId: 'todo', expectedVersion: '2' }),
    {
      headers: { ...formHeaders, origin: 'https://evil.example' },
      redirect: 'manual',
    },
  )
  assert.equal(forged.status, 403)

  const missing = await app.client.get('/admin/flow/issues/missing?lang=en')
  assert.equal(missing.status, 404)
  const refused = await app.client.request(detail, { method: 'PUT' })
  assert.equal(refused.status, 405)
})

test('flow issue detail route: archive and restore are one button, under the version on screen', async (t) => {
  const { app, call } = await boot(t)
  const detail = '/admin/flow/issues/issue-login?lang=en'
  const held = (await call<Row>('flow.issue.get', { id: 'issue-login' })) as Row

  const live = await (await app.client.get(detail)).text()
  assert.match(live, /value="archive"/)
  assert.doesNotMatch(live, /This issue is archived/)

  const archived = await app.client.request(detail, {
    ...post,
    method: 'POST',
    body: new URLSearchParams({
      action: 'archive',
      expectedVersion: String(held.version),
      idempotencyKey: 'route-archive-1',
    }),
  })
  assert.equal(archived.status, 303)

  // The page still opens — archiving is not deleting — and says what it means.
  const after = await (await app.client.get(detail)).text()
  assert.match(after, /This issue is archived/)
  assert.match(after, /value="restore"/)
  assert.doesNotMatch(after, /value="archive"/)

  // And it is out of the list until the list is asked for it.
  const list = '/admin/flow/projects/platform/issues?lang=en'
  assert.doesNotMatch(await (await app.client.get(list)).text(), /Finish login/)
  assert.match(await (await app.client.get(`${list}&archived=1`)).text(), /Finish login/)

  const back = (await call<Row>('flow.issue.get', { id: 'issue-login' })) as Row
  const restored = await app.client.request(detail, {
    ...post,
    method: 'POST',
    body: new URLSearchParams({
      action: 'restore',
      expectedVersion: String(back.version),
      idempotencyKey: 'route-restore-1',
    }),
  })
  assert.equal(restored.status, 303)
  assert.match(await (await app.client.get(list)).text(), /Finish login/)
})

test('flow issue detail route: following is a button in both directions', async (t) => {
  const { app, call } = await boot(t)
  const detail = '/admin/flow/issues/issue-login?lang=en'
  const following = async () =>
    Boolean(((await call<Row>('flow.issue.get', { id: 'issue-login' })) as Row).following)

  // The assignee already follows, so the screen offers the way out first.
  assert.equal(await following(), true)
  assert.match(await (await app.client.get(detail)).text(), /value="unfollow"/)

  const left = await app.client.request(detail, {
    ...post,
    method: 'POST',
    body: new URLSearchParams({ action: 'unfollow', idempotencyKey: 'route-unfollow-1' }),
  })
  assert.equal(left.status, 303)
  assert.equal(await following(), false)
  assert.match(await (await app.client.get(detail)).text(), /value="follow"/)

  const rejoined = await app.client.request(detail, {
    ...post,
    method: 'POST',
    body: new URLSearchParams({ action: 'follow', idempotencyKey: 'route-follow-1' }),
  })
  assert.equal(rejoined.status, 303)
  assert.equal(await following(), true)
})

test('flow issue detail route: an issue that already exists can be put under another', async (t) => {
  const { app, call } = await boot(t)
  await call('flow.issue.save', {
    id: 'issue-migration',
    projectId: 'platform',
    columnId: 'todo',
    title: 'Write the migration',
    idempotencyKey: 'issue-migration',
  })
  const child = (await call<Row>('flow.issue.get', { id: 'issue-migration' })) as Row
  const detail = '/admin/flow/issues/issue-login?lang=en'

  const attached = await app.client.request(detail, {
    ...post,
    method: 'POST',
    body: new URLSearchParams({
      action: 'attachSubtask',
      childId: 'issue-migration',
      childVersion: String(child.version),
      idempotencyKey: 'route-attach-1',
    }),
  })
  assert.equal(attached.status, 303)
  const parent = (await call<Row>('flow.issue.get', { id: 'issue-login' })) as Row
  assert.deepEqual(
    (parent.children as Row[]).map((row) => String(row.id)),
    ['issue-migration'],
  )
  // Nothing else about it moved: attaching is not editing.
  const moved = (await call<Row>('flow.issue.get', { id: 'issue-migration' })) as Row
  assert.equal(String(moved.title), 'Write the migration')
  assert.equal(String(moved.columnId), 'todo')
})
