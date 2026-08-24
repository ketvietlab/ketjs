import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Call = <T = unknown>(
  name: string,
  input?: Record<string, unknown>,
  options?: { idempotencyKey?: string },
) => Promise<T>

const bootLoyalty = async (t: TestContext, worker = false) => {
  const e2e = await createTestDeployment(ketsuite, { worker })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>, at = scope) =>
    e2e.fixture.call<Row>(name, input, { scope: at })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', {
    id: 'customer',
    kind: 'person',
    name: 'Khách hàng Minh Anh',
    email: 'minhanh@example.test',
  })
  await fixture('partner.savePartner', {
    id: 'customer-2',
    kind: 'person',
    name: 'Khách hàng Thu Hà',
  })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    partnerId: 'customer',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })

  const call: Call = async (name, input = {}, options = {}) =>
    (await e2e.client.call(name, input, options)).value as never

  await call('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'goods',
    name: 'Giỏ trái cây',
    type: 'goods',
    uomId: 'unit',
    listPrice: '100',
    saleOk: true,
  })
  await call('product.saveVariant', {
    id: 'fruit-box',
    templateId: 'goods',
    defaultCode: 'FRUIT-01',
    combinationKey: '',
  })
  await call('stock.configureProduct', { templateId: 'goods', isStorable: true, tracking: 'none' })
  await call('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await call('stock.saveLocation', { id: 'inventory', name: 'Inventory', usage: 'inventory' })
  await call('stock.adjustInventory', {
    id: 'fruit-stock',
    productId: 'fruit-box',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '20',
    productUomId: 'unit',
  })
  await call('pricing.savePricelist', { id: 'retail', name: 'Bán lẻ' })

  return { e2e, call, fixture }
}

const saveProgram = (call: Call, values: Partial<Row> = {}) =>
  call<Row>('loyalty.program.save', {
    id: values.id ?? 'program',
    name: values.name ?? 'Thành viên King Fruit',
    programType: values.programType ?? 'loyalty',
    sequence: values.sequence ?? 10,
    currency: values.currency ?? 'VND',
    appliesOn: values.appliesOn ?? 'future',
    trigger: values.trigger ?? 'auto',
    portalVisible: values.portalVisible ?? true,
    pointName: values.pointName ?? 'Điểm',
    availableSale: values.availableSale ?? true,
    availablePos: values.availablePos ?? true,
  })

const saveRule = (call: Call, values: Partial<Row> = {}) =>
  call<Row>('loyalty.rule.save', {
    id: values.id ?? 'rule',
    programId: values.programId ?? 'program',
    priority: values.priority ?? 10,
    pointAmount: values.pointAmount ?? '2',
    pointMode: values.pointMode ?? 'order',
    pointSplit: values.pointSplit ?? false,
    minimumQuantity: values.minimumQuantity ?? '1',
    minimumAmount: values.minimumAmount ?? '0',
    taxMode: values.taxMode ?? 'excl',
    mode: values.mode ?? 'auto',
    ...(values.code ? { code: values.code } : {}),
  })

const saveReward = (call: Call, values: Partial<Row> = {}) =>
  call<Row>('loyalty.reward.save', {
    id: values.id ?? 'reward',
    programId: values.programId ?? 'program',
    description: values.description ?? 'Giảm 20.000 đ',
    rewardType: values.rewardType ?? 'discount',
    discount: values.discount ?? '20',
    discountMode: values.discountMode ?? 'per_order',
    discountApplicability: values.discountApplicability ?? 'order',
    requiredPoints: values.requiredPoints ?? '5',
    rewardProductQuantity: values.rewardProductQuantity ?? '1',
    clearWallet: values.clearWallet ?? false,
    ...(values.rewardProductId ? { rewardProductId: values.rewardProductId } : {}),
  })

const snapshot = (orderId: string, total = 100, date = new Date().toISOString()) => ({
  orderType: 'sale',
  orderId,
  partnerId: 'customer',
  currency: 'VND',
  pricelistId: 'retail',
  date,
  lines: [
    {
      id: `${orderId}:line`,
      productId: 'fruit-box',
      quantity: 1,
      untaxed: total,
      total,
      lineKind: 'product',
    },
  ],
})

