import { createCommerceTestDeployment as createTestDeployment } from './commerce-test-deployment.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { TestHttpError } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const deployment = defineDeployment({
  ...ketsuite,
  name: 'commerce_modal_permissions',
  permissions: {
    ...ketsuite.permissions,
    roleTemplates: {
      ...ketsuite.permissions?.roleTemplates,
      'test.purchase-reader': {
        version: 1,
        labels: { vi: 'Đọc mua hàng', en: 'Purchase reader' },
        bundles: [
          'purchase.view',
          'purchase_backend.view',
          'sale.view',
          'sale_backend.view',
          'stock.view',
          'stock_backend.view',
        ],
      },
    },
  },
})

test('Commerce purchase modal uses live managed grants and refuses cross-company records and mutations', async (t) => {
  const app = await createTestDeployment(deployment, { worker: false })
  t.after(() => app.close())
  const scope = (company: string) => ({ company, branch: `root:${company}`, branches: [`root:${company}`] })
  const setup = async <T = Row>(name: string, input: Record<string, unknown>, company = 'a') =>
    (await app.fixture.call(name, input, { scope: scope(company) })).value as T
  for (const company of ['a', 'b']) {
    await setup('partner.savePartner', { id: `${company}-party`, kind: 'company', name: company }, company)
    await setup(
      'company.saveCompany',
      { id: company, code: company, partnerId: `${company}-party`, currency: 'VND' },
      company,
    )
    await setup(
      'partner.savePartner',
      { id: `vendor-${company}`, kind: 'company', name: `Vendor ${company}` },
      company,
    )
    await setup(
      'stock.saveLocation',
      { id: `supplier-${company}`, name: 'Supplier', usage: 'supplier' },
      company,
    )
    await setup('stock.saveLocation', { id: `stock-${company}`, name: 'Stock', usage: 'internal' }, company)
    await setup(
      'stock.savePickingType',
      {
        id: `receipt-${company}`,
        name: 'Receipt',
        code: 'incoming',
        defaultLocationSrcId: `supplier-${company}`,
        defaultLocationDestId: `stock-${company}`,
      },
      company,
    )
    await setup(
      'purchase.createOrder',
      { id: `order-${company}`, partnerId: `vendor-${company}`, pickingTypeId: `receipt-${company}` },
      company,
    )
  }
  await setup('stock.saveWarehouse', { id: 'wh-a', name: 'Warehouse A', code: 'WHA' })
  await setup('sale.createOrder', { id: 'sale-a', partnerId: 'vendor-a', warehouseId: 'wh-a' })
  await setup('user.createUser', {
    id: 'reader',
    login: 'reader',
    name: 'Reader',
    password: 'correct horse',
    defaultCompanyId: 'a',
  })
  await setup('user.grantCompany', { id: 'reader-a', userId: 'reader', companyId: 'a' })
  const rev = (await setup('user.authorizationState', {})).revision
  const role = await setup('user.applyRoleTemplate', {
    roleId: 'purchase-reader',
    templateKey: 'test.purchase-reader',
    expectedRoleRevision: 0,
    expectedAuthorizationRevision: rev,
    idempotencyKey: 'apply-reader',
  })
  assert.equal(role.ok, true, JSON.stringify(role))
  const assigned = await setup('user.assignScopedRole', {
    id: 'reader-assignment',
    userId: 'reader',
    roleId: 'purchase-reader',
    scopeKind: 'company',
    companyId: 'a',
    expectedAuthorizationRevision: role.revision,
    idempotencyKey: 'assign-reader',
  })
  assert.equal(assigned.ok, true, JSON.stringify(assigned))
  await app.client.login({ login: 'reader', password: 'correct horse' })
  const page = await app.client.get('/admin/purchase/rfqs?lang=vi&q=')
  assert.equal(page.status, 200, await page.clone().text())
  const markup = await page.text()
  assert.match(markup, /record=purchase\.order%3Aorder-a/)
  assert.doesNotMatch(markup, /record=purchase\.order%3Anew/)
  const response = await app.client.get('/admin/purchase/record/order-a/context?lang=vi')
  assert.equal(response.status, 200)
  const context = (await response.json()) as {
    data: { record: Row; permissions: Record<string, boolean>; choices: Record<string, Row[]> }
    messages: Record<string, string>
  }
  assert.equal(context.data.record.id, 'order-a')
  assert.equal(context.data.permissions.createOrder, false)
  assert.equal(context.data.permissions.approveOrder, false)
  assert.deepEqual(context.data.choices.accounts, [])
  assert.deepEqual(context.data.choices.partners, [])
  assert.equal(context.messages['recordModal.close'], 'Đóng')
  assert.equal((await app.client.get('/admin/purchase/record/new/context')).status, 403)
  assert.equal((await app.client.get('/admin/purchase/record/order-b/context')).status, 404)
  const salesPage = await app.client.get('/admin/sales/quotations?lang=vi&q=')
  assert.equal(salesPage.status, 200, await salesPage.clone().text())
  assert.match(await salesPage.text(), /record=sale\.order%3Asale-a/)
  const saleResponse = await app.client.get('/admin/sales/record/sale-a/context?lang=en')
  assert.equal(saleResponse.status, 200)
  const saleContext = (await saleResponse.json()) as typeof context
  assert.equal(saleContext.messages['recordModal.close'], 'Close')
  assert.equal(saleContext.data.permissions.confirmOrder, false)
  assert.equal((await app.client.get('/admin/sales/record/new/context')).status, 403)
  await assert.rejects(
    () => app.client.call('purchase.cancelOrder', { id: 'order-a' }),
    (error: unknown) => error instanceof TestHttpError && error.status === 403,
  )
  const after = await setup('purchase.getOrder', { id: 'order-a' })
  assert.equal(after.state, 'draft')
  const stockPage = await app.client.get('/admin/stock/warehouses?lang=vi&q=')
  assert.equal(stockPage.status, 200)
  const stockMarkup = await stockPage.text()
  assert.match(stockMarkup, /record=stock.warehouse%3Awh-a/)
  assert.doesNotMatch(stockMarkup, /record=stock.warehouse%3Anew/)
  const stockResponse = await app.client.get('/admin/stock/record/warehouse/wh-a/context')
  assert.equal(stockResponse.status, 200)
  assert.equal(((await stockResponse.json()) as { data: { save: boolean } }).data.save, false)
  assert.equal((await app.client.get('/admin/stock/record/warehouse/new/context')).status, 403)
  const unassigned = await setup('user.unassignScopedRole', {
    userId: 'reader',
    roleId: 'purchase-reader',
    assignmentId: 'reader-assignment',
    scopeKey: 'company:a',
    expectedAuthorizationRevision: (await setup('user.authorizationState', {})).revision,
    idempotencyKey: 'unassign-reader',
  })
  assert.equal(unassigned.ok, true, JSON.stringify(unassigned))
  assert.equal((await app.client.get('/admin/purchase/record/order-a/context')).status, 403)
  assert.equal((await app.client.get('/admin/sales/record/sale-a/context')).status, 403)
  for (const branch of ['north', 'south']) {
    await setup('company.saveBranch', {
      id: branch,
      companyId: 'a',
      name: branch,
      code: branch,
      parentId: 'root:a',
    })
    await setup('user.grantBranch', { id: `reader-${branch}`, userId: 'reader', branchId: branch })
  }
  const branchRole = await setup('user.assignScopedRole', {
    id: 'reader-branch-assignment',
    userId: 'reader',
    roleId: 'purchase-reader',
    scopeKind: 'branch',
    companyId: 'a',
    branchId: 'north',
    expectedAuthorizationRevision: (await setup('user.authorizationState', {})).revision,
    idempotencyKey: 'assign-north',
  })
  assert.equal(branchRole.ok, true, JSON.stringify(branchRole))
  await setup('user.setDefaultContext', { userId: 'reader', companyId: 'a', branchId: 'north' })
  await app.client.login({ login: 'reader', password: 'correct horse' })
  assert.equal((await app.client.get('/admin/purchase/record/order-a/context')).status, 200)
  await setup('user.setDefaultContext', { userId: 'reader', companyId: 'a', branchId: 'south' })
  await app.client.login({ login: 'reader', password: 'correct horse' })
  assert.equal((await app.client.get('/admin/purchase/record/order-a/context')).status, 403)
  assert.equal((await app.client.get('/admin/stock/record/warehouse/wh-a/context')).status, 403)
  await setup('user.createUser', {
    id: 'buyer',
    login: 'buyer',
    name: 'Buyer',
    password: 'correct horse',
    defaultCompanyId: 'a',
  })
  await setup('user.grantCompany', { id: 'buyer-a', userId: 'buyer', companyId: 'a' })
  const buyerRole = await setup('user.applyRoleTemplate', {
    roleId: 'buyer-role',
    templateKey: 'commerce.purchasing-operator',
    expectedRoleRevision: 0,
    expectedAuthorizationRevision: (await setup('user.authorizationState', {})).revision,
    idempotencyKey: 'buyer-role',
  })
  assert.equal(buyerRole.ok, true, JSON.stringify(buyerRole))
  await setup('user.assignScopedRole', {
    id: 'buyer-grant',
    userId: 'buyer',
    roleId: 'buyer-role',
    scopeKind: 'company',
    companyId: 'a',
    expectedAuthorizationRevision: buyerRole.revision,
    idempotencyKey: 'buyer-grant',
  })
  await app.client.login({ login: 'buyer', password: 'correct horse' })
  const createContext = await app.client.get('/admin/purchase/record/new/context?lang=vi')
  assert.equal(createContext.status, 200)
  const buyerContext = (await createContext.json()) as typeof context
  assert.equal(buyerContext.data.permissions.approveOrder, false)
  assert.ok(buyerContext.data.choices.partners.length)
  const created = await app.client.call<{ ok: boolean }>('purchase.createOrder', {
    id: 'buyer-order',
    partnerId: 'vendor-a',
    pickingTypeId: 'receipt-a',
  })
  assert.equal(created.value.ok, true)
  await assert.rejects(
    () => app.client.call('purchase.approveOrder', { id: 'buyer-order' }),
    (error: unknown) => error instanceof TestHttpError && error.status === 403,
  )
  assert.equal((await app.client.get('/admin/purchase/record/order-b/context')).status, 404)
})
