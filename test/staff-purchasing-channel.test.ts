import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Envelope<T> = { data: T; error: { code: string } | null }

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
    id: 'purchaser',
    login: 'purchaser',
    password: 'correct horse battery',
    name: 'Purchaser',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'purchaser:acme',
    userId: 'purchaser',
    companyId: 'acme',
  })
  for (const [id, name, role] of [
    ['vendor-a', 'An Phát', 'supplier'],
    ['vendor-b', 'Bình An', 'supplier'],
    ['customer', 'Chỉ Mua Hàng', 'customer'],
  ]) {
    await fixture('partner.savePartner', { id, kind: 'company', name })
    await fixture('partner.grantRole', { id: `${id}:${role}`, partnerId: id, role })
  }
  return e2e
}

test('staff purchasing channel lists only vendors with bounded cursor pagination', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/purchasing/vendors')).status, 401)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/purchasing/vendors?limit=1',
    )
  ).data
  assert.deepEqual(first.items, [{ id: 'vendor-a', name: 'An Phát', kind: 'company' }])
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/purchasing/vendors?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.deepEqual(second.items, [{ id: 'vendor-b', name: 'Bình An', kind: 'company' }])
  assert.equal(second.nextCursor, null)
})

test('staff purchasing channel returns a read-only vendor and hides non-vendors', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'purchaser', password: 'correct horse battery' })

  const vendor = await e2e.client.json<Envelope<Row>>('/api/staff/v1/purchasing/vendors/vendor-a')
  assert.deepEqual(vendor.data, {
    id: 'vendor-a',
    name: 'An Phát',
    kind: 'company',
    readOnly: true,
  })

  const customer = await e2e.client.get('/api/staff/v1/purchasing/vendors/customer')
  assert.equal(customer.status, 404)
  assert.equal(
    ((await customer.json()) as Envelope<null>).error?.code,
    'purchase_staff_channel.vendorNotFound',
  )
})
