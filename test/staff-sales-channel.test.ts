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
    id: 'salesperson',
    login: 'salesperson',
    password: 'correct horse battery',
    name: 'Salesperson',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'salesperson:acme',
    userId: 'salesperson',
    companyId: 'acme',
  })
  for (const [id, name, role] of [
    ['customer-a', 'An Nhiên', 'customer'],
    ['customer-b', 'Bình Minh', 'customer'],
    ['supplier', 'Chỉ Cung Cấp', 'supplier'],
  ]) {
    await fixture('partner.savePartner', { id, kind: 'company', name })
    await fixture('partner.grantRole', { id: `${id}:${role}`, partnerId: id, role })
  }
  return e2e
}

test('staff sales channel lists only customers with bounded cursor pagination', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/sales/customers')).status, 401)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/sales/customers?limit=1',
    )
  ).data
  assert.deepEqual(first.items, [{ id: 'customer-a', name: 'An Nhiên', kind: 'company' }])
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/sales/customers?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.deepEqual(second.items, [{ id: 'customer-b', name: 'Bình Minh', kind: 'company' }])
  assert.equal(second.nextCursor, null)
})

test('staff sales channel returns a read-only customer and hides non-customer partners', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'salesperson', password: 'correct horse battery' })

  const customer = await e2e.client.json<Envelope<Row>>('/api/staff/v1/sales/customers/customer-a')
  assert.deepEqual(customer.data, {
    id: 'customer-a',
    name: 'An Nhiên',
    kind: 'company',
    readOnly: true,
  })

  const supplier = await e2e.client.get('/api/staff/v1/sales/customers/supplier')
  assert.equal(supplier.status, 404)
  assert.equal(((await supplier.json()) as Envelope<null>).error?.code, 'sale_staff_channel.customerNotFound')
})
