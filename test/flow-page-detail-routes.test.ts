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
  for (const [id, title, parentPageId] of [
    ['guide', 'Product guide', ''],
    ['reference', 'Reference', ''],
    ['roadmap', 'Roadmap', ''],
    ['setup', 'Local setup', 'guide'],
    ['macos', 'macOS', 'setup'],
  ]) {
    await call('flow.page.save', {
      id,
      projectId: 'platform',
      title,
      ...(parentPageId ? { parentPageId } : {}),
      idempotencyKey: `page-${id}`,
    })
  }
  return { app, call }
}

test('flow page detail route: FormPage preserves Live Doc, modal sub-actions and safe document writes', async (t) => {
  const { app, call } = await boot(t)
  const detail = '/admin/flow/pages/setup?lang=en'

  const page = await app.client.get(detail)
  const html = await page.text()
  const textContent = html.replace(/<!--k\[?-->/g, '')
  assert.equal(page.status, 200)
  assert.match(html, /data-ui="form-page" data-scope="flow-page-detail-form-page"/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="modal-layer"/)
  assert.match(textContent, /data-ui="form-page-title">Local setup/)
  assert.match(textContent, /data-ui="form-page-description">Internal platform/)
  assert.match(html, /data-island="livedoc.editor"/)
  assert.match(html, /id="flow-page-detail-form"/)
  assert.match(html, /action="\/admin\/flow\/pages\/setup\?lang=en"/)
  assert.match(html, /name="expectedVersion" value="1"/)
  assert.match(html, /name="idempotencyKey" value="[^"]+"/)
  assert.match(html, /href="\/admin\/flow\/projects\/platform\/pages\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/pages\/guide\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/pages\/macos\?lang=en"/)
  assert.match(html, /href="\/admin\/flow\/pages\/setup\?lang=en&amp;dialog=addChild"/)
  assert.match(html, /href="\/admin\/flow\/pages\/setup\?lang=en&amp;dialog=move"/)

  const addChild = await app.client.get(`${detail}&dialog=addChild`)
  const addChildHtml = await addChild.text()
  assert.equal(addChild.status, 200)
  assert.match(addChildHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(addChildHtml, /id="flow-page-addChild-form"/)
  assert.match(addChildHtml, /action="\/admin\/flow\/pages\/setup\?lang=en&amp;dialog=addChild"/)
  assert.match(addChildHtml, /name="idempotencyKey" value="[^"]+"/)
  assert.match(addChildHtml, /name="childId" value="[^"]+"/)

  const invalidChild = await app.client.post(
    `${detail}&dialog=addChild`,
    new URLSearchParams({
      action: 'addChild',
      title: '   ',
      childId: 'child-invalid-record',
      idempotencyKey: 'child-invalid',
    }),
    post,
  )
  const invalidChildHtml = await invalidChild.text()
  assert.equal(invalidChild.status, 200)
  assert.match(invalidChildHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(invalidChildHtml, /name="title"[^>]*value=" {3}"/)
  assert.match(invalidChildHtml, /name="idempotencyKey" value="child-invalid"/)
  assert.match(invalidChildHtml, /name="childId" value="child-invalid-record"/)
  assert.match(invalidChildHtml, /required/i)
  assert.match(invalidChildHtml, /data-island="livedoc.editor"/)

  const invalidMove = await app.client.post(
    `${detail}&dialog=move`,
    new URLSearchParams({ action: 'move', parentPageId: 'missing' }),
    post,
  )
  const invalidMoveHtml = await invalidMove.text()
  assert.equal(invalidMove.status, 200)
  assert.match(invalidMoveHtml, /id="flow-page-move-form"/)
  assert.match(invalidMoveHtml, /<option value="missing" selected="true">/)
  assert.match(invalidMoveHtml, /The record was not found/)

  const renamed = await app.client.post(
    detail,
    new URLSearchParams({
      action: 'save',
      title: 'Local environment setup',
      expectedVersion: '1',
      idempotencyKey: 'rename-setup',
    }),
    post,
  )
  assert.equal(renamed.status, 303)
  assert.equal(renamed.headers.get('location'), detail)
  const renamedPage = await call<{ value: Row }>('flow.page.get', { id: 'setup' })
  assert.equal(renamedPage.value.title, 'Local environment setup')
  assert.equal(renamedPage.value.version, 2)

  const stale = await app.client.post(
    detail,
    new URLSearchParams({
      action: 'save',
      title: 'Rejected stale title',
      expectedVersion: '1',
      idempotencyKey: 'rename-stale',
    }),
    post,
  )
  const staleHtml = await stale.text()
  assert.equal(stale.status, 200)
  assert.match(staleHtml, /name="title"[^>]*value="Rejected stale title"/)
  assert.match(staleHtml, /name="idempotencyKey" value="rename-stale"/)
  assert.match(staleHtml, /changed/i)
  assert.match(staleHtml, /data-island="livedoc.editor"/)

  const child = await app.client.post(
    `${detail}&dialog=addChild`,
    new URLSearchParams({
      action: 'addChild',
      title: 'Windows',
      childId: 'page-windows',
      idempotencyKey: 'child-windows',
    }),
    post,
  )
  assert.equal(child.status, 303)
  assert.match(child.headers.get('location') ?? '', /^\/admin\/flow\/pages\/[^?]+\?lang=en$/)
  const pages = await call<Row[]>('flow.page.list', { projectId: 'platform' })
  assert.equal(pages.find((row) => row.title === 'Windows')?.parentPageId, 'setup')

  const childReplay = await app.client.post(
    `${detail}&dialog=addChild`,
    new URLSearchParams({
      action: 'addChild',
      title: 'Windows',
      childId: 'page-windows',
      idempotencyKey: 'child-windows',
    }),
    post,
  )
  assert.equal(childReplay.status, 303)
  assert.equal(childReplay.headers.get('location'), child.headers.get('location'))
  const afterChildReplay = await call<Row[]>('flow.page.list', { projectId: 'platform' })
  assert.equal(afterChildReplay.filter((row) => row.title === 'Windows').length, 1)

  const reorderOnce = new URLSearchParams({
    action: 'orderDown',
    idempotencyKey: 'guide-order-down-once',
  })
  const firstReorder = await app.client.post('/admin/flow/pages/guide?lang=en', reorderOnce, post)
  const replayedReorder = await app.client.post(
    '/admin/flow/pages/guide?lang=en',
    new URLSearchParams(reorderOnce),
    post,
  )
  assert.equal(firstReorder.status, 303)
  assert.equal(replayedReorder.status, 303)
  const rootsAfterReplay = (await call<Row[]>('flow.page.list', { projectId: 'platform' }))
    .filter((row) => !row.parentPageId)
    .map((row) => row.id)
  assert.deepEqual(rootsAfterReplay, ['reference', 'guide', 'roadmap'])

  const moved = await app.client.post(
    `${detail}&dialog=move`,
    new URLSearchParams({ action: 'move', parentPageId: 'reference' }),
    post,
  )
  assert.equal(moved.status, 303)
  assert.equal(moved.headers.get('location'), detail)
  const movedPage = await call<{ value: Row }>('flow.page.get', { id: 'setup' })
  assert.equal(movedPage.value.parentPageId, 'reference')

  const reordered = await app.client.post(detail, new URLSearchParams({ action: 'orderUp' }), post)
  assert.equal(reordered.status, 303)
  assert.equal(reordered.headers.get('location'), detail)

  const forged = await app.client.post(detail, new URLSearchParams({ action: 'archive' }), {
    headers: { ...formHeaders, origin: 'https://evil.example' },
    redirect: 'manual',
  })
  assert.equal(forged.status, 403)
  const refused = await app.client.request(detail, { method: 'PUT' })
  assert.equal(refused.status, 405)
  const missing = await app.client.get('/admin/flow/pages/missing?lang=en')
  assert.equal(missing.status, 404)

  const archived = await app.client.post(detail, new URLSearchParams({ action: 'archive' }), post)
  assert.equal(archived.status, 303)
  assert.equal(archived.headers.get('location'), '/admin/flow/projects/platform/pages?lang=en')
  const activePages = await call<Row[]>('flow.page.list', { projectId: 'platform' })
  assert.ok(!activePages.some((row) => row.id === 'setup'))
})
