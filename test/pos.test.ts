import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bootDeployment,
  callFn,
  compose,
  defineDeployment,
  migrateOne,
  registerFunctions,
  schemaFromManifest,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import {
  account,
  channelApi,
  company,
  partner,
  pos,
  posChannel,
  POS_ORDER_STATES,
  POS_SESSION_STATES,
  pricing,
  product,
  stock,
  uom,
  user,
  website,
} from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const modules = [
  website,
  address,
  partner,
  company,
  user,
  channelApi,
  uom,
  product,
  pricing,
  stock,
  account,
  pos,
  posChannel,
]
const manifest = compose(modules, { headless: true }),
  scope = { company: 'acme', branches: null }
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, {
    adapter,
    manifest,
    scope,
    correlationId: `test:${name}:${String(args.id ?? args.sessionId ?? 'read')}`,
  })

test('pos: provider payment primitives stay behind an internal integration seam', async () => {
  const names = [
    'pos.lockProviderPayment',
    'pos.unlockProviderPayment',
    'pos.settleProviderPayment',
    'pos.reviewProviderPayment',
    'pos.reverseProviderPayment',
  ]
  for (const name of names) assert.equal(manifest.functions[name]?.exposure, 'internal', name)

  const deployment = defineDeployment({
    name: 'pos_payment_internal_test',
    modules,
    headless: true,
    serve: {},
  })
  const booted = await bootDeployment(deployment, { env: { KET_SQLITE: ':memory:' }, port: 0 })
  try {
    for (const name of names) {
      const response = await fetch(`http://127.0.0.1:${booted.port}/_ket/fn/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      assert.equal(response.status, 400, name)
      assert.equal(((await response.json()) as { code: string }).code, 'E_FUNCTION_INTERNAL', name)
    }
  } finally {
    await booted.close()
  }
})

test('pos: stock moves are indexed by their originating order line', () => {
  const indexes = Object.values(schemaFromManifest(manifest).tables.stock_move!.indexes)
  assert.ok(indexes.some((index) => index.fields.join(',') === 'companyId,posLineId'))
})

test('pos: optional loyalty integration fields belong to the core order schema', () => {
  const order = manifest.models['pos.Order']!
  const line = manifest.models['pos.OrderLine']!
  assert.equal(order.fields.loyaltyState?.base, 'text')
  assert.equal(order.fields.loyaltyPointsEarned?.base, 'decimal')
  assert.equal(order.fields.loyaltyPointsSpent?.base, 'decimal')
  assert.equal(line.fields.lineKind?.base, 'text')
  assert.equal(line.fields.loyaltyApplicationId?.base, 'text')
  assert.equal(line.fields.loyaltyRewardId?.base, 'text')
  assert.equal(line.fields.loyaltyPointsCost?.base, 'decimal')
})

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' }, adapter)
  await call(
    'company.saveCompany',
    {
      id: 'acme',
      partnerId: 'acme-party',
      currency: 'VND',
      accountingTimezone: 'Asia/Ho_Chi_Minh',
    },
    adapter,
  )
  await call(
    'user.createUser',
    { id: 'cashier', login: 'cashier', password: 'correct horse', name: 'Cashier', defaultCompanyId: 'acme' },
    adapter,
  )
  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' }, adapter)
  await call(
    'product.saveTemplate',
    { id: 'goods', name: 'Goods', type: 'goods', uomId: 'unit', listPrice: '100', saleOk: true },
    adapter,
  )
  await call(
    'product.saveVariant',
    { id: 'goods-1', templateId: 'goods', defaultCode: 'G1', combinationKey: '' },
    adapter,
  )
  await call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' }, adapter)
  await call('stock.saveWarehouse', { id: 'wh', name: 'Main', code: 'WH' }, adapter)
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' }, adapter)
  await call(
    'stock.adjustInventory',
    {
      id: 'adjust',
      productId: 'goods-1',
      locationId: 'wh:stock',
      inventoryLocationId: 'inventory',
      countedQuantity: '10',
      productUomId: 'unit',
    },
    adapter,
  )
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Revenue', 'income'],
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['tax', '3331', 'VAT', 'liability_current'],
    ['cash', '1111', 'Cash', 'asset_cash'],
    ['cash-over-short', '8118', 'Cash over short', 'expense'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call('account.saveJournal', { id: 'sales', name: 'Sales', code: 'SAL', type: 'sale' }, adapter)
  await call(
    'account.saveJournal',
    { id: 'cash-journal', name: 'Cash', code: 'CSH', type: 'cash', defaultAccountId: 'cash' },
    adapter,
  )
  await call(
    'account.saveTax',
    { id: 'vat10', name: 'VAT 10%', typeTaxUse: 'sale', amountType: 'percent', amount: '10' },
    adapter,
  )
  await call('account.setProductTax', { templateId: 'goods', taxId: 'vat10' }, adapter)
  await call('pricing.savePricelist', { id: 'retail', name: 'Retail' }, adapter)
  await call(
    'pricing.savePricelistItem',
    {
      id: 'retail:goods',
      pricelistId: 'retail',
      appliedOn: '0_product_variant',
      productId: 'goods-1',
      computePrice: 'fixed',
      fixedPrice: '90',
    },
    adapter,
  )
  await call(
    'pos.saveConfig',
    {
      id: 'shop',
      name: 'Main Shop',
      warehouseId: 'wh',
      pricelistId: 'retail',
      salesJournalId: 'sales',
      revenueAccountId: 'revenue',
      receivableAccountId: 'receivable',
      taxAccountId: 'tax',
      cashOverShortAccountId: 'cash-over-short',
      maximumDifference: '0',
    },
    adapter,
  )
  await call(
    'pos.savePaymentMethod',
    { id: 'cash-method', name: 'Cash', journalId: 'cash-journal', isCash: true },
    adapter,
  )
  await call(
    'pos.linkPaymentMethod',
    { id: 'shop:cash', configId: 'shop', paymentMethodId: 'cash-method' },
    adapter,
  )
  return adapter
}

test('pos: exact session/order states, pricing, payment, stock and accounting form one retail flow', async () => {
  const adapter = await boot()
  try {
    assert.deepEqual(POS_SESSION_STATES, [
      'opening_control',
      'opened',
      'closing_control',
      'pending_approval',
      'closed',
    ])
    assert.deepEqual(POS_ORDER_STATES, ['draft', 'cancel', 'paid', 'done'])
    await call(
      'pos.createSession',
      { id: 'session-1', configId: 'shop', userId: 'cashier', openingCash: '10' },
      adapter,
    )
    await call('pos.openSession', { id: 'session-1' }, adapter)
    await call(
      'pos.createOrder',
      { id: 'order-1', uuid: 'offline-uuid-1', sessionId: 'session-1', partnerId: 'customer' },
      adapter,
    )
    const line = (
      await call(
        'pos.addLine',
        {
          id: 'line-1',
          orderId: 'order-1',
          productId: 'goods-1',
          productUomId: 'unit',
          qty: '1',
        },
        adapter,
      )
    ).value as Row
    assert.equal(line.priceUnit, '90')
    assert.deepEqual(
      Object.values(
        (
          await adapter.all(
            'SELECT "amountUntaxed", "amountTax", "amountTotal" FROM pos_order WHERE id = ?',
            ['order-1'],
          )
        )[0]!,
      ),
      ['90', '9', '99'],
    )
    let lineUpdates = 0
    let taxReads = 0
    const recording: Adapter = {
      ...adapter,
      async all(sql, params) {
        if (sql.includes('FROM account_tax')) taxReads++
        return adapter.all(sql, params)
      },
      async run(sql, params) {
        if (sql.startsWith('UPDATE pos_order_line')) lineUpdates++
        return adapter.run(sql, params)
      },
    }
    await call(
      'pos.addPayment',
      { id: 'payment-1', orderId: 'order-1', paymentMethodId: 'cash-method', amount: '99' },
      recording,
    )
    assert.equal(
      taxReads,
      0,
      'payment recomputation uses stored line totals instead of reloading tax per line',
    )
    assert.equal(lineUpdates, 0, 'payment recomputation does not rewrite every order line')
    const paid = (await call('pos.validateOrder', { id: 'order-1' }, adapter)).value as Row
    assert.equal(paid.state, 'paid')
    assert.equal(paid.pickingId, 'order-1:picking')
    assert.equal(
      (
        await adapter.all('SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?', [
          'goods-1',
          'wh:stock',
        ])
      )[0]!.quantity,
      '9',
    )
    const move = (await adapter.all('SELECT state FROM account_move WHERE id = ?', ['order-1:account']))[0]!
    assert.equal(move.state, 'posted')
    const totals = await adapter.all('SELECT debit, credit FROM account_move_line WHERE "moveId" = ?', [
      'order-1:account',
    ])
    assert.equal(
      totals.reduce((sum, row) => sum + Number(row.debit), 0),
      99,
    )
    assert.equal(
      totals.reduce((sum, row) => sum + Number(row.credit), 0),
      99,
    )
    await call('pos.startClosing', { id: 'session-1' }, adapter)
    const closed = (await call('pos.closeSession', { id: 'session-1', closingCash: '109' }, adapter))
      .value as Row
    assert.equal(closed.difference, '0')
    assert.equal(
      (await adapter.all('SELECT state FROM pos_order WHERE id = ?', ['order-1']))[0]!.state,
      'done',
    )
  } finally {
    await adapter.close()
  }
})

test('pos: money remains exact above the JavaScript safe-integer boundary', async () => {
  const adapter = await boot()
  try {
    await call(
      'pos.createSession',
      { id: 'exact-shift', configId: 'shop', userId: 'cashier', openingCash: '0' },
      adapter,
    )
    await call('pos.openSession', { id: 'exact-shift', expectedRevision: 0 }, adapter)
    await call(
      'pos.createOrder',
      { id: 'exact-sale', sessionId: 'exact-shift', partnerId: 'customer' },
      adapter,
    )
    await call(
      'pos.addLine',
      {
        id: 'exact-line',
        orderId: 'exact-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        priceUnit: '9007199254740993',
        expectedRevision: 0,
      },
      adapter,
    )
    const order = (await call('pos.getOrder', { id: 'exact-sale' }, adapter)).value as Row
    assert.equal(order.amountUntaxed, '9007199254740993')
    assert.equal(order.amountTax, '900719925474099')
    assert.equal(order.amountTotal, '9907919180215092')

    const conflictingLine = (
      await call(
        'pos.addLine',
        {
          id: 'exact-line',
          orderId: 'exact-sale',
          productId: 'goods-1',
          productUomId: 'unit',
          qty: '1',
          priceUnit: '9007199254740992',
        },
        adapter,
      )
    ).value as Row
    assert.equal(conflictingLine.ok, false)
    assert.equal((conflictingLine.errors as Row[])[0]?.field, 'id')

    const tender = (
      await call(
        'pos.addPayment',
        {
          id: 'exact-payment',
          orderId: 'exact-sale',
          paymentMethodId: 'cash-method',
          tenderedAmount: '9907919180215093',
          expectedRevision: 1,
        },
        adapter,
      )
    ).value as Row
    assert.equal(tender.appliedAmount, '9907919180215092')
    assert.equal(tender.change, '1')

    const conflictingTender = (
      await call(
        'pos.addPayment',
        {
          id: 'exact-payment',
          orderId: 'exact-sale',
          paymentMethodId: 'cash-method',
          tenderedAmount: '9907919180215092',
          expectedRevision: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(conflictingTender.ok, false)
    assert.equal((conflictingTender.errors as Row[])[0]?.field, 'id')

    const paid = (await call('pos.validateOrder', { id: 'exact-sale', expectedRevision: 2 }, adapter))
      .value as Row
    assert.equal(paid.state, 'paid')
    assert.equal(
      ((await call('pos.getSession', { id: 'exact-shift' }, adapter)).value as Row).cashRegisterBalanceEnd,
      '9907919180215092',
    )
    await call('pos.startClosing', { id: 'exact-shift', expectedRevision: 1 }, adapter)
    const closed = (
      await call(
        'pos.closeSession',
        { id: 'exact-shift', closingCash: '9907919180215092', expectedRevision: 2 },
        adapter,
      )
    ).value as Row
    assert.equal(closed.difference, '0')
  } finally {
    await adapter.close()
  }
})

test('pos: price-book exposes only active sellable products and explicitly enabled units', async () => {
  const adapter = await boot()
  try {
    await call(
      'uom.saveUnit',
      { id: 'box', name: 'Box', relativeUomId: 'unit', relativeFactor: '10' },
      adapter,
    )
    await call('pos.createSession', { id: 'catalog-session', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'catalog-session' }, adapter)
    await call('pos.createOrder', { id: 'catalog-order', sessionId: 'catalog-session' }, adapter)
    const refused = (
      await call(
        'pos.addLine',
        {
          id: 'catalog-line',
          orderId: 'catalog-order',
          productId: 'goods-1',
          productUomId: 'box',
          qty: '1',
        },
        adapter,
      )
    ).value as Row
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]?.field, 'productUomId')

    const first = (await call('pos_channel.priceBook', { posConfigId: 'shop' }, adapter)).value as Row
    const second = (await call('pos_channel.priceBook', { posConfigId: 'shop' }, adapter)).value as Row
    assert.equal(first.revision, second.revision)
    assert.equal((first.products as Row[]).length, 1)
    const offered = (first.products as Row[])[0]!
    assert.equal(offered.id, 'goods-1')
    assert.equal(offered.tracking, 'none')
    assert.equal(offered.listPrice, 90)
    const firstPrice = (offered.prices as Row[])[0]!
    assert.equal((firstPrice.taxIds as string[])[0], 'vat10')
    assert.equal(firstPrice.amountTotal, '99')
    assert.deepEqual(
      (offered.uoms as Row[]).map((unit) => unit.id),
      ['unit'],
    )
    assert.equal(JSON.stringify(first).includes('standardPrice'), false)

    await adapter.run('UPDATE product_product SET active = ? WHERE id = ?', [false, 'goods-1'])
    const changed = (await call('pos_channel.priceBook', { posConfigId: 'shop' }, adapter)).value as Row
    assert.notEqual(changed.revision, first.revision)
    assert.deepEqual(changed.products, [])
  } finally {
    await adapter.close()
  }
})

test('pos: revisioned cart commands reject stale and cross-order edits', async () => {
  const adapter = await boot()
  try {
    await call('pos.createSession', { id: 'revision-shift', configId: 'shop', userId: 'cashier' }, adapter)
    const opened = (await call('pos.openSession', { id: 'revision-shift', expectedRevision: 0 }, adapter))
      .value as Row
    assert.equal(opened.revision, 1)
    await call('pos.createOrder', { id: 'cart-a', sessionId: 'revision-shift' }, adapter)
    await call('pos.createOrder', { id: 'cart-b', sessionId: 'revision-shift' }, adapter)

    const added = (
      await call(
        'pos.addLine',
        {
          id: 'cart-a:line',
          orderId: 'cart-a',
          productId: 'goods-1',
          productUomId: 'unit',
          qty: '1',
          expectedRevision: 0,
        },
        adapter,
      )
    ).value as Row
    assert.equal(added.revision, 1)

    const foreign = (
      await call(
        'pos.addLine',
        {
          id: 'cart-a:line',
          orderId: 'cart-b',
          productId: 'goods-1',
          productUomId: 'unit',
          qty: '1',
          expectedRevision: 0,
        },
        adapter,
      )
    ).value as Row
    assert.equal(foreign.ok, false)

    const stale = (
      await call(
        'pos.updateLine',
        { id: 'cart-a:line', orderId: 'cart-a', qty: '2', expectedRevision: 0 },
        adapter,
      )
    ).value as Row
    assert.equal(stale.ok, false)
    assert.equal((stale.errors as Row[])[0]!.field, 'expectedRevision')

    const updated = (
      await call(
        'pos.updateLine',
        { id: 'cart-a:line', orderId: 'cart-a', qty: '2', expectedRevision: 1 },
        adapter,
      )
    ).value as Row
    assert.equal(updated.revision, 2)
    const order = (await call('pos.getOrder', { id: 'cart-a' }, adapter)).value as Row
    assert.equal(order.amountTotal, '198')

    const header = (
      await call('pos.updateOrder', { id: 'cart-a', expectedRevision: 2, note: 'fragile' }, adapter)
    ).value as Row
    assert.equal(header.revision, 3)
    const reordered = (
      await call('pos.reorderLines', { id: 'cart-a', expectedRevision: 3, lineIds: ['cart-a:line'] }, adapter)
    ).value as Row
    assert.equal(reordered.revision, 4)
    const removed = (
      await call('pos.removeLine', { id: 'cart-a:line', orderId: 'cart-a', expectedRevision: 4 }, adapter)
    ).value as Row
    assert.equal(removed.revision, 5)
    assert.equal(((await call('pos.getOrder', { id: 'cart-a' }, adapter)).value as Row).amountTotal, '0')

    await call('pos.cancelOrder', { id: 'cart-a', expectedRevision: 5 }, adapter)
    await call('pos.cancelOrder', { id: 'cart-b', expectedRevision: 0 }, adapter)
    const closing = (await call('pos.startClosing', { id: 'revision-shift', expectedRevision: 1 }, adapter))
      .value as Row
    assert.equal(closing.revision, 2)
    const staleClose = (
      await call('pos.closeSession', { id: 'revision-shift', expectedRevision: 1, closingCash: '0' }, adapter)
    ).value as Row
    assert.equal(staleClose.ok, false)
    const closed = (
      await call('pos.closeSession', { id: 'revision-shift', expectedRevision: 2, closingCash: '0' }, adapter)
    ).value as Row
    assert.equal(closed.revision, 3)
  } finally {
    await adapter.close()
  }
})

test('pos: concurrent shift creation keeps one active shift per configuration', async () => {
  const adapter = await boot()
  try {
    const [first, second] = await Promise.all([
      call('pos.createSession', { id: 'shift-a', configId: 'shop', userId: 'cashier' }, adapter),
      call('pos.createSession', { id: 'shift-b', configId: 'shop', userId: 'cashier' }, adapter),
    ])
    const answers = [first.value as Row, second.value as Row]
    assert.equal(answers.filter((answer) => answer.ok === true).length, 1)
    assert.equal(answers.filter((answer) => answer.ok === false).length, 1)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM pos_session'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('pos: sensitive commands append one retry-stable operational audit event', async () => {
  const adapter = await boot()
  try {
    await call(
      'pos.createSession',
      {
        id: 'audit-shift',
        configId: 'shop',
        userId: 'cashier',
        deviceId: 'device-1',
        openingCash: '0',
      },
      adapter,
    )
    await call('pos.openSession', { id: 'audit-shift', expectedRevision: 0 }, adapter)
    const movement = {
      id: 'audit-cash-in',
      sessionId: 'audit-shift',
      direction: 'in',
      amount: '5',
      reason: 'Petty cash float',
      actorId: 'cashier',
      deviceId: 'device-1',
      expectedRevision: 1,
    }
    await call('pos.recordCashMovement', movement, adapter)
    await call('pos.recordCashMovement', movement, adapter)
    await call(
      'pos.reverseCashMovement',
      {
        id: 'audit-cash-reversal',
        sessionId: 'audit-shift',
        movementId: 'audit-cash-in',
        expectedRevision: 2,
        reason: 'Float entered twice',
        actorId: 'manager',
        deviceId: 'device-1',
      },
      adapter,
    )

    await call(
      'pos.createOrder',
      {
        id: 'audit-order',
        sessionId: 'audit-shift',
        operatorId: 'cashier',
        deviceId: 'device-1',
      },
      adapter,
    )
    await call(
      'pos.addLine',
      {
        id: 'audit-line',
        orderId: 'audit-order',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        expectedRevision: 0,
      },
      adapter,
    )
    await call(
      'pos.updateLine',
      {
        id: 'audit-line',
        orderId: 'audit-order',
        qty: '1',
        discount: '10',
        overrideReason: 'Damaged packaging',
        overrideBy: 'manager',
        expectedRevision: 1,
      },
      adapter,
    )
    await call('pos.cancelOrder', { id: 'audit-order', expectedRevision: 2 }, adapter)
    await call('pos.startClosing', { id: 'audit-shift', expectedRevision: 3 }, adapter)
    await call('pos.closeSession', { id: 'audit-shift', closingCash: '0', expectedRevision: 4 }, adapter)
    await call('pos.closeSession', { id: 'audit-shift', closingCash: '0', expectedRevision: 5 }, adapter)

    const events = (await call('pos.listAuditEvents', { limit: 200 }, adapter)).value as Row[]
    assert.equal(events.length, 8)
    assert.deepEqual(
      new Set(events.map((event) => event.action)),
      new Set([
        'session.created',
        'session.opened',
        'cash_movement.recorded',
        'cash_movement.reversed',
        'order.line_adjusted',
        'order.cancelled',
        'session.closing_started',
        'session.closed',
      ]),
    )
    const adjusted = events.find((event) => event.action === 'order.line_adjusted')!
    assert.ok(events.every((event) => event.configId === 'shop' && event.sessionId === 'audit-shift'))
    assert.equal(adjusted.actorId, 'manager')
    assert.equal(adjusted.deviceId, 'device-1')
    assert.equal(adjusted.reason, 'Damaged packaging')
    assert.equal((adjusted.details as Row).previousDiscount, '0')
    assert.equal((adjusted.details as Row).discount, '10')
    assert.ok(events.every((event) => String(event.correlationHash).length === 64))
    assert.ok(events.every((event) => String(event.subjectHash).length === 64))
    assert.equal(JSON.stringify(events).includes('test:pos.'), false)

    const sessionEvents = (
      await call(
        'pos.listAuditEvents',
        { subjectType: 'session', subjectId: 'audit-shift', limit: 2 },
        adapter,
      )
    ).value as Row[]
    assert.equal(sessionEvents.length, 2)
    assert.ok(sessionEvents.every((event) => event.subjectId === 'audit-shift'))
    assert.equal(events.filter((event) => event.id === 'cash-movement:audit-cash-in:recorded').length, 1)
    const otherCompany = await callFn(
      'pos.listAuditEvents',
      {},
      { adapter, manifest, scope: { company: 'other-company', branches: null } },
    )
    assert.deepEqual(otherCompany.value, [])
  } finally {
    await adapter.close()
  }
})

test('pos: operations report is date-bounded, configuration-scoped and aggregated in the database', async () => {
  const adapter = await boot()
  try {
    await call(
      'pos.saveConfig',
      {
        id: 'branch-shop',
        name: 'Branch Shop',
        warehouseId: 'wh',
        pricelistId: 'retail',
        salesJournalId: 'sales',
        revenueAccountId: 'revenue',
        receivableAccountId: 'receivable',
        taxAccountId: 'tax',
        cashOverShortAccountId: 'cash-over-short',
        maximumDifference: '0',
      },
      adapter,
    )
    await call(
      'pos.linkPaymentMethod',
      { id: 'branch-shop:cash', configId: 'branch-shop', paymentMethodId: 'cash-method' },
      adapter,
    )

    for (const [configId, shiftId, orderId] of [
      ['shop', 'report-main-shift', 'report-main-order'],
      ['branch-shop', 'report-branch-shift', 'report-branch-order'],
    ]) {
      await call('pos.createSession', { id: shiftId, configId, userId: 'cashier' }, adapter)
      await call('pos.openSession', { id: shiftId, expectedRevision: 0 }, adapter)
      await call('pos.createOrder', { id: orderId, sessionId: shiftId }, adapter)
      await call(
        'pos.addLine',
        {
          id: `${orderId}:line`,
          orderId,
          productId: 'goods-1',
          productUomId: 'unit',
          qty: '1',
          expectedRevision: 0,
        },
        adapter,
      )
      await call(
        'pos.addPayment',
        {
          id: `${orderId}:payment`,
          orderId,
          paymentMethodId: 'cash-method',
          amount: '99',
          expectedRevision: 1,
        },
        adapter,
      )
      await call('pos.validateOrder', { id: orderId, expectedRevision: 2 }, adapter)
    }

    await call(
      'pos.recordCashMovement',
      {
        id: 'report-float',
        sessionId: 'report-main-shift',
        direction: 'in',
        amount: '5',
        reason: 'Add float',
        actorId: 'cashier',
        expectedRevision: 1,
      },
      adapter,
    )
    await call(
      'pos.reverseCashMovement',
      {
        id: 'report-float-reversal',
        sessionId: 'report-main-shift',
        movementId: 'report-float',
        reason: 'Wrong register',
        actorId: 'manager',
        expectedRevision: 2,
      },
      adapter,
    )

    const civil = Object.fromEntries(
      new Intl.DateTimeFormat('en', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(new Date())
        .map((part) => [part.type, part.value]),
    )
    const today = `${civil.year}-${civil.month}-${civil.day}`
    const scoped = (
      await call(
        'pos.operationsReport',
        { dateFrom: today, dateTo: today, configId: 'shop', auditLimit: 1 },
        adapter,
      )
    ).value as Row
    assert.equal(scoped.ok, true)
    const report = scoped.report as Row
    const reportScope = report.scope as Row
    assert.equal(reportScope.configId, 'shop')
    assert.equal(reportScope.timezone, 'Asia/Ho_Chi_Minh')
    assert.deepEqual(report.scopeCoverage, {
      complete: true,
      missingPaymentScope: 0,
      missingPaymentCurrency: 0,
      missingMovementScope: 0,
      missingAuditScope: 0,
      missingOrderFinalizedAt: 0,
      missingAuditCorrelation: 0,
    })
    assert.deepEqual((report.orders as Row).sales, [
      {
        currency: 'VND',
        saleCount: 1,
        returnCount: 0,
        grossSales: '99',
        refunds: '0',
        netSales: '99',
      },
    ])
    assert.deepEqual(report.tenders, [
      { state: 'captured', kind: 'cash', currency: 'VND', count: 1, amount: '99' },
    ])
    assert.deepEqual(report.cash, {
      currency: 'VND',
      count: 2,
      cashIn: '5',
      cashOut: '5',
      net: '0',
    })
    assert.equal((report.shifts as Row).opened, 1)
    assert.equal((report.exceptions as Row).reversedCashMovements, 1)
    assert.equal(((report.audit as Row).events as Row[]).length, 1)
    assert.equal((report.audit as Row).truncated, true)
    const projected = ((report.audit as Row).events as Row[])[0]!
    assert.equal(String(projected.id).length, 64)
    assert.equal(String(projected.subjectHash).length, 64)
    assert.equal(String(projected.correlationHash).length, 64)
    assert.equal(String(projected.actorHash).length, 64)
    assert.equal('actorId' in projected, false)
    assert.equal('subjectId' in projected, false)
    assert.equal('relatedId' in projected, false)
    assert.equal('details' in projected, false)
    const traceCoverage = (report.observability as Row).traceCoverage as Row
    assert.ok(Number(traceCoverage.coreAuditTotal) > 0)
    assert.equal(traceCoverage.coreTraceGaps, 0)
    assert.equal(traceCoverage.ratio, 1)

    const all = (await call('pos.operationsReport', { dateFrom: today, dateTo: today }, adapter)).value as Row
    assert.deepEqual(((all.report as Row).orders as Row).sales, [
      {
        currency: 'VND',
        saleCount: 2,
        returnCount: 0,
        grossSales: '198',
        refunds: '0',
        netSales: '198',
      },
    ])

    const audit = (
      await call(
        'pos.listAuditEvents',
        {
          configId: 'shop',
          sessionId: 'report-main-shift',
          from: reportScope.from,
          to: reportScope.toExclusive,
          limit: 200,
        },
        adapter,
      )
    ).value as Row[]
    assert.ok(audit.length > 0)
    assert.ok(audit.every((event) => event.configId === 'shop' && event.sessionId === 'report-main-shift'))

    await adapter.run('UPDATE pos_payment SET "configId" = NULL, currency = NULL WHERE id = ?', [
      'report-main-order:payment',
    ])
    await adapter.run('UPDATE pos_order SET "finalizedAt" = NULL WHERE id = ?', ['report-main-order'])
    await adapter.run('UPDATE pos_audit_event SET "correlationHash" = NULL WHERE id = ?', [
      'cash-movement:report-float:recorded',
    ])
    const legacy = (
      await call('pos.operationsReport', { dateFrom: today, dateTo: today, configId: 'shop' }, adapter)
    ).value as Row
    assert.equal(((legacy.report as Row).scopeCoverage as Row).complete as boolean, false)
    assert.equal(((legacy.report as Row).scopeCoverage as Row).missingPaymentScope, 1)
    assert.equal(((legacy.report as Row).scopeCoverage as Row).missingPaymentCurrency, 1)
    assert.equal(((legacy.report as Row).scopeCoverage as Row).missingOrderFinalizedAt, 1)
    assert.equal(((legacy.report as Row).scopeCoverage as Row).missingAuditCorrelation, 1)
    assert.equal((((legacy.report as Row).observability as Row).traceCoverage as Row).coreTraceGaps, 1)

    const tooWide = (
      await call('pos.operationsReport', { dateFrom: '2026-01-01', dateTo: '2026-02-01' }, adapter)
    ).value as Row
    assert.equal(tooWide.ok, false)
    assert.equal((tooWide.errors as Row[])[0]?.field, 'dateTo')
  } finally {
    await adapter.close()
  }
})

test('pos: cash tender separates applied amount and change and always posts a Vietnam invoice', async () => {
  const adapter = await boot()
  try {
    await call('pos.createSession', { id: 'invoice-shift', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'invoice-shift', expectedRevision: 0 }, adapter)
    await call('pos.createOrder', { id: 'anonymous-sale', sessionId: 'invoice-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'anonymous-sale:line',
        orderId: 'anonymous-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        expectedRevision: 0,
      },
      adapter,
    )
    const tender = (
      await call(
        'pos.addPayment',
        {
          id: 'anonymous-sale:cash',
          orderId: 'anonymous-sale',
          paymentMethodId: 'cash-method',
          tenderedAmount: '120',
          expectedRevision: 1,
        },
        adapter,
      )
    ).value as Row
    assert.equal(tender.appliedAmount, '99')
    assert.equal(tender.change, '21')
    assert.equal(tender.revision, 2)
    const paid = (await call('pos.getOrder', { id: 'anonymous-sale' }, adapter)).value as Row
    assert.equal(paid.amountPaid, '99')
    assert.equal(paid.amountReturn, '21')

    const finalized = (
      await call('pos.validateOrder', { id: 'anonymous-sale', expectedRevision: 2 }, adapter)
    ).value as Row
    assert.equal(finalized.ok, true)
    assert.equal(finalized.revision, 3)
    const order = (await call('pos.getOrder', { id: 'anonymous-sale' }, adapter)).value as Row
    const buyer = (await adapter.all('SELECT name FROM partner_partner WHERE id = ?', [order.partnerId]))[0]
    const move = (
      await adapter.all('SELECT "moveType", "partnerId" FROM account_move WHERE id = ?', [
        order.accountMoveId,
      ])
    )[0]
    assert.equal(buyer?.name, 'Bán cho người tiêu dùng')
    assert.equal(move?.moveType, 'out_invoice')
    assert.equal(move?.partnerId, order.partnerId)
  } finally {
    await adapter.close()
  }
})

test('pos: split tender requires manual reference and voided tender stops covering the order', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.saveAccount',
      { id: 'bank', code: '1121', name: 'Bank', accountType: 'asset_cash' },
      adapter,
    )
    await call(
      'account.saveJournal',
      { id: 'bank-journal', name: 'Bank', code: 'BNK', type: 'bank', defaultAccountId: 'bank' },
      adapter,
    )
    await call(
      'pos.savePaymentMethod',
      { id: 'manual-bank', name: 'Manual bank', journalId: 'bank-journal', isCash: false },
      adapter,
    )
    await call(
      'pos.linkPaymentMethod',
      { id: 'shop:bank', configId: 'shop', paymentMethodId: 'manual-bank' },
      adapter,
    )
    await call('pos.createSession', { id: 'split-shift', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'split-shift', expectedRevision: 0 }, adapter)
    await call('pos.createOrder', { id: 'split-sale', sessionId: 'split-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'split-sale:line',
        orderId: 'split-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        expectedRevision: 0,
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      {
        id: 'split-sale:cash',
        orderId: 'split-sale',
        paymentMethodId: 'cash-method',
        tenderedAmount: '40',
        expectedRevision: 1,
      },
      adapter,
    )
    const missingReference = (
      await call(
        'pos.addPayment',
        {
          id: 'split-sale:bank',
          orderId: 'split-sale',
          paymentMethodId: 'manual-bank',
          tenderedAmount: '59',
          expectedRevision: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(missingReference.ok, false)
    const bank = (
      await call(
        'pos.addPayment',
        {
          id: 'split-sale:bank',
          orderId: 'split-sale',
          paymentMethodId: 'manual-bank',
          tenderedAmount: '59',
          reference: 'BANK-001',
          expectedRevision: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(bank.revision, 3)
    const conflictingReplay = (
      await call(
        'pos.addPayment',
        {
          id: 'split-sale:bank',
          orderId: 'split-sale',
          paymentMethodId: 'manual-bank',
          tenderedAmount: '59',
          reference: 'BANK-002',
          expectedRevision: 3,
        },
        adapter,
      )
    ).value as Row
    assert.equal(conflictingReplay.ok, false)
    assert.equal((conflictingReplay.errors as Row[])[0]?.field, 'id')
    await call(
      'pos.voidPayment',
      {
        id: 'split-sale:bank',
        orderId: 'split-sale',
        expectedRevision: 3,
        reason: 'Wrong bank reference',
      },
      adapter,
    )
    assert.equal(((await call('pos.getOrder', { id: 'split-sale' }, adapter)).value as Row).amountPaid, '40')
    const incomplete = (await call('pos.validateOrder', { id: 'split-sale', expectedRevision: 4 }, adapter))
      .value as Row
    assert.equal(incomplete.ok, false)
  } finally {
    await adapter.close()
  }
})

test('pos: a provider settlement becomes exactly one revisioned non-cash tender', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.saveAccount',
      { id: 'provider-bank', code: '1122', name: 'Provider bank', accountType: 'asset_cash' },
      adapter,
    )
    await call(
      'account.saveJournal',
      {
        id: 'provider-journal',
        name: 'Provider',
        code: 'PAY',
        type: 'bank',
        defaultAccountId: 'provider-bank',
      },
      adapter,
    )
    await call(
      'pos.savePaymentMethod',
      { id: 'provider-method', name: 'Provider rail', journalId: 'provider-journal', isCash: false },
      adapter,
    )
    await call(
      'pos.linkPaymentMethod',
      { id: 'shop:provider', configId: 'shop', paymentMethodId: 'provider-method' },
      adapter,
    )
    await call('pos.createSession', { id: 'provider-shift', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'provider-shift', expectedRevision: 0 }, adapter)
    await call('pos.createOrder', { id: 'provider-unlock-sale', sessionId: 'provider-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'provider-unlock-sale:line',
        orderId: 'provider-unlock-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        expectedRevision: 0,
      },
      adapter,
    )
    const pendingLock = (
      await call(
        'pos.lockProviderPayment',
        {
          orderId: 'provider-unlock-sale',
          paymentMethodId: 'provider-method',
          amount: '99',
          providerAttemptId: 'attempt-expired',
          expectedRevision: 1,
        },
        adapter,
      )
    ).value as Row
    assert.equal(pendingLock.ok, true, JSON.stringify(pendingLock))
    const released = (
      await call(
        'pos.unlockProviderPayment',
        {
          orderId: 'provider-unlock-sale',
          providerAttemptId: 'attempt-expired',
          expectedRevision: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(released.ok, true, JSON.stringify(released))
    assert.equal(released.revision, 3)
    const editedAfterRelease = (
      await call(
        'pos.updateLine',
        {
          id: 'provider-unlock-sale:line',
          orderId: 'provider-unlock-sale',
          qty: '2',
          expectedRevision: 3,
        },
        adapter,
      )
    ).value as Row
    assert.equal(editedAfterRelease.ok, true, JSON.stringify(editedAfterRelease))
    const replacementLock = (
      await call(
        'pos.lockProviderPayment',
        {
          orderId: 'provider-unlock-sale',
          paymentMethodId: 'provider-method',
          amount: '198',
          providerAttemptId: 'attempt-new',
          expectedRevision: 4,
        },
        adapter,
      )
    ).value as Row
    assert.equal(replacementLock.ok, true, JSON.stringify(replacementLock))
    const lateSuccess = (
      await call(
        'pos.settleProviderPayment',
        {
          id: 'provider-unlock-sale:late-payment',
          orderId: 'provider-unlock-sale',
          paymentMethodId: 'provider-method',
          amount: '99',
          currency: 'VND',
          providerAttemptId: 'attempt-expired',
          providerReference: 'late-provider-success',
          expectedRevision: 5,
        },
        adapter,
      )
    ).value as Row
    assert.equal(lateSuccess.ok, false)
    const replacementReleased = (
      await call(
        'pos.unlockProviderPayment',
        {
          orderId: 'provider-unlock-sale',
          providerAttemptId: 'attempt-new',
          expectedRevision: 5,
        },
        adapter,
      )
    ).value as Row
    assert.equal(replacementReleased.ok, true, JSON.stringify(replacementReleased))
    await call('pos.createOrder', { id: 'provider-sale', sessionId: 'provider-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'provider-sale:line',
        orderId: 'provider-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        expectedRevision: 0,
      },
      adapter,
    )
    const reusedAttempt = (
      await call(
        'pos.lockProviderPayment',
        {
          orderId: 'provider-sale',
          paymentMethodId: 'provider-method',
          amount: '99',
          providerAttemptId: 'attempt-expired',
          expectedRevision: 1,
        },
        adapter,
      )
    ).value as Row
    assert.equal(reusedAttempt.ok, false)
    const locked = (
      await call(
        'pos.lockProviderPayment',
        {
          orderId: 'provider-sale',
          paymentMethodId: 'provider-method',
          amount: '99',
          providerAttemptId: 'attempt-1',
          expectedRevision: 1,
        },
        adapter,
      )
    ).value as Row
    assert.equal(locked.ok, true, JSON.stringify(locked))
    assert.equal(locked.revision, 2)
    const lockedEdit = (
      await call(
        'pos.updateLine',
        {
          id: 'provider-sale:line',
          orderId: 'provider-sale',
          qty: '2',
          expectedRevision: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(lockedEdit.ok, false)
    const settlementCommand = {
      id: 'provider-sale:payment',
      orderId: 'provider-sale',
      paymentMethodId: 'provider-method',
      amount: '99',
      currency: 'VND',
      providerAttemptId: 'attempt-1',
      providerReference: 'sandbox-settlement-1',
      expectedRevision: 2,
    }
    const [settledResult, concurrentReplayResult] = await Promise.all([
      call('pos.settleProviderPayment', settlementCommand, adapter),
      call('pos.settleProviderPayment', settlementCommand, adapter),
    ])
    const settled = settledResult.value as Row
    assert.equal(settled.ok, true, JSON.stringify(settled))
    assert.equal(settled.revision, 3)
    const concurrentReplay = concurrentReplayResult.value as Row
    assert.equal(concurrentReplay.ok, true, JSON.stringify(concurrentReplay))
    assert.equal(concurrentReplay.revision, 3)
    const duplicate = (
      await call(
        'pos.settleProviderPayment',
        {
          id: 'provider-sale:other-payment',
          orderId: 'provider-sale',
          paymentMethodId: 'provider-method',
          amount: '99',
          currency: 'VND',
          providerAttemptId: 'attempt-1',
          providerReference: 'sandbox-settlement-1',
          expectedRevision: 3,
        },
        adapter,
      )
    ).value as Row
    assert.equal(duplicate.ok, false)
    const changedReplay = (
      await call(
        'pos.settleProviderPayment',
        { ...settlementCommand, providerReference: 'different-settlement-reference', expectedRevision: 3 },
        adapter,
      )
    ).value as Row
    assert.equal(changedReplay.ok, false)
    const unlocked = (
      await call(
        'pos.unlockProviderPayment',
        { orderId: 'provider-sale', providerAttemptId: 'attempt-1', expectedRevision: 3 },
        adapter,
      )
    ).value as Row
    assert.equal(unlocked.ok, false)
    const voided = (
      await call(
        'pos.voidPayment',
        {
          id: 'provider-sale:payment',
          orderId: 'provider-sale',
          expectedRevision: 3,
          reason: 'must not bypass rail',
        },
        adapter,
      )
    ).value as Row
    assert.equal(voided.ok, false)
    const cancelled = (await call('pos.cancelOrder', { id: 'provider-sale', expectedRevision: 3 }, adapter))
      .value as Row
    assert.equal(cancelled.ok, false)
    const order = (await call('pos.getOrder', { id: 'provider-sale' }, adapter)).value as Row
    assert.equal((order.payments as Row[]).length, 1)
    assert.equal((order.payments as Row[])[0]?.kind, 'provider')
    assert.equal((order.payments as Row[])[0]?.providerAttemptId, 'attempt-1')
    const finalized = (await call('pos.validateOrder', { id: 'provider-sale', expectedRevision: 3 }, adapter))
      .value as Row
    assert.equal(finalized.ok, true, JSON.stringify(finalized))
    assert.equal(finalized.receiptId, 'provider-sale:receipt:v1')
    const receipt = (await call('pos.getReceipt', { orderId: 'provider-sale' }, adapter)).value as Row
    assert.equal(receipt.version, 1)
    assert.equal(receipt.templateVersion, 'pos-receipt-v1')
    assert.match(String(receipt.contentHash), /^[a-f0-9]{64}$/)
    const document = receipt.document as Row
    assert.equal(document.schema, 'ketviet.pos.receipt.v1')
    assert.equal((document.totals as Row).total, '99')
    assert.equal((document.lines as Row[])[0]?.name, 'Goods')
    const serializedReceipt = JSON.stringify(receipt)
    assert.doesNotMatch(
      serializedReceipt,
      /attempt-1|sandbox-settlement-1|providerAttemptId|providerReference/,
    )
    assert.doesNotMatch(serializedReceipt, /phone|email|token/i)
    await adapter.run('UPDATE pos_order_line SET name = ? WHERE id = ?', [
      'Mutated after payment',
      'provider-sale:line',
    ])
    const immutableReceipt = (await call('pos.getReceipt', { orderId: 'provider-sale' }, adapter))
      .value as Row
    assert.equal(immutableReceipt.contentHash, receipt.contentHash)
    assert.deepEqual(immutableReceipt.document, receipt.document)
    const finalizeReplay = (
      await call('pos.validateOrder', { id: 'provider-sale', expectedRevision: 4 }, adapter)
    ).value as Row
    assert.equal(finalizeReplay.ok, true, JSON.stringify(finalizeReplay))
    assert.equal(finalizeReplay.receiptId, finalized.receiptId)
    const reviewAfterFinalize = (
      await call(
        'pos.reviewProviderPayment',
        {
          orderId: 'provider-sale',
          providerAttemptId: 'attempt-1',
          state: 'needs_review',
          expectedRevision: 4,
        },
        adapter,
      )
    ).value as Row
    assert.equal(reviewAfterFinalize.ok, false)
    const lockReplayAfterFinalize = (
      await call(
        'pos.lockProviderPayment',
        {
          orderId: 'provider-sale',
          paymentMethodId: 'provider-method',
          amount: '99',
          providerAttemptId: 'attempt-1',
          expectedRevision: 4,
        },
        adapter,
      )
    ).value as Row
    assert.equal(lockReplayAfterFinalize.ok, true, JSON.stringify(lockReplayAfterFinalize))
    const settlementReplayAfterFinalize = (
      await call('pos.settleProviderPayment', { ...settlementCommand, expectedRevision: 4 }, adapter)
    ).value as Row
    assert.equal(settlementReplayAfterFinalize.ok, true, JSON.stringify(settlementReplayAfterFinalize))
    assert.equal(settlementReplayAfterFinalize.revision, 4)

    await call('pos.createOrder', { id: 'provider-race-sale', sessionId: 'provider-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'provider-race-sale:line',
        orderId: 'provider-race-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        expectedRevision: 0,
      },
      adapter,
    )
    await call(
      'pos.lockProviderPayment',
      {
        orderId: 'provider-race-sale',
        paymentMethodId: 'provider-method',
        amount: '99',
        providerAttemptId: 'attempt-race',
        expectedRevision: 1,
      },
      adapter,
    )
    await call(
      'pos.settleProviderPayment',
      {
        id: 'provider-race-sale:payment',
        orderId: 'provider-race-sale',
        paymentMethodId: 'provider-method',
        amount: '99',
        currency: 'VND',
        providerAttemptId: 'attempt-race',
        providerReference: 'sandbox-race',
        expectedRevision: 2,
      },
      adapter,
    )
    const [raceFinalizeResult, raceReviewResult] = await Promise.all([
      call('pos.validateOrder', { id: 'provider-race-sale' }, adapter),
      call(
        'pos.reviewProviderPayment',
        {
          orderId: 'provider-race-sale',
          providerAttemptId: 'attempt-race',
          state: 'needs_review',
          expectedRevision: 3,
        },
        adapter,
      ),
    ])
    const raceFinalize = raceFinalizeResult.value as Row
    const raceReview = raceReviewResult.value as Row
    assert.equal(Number(raceFinalize.ok === true) + Number(raceReview.ok === true), 1)
    const racedOrder = (await call('pos.getOrder', { id: 'provider-race-sale' }, adapter)).value as Row
    assert.equal(racedOrder.state, raceFinalize.ok === true ? 'paid' : 'draft')

    await call('pos.createOrder', { id: 'provider-resume-sale', sessionId: 'provider-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'provider-resume-sale:line',
        orderId: 'provider-resume-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        expectedRevision: 0,
      },
      adapter,
    )
    await call(
      'pos.lockProviderPayment',
      {
        orderId: 'provider-resume-sale',
        paymentMethodId: 'provider-method',
        amount: '99',
        providerAttemptId: 'attempt-resume',
        expectedRevision: 1,
      },
      adapter,
    )
    await call(
      'pos.settleProviderPayment',
      {
        id: 'provider-resume-sale:payment',
        orderId: 'provider-resume-sale',
        paymentMethodId: 'provider-method',
        amount: '99',
        currency: 'VND',
        providerAttemptId: 'attempt-resume',
        providerReference: 'sandbox-resume',
        expectedRevision: 2,
      },
      adapter,
    )
    await adapter.tx(async (tx) => {
      await tx.run('UPDATE pos_provider_payment_lock SET state = ? WHERE id = ?', [
        'finalizing',
        'attempt-resume',
      ])
      await tx.run('UPDATE pos_order SET revision = ? WHERE id = ?', [4, 'provider-resume-sale'])
    })
    const concurrentResume = (
      await call('pos.validateOrder', { id: 'provider-resume-sale', expectedRevision: 3 }, adapter)
    ).value as Row
    assert.equal(concurrentResume.ok, false)
    await adapter.run('UPDATE pos_provider_payment_lock SET "updatedAt" = ? WHERE id = ?', [
      '2000-01-01T00:00:00.000Z',
      'attempt-resume',
    ])
    const resumedFinalize = (
      await call('pos.validateOrder', { id: 'provider-resume-sale', expectedRevision: 3 }, adapter)
    ).value as Row
    assert.equal(resumedFinalize.ok, true, JSON.stringify(resumedFinalize))
    assert.equal(resumedFinalize.revision, 4)
  } finally {
    await adapter.close()
  }
})

test('pos: provider locks preserve split tenders and compensation is append-only', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.saveAccount',
      { id: 'rail-bank', code: '1123', name: 'Rail bank', accountType: 'asset_cash' },
      adapter,
    )
    await call(
      'account.saveJournal',
      {
        id: 'rail-journal',
        name: 'Rail',
        code: 'RAIL',
        type: 'bank',
        defaultAccountId: 'rail-bank',
      },
      adapter,
    )
    await call(
      'pos.savePaymentMethod',
      { id: 'rail-method', name: 'Payment rail', journalId: 'rail-journal', isCash: false },
      adapter,
    )
    await call(
      'pos.linkPaymentMethod',
      { id: 'shop:rail', configId: 'shop', paymentMethodId: 'rail-method' },
      adapter,
    )
    await call(
      'account.saveJournal',
      {
        id: 'rail-journal-2',
        name: 'Rail 2',
        code: 'RAI2',
        type: 'bank',
        defaultAccountId: 'rail-bank',
      },
      adapter,
    )
    await call(
      'pos.savePaymentMethod',
      { id: 'rail-method-2', name: 'Payment rail 2', journalId: 'rail-journal-2', isCash: false },
      adapter,
    )
    await call(
      'pos.linkPaymentMethod',
      { id: 'shop:rail-2', configId: 'shop', paymentMethodId: 'rail-method-2' },
      adapter,
    )
    await call('pos.createSession', { id: 'rail-shift', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'rail-shift', expectedRevision: 0 }, adapter)

    await call('pos.createOrder', { id: 'rail-split-sale', sessionId: 'rail-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'rail-split-sale:line',
        orderId: 'rail-split-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        expectedRevision: 0,
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      {
        id: 'rail-split-sale:manual',
        orderId: 'rail-split-sale',
        paymentMethodId: 'rail-method',
        amount: '40',
        reference: 'manual-40',
        expectedRevision: 1,
      },
      adapter,
    )
    const splitLock = (
      await call(
        'pos.lockProviderPayment',
        {
          orderId: 'rail-split-sale',
          paymentMethodId: 'rail-method',
          amount: '59',
          providerAttemptId: 'split-attempt',
          expectedRevision: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(splitLock.ok, true, JSON.stringify(splitLock))
    const blockedVoid = (
      await call(
        'pos.voidPayment',
        {
          id: 'rail-split-sale:manual',
          orderId: 'rail-split-sale',
          expectedRevision: 3,
          reason: 'must remain frozen',
        },
        adapter,
      )
    ).value as Row
    assert.equal(blockedVoid.ok, false)
    const splitReleased = (
      await call(
        'pos.unlockProviderPayment',
        { orderId: 'rail-split-sale', providerAttemptId: 'split-attempt', expectedRevision: 3 },
        adapter,
      )
    ).value as Row
    assert.equal(splitReleased.ok, true, JSON.stringify(splitReleased))
    const voidAfterRelease = (
      await call(
        'pos.voidPayment',
        {
          id: 'rail-split-sale:manual',
          orderId: 'rail-split-sale',
          expectedRevision: 4,
          reason: 'operator correction after provider decline',
        },
        adapter,
      )
    ).value as Row
    assert.equal(voidAfterRelease.ok, true, JSON.stringify(voidAfterRelease))

    await call('pos.createOrder', { id: 'rail-multi-sale', sessionId: 'rail-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'rail-multi-sale:line',
        orderId: 'rail-multi-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        expectedRevision: 0,
      },
      adapter,
    )
    const firstLock = (
      await call(
        'pos.lockProviderPayment',
        {
          orderId: 'rail-multi-sale',
          paymentMethodId: 'rail-method',
          amount: '40',
          providerAttemptId: 'multi-attempt-1',
          expectedRevision: 1,
        },
        adapter,
      )
    ).value as Row
    assert.equal(firstLock.ok, true, JSON.stringify(firstLock))
    const firstSettlement = (
      await call(
        'pos.settleProviderPayment',
        {
          id: 'rail-multi-sale:payment-1',
          orderId: 'rail-multi-sale',
          paymentMethodId: 'rail-method',
          amount: '40',
          currency: 'VND',
          providerAttemptId: 'multi-attempt-1',
          providerReference: 'multi-reference-1',
          expectedRevision: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(firstSettlement.ok, true, JSON.stringify(firstSettlement))
    const secondLock = (
      await call(
        'pos.lockProviderPayment',
        {
          orderId: 'rail-multi-sale',
          paymentMethodId: 'rail-method-2',
          amount: '59',
          providerAttemptId: 'multi-attempt-2',
          expectedRevision: 3,
        },
        adapter,
      )
    ).value as Row
    assert.equal(secondLock.ok, true, JSON.stringify(secondLock))
    const firstReplay = (
      await call(
        'pos.settleProviderPayment',
        {
          id: 'rail-multi-sale:payment-1',
          orderId: 'rail-multi-sale',
          paymentMethodId: 'rail-method',
          amount: '40',
          currency: 'VND',
          providerAttemptId: 'multi-attempt-1',
          providerReference: 'multi-reference-1',
          expectedRevision: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(firstReplay.ok, true, JSON.stringify(firstReplay))
    assert.equal(firstReplay.id, firstSettlement.id)
    const secondSettlement = (
      await call(
        'pos.settleProviderPayment',
        {
          id: 'rail-multi-sale:payment-2',
          orderId: 'rail-multi-sale',
          paymentMethodId: 'rail-method-2',
          amount: '59',
          currency: 'VND',
          providerAttemptId: 'multi-attempt-2',
          providerReference: 'multi-reference-2',
          expectedRevision: 4,
        },
        adapter,
      )
    ).value as Row
    assert.equal(secondSettlement.ok, true, JSON.stringify(secondSettlement))
    const multiFinalized = (
      await call('pos.validateOrder', { id: 'rail-multi-sale', expectedRevision: 5 }, adapter)
    ).value as Row
    assert.equal(multiFinalized.ok, true, JSON.stringify(multiFinalized))
    const multiOrder = (await call('pos.getOrder', { id: 'rail-multi-sale' }, adapter)).value as Row
    assert.equal(multiOrder.state, 'paid')
    assert.equal(multiOrder.amountPaid, '99')
    const multiLocks = await adapter.all(
      'SELECT id, state FROM pos_provider_payment_lock WHERE "orderId" = ? ORDER BY id',
      ['rail-multi-sale'],
    )
    assert.deepEqual(
      multiLocks.map((lock) => ({ id: lock.id, state: lock.state })),
      [
        { id: 'multi-attempt-1', state: 'finalized' },
        { id: 'multi-attempt-2', state: 'finalized' },
      ],
    )

    await call('pos.createOrder', { id: 'rail-repair-sale', sessionId: 'rail-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'rail-repair-sale:line',
        orderId: 'rail-repair-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        expectedRevision: 0,
      },
      adapter,
    )
    await call(
      'pos.lockProviderPayment',
      {
        orderId: 'rail-repair-sale',
        paymentMethodId: 'rail-method',
        amount: '99',
        providerAttemptId: 'repair-attempt',
        expectedRevision: 1,
      },
      adapter,
    )
    const captured = (
      await call(
        'pos.settleProviderPayment',
        {
          id: 'rail-repair-sale:payment',
          orderId: 'rail-repair-sale',
          paymentMethodId: 'rail-method',
          amount: '99',
          currency: 'VND',
          providerAttemptId: 'repair-attempt',
          providerReference: 'capture-reference',
          expectedRevision: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(captured.ok, true, JSON.stringify(captured))
    const reversalCommand = {
      id: 'rail-repair-sale:reversal',
      orderId: 'rail-repair-sale',
      providerAttemptId: 'repair-attempt',
      providerReversalId: 'repair-attempt:reversal',
      amount: '99',
      currency: 'VND',
      reversalReference: 'reversal-reference',
      expectedRevision: 5,
    }
    const prematureReversal = (
      await call('pos.reverseProviderPayment', { ...reversalCommand, expectedRevision: 3 }, adapter)
    ).value as Row
    assert.equal(prematureReversal.ok, false)
    const skippedReview = (
      await call(
        'pos.reviewProviderPayment',
        {
          orderId: 'rail-repair-sale',
          providerAttemptId: 'repair-attempt',
          state: 'reversing',
          expectedRevision: 3,
        },
        adapter,
      )
    ).value as Row
    assert.equal(skippedReview.ok, false)
    const needsReview = (
      await call(
        'pos.reviewProviderPayment',
        {
          orderId: 'rail-repair-sale',
          providerAttemptId: 'repair-attempt',
          state: 'needs_review',
          expectedRevision: 3,
        },
        adapter,
      )
    ).value as Row
    assert.equal(needsReview.ok, true, JSON.stringify(needsReview))
    assert.equal(needsReview.revision, 4)
    const reviewReplay = (
      await call(
        'pos.reviewProviderPayment',
        {
          orderId: 'rail-repair-sale',
          providerAttemptId: 'repair-attempt',
          state: 'needs_review',
          expectedRevision: 3,
        },
        adapter,
      )
    ).value as Row
    assert.equal(reviewReplay.ok, true, JSON.stringify(reviewReplay))
    assert.equal(reviewReplay.revision, 4)
    const finalizedDuringReview = (
      await call('pos.validateOrder', { id: 'rail-repair-sale', expectedRevision: 4 }, adapter)
    ).value as Row
    assert.equal(finalizedDuringReview.ok, false)
    const reversing = (
      await call(
        'pos.reviewProviderPayment',
        {
          orderId: 'rail-repair-sale',
          providerAttemptId: 'repair-attempt',
          state: 'reversing',
          expectedRevision: 4,
        },
        adapter,
      )
    ).value as Row
    assert.equal(reversing.ok, true, JSON.stringify(reversing))
    assert.equal(reversing.revision, 5)
    const reversed = (await call('pos.reverseProviderPayment', reversalCommand, adapter)).value as Row
    assert.equal(reversed.ok, true, JSON.stringify(reversed))
    assert.equal(reversed.revision, 6)
    const reversalReplay = (await call('pos.reverseProviderPayment', reversalCommand, adapter)).value as Row
    assert.equal(reversalReplay.ok, true, JSON.stringify(reversalReplay))
    const repairedOrder = (await call('pos.getOrder', { id: 'rail-repair-sale' }, adapter)).value as Row
    assert.equal(repairedOrder.amountPaid, '0')
    assert.equal(repairedOrder.paymentLockId, null)
    const repairedPayments = repairedOrder.payments as Row[]
    assert.equal(repairedPayments.length, 2)
    assert.deepEqual(repairedPayments.map((payment) => payment.state).sort(), ['reversed', 'reversed'])
    const cancelled = (
      await call('pos.cancelOrder', { id: 'rail-repair-sale', expectedRevision: 6 }, adapter)
    ).value as Row
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled))
  } finally {
    await adapter.close()
  }
})

test('pos: cash movements affect expected cash and corrections append a linked reversal', async () => {
  const adapter = await boot()
  try {
    await call(
      'pos.createSession',
      { id: 'movement-shift', configId: 'shop', userId: 'cashier', openingCash: '10' },
      adapter,
    )
    await call('pos.openSession', { id: 'movement-shift', expectedRevision: 0 }, adapter)
    const moved = (
      await call(
        'pos.recordCashMovement',
        {
          id: 'movement-out',
          sessionId: 'movement-shift',
          expectedRevision: 1,
          direction: 'out',
          amount: '2',
          reason: 'petty_cash',
          actorId: 'cashier',
        },
        adapter,
      )
    ).value as Row
    assert.equal(moved.revision, 2)
    assert.equal(
      ((await call('pos.getSession', { id: 'movement-shift' }, adapter)).value as Row).cashRegisterBalanceEnd,
      '8',
    )
    const reversed = (
      await call(
        'pos.reverseCashMovement',
        {
          id: 'movement-reversal',
          sessionId: 'movement-shift',
          movementId: 'movement-out',
          expectedRevision: 2,
          reason: 'wrong_drawer',
          actorId: 'cashier',
        },
        adapter,
      )
    ).value as Row
    assert.equal(reversed.revision, 3)
    const shift = (await call('pos.getSession', { id: 'movement-shift' }, adapter)).value as Row
    assert.equal(shift.cashRegisterBalanceEnd, '10')
    assert.equal((shift.cashMovements as Row[]).length, 2)
    assert.equal(
      (shift.cashMovements as Row[]).find((row) => row.id === 'movement-reversal')?.reversalOfId,
      'movement-out',
    )
  } finally {
    await adapter.close()
  }
})

test('pos: a variance seals the old shift, permits a new shift and posts approval separately', async () => {
  const adapter = await boot()
  try {
    await call(
      'pos.createSession',
      { id: 'variance-shift', configId: 'shop', userId: 'cashier', openingCash: '10' },
      adapter,
    )
    await call('pos.openSession', { id: 'variance-shift', expectedRevision: 0 }, adapter)
    await call('pos.startClosing', { id: 'variance-shift', expectedRevision: 1 }, adapter)
    const sealed = (
      await call(
        'pos.closeSession',
        {
          id: 'variance-shift',
          closingCash: '8',
          varianceReason: 'count_error',
          varianceNote: 'Cashier counted twice',
          expectedRevision: 2,
        },
        adapter,
      )
    ).value as Row
    assert.equal(sealed.pendingApproval, true)
    assert.equal(sealed.difference, '-2')
    assert.equal(
      ((await call('pos.getSession', { id: 'variance-shift' }, adapter)).value as Row).state,
      'pending_approval',
    )

    const next = (
      await call('pos.createSession', { id: 'next-shift', configId: 'shop', userId: 'cashier' }, adapter)
    ).value as Row
    assert.equal(next.ok, true)

    const approved = (
      await call(
        'pos.approveSessionVariance',
        { id: 'variance-shift', expectedRevision: 3, approvedBy: 'manager', note: 'Approved shortage' },
        adapter,
      )
    ).value as Row
    assert.equal(approved.ok, true)
    assert.equal(approved.revision, 4)
    const adjustment = (
      await adapter.all(
        'SELECT amount, "approvedBy", "accountMoveId" FROM pos_cash_adjustment WHERE "sessionId" = ?',
        ['variance-shift'],
      )
    )[0]
    assert.equal(adjustment?.amount, '-2')
    assert.equal(adjustment?.approvedBy, 'manager')
    const balances = await adapter.all('SELECT balance FROM account_move_line WHERE "moveId" = ?', [
      adjustment?.accountMoveId,
    ])
    assert.deepEqual(
      balances.map((row) => Number(row.balance)).sort((a, b) => a - b),
      [-2, 2],
    )
  } finally {
    await adapter.close()
  }
})

test('pos: refunds use a new open session, reverse accounting and return stock', async () => {
  const adapter = await boot()
  try {
    await call('pos.createSession', { id: 's1', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 's1' }, adapter)
    await call('pos.createOrder', { id: 'sale', sessionId: 's1' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'sale:line',
        orderId: 'sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        priceUnit: '100',
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      { id: 'sale:pay', orderId: 'sale', paymentMethodId: 'cash-method', amount: '110' },
      adapter,
    )
    await call('pos.validateOrder', { id: 'sale' }, adapter)
    await call('pos.startClosing', { id: 's1' }, adapter)
    await call('pos.closeSession', { id: 's1', closingCash: '110' }, adapter)
    await call('pos.createSession', { id: 's2', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 's2' }, adapter)
    await call('pos.refundOrder', { id: 'refund', originalOrderId: 'sale', sessionId: 's2' }, adapter)
    assert.equal(
      (await adapter.all('SELECT "amountTotal" FROM pos_order WHERE id = ?', ['refund']))[0]!.amountTotal,
      '-110',
    )
    await call(
      'pos.addPayment',
      { id: 'refund:pay', orderId: 'refund', paymentMethodId: 'cash-method', amount: '-110' },
      adapter,
    )
    await call('pos.validateOrder', { id: 'refund' }, adapter)
    assert.equal(
      (
        await adapter.all('SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?', [
          'goods-1',
          'wh:stock',
        ])
      )[0]!.quantity,
      '10',
    )
    const lines = await adapter.all('SELECT debit, credit FROM account_move_line WHERE "moveId" = ?', [
      'refund:account',
    ])
    assert.equal(
      lines.reduce((sum, row) => sum + Number(row.debit), 0),
      110,
    )
    assert.equal(
      lines.reduce((sum, row) => sum + Number(row.credit), 0),
      110,
    )
  } finally {
    await adapter.close()
  }
})

test('pos: partial returns reserve remaining quantities and post exact credit notes', async () => {
  const adapter = await boot()
  try {
    await call('pos.createSession', { id: 'return-shift', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'return-shift' }, adapter)
    await call('pos.createOrder', { id: 'partial-sale', sessionId: 'return-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'partial-line',
        orderId: 'partial-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '3',
        priceUnit: '100',
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      { id: 'partial-pay', orderId: 'partial-sale', paymentMethodId: 'cash-method', amount: '330' },
      adapter,
    )
    await call('pos.validateOrder', { id: 'partial-sale' }, adapter)

    let eligibility = (await call('pos.getReturnEligibility', { id: 'partial-sale' }, adapter)).value as Row
    assert.equal(eligibility.refundable, true)
    assert.equal((eligibility.lines as Row[])[0]!.remainingQuantity, '3')
    const first = (
      await call(
        'pos.refundOrder',
        {
          id: 'partial-return-1',
          originalOrderId: 'partial-sale',
          sessionId: 'return-shift',
          expectedRevision: eligibility.revision,
          lines: [{ lineId: 'partial-line', quantity: '1' }],
        },
        adapter,
      )
    ).value as Row
    assert.equal(first.ok, true, JSON.stringify(first))
    assert.equal(
      (await adapter.all('SELECT "amountTotal" FROM pos_order WHERE id = ?', ['partial-return-1']))[0]!
        .amountTotal,
      '-110',
    )
    await call(
      'pos.addPayment',
      {
        id: 'partial-return-1:pay',
        orderId: 'partial-return-1',
        paymentMethodId: 'cash-method',
        amount: '-110',
      },
      adapter,
    )
    await call('pos.validateOrder', { id: 'partial-return-1' }, adapter)
    const credit = (
      await adapter.all('SELECT "moveType", state, "paymentState" FROM account_move WHERE id = ?', [
        'partial-return-1:account',
      ])
    )[0]!
    assert.deepEqual({ ...credit }, { moveType: 'out_refund', state: 'posted', paymentState: 'paid' })

    eligibility = (await call('pos.getReturnEligibility', { id: 'partial-sale' }, adapter)).value as Row
    assert.equal((eligibility.lines as Row[])[0]!.refundedQuantity, '1')
    assert.equal((eligibility.lines as Row[])[0]!.remainingQuantity, '2')
    const stale = (
      await call(
        'pos.refundOrder',
        {
          id: 'partial-return-stale',
          originalOrderId: 'partial-sale',
          sessionId: 'return-shift',
          expectedRevision: Number(eligibility.revision) - 1,
          lines: [{ lineId: 'partial-line', quantity: '2' }],
        },
        adapter,
      )
    ).value as Row
    assert.equal(stale.ok, false)
    assert.equal((stale.errors as Row[])[0]!.field, 'expectedRevision')
    const over = (
      await call(
        'pos.refundOrder',
        {
          id: 'partial-return-over',
          originalOrderId: 'partial-sale',
          sessionId: 'return-shift',
          expectedRevision: eligibility.revision,
          lines: [{ lineId: 'partial-line', quantity: '3' }],
        },
        adapter,
      )
    ).value as Row
    assert.equal(over.ok, false)
    assert.equal((over.errors as Row[])[0]!.field, 'quantity')

    const held = (
      await call(
        'pos.refundOrder',
        {
          id: 'partial-return-held',
          originalOrderId: 'partial-sale',
          sessionId: 'return-shift',
          expectedRevision: eligibility.revision,
          lines: [{ lineId: 'partial-line', quantity: '2' }],
        },
        adapter,
      )
    ).value as Row
    assert.equal(held.ok, true)
    const reserved = (await call('pos.getReturnEligibility', { id: 'partial-sale' }, adapter)).value as Row
    assert.equal(reserved.refundable, false)
    await call('pos.cancelOrder', { id: 'partial-return-held', expectedRevision: 0 }, adapter)
    eligibility = (await call('pos.getReturnEligibility', { id: 'partial-sale' }, adapter)).value as Row
    assert.equal((eligibility.lines as Row[])[0]!.remainingQuantity, '2')

    const final = (
      await call(
        'pos.refundOrder',
        {
          id: 'partial-return-2',
          originalOrderId: 'partial-sale',
          sessionId: 'return-shift',
          expectedRevision: eligibility.revision,
          lines: [{ lineId: 'partial-line', quantity: '2' }],
        },
        adapter,
      )
    ).value as Row
    assert.equal(final.ok, true, JSON.stringify(final))
    await call(
      'pos.addPayment',
      {
        id: 'partial-return-2:pay',
        orderId: 'partial-return-2',
        paymentMethodId: 'cash-method',
        amount: '-220',
      },
      adapter,
    )
    await call('pos.validateOrder', { id: 'partial-return-2' }, adapter)
    eligibility = (await call('pos.getReturnEligibility', { id: 'partial-sale' }, adapter)).value as Row
    assert.equal(eligibility.refundable, false)
    assert.equal(
      (
        await adapter.all('SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?', [
          'goods-1',
          'wh:stock',
        ])
      )[0]!.quantity,
      '10',
    )
    const returned = await adapter.all(
      'SELECT "amountTotal" FROM pos_order WHERE "refundedOrderId" = ? AND state = ? ORDER BY id',
      ['partial-sale', 'paid'],
    )
    assert.equal(
      returned.reduce((sum, row) => sum + Number(row.amountTotal), 0),
      -330,
    )
  } finally {
    await adapter.close()
  }
})

test('pos: an exchange atomically links a negative return to a separate replacement sale', async () => {
  const adapter = await boot()
  try {
    await call('pos.createSession', { id: 'exchange-shift', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'exchange-shift' }, adapter)
    await call(
      'pos.createOrder',
      { id: 'exchange-original', sessionId: 'exchange-shift', partnerId: 'customer' },
      adapter,
    )
    await call(
      'pos.addLine',
      {
        id: 'exchange-original-line',
        orderId: 'exchange-original',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '2',
        priceUnit: '100',
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      {
        id: 'exchange-original-pay',
        orderId: 'exchange-original',
        paymentMethodId: 'cash-method',
        amount: '220',
      },
      adapter,
    )
    await call('pos.validateOrder', { id: 'exchange-original' }, adapter)
    const eligibility = (await call('pos.getReturnEligibility', { id: 'exchange-original' }, adapter))
      .value as Row
    const command = {
      id: 'exchange-1',
      uuid: 'exchange-uuid-1',
      originalOrderId: 'exchange-original',
      sessionId: 'exchange-shift',
      expectedRevision: eligibility.revision,
      lines: [{ lineId: 'exchange-original-line', quantity: '1' }],
      reason: 'Customer changed the product',
      replacementPriceBookRevision: 'price-book-r2',
      replacementNote: 'Replacement leg',
    }
    const created = (await call('pos.createExchange', command, adapter)).value as Row
    assert.equal(created.ok, true, JSON.stringify(created))
    assert.equal(created.returnOrderId, 'exchange-1:return')
    assert.equal(created.replacementOrderId, 'exchange-1:replacement')

    const returned = (await call('pos.getOrder', { id: 'exchange-1:return' }, adapter)).value as Row
    const replacement = (await call('pos.getOrder', { id: 'exchange-1:replacement' }, adapter)).value as Row
    assert.equal(returned.isRefund, true)
    assert.equal(returned.exchangeRole, 'return')
    assert.equal(Number((returned.lines as Row[])[0]?.qty), -1)
    assert.equal(Number(returned.amountTotal), -110)
    assert.equal(replacement.isRefund, false)
    assert.equal(replacement.exchangeRole, 'replacement')
    assert.equal((replacement.lines as Row[]).length, 0)
    assert.equal(replacement.partnerId, 'customer')
    assert.equal(replacement.priceBookRevision, 'price-book-r2')
    assert.equal((returned.exchange as Row).replacementOrderId, replacement.id)
    assert.equal((replacement.exchange as Row).returnOrderId, returned.id)

    const replay = (await call('pos.createExchange', command, adapter)).value as Row
    assert.equal(replay.ok, true)
    assert.equal(replay.id, created.id)
    assert.equal((await adapter.all('SELECT id FROM pos_order WHERE id LIKE ?', ['exchange-1:%'])).length, 2)
    const changed = (
      await call(
        'pos.createExchange',
        { ...command, lines: [{ lineId: 'exchange-original-line', quantity: '2' }] },
        adapter,
      )
    ).value as Row
    assert.equal(changed.ok, false)

    await call(
      'pos.addLine',
      {
        id: 'exchange-replacement-line',
        orderId: replacement.id,
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        priceUnit: '100',
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      {
        id: 'exchange-replacement-pay',
        orderId: replacement.id,
        paymentMethodId: 'cash-method',
        amount: '110',
      },
      adapter,
    )
    const premature = (await call('pos.validateOrder', { id: replacement.id }, adapter)).value as Row
    assert.equal(premature.ok, false)
    assert.equal((premature.errors as Row[])[0]?.field, 'exchangeId')

    await call(
      'pos.addPayment',
      {
        id: 'exchange-return-pay',
        orderId: returned.id,
        paymentMethodId: 'cash-method',
        amount: '-110',
      },
      adapter,
    )
    assert.equal(((await call('pos.validateOrder', { id: returned.id }, adapter)).value as Row).ok, true)
    assert.equal(((await call('pos.validateOrder', { id: replacement.id }, adapter)).value as Row).ok, true)
    assert.equal(
      (
        await adapter.all('SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?', [
          'goods-1',
          'wh:stock',
        ])
      )[0]?.quantity,
      '8',
    )
    const moves = await adapter.all('SELECT id, "moveType" FROM account_move WHERE id IN (?, ?)', [
      `${returned.id}:account`,
      `${replacement.id}:account`,
    ])
    assert.deepEqual(new Set(moves.map((move) => move.moveType)), new Set(['out_refund', 'out_invoice']))

    await call('pos.createOrder', { id: 'mixed-sale', sessionId: 'exchange-shift' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'mixed-sale-line',
        orderId: 'mixed-sale',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        priceUnit: '100',
      },
      adapter,
    )
    await adapter.run('UPDATE pos_order_line SET qty = ? WHERE id = ?', ['-1', 'mixed-sale-line'])
    const mixed = (await call('pos.validateOrder', { id: 'mixed-sale' }, adapter)).value as Row
    assert.equal(mixed.ok, false)
    assert.equal((mixed.errors as Row[])[0]?.field, 'lines')
  } finally {
    await adapter.close()
  }
})

test('pos: customer invoice is posted and reconciled by the POS payment', async () => {
  const adapter = await boot()
  try {
    await call('pos.createSession', { id: 'session', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'session' }, adapter)
    await call(
      'pos.createOrder',
      { id: 'invoice-order', sessionId: 'session', partnerId: 'customer', toInvoice: true },
      adapter,
    )
    await call(
      'pos.addLine',
      {
        id: 'invoice-line',
        orderId: 'invoice-order',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
        priceUnit: '100',
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      { id: 'invoice-payment', orderId: 'invoice-order', paymentMethodId: 'cash-method', amount: '110' },
      adapter,
    )
    await call('pos.validateOrder', { id: 'invoice-order' }, adapter)
    const invoice = (
      await adapter.all('SELECT "moveType", state, "paymentState" FROM account_move WHERE id = ?', [
        'invoice-order:account',
      ])
    )[0]!
    assert.equal(invoice.moveType, 'out_invoice')
    assert.equal(invoice.state, 'posted')
    assert.equal(invoice.paymentState, 'paid')
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM account_partial_reconcile'))[0]!.n, 1)
  } finally {
    await adapter.close()
  }
})

test('pos: retry after an accounting fault reuses the completed stock transfer exactly once', async () => {
  const adapter = await boot()
  try {
    await call('pos.createSession', { id: 'retry-session', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'retry-session' }, adapter)
    await call(
      'pos.createOrder',
      { id: 'retry-order', sessionId: 'retry-session', partnerId: 'customer' },
      adapter,
    )
    await call(
      'pos.addLine',
      {
        id: 'retry-line',
        orderId: 'retry-order',
        productId: 'goods-1',
        productUomId: 'unit',
        qty: '1',
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      { id: 'retry-payment', orderId: 'retry-order', paymentMethodId: 'cash-method', amount: '99' },
      adapter,
    )
    await adapter.run('UPDATE pos_config SET "salesJournalId" = ? WHERE id = ?', [
      'missing-sales-journal',
      'shop',
    ])
    const failed = (await call('pos.validateOrder', { id: 'retry-order', expectedRevision: 2 }, adapter))
      .value as Row
    assert.equal(failed.ok, false, JSON.stringify(failed))
    assert.equal((failed.errors as Row[])[0]?.field, 'accounting')
    assert.equal(
      (await adapter.all('SELECT state FROM stock_picking WHERE id = ?', ['retry-order:picking']))[0]?.state,
      'done',
    )
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM account_move WHERE id = ?', ['retry-order:account']))[0]
        ?.n,
      0,
    )
    assert.equal(
      (
        await adapter.all('SELECT COUNT(*) AS n FROM pos_receipt_document WHERE "orderId" = ?', [
          'retry-order',
        ])
      )[0]?.n,
      0,
    )

    await adapter.run('UPDATE pos_config SET "salesJournalId" = ? WHERE id = ?', ['sales', 'shop'])
    const held = (await adapter.all('SELECT revision FROM pos_order WHERE id = ?', ['retry-order']))[0]!
    const recovered = (
      await call('pos.validateOrder', { id: 'retry-order', expectedRevision: Number(held.revision) }, adapter)
    ).value as Row
    assert.equal(recovered.ok, true, JSON.stringify(recovered))
    assert.equal(
      ((await call('pos.validateOrder', { id: 'retry-order' }, adapter)).value as Row).state,
      'paid',
    )
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM stock_picking WHERE id = ?', ['retry-order:picking']))[0]
        ?.n,
      1,
    )
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM stock_move WHERE id = ?', ['retry-line:move']))[0]?.n,
      1,
    )
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM account_move WHERE id = ?', ['retry-order:account']))[0]
        ?.n,
      1,
    )
    assert.equal(
      (
        await adapter.all('SELECT COUNT(*) AS n FROM pos_receipt_document WHERE "orderId" = ?', [
          'retry-order',
        ])
      )[0]?.n,
      1,
    )
    assert.equal(
      (
        await adapter.all('SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?', [
          'goods-1',
          'wh:stock',
        ])
      )[0]?.quantity,
      '9',
    )
  } finally {
    await adapter.close()
  }
})

test('pos: immediate fulfillment rolls back every reservation when the whole picking cannot fill', async () => {
  const adapter = await boot()
  try {
    await call(
      'pos.createSession',
      { id: 'atomic-stock-session', configId: 'shop', userId: 'cashier' },
      adapter,
    )
    await call('pos.openSession', { id: 'atomic-stock-session' }, adapter)
    await call('pos.createOrder', { id: 'atomic-stock-order', sessionId: 'atomic-stock-session' }, adapter)
    for (const lineId of ['atomic-stock-a', 'atomic-stock-b'])
      await call(
        'pos.addLine',
        {
          id: lineId,
          orderId: 'atomic-stock-order',
          productId: 'goods-1',
          productUomId: 'unit',
          qty: '6',
          priceUnit: '100',
        },
        adapter,
      )
    await call(
      'pos.addPayment',
      {
        id: 'atomic-stock-payment',
        orderId: 'atomic-stock-order',
        paymentMethodId: 'cash-method',
        amount: '1320',
      },
      adapter,
    )
    const refused = (
      await call('pos.validateOrder', { id: 'atomic-stock-order', expectedRevision: 3 }, adapter)
    ).value as Row
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]!.field, 'stock')
    const quant = (
      await adapter.all(
        'SELECT quantity, "reservedQuantity" FROM stock_quant WHERE "productId" = ? AND "locationId" = ?',
        ['goods-1', 'wh:stock'],
      )
    )[0]!
    assert.deepEqual({ ...quant }, { quantity: '10', reservedQuantity: '0' })
    assert.equal(
      (
        await adapter.all('SELECT COUNT(*) AS n FROM stock_move_line WHERE "pickingId" = ?', [
          'atomic-stock-order:picking',
        ])
      )[0]!.n,
      0,
    )
  } finally {
    await adapter.close()
  }
})

test('pos: lot and serial selections are revision-bound, exact and returned to the original lot', async () => {
  const adapter = await boot()
  try {
    for (const [templateId, productId, tracking, price] of [
      ['batch-goods', 'batch-1', 'lot', '10'],
      ['serial-goods', 'serial-1', 'serial', '5'],
    ]) {
      await call(
        'product.saveTemplate',
        { id: templateId, name: templateId, type: 'goods', uomId: 'unit', listPrice: price, saleOk: true },
        adapter,
      )
      await call(
        'product.saveVariant',
        { id: productId, templateId, defaultCode: productId, combinationKey: '' },
        adapter,
      )
      await call('stock.configureProduct', { templateId, isStorable: true, tracking }, adapter)
    }
    await call('stock.createLot', { id: 'batch-live', productId: 'batch-1', name: 'BATCH-LIVE' }, adapter)
    await call(
      'stock.createLot',
      {
        id: 'batch-expired',
        productId: 'batch-1',
        name: 'BATCH-EXPIRED',
        expirationDate: '2020-01-01T00:00:00.000Z',
      },
      adapter,
    )
    for (const lotId of ['serial-a', 'serial-b'])
      await call('stock.createLot', { id: lotId, productId: 'serial-1', name: lotId.toUpperCase() }, adapter)
    for (const [id, productId, lotId, quantity] of [
      ['batch-live-stock', 'batch-1', 'batch-live', '3'],
      ['batch-expired-stock', 'batch-1', 'batch-expired', '1'],
      ['serial-a-stock', 'serial-1', 'serial-a', '1'],
      ['serial-b-stock', 'serial-1', 'serial-b', '1'],
    ])
      await call(
        'stock.adjustInventory',
        {
          id,
          productId,
          lotId,
          locationId: 'wh:stock',
          inventoryLocationId: 'inventory',
          countedQuantity: quantity,
          productUomId: 'unit',
        },
        adapter,
      )

    await call('pos.createSession', { id: 'tracked-s1', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'tracked-s1' }, adapter)
    await call('pos.createOrder', { id: 'tracked-sale', sessionId: 'tracked-s1' }, adapter)
    await call(
      'pos.addLine',
      {
        id: 'tracked-line',
        orderId: 'tracked-sale',
        productId: 'batch-1',
        productUomId: 'unit',
        qty: '2',
        priceUnit: '10',
      },
      adapter,
    )
    let availability = (
      await call(
        'pos.getLineTrackingAvailability',
        { orderId: 'tracked-sale', lineId: 'tracked-line' },
        adapter,
      )
    ).value as Row
    assert.equal(availability.tracking, 'lot')
    assert.equal((availability.lots as Row[]).find((lot) => lot.lotId === 'batch-expired')!.selectable, false)
    const live = (availability.lots as Row[]).find((lot) => lot.lotId === 'batch-live')!
    const selected = (
      await call(
        'pos.setLineLotSelections',
        {
          orderId: 'tracked-sale',
          lineId: 'tracked-line',
          expectedRevision: 1,
          selections: [{ lotId: 'batch-live', quantity: '2', stockRevision: live.stockRevision }],
        },
        adapter,
      )
    ).value as Row
    assert.equal(selected.ok, true)
    await call(
      'stock.adjustInventory',
      {
        id: 'batch-live-recount',
        productId: 'batch-1',
        lotId: 'batch-live',
        locationId: 'wh:stock',
        inventoryLocationId: 'inventory',
        countedQuantity: '4',
        productUomId: 'unit',
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      { id: 'tracked-pay', orderId: 'tracked-sale', paymentMethodId: 'cash-method', amount: '20' },
      adapter,
    )
    const stale = (await call('pos.validateOrder', { id: 'tracked-sale', expectedRevision: 3 }, adapter))
      .value as Row
    assert.equal(stale.ok, false)
    assert.equal((stale.errors as Row[])[0]!.field, 'stockRevision')
    assert.equal(
      (
        await adapter.all('SELECT COUNT(*) AS n FROM stock_picking WHERE id = ?', ['tracked-sale:picking'])
      )[0]!.n,
      0,
    )

    availability = (
      await call(
        'pos.getLineTrackingAvailability',
        { orderId: 'tracked-sale', lineId: 'tracked-line' },
        adapter,
      )
    ).value as Row
    const refreshed = (availability.lots as Row[]).find((lot) => lot.lotId === 'batch-live')!
    await call(
      'pos.setLineLotSelections',
      {
        orderId: 'tracked-sale',
        lineId: 'tracked-line',
        expectedRevision: 3,
        selections: [{ lotId: 'batch-live', quantity: '2', stockRevision: refreshed.stockRevision }],
      },
      adapter,
    )
    const paid = (await call('pos.validateOrder', { id: 'tracked-sale', expectedRevision: 4 }, adapter))
      .value as Row
    assert.equal(paid.ok, true)
    assert.equal(
      (
        await adapter.all(
          'SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ? AND "lotId" = ?',
          ['batch-1', 'wh:stock', 'batch-live'],
        )
      )[0]!.quantity,
      '2',
    )

    await call('pos.startClosing', { id: 'tracked-s1' }, adapter)
    await call('pos.closeSession', { id: 'tracked-s1', closingCash: '20' }, adapter)
    await call('pos.createSession', { id: 'tracked-s2', configId: 'shop', userId: 'cashier' }, adapter)
    await call('pos.openSession', { id: 'tracked-s2' }, adapter)
    let returnEligibility = (await call('pos.getReturnEligibility', { id: 'tracked-sale' }, adapter))
      .value as Row
    await call(
      'pos.refundOrder',
      {
        id: 'tracked-refund',
        originalOrderId: 'tracked-sale',
        sessionId: 'tracked-s2',
        expectedRevision: returnEligibility.revision,
        lines: [{ lineId: 'tracked-line', quantity: '1' }],
      },
      adapter,
    )
    const refund = (await call('pos.getOrder', { id: 'tracked-refund' }, adapter)).value as Row
    assert.deepEqual((refund.lines as Row[])[0]!.lotSelections, [
      { lotId: 'batch-live', quantity: '1', stockRevision: null },
    ])
    await call(
      'pos.addPayment',
      { id: 'tracked-refund-pay', orderId: 'tracked-refund', paymentMethodId: 'cash-method', amount: '-10' },
      adapter,
    )
    assert.equal(((await call('pos.validateOrder', { id: 'tracked-refund' }, adapter)).value as Row).ok, true)
    returnEligibility = (await call('pos.getReturnEligibility', { id: 'tracked-sale' }, adapter)).value as Row
    await call(
      'pos.refundOrder',
      {
        id: 'tracked-refund-final',
        originalOrderId: 'tracked-sale',
        sessionId: 'tracked-s2',
        expectedRevision: returnEligibility.revision,
        lines: [{ lineId: 'tracked-line', quantity: '1' }],
      },
      adapter,
    )
    const finalRefund = (await call('pos.getOrder', { id: 'tracked-refund-final' }, adapter)).value as Row
    assert.deepEqual((finalRefund.lines as Row[])[0]!.lotSelections, [
      { lotId: 'batch-live', quantity: '1', stockRevision: null },
    ])
    await call(
      'pos.addPayment',
      {
        id: 'tracked-refund-final-pay',
        orderId: 'tracked-refund-final',
        paymentMethodId: 'cash-method',
        amount: '-10',
      },
      adapter,
    )
    assert.equal(
      ((await call('pos.validateOrder', { id: 'tracked-refund-final' }, adapter)).value as Row).ok,
      true,
    )
    assert.equal(
      (
        await adapter.all(
          'SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ? AND "lotId" = ?',
          ['batch-1', 'wh:stock', 'batch-live'],
        )
      )[0]!.quantity,
      '4',
    )

    await call('pos.createOrder', { id: 'serial-sale', sessionId: 'tracked-s2' }, adapter)
    for (const lineId of ['serial-line-a', 'serial-line-b'])
      await call(
        'pos.addLine',
        {
          id: lineId,
          orderId: 'serial-sale',
          productId: 'serial-1',
          productUomId: 'unit',
          qty: '1',
          priceUnit: '5',
        },
        adapter,
      )
    const serialAvailability = (
      await call(
        'pos.getLineTrackingAvailability',
        { orderId: 'serial-sale', lineId: 'serial-line-a' },
        adapter,
      )
    ).value as Row
    const serialA = (serialAvailability.lots as Row[]).find((lot) => lot.lotId === 'serial-a')!
    await call(
      'pos.setLineLotSelections',
      {
        orderId: 'serial-sale',
        lineId: 'serial-line-a',
        expectedRevision: 2,
        selections: [{ lotId: 'serial-a', quantity: '1', stockRevision: serialA.stockRevision }],
      },
      adapter,
    )
    await call(
      'pos.setLineLotSelections',
      {
        orderId: 'serial-sale',
        lineId: 'serial-line-b',
        expectedRevision: 3,
        selections: [{ lotId: 'serial-a', quantity: '1', stockRevision: serialA.stockRevision }],
      },
      adapter,
    )
    await call(
      'pos.addPayment',
      { id: 'serial-pay', orderId: 'serial-sale', paymentMethodId: 'cash-method', amount: '10' },
      adapter,
    )
    const duplicate = (await call('pos.validateOrder', { id: 'serial-sale', expectedRevision: 5 }, adapter))
      .value as Row
    assert.equal(duplicate.ok, false)
    assert.match(String((duplicate.errors as Row[])[0]!.message), /only be selected on one order line/)
    assert.equal(
      (await adapter.all('SELECT COUNT(*) AS n FROM stock_picking WHERE id = ?', ['serial-sale:picking']))[0]!
        .n,
      0,
    )
  } finally {
    await adapter.close()
  }
})