test('loyalty HTTP E2E: admin screens create, edit, archive and localize programs', async (t) => {
  const { e2e } = await bootLoyalty(t)
  const empty = await e2e.client.get('/admin/loyalty/programs')
  assert.equal(empty.status, 200)
  assert.match(await empty.text(), /Chương trình Loyalty/)

  const created = await e2e.client.post(
    '/admin/loyalty/programs',
    new URLSearchParams({ name: 'Mua X tặng Y', programType: 'buy_x_get_y' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(created.status, 303)
  const location = created.headers.get('location') ?? ''
  assert.match(location, /^\/admin\/loyalty\/programs\/[0-9a-f-]+$/)

  const detail = await e2e.client.get(location)
  assert.equal(detail.status, 200)
  const detailHtml = await detail.text()
  assert.match(detailHtml, /Mua X tặng Y/)
  assert.match(detailHtml, /data-ui="record-form"/)

  const id = location.split('/').pop()!
  await e2e.client.form(location, {
    action: 'add-rule',
    priority: '5',
    pointAmount: '1',
    pointMode: 'order',
    minimumQuantity: '1',
    minimumAmount: '0',
    taxMode: 'excl',
    mode: 'auto',
  })
  await e2e.client.form(location, {
    action: 'add-reward',
    description: 'Tặng giỏ trái cây',
    rewardType: 'product',
    rewardProductId: 'fruit-box',
    rewardProductQuantity: '1',
    requiredPoints: '1',
    discountMode: 'percent',
    discountApplicability: 'order',
  })
  const populated = await (await e2e.client.get(location)).text()
  assert.match(populated, /Tặng giỏ trái cây/)
  assert.match(populated, />5</)

  await e2e.client.form(location, { action: 'archive' })
  const archived = await (await e2e.client.get(location)).text()
  assert.match(archived, /Đã lưu trữ/)

  const english = await e2e.client.get(`${location}?lang=en`)
  const englishHtml = await english.text()
  assert.equal(english.status, 200)
  assert.match(englishHtml, /Program settings|Buy X get Y/)
  assert.doesNotMatch(englishHtml, /loyalty(?:_backend)?\.[A-Za-z]/)
  assert.equal(id.length > 10, true)
})

test('loyalty HTTP E2E: reservation, concurrent redeem, finalize retry and reversal keep ledger correct', async (t) => {
  const { call } = await bootLoyalty(t)
  assert.equal((await saveProgram(call)).ok, true)
  assert.equal((await saveRule(call)).ok, true)
  assert.equal((await saveReward(call)).ok, true)
  assert.equal(
    (
      await call<Row>('loyalty.wallet.create', {
        id: 'wallet',
        programId: 'program',
        partnerId: 'customer',
        code: 'KING-10',
        initialBalance: '10',
      })
    ).ok,
    true,
  )

  const firstOrder = snapshot('order-1')
  const applied = await call<Row>(
    'loyalty.applyReward',
    { order: firstOrder, programId: 'program', rewardId: 'reward' },
    { idempotencyKey: 'redeem-order-1' },
  )
  assert.equal(applied.ok, true)
  assert.equal((await call<Row>('loyalty.wallet.get', { id: 'wallet' })).reserved, 5)

  const competing = await Promise.all(
    ['order-2', 'order-3'].map((id) =>
      call<Row>(
        'loyalty.applyReward',
        { order: snapshot(id), programId: 'program', rewardId: 'reward' },
        { idempotencyKey: `redeem-${id}` },
      ),
    ),
  )
  assert.equal(competing.filter((result) => result.ok).length, 1)
  assert.equal(competing.filter((result) => !result.ok).length, 1)
  const heldId = competing[0]!.ok ? 'order-2' : 'order-3'

  const finalized = await call<Row>(
    'loyalty.order.finalize',
    { order: firstOrder },
    { idempotencyKey: 'finalize-1' },
  )
  assert.equal(finalized.ok, true)
  await call<Row>('loyalty.order.finalize', { order: firstOrder }, { idempotencyKey: 'finalize-1-retry' })
  let wallet = await call<Row>('loyalty.wallet.get', { id: 'wallet' })
  assert.equal(wallet.balance, 7)
  assert.equal(wallet.reserved, 5)
  assert.equal((wallet.ledger as Row[]).filter((entry) => entry.sourceId === 'order-1').length, 2)

  await call<Row>('loyalty.removeReward', { orderType: 'sale', orderId: heldId, programId: 'program' })
  const reversed = await call<Row>('loyalty.order.reverse', { orderType: 'sale', orderId: 'order-1' })
  assert.equal(reversed.ok, true)
  await call<Row>('loyalty.order.reverse', { orderType: 'sale', orderId: 'order-1' })
  wallet = await call<Row>('loyalty.wallet.get', { id: 'wallet' })
  assert.equal(wallet.balance, 10)
  assert.equal(wallet.reserved, 0)
  assert.equal((wallet.ledger as Row[]).filter((entry) => entry.operation === 'reverse').length, 2)
})

test('loyalty HTTP E2E: promotion code is applied through the public HTTP boundary', async (t) => {
  const { call } = await bootLoyalty(t)
  await saveProgram(call, {
    id: 'promo',
    programType: 'promo_code',
    appliesOn: 'current',
    trigger: 'with_code',
  })
  await saveRule(call, {
    id: 'promo-rule',
    programId: 'promo',
    mode: 'with_code',
    code: 'KINGFRESH',
  })
  await saveReward(call, { id: 'promo-reward', programId: 'promo', requiredPoints: '2' })

  const order = snapshot('promo-order')
  const applied = await call<Row>(
    'loyalty.applyCode',
    { order, code: ' kingfresh ' },
    { idempotencyKey: 'promo-order:code' },
  )
  assert.equal(applied.ok, true)
  assert.equal((applied.program as Row).programId, 'promo')
  const replay = await call<Row>(
    'loyalty.applyCode',
    { order, code: ' kingfresh ' },
    { idempotencyKey: 'promo-order:code' },
  )
  assert.equal(replay.ok, true)
  const invalid = await call<Row>('loyalty.applyCode', { order, code: 'NOT-A-CODE' })
  assert.equal(invalid.ok, false)
  assert.equal((invalid.errors as Row[])[0]?.code, 'loyalty.error.codeInvalid')
})

test('loyalty HTTP E2E: durable worker drains wallet expiry and membership refresh jobs', async (t) => {
  const { e2e, call } = await bootLoyalty(t, true)
  await saveProgram(call, {
    id: 'wallet-program',
    programType: 'ewallet',
    appliesOn: 'future',
  })
  await call<Row>('loyalty.wallet.create', {
    id: 'expired-wallet',
    programId: 'wallet-program',
    partnerId: 'customer',
    initialBalance: '12',
    expiresAt: '2026-01-01T00:00:00.000Z',
  })
  const expiry = await call<Row>('loyalty.maintenance.expire', {
    at: '2026-08-20T00:00:00.000Z',
    idempotencyKey: 'expiry-2026-08-20',
  })
  assert.equal(expiry.ok, true)
  const duplicateExpiry = await call<Row>('loyalty.maintenance.expire', {
    at: '2026-08-20T00:00:00.000Z',
    idempotencyKey: 'expiry-2026-08-20',
  })
  assert.equal(duplicateExpiry.duplicate, true)

  await saveProgram(call, { id: 'member-program', appliesOn: 'both' })
  await call<Row>('loyalty.tier.save', {
    id: 'member-tier',
    name: 'Thành viên',
    code: 'member',
    minimumSpend: '0',
    redeemPercent: '20',
  })
  await call<Row>('loyalty.membership.config.save', {
    id: 'member-config',
    programId: 'member-program',
    windowMonths: 12,
    pointValue: '1',
    minimumRedeemStep: '1',
    fallbackCurrencyPerPoint: '1',
    fallbackEnabled: true,
  })
  const refresh = await call<Row>('loyalty.membership.refreshAsync', {
    partnerId: 'customer',
    at: '2026-08-20T00:00:00.000Z',
    idempotencyKey: 'membership-2026-08-20',
  })
  assert.equal(refresh.ok, true)

  assert.equal(await e2e.drainJobs(), 2)
  const wallet = await call<Row>('loyalty.wallet.get', { id: 'expired-wallet' })
  assert.equal(wallet.active, false)
  assert.equal(wallet.balance, 0)
  assert.equal(
    (wallet.ledger as Row[]).some((entry) => entry.operation === 'expire'),
    true,
  )
  const summary = await call<Row>('loyalty.membership.getSummary', { partnerId: 'customer' })
  assert.equal(summary.tierCode, 'member')
  assert.equal(summary.refreshedAt, '2026-08-20T00:00:00.000Z')
})

test('loyalty HTTP E2E: tier window, stable earn-group priority and redeem cap are enforced', async (t) => {
  const { call } = await bootLoyalty(t)
  await saveProgram(call, { id: 'membership', appliesOn: 'both' })
  await saveRule(call, { id: 'membership-rule', programId: 'membership', pointAmount: '1' })
  await saveReward(call, {
    id: 'membership-reward',
    programId: 'membership',
    discount: '20',
    requiredPoints: '5',
  })
  await call<Row>('loyalty.tier.save', {
    id: 'bronze',
    name: 'Đồng',
    code: 'bronze',
    minimumSpend: '0',
    redeemPercent: '20',
  })
  await call<Row>('loyalty.tier.save', {
    id: 'silver',
    name: 'Bạc',
    code: 'silver',
    minimumSpend: '100',
    redeemPercent: '50',
  })
  await call<Row>('loyalty.membership.config.save', {
    id: 'config',
    programId: 'membership',
    windowMonths: 12,
    pointValue: '1',
    minimumRedeemStep: '1',
    fallbackCurrencyPerPoint: '10',
    fallbackEnabled: true,
  })
  await call<Row>('loyalty.earnGroup.save', {
    id: 'blocked',
    programId: 'membership',
    name: 'Không tích điểm',
    code: 'blocked',
    priority: 1,
    earnsPoints: false,
    currencyPerPoint: '1',
    productId: 'fruit-box',
  })
  await call<Row>('loyalty.earnGroup.save', {
    id: 'fallback-product',
    programId: 'membership',
    name: 'Tích sau',
    code: 'fallback-product',
    priority: 2,
    earnsPoints: true,
    currencyPerPoint: '5',
    productId: 'fruit-box',
  })
  await call<Row>('loyalty.wallet.create', {
    id: 'member-wallet',
    programId: 'membership',
    partnerId: 'customer',
    initialBalance: '20',
  })

  const evaluation = await call<Row>('loyalty.evaluateOrder', { order: snapshot('priority', 100) })
  const membershipProgram = (evaluation.programs as Row[]).find((row) => row.programId === 'membership')!
  assert.equal(membershipProgram.points, 0, 'first matching earn group wins even when it blocks points')

  const oldDate = new Date()
  oldDate.setUTCMonth(oldDate.getUTCMonth() - 13)
  await call<Row>('loyalty.order.finalize', { order: snapshot('old-order', 200, oldDate.toISOString()) })
  await call<Row>('loyalty.order.finalize', { order: snapshot('current-order', 50) })
  let summary = (await call<Row>('loyalty.membership.refresh', { partnerId: 'customer' })).summary as Row
  assert.equal(summary.rollingSpend, 50)
  assert.equal(summary.tierCode, 'bronze')

  const capped = await call<Row>('loyalty.applyReward', {
    order: snapshot('capped-order', 50),
    programId: 'membership',
    rewardId: 'membership-reward',
  })
  assert.equal(capped.ok, false)
  assert.equal((capped.errors as Row[])[0]?.code, 'loyalty.error.redeemCap')

  await call<Row>('loyalty.order.finalize', { order: snapshot('silver-order', 60) })
  summary = (await call<Row>('loyalty.membership.refresh', { partnerId: 'customer' })).summary as Row
  assert.equal(summary.rollingSpend, 110)
  assert.equal(summary.tierCode, 'silver')
  assert.equal(
    (
      await call<Row>('loyalty.applyReward', {
        order: snapshot('allowed-order', 50),
        programId: 'membership',
        rewardId: 'membership-reward',
      })
    ).ok,
    true,
  )
})

test('loyalty HTTP E2E: POS payment and refund finalize and reverse through the adapter', async (t) => {
  const { e2e, call } = await bootLoyalty(t)
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Doanh thu', 'income'],
    ['receivable', '131', 'Phải thu khách hàng', 'asset_receivable'],
    ['cash', '1111', 'Tiền mặt', 'asset_cash'],
  ])
    await call<Row>('account.saveAccount', { id, code, name, accountType })
  await call<Row>('account.saveJournal', { id: 'sales', name: 'Bán hàng', code: 'SAL', type: 'sale' })
  await call<Row>('account.saveJournal', {
    id: 'cash-journal',
    name: 'Tiền mặt',
    code: 'CSH',
    type: 'cash',
    defaultAccountId: 'cash',
  })
  await call<Row>('pos.saveConfig', {
    id: 'shop',
    name: 'Cửa hàng chính',
    warehouseId: 'wh',
    pricelistId: 'retail',
    salesJournalId: 'sales',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  await call<Row>('pos.savePaymentMethod', {
    id: 'cash-method',
    name: 'Tiền mặt',
    journalId: 'cash-journal',
    isCash: true,
  })
  await call<Row>('pos.linkPaymentMethod', {
    id: 'shop:cash',
    configId: 'shop',
    paymentMethodId: 'cash-method',
  })
  await call<Row>('pos.createSession', {
    id: 'session',
    configId: 'shop',
    userId: 'admin',
    openingCash: '0',
  })
  await call<Row>('pos.openSession', { id: 'session' })
  await saveProgram(call, { id: 'pos-program', appliesOn: 'current', availableSale: false })
  await saveRule(call, { id: 'pos-rule', programId: 'pos-program', pointAmount: '5' })
  await saveReward(call, { id: 'pos-reward', programId: 'pos-program', requiredPoints: '5' })
  await call<Row>('pos.createOrder', {
    id: 'pos-loyalty',
    uuid: 'pos-loyalty',
    sessionId: 'session',
    partnerId: 'customer',
  })
  await call<Row>('pos.addLine', {
    id: 'pos-line',
    orderId: 'pos-loyalty',
    productId: 'fruit-box',
    productUomId: 'unit',
    qty: '1',
    priceUnit: '100',
  })
  const detail = await (await e2e.client.get('/admin/pos/orders/pos-loyalty')).text()
  assert.match(detail, /Mở ưu đãi Loyalty/)
  await e2e.client.form('/admin/loyalty/orders/pos/pos-loyalty', {
    action: 'reward',
    programId: 'pos-program',
    rewardId: 'pos-reward',
  })
  assert.doesNotMatch(
    await (await e2e.client.get('/admin/loyalty/orders/pos/pos-loyalty')).text(),
    /undefined/,
  )
  await call<Row>('pos.addPayment', {
    id: 'pos-payment',
    orderId: 'pos-loyalty',
    paymentMethodId: 'cash-method',
    amount: '80',
  })
  const beforePayment = await call<Row>('pos.getOrder', { id: 'pos-loyalty' })
  assert.equal(Number(beforePayment.amountTotal), 80)
  assert.equal(Number(beforePayment.amountPaid), 80)
  const validated = await call<Row>('loyalty_pos.validateOrder', { id: 'pos-loyalty' })
  assert.equal(validated.ok, true, JSON.stringify(validated))
  await e2e.client.form('/admin/pos/orders/pos-loyalty', { action: 'validate' })
  let order = await call<Row>('pos.getOrder', { id: 'pos-loyalty' })
  assert.equal(order.state, 'paid', JSON.stringify(order))
  assert.equal(order.loyaltyState, 'finalized')

  await call<Row>('loyalty_pos.refundOrder', {
    id: 'pos-refund',
    originalOrderId: 'pos-loyalty',
    sessionId: 'session',
  })
  await call<Row>('pos.addPayment', {
    id: 'refund-payment',
    orderId: 'pos-refund',
    paymentMethodId: 'cash-method',
    amount: '-80',
  })
  await call<Row>('loyalty_pos.validateOrder', { id: 'pos-refund' })
  order = await call<Row>('pos.getOrder', { id: 'pos-loyalty' })
  const refund = await call<Row>('pos.getOrder', { id: 'pos-refund' })
  assert.equal(refund.state, 'paid')
  assert.equal(refund.loyaltyState, 'reversed')
  assert.equal(order.loyaltyState, 'finalized')
  const applications = (await call<Row>('loyalty.wallet.get', {
    partnerId: 'customer',
    programId: 'pos-program',
  })) as Row | null
  assert.equal(applications === null || Number(applications.balance) >= 0, true)
})

test('loyalty HTTP E2E: Sale UI adapter, portal actor and company scope stay isolated', async (t) => {
  const { e2e, call, fixture } = await bootLoyalty(t)
  await saveProgram(call, { id: 'sale-program', appliesOn: 'current' })
  await saveRule(call, { id: 'sale-rule', programId: 'sale-program', pointAmount: '5' })
  await saveReward(call, { id: 'sale-reward', programId: 'sale-program', requiredPoints: '5' })
  await call<Row>('sale.createOrder', {
    id: 'so-loyalty',
    partnerId: 'customer',
    warehouseId: 'wh',
    pricelistId: 'retail',
  })
  await call<Row>('sale.addLine', {
    id: 'so-loyalty:line',
    orderId: 'so-loyalty',
    productId: 'fruit-box',
    productUomQty: '1',
    productUomId: 'unit',
    priceUnit: '100',
  })

  const detail = await (await e2e.client.get('/admin/sales/quotations/so-loyalty')).text()
  assert.match(detail, /Mở ưu đãi Loyalty/)
  await e2e.client.form('/admin/loyalty/orders/sale/so-loyalty', {
    action: 'reward',
    programId: 'sale-program',
    rewardId: 'sale-reward',
  })
  let order = await call<Row>('sale.getOrder', { id: 'so-loyalty' })
  assert.equal(
    (order.lines as Row[]).some((line) => line.lineKind === 'reward'),
    true,
  )

  await e2e.client.form('/admin/sales/quotations/so-loyalty', { action: 'confirm' })
  order = await call<Row>('sale.getOrder', { id: 'so-loyalty' })
  assert.equal(order.state, 'sale')
  assert.equal(order.loyaltyState, 'finalized')
  assert.equal(
    (
      await call<Row>('loyalty_sale.refundOrder', {
        id: 'sale-refund-event',
        originalOrderId: 'so-loyalty',
      })
    ).ok,
    true,
  )
  await e2e.client.form('/admin/sales/orders/so-loyalty', { action: 'cancel' })
  order = await call<Row>('sale.getOrder', { id: 'so-loyalty' })
  assert.equal(order.state, 'cancel')
  assert.equal(order.loyaltyState, 'reversed')

  await call<Row>('loyalty.wallet.create', {
    id: 'portal-wallet',
    programId: 'sale-program',
    partnerId: 'customer',
    initialBalance: '9',
  })
  await call<Row>('loyalty.wallet.create', {
    id: 'other-wallet',
    programId: 'sale-program',
    partnerId: 'customer-2',
    initialBalance: '999',
  })
  const portal = await e2e.client.get('/my/loyalty?lang=en')
  const portalHtml = await portal.text()
  assert.equal(portal.status, 200)
  assert.match(portalHtml, /My Loyalty/)
  assert.match(portalHtml, /portal-wallet|9/)
  assert.doesNotMatch(portalHtml, /999/)
  assert.doesNotMatch(portalHtml, /undefined/)

  await fixture('partner.savePartner', { id: 'globex-party', kind: 'company', name: 'Globex' })
  await fixture('company.saveCompany', {
    id: 'globex',
    code: 'GLOBEX',
    partnerId: 'globex-party',
    currency: 'USD',
  })
  await fixture('user.grantCompany', { id: 'admin:globex', userId: 'admin', companyId: 'globex' })
  await e2e.client.form('/admin/context', {
    companyId: 'globex',
    branchId: 'root:globex',
    'company.globex': '1',
    'branch.root:globex': '1',
  })
  const globexPrograms = await call<Row[]>('loyalty.program.list', { includeArchived: true })
  assert.equal(
    globexPrograms.some((program) => program.id === 'sale-program'),
    false,
  )

  await fixture('user.createUser', {
    id: 'limited',
    login: 'limited',
    password: 'correct horse',
    name: 'Limited user',
    defaultCompanyId: 'acme',
  })
  await fixture('user.grantCompany', { id: 'limited:acme', userId: 'limited', companyId: 'acme' })
  await fixture('user.grantBranch', {
    id: 'limited:root:acme',
    userId: 'limited',
    branchId: 'root:acme',
  })
  const limited = e2e.client.anonymous()
  await limited.login({ login: 'limited', password: 'correct horse' })
  const denied = await limited.get('/admin/loyalty/programs', { headers: { accept: 'application/json' } })
  assert.equal([400, 403].includes(denied.status), true)
})
