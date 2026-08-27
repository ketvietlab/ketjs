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
  for (const [id, key, name] of [
    ['platform', 'PLAT', 'Internal platform'],
    ['commerce', 'COMM', 'Commerce'],
  ])
    await call('flow.project.save', {
      values: { id, key, name },
      idempotencyKey: `project-${id}`,
    })
  await call('flow.column.save', {
    values: { id: 'todo', projectId: 'platform', code: 'todo', name: 'To do', sequence: 10 },
    idempotencyKey: 'column-todo',
  })
  await call('flow.epic.save', {
    values: { id: 'release-one', projectId: 'platform', title: 'First release', color: '#336699' },
    idempotencyKey: 'epic-release-one',
  })
  await call('flow.epic.save', {
    values: { id: 'foreign-epic', projectId: 'commerce', title: 'Commerce release' },
    idempotencyKey: 'epic-foreign',
  })
  await call('flow.issue.save', {
    id: 'release-login',
    projectId: 'platform',
    columnId: 'todo',
    epicId: 'release-one',
    title: 'Finish login',
    idempotencyKey: 'issue-release-login',
  })
  return { app, call }
}

test('flow project epics route: specialized cards and URL modal preserve project paths and safe retries', async (t) => {
  const { app, call } = await boot(t)
  const collection = '/admin/flow/projects/platform/epics?lang=en'

  const page = await app.client.get(collection)
  const html = await page.text()
  const textContent = html.replace(/<!--k\[?-->/g, '')
  assert.equal(page.status, 200)
  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
  assert.match(textContent, /data-ui="record-heading">Internal platform/)
  assert.match(html, /data-ui="kanban-card" data-interactive="true"/)
  assert.match(html, /href="\/admin\/flow\/epics\/release-one\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/epics\/release-one\/map\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/issues\?[^"]*lang=en/)
  assert.match(textContent, /1 issue/)
  assert.match(html, /action="\/admin\/flow\/projects\/platform\/epics\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/epics\?lang=en&amp;create=1"/)

  const create = await app.client.get(`${collection}&create=1`)
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(createHtml, /id="flow-project-epic-create-form"/)
  assert.match(createHtml, /action="\/admin\/flow\/projects\/platform\/epics\?lang=en&amp;create=1"/)
  assert.match(createHtml, /name="id" value="[^"]+"/)
  assert.match(createHtml, /name="idempotencyKey" value="[^"]+"/)
  assert.match(createHtml, /data-ui="modal-close" href="\/admin\/flow\/projects\/platform\/epics\?lang=en"/)

  const retryState = {
    action: 'save',
    id: 'release-two',
    idempotencyKey: 'epic-release-two',
    title: '',
    color: '#123456',
  }
  const invalid = await app.client.post(`${collection}&create=1`, new URLSearchParams(retryState), post)
  assert.equal(invalid.status, 303)
  const invalidLocation = invalid.headers.get('location') ?? ''
  const invalidUrl = new URL(invalidLocation, 'http://ket.local')
  assert.equal(invalidUrl.pathname, '/admin/flow/projects/platform/epics')
  assert.equal(invalidUrl.searchParams.get('lang'), 'en')
  assert.equal(invalidUrl.searchParams.get('create'), '1')
  assert.equal(invalidUrl.searchParams.get('id'), 'release-two')
  assert.equal(invalidUrl.searchParams.get('idempotencyKey'), 'epic-release-two')
  assert.equal(invalidUrl.searchParams.get('title'), null)
  assert.equal(invalidUrl.searchParams.get('color'), '#123456')
  const invalidHtml = await (await app.client.get(invalidLocation)).text()
  assert.match(invalidHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(invalidHtml, /name="id" value="release-two"/)
  assert.match(invalidHtml, /name="idempotencyKey" value="epic-release-two"/)
  assert.match(invalidHtml, /name="title"[^>]*value=""/)
  assert.match(invalidHtml, /name="color"[^>]*value="#123456"/)
  assert.match(invalidHtml, /required/i)

  const validRetry = new URLSearchParams({
    ...retryState,
    title: 'Second release',
  })
  const created = await app.client.post(`${collection}&create=1`, validRetry, post)
  assert.equal(created.status, 303)
  assert.equal(created.headers.get('location'), collection)
  const replay = await app.client.post(`${collection}&create=1`, validRetry, post)
  assert.equal(replay.status, 303)
  assert.equal(replay.headers.get('location'), collection)
  const epics = await call<Row[]>('flow.epic.list', { projectId: 'platform' })
  assert.equal(epics.filter((row) => row.id === 'release-two').length, 1)
  assert.equal(epics.find((row) => row.id === 'release-two')?.title, 'Second release')

  const legacy = await app.client.post(
    collection,
    new URLSearchParams({ title: 'Legacy epic', color: '#abcdef' }),
    post,
  )
  assert.equal(legacy.status, 303)
  assert.equal(legacy.headers.get('location'), collection)
  assert.ok(
    (await call<Row[]>('flow.epic.list', { projectId: 'platform' })).some(
      (row) => row.title === 'Legacy epic',
    ),
  )

  const unknown = await app.client.post(
    collection,
    new URLSearchParams({ action: 'delete', title: 'Must not exist' }),
    post,
  )
  assert.equal(unknown.status, 400)
  assert.ok(
    !(await call<Row[]>('flow.epic.list', { projectId: 'platform' })).some(
      (row) => row.title === 'Must not exist',
    ),
  )

  const forgedArchive = await app.client.post(
    collection,
    new URLSearchParams({ action: 'archive', id: 'foreign-epic' }),
    post,
  )
  assert.equal(forgedArchive.status, 303)
  const forgedLocation = forgedArchive.headers.get('location') ?? ''
  const forgedUrl = new URL(forgedLocation, 'http://ket.local')
  assert.equal(forgedUrl.pathname, '/admin/flow/projects/platform/epics')
  assert.equal(forgedUrl.searchParams.get('lang'), 'en')
  assert.match(await (await app.client.get(forgedLocation)).text(), /The record was not found/)
  const foreign = await call<{ value: Row }>('flow.epic.get', { id: 'foreign-epic' })
  assert.equal(foreign.value.active, true)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const archived = await app.client.post(
      collection,
      new URLSearchParams({ action: 'archive', id: 'release-two' }),
      post,
    )
    assert.equal(archived.status, 303)
    assert.equal(archived.headers.get('location'), collection)
  }
  assert.ok(
    !(await call<Row[]>('flow.epic.list', { projectId: 'platform' })).some((row) => row.id === 'release-two'),
  )

  const csrf = await app.client.post(collection, new URLSearchParams({ action: 'save', title: 'Forged' }), {
    headers: { ...formHeaders, origin: 'https://evil.example' },
    redirect: 'manual',
  })
  assert.equal(csrf.status, 403)
  assert.equal((await app.client.request(collection, { method: 'PUT' })).status, 405)
  assert.equal((await app.client.get('/admin/flow/projects/missing/epics?lang=en')).status, 404)
})
