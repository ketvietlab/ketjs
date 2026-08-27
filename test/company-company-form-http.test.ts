import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const post = {
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  redirect: 'manual' as const,
}

const bootCompanies = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })

  for (const [id, name, currency] of [
    ['acme', 'ACME Legal Entity', 'VND'],
    ['beta', 'Beta Legal Entity', 'USD'],
  ]) {
    await fixture('partner.savePartner', { id: `${id}:partner`, kind: 'company', name })
    await fixture('company.saveCompany', {
      id,
      code: id.toUpperCase(),
      partnerId: `${id}:partner`,
      currency,
    })
  }
  await fixture('company.saveBranch', {
    id: 'beta:north',
    companyId: 'beta',
    code: 'NORTH',
    name: 'Beta North',
    parentId: 'root:beta',
  })
  await fixture('partner.savePartner', {
    id: 'new-company-partner',
    kind: 'company',
    name: 'New Company Partner',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    defaultBranchId: 'root:acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'admin:acme',
    userId: 'admin',
    companyId: 'acme',
  })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

const hidden = (html: string, name: string): string => {
  const match = html.match(new RegExp(`name="${name}" value="([^"]*)"`))
  assert.ok(match, `missing hidden field ${name}`)
  return match[1]!
}

test('company create keeps a stable command id, safe return target, locale PRG and no chatter', async (t) => {
  const app = await bootCompanies(t)
  const returnTo = '/admin/companies?q=Legal&archived=1&lang=vi'
  const path = `/admin/companies/new?lang=vi&returnTo=${encodeURIComponent(returnTo)}`
  const create = await app.client.get(path)
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="form-page" data-scope="company-form-page"/)
  assert.doesNotMatch(createHtml, /data-ui="modal-layer"|mail\.chatter/)
  assert.match(createHtml, /href="\/admin\/companies\?q=Legal&amp;archived=1&amp;lang=vi"/)
  const id = hidden(createHtml, 'id')
  assert.match(id, /^[0-9a-f-]{36}$/i)

  const rejected = await app.client.post(
    path,
    new URLSearchParams({
      action: 'save',
      id,
      code: 'DRAFT-CODE',
      partnerId: 'missing-create-partner',
      parentId: 'missing-create-parent',
      currency: 'JPY',
      returnTo,
    }),
    post,
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.equal(hidden(rejectedHtml, 'id'), id)
  assert.match(rejectedHtml, /name="code"[^>]*value="DRAFT-CODE"/)
  assert.match(rejectedHtml, /name="currency"[^>]*value="JPY"/)
  assert.match(rejectedHtml, /<option value="missing-create-partner" selected="true">/)
  assert.match(rejectedHtml, /<option value="missing-create-parent" selected="true">/)

  const body = new URLSearchParams({
    action: 'save',
    id,
    code: 'NEWCO',
    partnerId: 'new-company-partner',
    parentId: 'beta',
    currency: 'EUR',
    returnTo,
  })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const saved = await app.client.post(path, body, post)
    assert.equal(saved.status, 303)
    assert.equal(
      saved.headers.get('location'),
      `/admin/companies/${id}?lang=vi&returnTo=${encodeURIComponent(returnTo)}`,
    )
  }

  const unsafe = await (
    await app.client.get('/admin/companies/new?lang=en&returnTo=https://attacker.example/leave')
  ).text()
  assert.match(unsafe, /href="\/admin\/companies\?lang=en"/)
  assert.doesNotMatch(unsafe, /attacker\.example/)
})

