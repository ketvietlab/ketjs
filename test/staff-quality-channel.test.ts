import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Envelope<T> = { data: T; error: { code: string } | null }

const requirementId = '7c5a67b5-0fca-42e1-bd7a-f7a6146724e6'
const photoStepId = 'c49ed48c-351e-4420-8d2e-a5ab37a582e3'
const passStepId = '156a2f2b-86bd-47f8-8f21-f7d603946b8e'

const boot = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'quality-user',
    login: 'quality-user',
    password: 'correct horse battery',
    name: 'Quality User',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'quality-user:acme',
    userId: 'quality-user',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'quality-inspector', name: 'Quality inspector' })
  for (const fnKey of ['quality.getCheck', 'quality.uploadPhoto', 'quality.submit'])
    await fixture('user.grantFunction', {
      id: `quality-inspector:${fnKey}`,
      roleId: 'quality-inspector',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'quality-user:quality-inspector',
    userId: 'quality-user',
    roleId: 'quality-inspector',
  })
  await fixture('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await fixture('quality.saveTemplate', {
    id: 'fruit-arrival',
    version: '2026.08.1',
    steps: [
      {
        id: passStepId,
        sequence: 1,
        code: 'PACKAGING',
        label: 'Packaging intact',
        instruction: 'Check the outer packaging.',
        type: 'pass_fail',
        required: true,
      },
      {
        id: photoStepId,
        sequence: 2,
        code: 'PHOTO',
        label: 'Arrival photograph',
        instruction: 'Photograph the received lot.',
        type: 'photo',
        required: true,
        photoMimeTypes: ['image/jpeg'],
        photoMaxBytes: 262_144,
      },
    ],
  })
  await fixture('quality.createRequirement', {
    id: requirementId,
    warehouseId: 'wh',
    templateId: 'fruit-arrival',
  })
  return e2e
}

test('staff quality channel preserves canonical photo evidence through submission', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get(`/api/staff/v1/quality/checks/${requirementId}`)).status, 401)
  await e2e.client.login({ login: 'quality-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')

  const read = await e2e.client.get(`/api/staff/v1/quality/checks/${requirementId}`)
  assert.equal(read.status, 200)
  const initial = (await read.json()) as Envelope<Row>
  assert.match(String(initial.data.expectedCheckVersion), /^qcv_[0-9a-f]{64}$/)
  assert.equal(read.headers.get('etag'), `"${String(initial.data.expectedCheckVersion)}"`)
  assert.equal((initial.data.steps as Row[]).length, 2)

  const bytes = Buffer.from('bounded quality photograph')
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const photo = await e2e.client.request(`/api/staff/v1/quality/checks/${requirementId}/photos`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': bootstrap.data.csrfToken,
      'idempotency-key': 'quality-photo-1',
      'if-match': `"${String(initial.data.expectedCheckVersion)}"`,
    },
    body: JSON.stringify({
      warehouseId: 'wh',
      stepPublicId: photoStepId,
      expectedVersion: initial.data.expectedCheckVersion,
      mimeType: 'image/jpeg',
      contentBase64: bytes.toString('base64'),
      checksum,
      altText: 'Received fruit lot',
    }),
  })
  assert.equal(photo.status, 200)
  const uploaded = (await photo.json()) as Envelope<Row>
  assert.match(String(uploaded.data.uploadPublicId), /^qpu_[0-9a-f]{40}$/)
  assert.notEqual(uploaded.data.expectedCheckVersion, initial.data.expectedCheckVersion)

  const stale = await e2e.client.request(`/api/staff/v1/quality/checks/${requirementId}/submit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': bootstrap.data.csrfToken,
      'idempotency-key': 'quality-submit-stale',
      'if-match': `"${String(initial.data.expectedCheckVersion)}"`,
    },
    body: JSON.stringify({
      warehouseId: 'wh',
      expectedVersion: initial.data.expectedCheckVersion,
      results: [{ stepPublicId: passStepId, value: true }],
    }),
  })
  assert.equal(stale.status, 409)

  const submitBody = JSON.stringify({
    warehouseId: 'wh',
    expectedVersion: uploaded.data.expectedCheckVersion,
    results: [
      { stepPublicId: passStepId, value: true },
      {
        stepPublicId: photoStepId,
        uploadPublicId: uploaded.data.uploadPublicId,
        checksum,
        altText: 'Received fruit lot',
      },
    ],
  })
  const submissions = await Promise.all(
    ['quality-submit-1', 'quality-submit-racing'].map((key) =>
      e2e.client.request(`/api/staff/v1/quality/checks/${requirementId}/submit`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': bootstrap.data.csrfToken,
          'idempotency-key': key,
          'if-match': `"${String(uploaded.data.expectedCheckVersion)}"`,
        },
        body: submitBody,
      }),
    ),
  )
  assert.deepEqual(submissions.map((response) => response.status).sort(), [200, 409])
  const submit = submissions.find((response) => response.status === 200)!
  const completed = (await submit.json()) as Envelope<Row>
  assert.equal(completed.data.state, 'passed')
  assert.equal((completed.data.attempt as Row).outcome, 'passed')

  const canonical = await e2e.client.json<Envelope<Row>>(`/api/staff/v1/quality/checks/${requirementId}`)
  assert.equal(canonical.data.state, 'passed')
  assert.equal((canonical.data.attempts as Row[]).length, 1)
})
