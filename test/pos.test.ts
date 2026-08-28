import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
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
  callFn(name, args, { adapter, manifest, scope })

test('pos: stock moves are indexed by their originating order line', () => {
  const indexes = Object.values(schemaFromManifest(manifest).tables.stock_move!.indexes)
  assert.ok(indexes.some((index) => index.fields.join(',') === 'companyId,posLineId'))
})

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' }, adapter)
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
    await call(
      'pos.refundOrder',
      { id: 'tracked-refund', originalOrderId: 'tracked-sale', sessionId: 'tracked-s2' },
      adapter,
    )
    const refund = (await call('pos.getOrder', { id: 'tracked-refund' }, adapter)).value as Row
    assert.deepEqual((refund.lines as Row[])[0]!.lotSelections, [
      { lotId: 'batch-live', quantity: '2', stockRevision: null },
    ])
    await call(
      'pos.addPayment',
      { id: 'tracked-refund-pay', orderId: 'tracked-refund', paymentMethodId: 'cash-method', amount: '-20' },
      adapter,
    )
    assert.equal(((await call('pos.validateOrder', { id: 'tracked-refund' }, adapter)).value as Row).ok, true)
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