test('company detail preserves rejected values and missing relations beside branches and partner chatter', async (t) => {
  const app = await bootCompanies(t)
  const path = '/admin/companies/beta?lang=en'
  const detail = await app.client.get(path)
  const detailHtml = await detail.text()
  assert.equal(detail.status, 200)
  assert.match(detailHtml, /data-ui="form-page"[^>]*data-has-aside="true"/)
  assert.match(detailHtml, /data-island="mail\.chatter"/)
  assert.match(detailHtml, /Beta North/)
  assert.match(detailHtml, /name="expectedVersion" value="1"/)

  const rejected = await app.client.post(
    path,
    new URLSearchParams({
      action: 'save',
      expectedVersion: '1',
      code: 'UNSAVED-CODE',
      partnerId: 'missing-partner',
      parentId: 'missing-parent',
      currency: 'JPY',
    }),
    post,
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.match(rejectedHtml, /data-ui="form-errors" role="alert"/)
  assert.match(rejectedHtml, /name="code"[^>]*value="UNSAVED-CODE"/)
  assert.match(rejectedHtml, /name="currency"[^>]*value="JPY"/)
  assert.match(rejectedHtml, /<option value="missing-partner" selected="true">/)
  assert.match(rejectedHtml, /<option value="missing-parent" selected="true">/)
  assert.match(rejectedHtml, /Partner does not exist|representative partner does not exist/i)
  assert.match(rejectedHtml, /Parent company does not exist/i)
})

test('branch create/detail uses FormPage, stable retry identity and company-scoped lookup', async (t) => {
  const app = await bootCompanies(t)
  const path = '/admin/companies/beta/branches/new?lang=en'
  const create = await app.client.get(path)
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="form-page" data-scope="branch-form-page"/)
  assert.doesNotMatch(createHtml, /data-ui="modal-layer"|mail\.chatter/)
  const id = hidden(createHtml, 'id')
  assert.match(id, /^[0-9a-f-]{36}$/i)

  const rejected = await app.client.post(
    path,
    new URLSearchParams({
      action: 'save',
      id,
      code: 'DRAFT',
      name: 'Draft branch',
      parentId: 'missing-parent',
    }),
    post,
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.equal(hidden(rejectedHtml, 'id'), id)
  assert.match(rejectedHtml, /<option value="missing-parent" selected="true">/)

  const saved = await app.client.post(
    path,
    new URLSearchParams({
      action: 'save',
      id,
      code: 'SOUTH',
      name: 'Beta South',
      parentId: 'root:beta',
    }),
    post,
  )
  assert.equal(saved.status, 303)
  assert.equal(saved.headers.get('location'), `/admin/companies/beta/branches/${id}?lang=en`)

  const detail = await (await app.client.get(saved.headers.get('location')!)).text()
  assert.match(detail, /data-ui="form-page" data-scope="branch-form-page"/)
  assert.match(detail, /name="action" value="archive"/)
  assert.match(detail, /href="\/admin\/companies\/beta\?lang=en"/)

  assert.equal((await app.client.get('/admin/companies/acme/branches/beta%3Anorth?lang=en')).status, 404)
  assert.equal(
    (
      await app.client.post(
        path,
        new URLSearchParams({ id, code: 'IGNORED', name: 'Ignored', parentId: 'root:beta' }),
        post,
      )
    ).status,
    400,
  )
})

test('company mutations enforce same-origin and command allowlists while detail keeps legacy save', async (t) => {
  const app = await bootCompanies(t)
  const crossSiteOptions = {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://attacker.example',
    },
    redirect: 'manual' as const,
  }
  for (const path of [
    '/admin/companies/new?lang=en',
    '/admin/companies/beta?lang=en',
    '/admin/companies/beta/archive?lang=en',
    '/admin/companies/beta/branches/new?lang=en',
    '/admin/companies/beta/branches/beta:north?lang=en',
    '/admin/companies/beta/branches/beta:north/archive?lang=en',
  ]) {
    const response = await app.client.post(path, new URLSearchParams(), crossSiteOptions)
    assert.equal(response.status, 403, path)
  }

  const missingCreateAction = await app.client.post(
    '/admin/companies/new?lang=en',
    new URLSearchParams({
      code: 'IGNORED',
      partnerId: 'new-company-partner',
      currency: 'VND',
    }),
    post,
  )
  assert.equal(missingCreateAction.status, 400)
  const invalidSaveAction = await app.client.post(
    '/admin/companies/beta?lang=en',
    new URLSearchParams({ action: 'archive', code: 'BETA', partnerId: 'beta:partner', currency: 'USD' }),
    post,
  )
  assert.equal(invalidSaveAction.status, 400)
  const invalidArchiveAction = await app.client.post(
    '/admin/companies/beta/archive?lang=en',
    new URLSearchParams({ action: 'save', expectedVersion: '1' }),
    post,
  )
  assert.equal(invalidArchiveAction.status, 400)
  const invalidBranchSave = await app.client.post(
    '/admin/companies/beta/branches/beta:north?lang=en',
    new URLSearchParams({ action: 'archive', code: 'NORTH', name: 'Beta North' }),
    post,
  )
  assert.equal(invalidBranchSave.status, 400)
  const invalidBranchArchive = await app.client.post(
    '/admin/companies/beta/branches/beta:north/archive?lang=en',
    new URLSearchParams({ action: 'save' }),
    post,
  )
  assert.equal(invalidBranchArchive.status, 400)

  const legacySave = await app.client.post(
    '/admin/companies/beta?lang=en',
    new URLSearchParams({
      expectedVersion: '1',
      code: 'BETA-LEGACY',
      partnerId: 'beta:partner',
      currency: 'USD',
    }),
    post,
  )
  assert.equal(legacySave.status, 303)
  assert.equal(
    legacySave.headers.get('location'),
    '/admin/companies/beta?lang=en&returnTo=%2Fadmin%2Fcompanies%3Flang%3Den',
  )
})

test('company archive and restore require explicit transitions and retain locale through PRG', async (t) => {
  const app = await bootCompanies(t)
  const returnTo = '/admin/companies?archived=1&lang=vi'
  const archivePath = `/admin/companies/beta/archive?lang=vi&returnTo=${encodeURIComponent(returnTo)}`
  const archived = await app.client.post(
    archivePath,
    new URLSearchParams({ action: 'archive', expectedVersion: '1', returnTo }),
    post,
  )
  assert.equal(archived.status, 303)
  assert.equal(
    archived.headers.get('location'),
    `/admin/companies/beta?lang=vi&returnTo=${encodeURIComponent(returnTo)}`,
  )
  const archivedHtml = await (await app.client.get(archived.headers.get('location')!)).text()
  assert.match(archivedHtml, /name="action" value="restore"/)
  assert.match(archivedHtml, /name="expectedVersion" value="2"/)

  const staleRestore = await app.client.post(
    archivePath,
    new URLSearchParams({ action: 'restore', expectedVersion: '1', returnTo }),
    post,
  )
  assert.equal(staleRestore.status, 200)
  assert.match(await staleRestore.text(), /company changed|đã thay đổi/i)

  const restored = await app.client.post(
    archivePath,
    new URLSearchParams({ action: 'restore', expectedVersion: '2', returnTo }),
    post,
  )
  assert.equal(restored.status, 303)
  const restoredHtml = await (await app.client.get(restored.headers.get('location')!)).text()
  assert.match(restoredHtml, /name="action" value="archive"/)
  assert.match(restoredHtml, /name="expectedVersion" value="3"/)
})
