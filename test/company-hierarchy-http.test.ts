import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

test('company hierarchy HTTP preserves nesting, archived state, encoding and locale', async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'root', branch: 'root:root', branches: ['root:root'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  for (const [id, name, parentId] of [
    ['root', 'Root Company', null],
    ['child/a', 'Child Company', 'root'],
    ['grandchild', 'Grandchild', 'child/a'],
  ] as const) {
    await fixture('partner.savePartner', { id: `${id}:party`, kind: 'company', name })
    await fixture('company.saveCompany', {
      id,
      code: id,
      partnerId: `${id}:party`,
      parentId,
      currency: 'VND',
    })
  }
  await fixture('user.archiveCompany', { id: 'grandchild', active: false })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Admin',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:root', userId: 'admin', companyId: 'root' })
  await app.client.login({ login: 'admin', password: 'correct horse' })

  const response = await app.client.get('/admin/companies/hierarchy?lang=en')
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.ok(html.indexOf('Root Company') < html.indexOf('Child Company'))
  assert.ok(html.indexOf('Child Company') < html.indexOf('Grandchild'))
  assert.match(html, /data-row-href="\/admin\/companies\/child%2Fa\?lang=en"/)
  assert.match(html, /data-tone="neutral" data-value="archived"/)
  assert.match(html, /Companies: 3/)
  assert.equal(
    (await app.client.request('/admin/companies/hierarchy?lang=en', { method: 'POST' })).status,
    405,
  )
})
