import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const post = { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' as const }

test('working context HTTP uses explicit save and locale-preserving PRG', async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', { id: 'admin', login: 'admin', password: 'correct horse', name: 'Admin', superuser: true })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })

  const path = '/admin/context?lang=en'
  const html = await (await app.client.get(path)).text()
  assert.match(html, /data-ui="form-page" data-scope="working-context-page"/)
  assert.match(html, /action="\/admin\/context\?lang=en"/)
  assert.equal((await app.client.post(path, new URLSearchParams({ action: 'unknown' }), post)).status, 400)

  const saved = await app.client.post(
    path,
    new URLSearchParams({
      action: 'save',
      companyId: 'acme',
      branchId: 'root:acme',
      'company.acme': '1',
      'branch.root:acme': '1',
    }),
    post,
  )
  assert.equal(saved.status, 303)
  assert.equal(saved.headers.get('location'), '/admin/context?lang=en')
})
