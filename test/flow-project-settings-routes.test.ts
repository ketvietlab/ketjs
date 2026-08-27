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
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', { id: 'admin', login: 'admin', password: 'correct horse', name: 'Admin', superuser: true })
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
