import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { defineDeployment, type Row, type Scope } from '@ketvietlab/ketjs'
import { createTestDeployment, type TestDeployment } from '@ketvietlab/ketjs/testing'
import {
  registerChannelIdentity,
  registerPosOfflineLeaseProvider,
  type PosIdentity,
} from '@ketvietlab/ketsuite'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const scope: Scope = { company: 'default', companies: ['default'], branches: null }
const posSyncDeployment = defineDeployment({
  name: 'pos_sync_test',
  modules: ketsuite.modules,
  headless: true,
  serve: {},
})

type Envelope<T> = {
  data: T
  error: { code: string } | null
  meta: { nextCursor: string | null }
}

const setup = async (t: TestContext, identity: () => PosIdentity) => {
  registerChannelIdentity('pos', async () => identity())
  const e2e = await createTestDeployment(posSyncDeployment, { worker: false })
  t.after(() => e2e.close())
  const call = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })

  await call('partner.savePartner', { id: 'company-party', kind: 'company', name: 'Offline Shop' })
  await call('company.saveCompany', { id: 'default', partnerId: 'company-party', currency: 'VND' })
  await call('user.createUser', {
    id: 'cashier',
    login: 'cashier',
    password: 'correct horse',
    name: 'Cashier',
    defaultCompanyId: 'default',
    superuser: true,
  })
  await call('user.grantCompany', {
    id: 'cashier:default',
    userId: 'cashier',
    companyId: 'default',
  })
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'goods',
    name: 'Goods',
    type: 'goods',
    uomId: 'unit',
    listPrice: '100',
    saleOk: true,
  })
  await call('product.saveVariant', {
    id: 'goods-1',
    templateId: 'goods',
    defaultCode: 'G1',
    combinationKey: '',
  })
  await call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await call('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' })
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await call('stock.adjustInventory', {
    id: 'adjust',
    productId: 'goods-1',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '10',
    productUomId: 'unit',
  })
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Revenue', 'income'],
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['cash', '1111', 'Cash', 'asset_cash'],
  ])
    await call('account.saveAccount', { id, code, name, accountType })
  await call('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' })
  await call('account.saveJournal', {
    id: 'cash-journal',
    name: 'Cash',
    code: 'CSH',
    type: 'cash',
    defaultAccountId: 'cash',
  })
  await call('pricing.savePricelist', { id: 'retail', name: 'Retail', currency: 'VND' })
  await call('pricing.savePricelistItem', {
    id: 'retail:goods',
    pricelistId: 'retail',
    appliedOn: '0_product_variant',
    productId: 'goods-1',
    computePrice: 'fixed',
    fixedPrice: '100',
  })
  await call('pos.saveConfig', {
    id: 'shop',
    name: 'Main Shop',
    warehouseId: 'wh',
    pricelistId: 'retail',
    salesJournalId: 'sales',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  await call('pos.savePaymentMethod', {
    id: 'cash-method',
    name: 'Cash',
    journalId: 'cash-journal',
    isCash: true,
  })
  await call('pos.linkPaymentMethod', {
    id: 'shop:cash',
    configId: 'shop',
    paymentMethodId: 'cash-method',
  })
  await call('pos.createSession', {
    id: 'shift-1',
    configId: 'shop',
    userId: 'cashier',
    deviceId: 'device-1',
    openingCash: '0',
  })
  await call('pos.openSession', { id: 'shift-1' })
  return { e2e, call }
}

const channel = async <T>(
  e2e: TestDeployment,
  path: string,
  init: RequestInit & { key?: string } = {},
): Promise<{ status: number; body: Envelope<T> }> => {
  const headers: Record<string, string> = {
    authorization: 'Bearer test-pos-session',
    'x-channel-realm': 'site:default:pos-test',
  }
  if (init.body) headers['content-type'] = 'application/json'
  if (init.key) headers['idempotency-key'] = init.key
  const response = await e2e.client.request(`/api/pos/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  })
  return { status: response.status, body: (await response.json()) as Envelope<T> }
}

const command = (
  commandId: string,
  sequence: number,
  operation: string,
  aggregateId: string,
  aggregateRevision: number,
  payload: Row,
  dependencyIds: string[] = [],
) => ({
  commandId,
  sequence,
  dependencyIds,
  aggregateType: 'order',
  aggregateId,
  aggregateRevision,
  operation,
  capturedAt: new Date().toISOString(),
  idempotencyKey: `${commandId}-key`,
  payload,
  signature: `test-signature-${commandId}`.padEnd(48, '0'),
})

const leaseToken = 'test-offline-lease-token'.padEnd(64, '0')
let issuedLease: Awaited<
  ReturnType<NonNullable<Parameters<typeof registerPosOfflineLeaseProvider>[0]['issue']>>
> = null
registerPosOfflineLeaseProvider({
  issue: async (_ctx, _url, _req, input) => {
    issuedLease = {
      token: leaseToken,
      claims: {
        leaseId: 'test-lease-1',
        companyId: input.identity.companyId,
        posConfigId: input.identity.posConfigId,
        deviceId: input.identity.deviceId,
        grantId: input.identity.grantId,
        operatorId: input.identity.operatorId,
        sessionId: input.identity.sessionId,
        deviceSecurityVersion: 1,
        grantSecurityVersion: 0,
        shiftId: input.shiftId,
        priceBookRevision: input.priceBookRevision,
        issuedAt: new Date(Date.now() - 1_000).toISOString(),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1_000).toISOString(),
        minSequence: input.minSequence,
        maxSequence: input.minSequence + 99,
        allowedOperationIds: [...input.allowedOperationIds],
        ceilings: { maxOrderTotal: '1000000', maxTenderAmount: '1000000' },
      },
    }
    return issuedLease
  },
  verify: async (_ctx, _url, _req, input) =>
    input.token === leaseToken &&
    issuedLease &&
    input.commands.every((held) => held.signature.startsWith('test-signature-'))
      ? {
          ok: true,
          claims: issuedLease.claims,
        }
      : { ok: false, code: 'syncLeaseInvalid' },
})

test('pos sync: bootstrap and dependency replay converge without duplicate retail side effects', async (t) => {
  let identity: PosIdentity = {
    operatorId: 'cashier',
    deviceId: 'device-1',
    companyId: 'default',
    posConfigId: 'shop',
    grantId: 'grant-1',
    sessionId: 'pos-session-1',
    securityVersion: 1,
    presentation: 'bearer',
  }
  const { e2e, call } = await setup(t, () => identity)
  const bootstrap = await channel<{
    revisions: Record<string, string>
    policy: {
      maxBatchSize: number
      requiresSignedLease: boolean
      requiresDeviceSignature: boolean
      onlineOnlyOperationIds: string[]
    }
    offlineLease: { token: string }
  }>(e2e, 'sync/bootstrap')
  assert.equal(bootstrap.status, 200, JSON.stringify(bootstrap.body))
  assert.equal(bootstrap.body.data.policy.maxBatchSize, 50)
  assert.equal(bootstrap.body.data.policy.requiresSignedLease, true)
  assert.equal(bootstrap.body.data.policy.requiresDeviceSignature, true)
  assert.equal(bootstrap.body.data.offlineLease.token, leaseToken)
  assert.ok(bootstrap.body.data.revisions.catalog)
  assert.ok(bootstrap.body.data.revisions.price)
  assert.ok(bootstrap.body.data.revisions.tax)
  assert.ok(bootstrap.body.data.revisions.paymentMethods)
  assert.ok(bootstrap.body.data.revisions.capabilities)
  assert.ok(bootstrap.body.data.policy.onlineOnlyOperationIds.includes('pos.orders.paymentAttempts.create'))

  const master = bootstrap.body.data.revisions.master
  const commands = [
    command('create-order-0001', 1, 'pos.orders.create', 'local-order-1', 0, {
      uuid: 'offline-order-1',
      shiftId: 'shift-1',
      priceBookRevision: master,
    }),
    command(
      'add-line-0000001',
      2,
      'pos.orders.lines.add',
      'command:create-order-0001',
      0,
      { productId: 'goods-1', uomId: 'unit', quantity: '1', quoteRevision: master },
      ['create-order-0001'],
    ),
    command(
      'add-tender-00001',
      3,
      'pos.orders.tenders.add',
      'command:create-order-0001',
      1,
      { paymentMethodId: 'cash-method', tenderedAmount: '100' },
      ['add-line-0000001', 'create-order-0001'],
    ),
    command('finalize-order01', 4, 'pos.orders.finalize', 'command:create-order-0001', 2, {}, [
      'add-tender-00001',
      'create-order-0001',
    ]),
  ]
  const invalidLease = await channel(e2e, 'sync/reconcile', {
    method: 'POST',
    key: 'offline-batch-invalid-lease',
    body: JSON.stringify({
      batchId: 'offline-batch-invalid-lease',
      leaseToken: 'invalid-offline-lease-token'.padEnd(64, '0'),
      commands,
    }),
  })
  assert.equal(invalidLease.status, 401)
  assert.equal(invalidLease.body.error?.code, 'pos.syncLeaseInvalid')

  const reconciled = await channel<{
    accepted: number
    replayed: number
    results: Array<{ status: string; projection: Row; entityId: string }>
  }>(e2e, 'sync/reconcile', {
    method: 'POST',
    key: 'offline-batch-0001',
    body: JSON.stringify({ batchId: 'offline-batch-0001', leaseToken, commands }),
  })
  assert.equal(reconciled.status, 200)
  assert.equal(reconciled.body.data.accepted, 4)
  assert.equal(reconciled.body.data.results[3]?.projection.state, 'paid')
  assert.ok(reconciled.body.meta.nextCursor)

  const replayed = await channel<{ accepted: number; replayed: number }>(e2e, 'sync/reconcile', {
    method: 'POST',
    key: 'offline-batch-0002',
    body: JSON.stringify({
      batchId: 'offline-batch-0002',
      leaseToken,
      resumeCursor: reconciled.body.meta.nextCursor,
      commands,
    }),
  })
  assert.equal(replayed.status, 200)
  assert.equal(replayed.body.data.accepted, 0)
  assert.equal(replayed.body.data.replayed, 4)

  const orders = (await call('pos.listOrders', {})).value as Row[]
  assert.equal(orders.length, 1)
  const order = (await call('pos.getOrder', { id: orders[0]?.id })).value as Row
  assert.equal(order.state, 'paid')
  assert.equal(((order.payments as Row[]) ?? []).length, 1)
  assert.ok(order.pickingId)
  assert.ok(order.accountMoveId)
  assert.ok(order.receiptId)

  const conflict = await channel<{
    conflicted: number
    results: Array<{ status: string; serverProjection: Row; allowedRecovery: string[] }>
  }>(e2e, 'sync/reconcile', {
    method: 'POST',
    key: 'offline-batch-0003',
    body: JSON.stringify({
      batchId: 'offline-batch-0003',
      leaseToken,
      resumeCursor: reconciled.body.meta.nextCursor,
      commands: [
        command(
          'stale-update-0001',
          5,
          'pos.orders.update',
          'command:create-order-0001',
          0,
          { note: 'stale' },
          ['create-order-0001'],
        ),
      ],
    }),
  })
  assert.equal(conflict.status, 200)
  assert.equal(conflict.body.data.conflicted, 1)
  assert.equal(conflict.body.data.results[0]?.status, 'conflict')
  assert.equal(conflict.body.data.results[0]?.serverProjection.state, 'paid')
  assert.ok(conflict.body.data.results[0]?.allowedRecovery.includes('reload_aggregate'))

  identity = { ...identity, deviceId: 'device-2', grantId: 'grant-2', sessionId: 'pos-session-2' }
  assert.ok(issuedLease)
  issuedLease = {
    ...issuedLease,
    claims: {
      ...issuedLease.claims,
      deviceId: identity.deviceId,
      grantId: identity.grantId,
      sessionId: identity.sessionId,
      minSequence: 1,
    },
  }
  const crossed = await channel<{ refused: number; results: Array<{ code: string }> }>(
    e2e,
    'sync/reconcile',
    {
      method: 'POST',
      key: 'offline-batch-0004',
      body: JSON.stringify({
        batchId: 'offline-batch-0004',
        leaseToken,
        commands: [
          command(
            'cross-device-001',
            1,
            'pos.orders.update',
            'command:create-order-0001',
            0,
            { note: 'must refuse' },
            ['create-order-0001'],
          ),
        ],
      }),
    },
  )
  assert.equal(crossed.status, 200, JSON.stringify(crossed.body))
  assert.equal(crossed.body.data.refused, 1)
  assert.equal(crossed.body.data.results[0]?.code, 'cross_device_dependency')
})
