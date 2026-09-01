import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { defineDeployment, defineFn, defineModule, type Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import {
  applyLoyaltyOrderReward,
  finalizeOrderLoyalty,
  loyaltyOrderFunctionSpecs,
  loyaltyPosFunctionSpecs,
  materializePosLoyaltyReward,
  posLoyaltyOrderSnapshot,
  reverseOrderLoyaltyPortion,
} from '@ketvietlab/ketsuite'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const loyaltyTransactionBridge = defineModule({
  name: 'loyalty_transaction_bridge_test',
  depends: ['loyalty', 'pos', 'product'],
  functions: {
    finalize: defineFn({
      input: { order: 'json' },
      effects: [...(loyaltyOrderFunctionSpecs['order.finalize']?.effects ?? [])],
      agent: true,
      handler: (ctx, args) => ctx.tx((tx) => finalizeOrderLoyalty(tx, args, { inTransaction: true })),
    }),
    reversePortion: defineFn({
      input: {
        orderType: 'text',
        orderId: 'text',
        reversalId: 'text',
        portion: 'decimal',
        complete: 'bool?',
      },
      effects: [...(loyaltyOrderFunctionSpecs['order.reversePortion']?.effects ?? [])],
      agent: true,
      handler: (ctx, args) => ctx.tx((tx) => reverseOrderLoyaltyPortion(tx, args, { inTransaction: true })),
    }),
    applyPosReward: defineFn({
      input: { orderId: 'id', programId: 'id', rewardId: 'id' },
      effects: [
        ...(loyaltyPosFunctionSpecs.applyReward?.effects ?? []),
        ...(loyaltyOrderFunctionSpecs.applyReward?.effects ?? []),
      ],
      agent: true,
      handler: (ctx, args) =>
        ctx.tx(async (tx) => {
          const order = await posLoyaltyOrderSnapshot(tx, String(args.orderId))
          if (!order) return { ok: false }
          const applied = await applyLoyaltyOrderReward(
            tx,
            { order, programId: args.programId, rewardId: args.rewardId },
            { inTransaction: true },
          )
          if (applied.ok !== true) return applied
          const materialized = await materializePosLoyaltyReward(
            tx,
            String(args.orderId),
            String(args.programId),
            applied.reward as Row,
          )
          return (materialized as Row).ok === true ? applied : materialized
        }),
    }),
  },
})

const loyaltyTransactionDeployment = defineDeployment({
  ...ketsuite,
  name: 'loyalty_transaction_test',
  modules: [...ketsuite.modules, loyaltyTransactionBridge],
})

type Call = <T = unknown>(
  name: string,
  input?: Record<string, unknown>,
  options?: { idempotencyKey?: string },
) => Promise<T>

const bootLoyalty = async (t: TestContext, worker = false, deployment = ketsuite) => {
  const e2e = await createTestDeployment(deployment, { worker })
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
      untaxed: String(total),
      total: String(total),
      lineKind: 'product',
    },
  ],
})

test('loyalty HTTP E2E: admin screens create, edit, archive and localize programs', async (t) => {
  const { e2e } = await bootLoyalty(t)
  const empty = await e2e.client.get('/admin/loyalty/programs')
  assert.equal(empty.status, 200)
  assert.match(await empty.text(), /Chương trình Loyalty/)

  // Every list, on an empty database, before anything exists to show. The
  // figures above each one are aggregate queries, and an aggregate the store
  // refuses is a 500 nobody sees until they open the page — which is how the
  // ledger shipped broken while every other loyalty test passed.
  for (const path of [
    '/admin/loyalty',
    '/admin/loyalty/programs',
    '/admin/loyalty/wallets',
    '/admin/loyalty/memberships',
    '/admin/loyalty/ledger',
    '/admin/loyalty/ledger?period=all',
  ]) {
    const page = await e2e.client.get(path)
    assert.equal(page.status, 200, `${path} answered ${page.status}`)
  }

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
  // Rules and rewards are set up on separate occasions and each carries its own
  // form, so each has its own tab — stacked, adding a reward meant scrolling past
  // every rule to reach the form for it.
  const rulesTab = await (await e2e.client.get(`${location}?tab=rules`)).text()
  assert.match(rulesTab, />5</)
  const rewardsTab = await (await e2e.client.get(`${location}?tab=rewards`)).text()
  assert.match(rewardsTab, /Tặng giỏ trái cây/)
  // And the counts are on the tabs themselves, so the overview says what is
  // there without anyone opening either.
  const populated = await (await e2e.client.get(location)).text()
  assert.match(populated, /data-ui="tabs"/)

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

test('loyalty transaction helper joins a channel-owned transaction without nesting', async (t) => {
  const { call } = await bootLoyalty(t, false, loyaltyTransactionDeployment)
  assert.equal((await saveProgram(call)).ok, true)
  assert.equal((await saveRule(call)).ok, true)

  const finalized = await call<Row>('loyalty_transaction_bridge_test.finalize', {
    order: snapshot('transaction-order'),
  })
  assert.equal(finalized.ok, true)
  let wallet = await call<Row>('loyalty.wallet.get', {
    partnerId: 'customer',
    programId: 'program',
  })
  assert.equal(wallet.balance, 2)
  assert.equal((wallet.ledger as Row[]).filter((entry) => entry.sourceId === 'transaction-order').length, 1)

  const reversed = await call<Row>('loyalty_transaction_bridge_test.reversePortion', {
    orderType: 'sale',
    orderId: 'transaction-order',
    reversalId: 'transaction-return',
    portion: '1',
    complete: true,
  })
  assert.equal(reversed.ok, true)
  wallet = await call<Row>('loyalty.wallet.get', { id: wallet.id })
  assert.equal(wallet.balance, 0)
  assert.equal((wallet.ledger as Row[]).filter((entry) => entry.operation === 'reverse').length, 1)
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
  const { e2e, call } = await bootLoyalty(t, true, loyaltyTransactionDeployment)
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Doanh thu', 'income'],
    ['receivable', '131', 'Phải thu khách hàng', 'asset_receivable'],
    ['tax', '3331', 'Thuế GTGT', 'liability_current'],
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
  await call<Row>('account.saveTax', {
    id: 'vat10',
    name: 'VAT 10%',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await call<Row>('account.setProductTax', { templateId: 'goods', taxId: 'vat10' })
  await call<Row>('pos.saveConfig', {
    id: 'shop',
    name: 'Cửa hàng chính',
    warehouseId: 'wh',
    pricelistId: 'retail',
    salesJournalId: 'sales',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
    taxAccountId: 'tax',
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
    id: 'pos-bridge',
    uuid: 'pos-bridge',
    sessionId: 'session',
    partnerId: 'customer',
  })
  await call<Row>('pos.addLine', {
    id: 'pos-bridge-line',
    orderId: 'pos-bridge',
    productId: 'fruit-box',
    productUomId: 'unit',
    qty: '1',
    priceUnit: '100',
  })
  const bridged = await call<Row>('loyalty_transaction_bridge_test.applyPosReward', {
    orderId: 'pos-bridge',
    programId: 'pos-program',
    rewardId: 'pos-reward',
  })
  assert.equal(bridged.ok, true)
  assert.equal(String((await call<Row>('pos.getOrder', { id: 'pos-bridge' })).amountTotal), '90')
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
  const discounted = await call<Row>('pos.getOrder', { id: 'pos-loyalty' })
  const rewardLines = (discounted.lines as Row[]).filter((line) => line.lineKind === 'reward')
  assert.equal(String(discounted.amountUntaxed), '82')
  assert.equal(String(discounted.amountTax), '8')
  assert.equal(String(discounted.amountTotal), '90')
  assert.equal(rewardLines.length, 1)
  assert.equal(rewardLines[0]?.taxId, 'vat10')
  assert.deepEqual(rewardLines[0]?.taxIds, ['vat10'])
  assert.equal(String(rewardLines[0]?.priceSubtotal), '-18')
  assert.equal(String(rewardLines[0]?.priceSubtotalIncl), '-20')
  await call<Row>('pos.addPayment', {
    id: 'pos-payment',
    orderId: 'pos-loyalty',
    paymentMethodId: 'cash-method',
    amount: '90',
  })
  const beforePayment = await call<Row>('pos.getOrder', { id: 'pos-loyalty' })
  assert.equal(Number(beforePayment.amountTotal), 90)
  assert.equal(Number(beforePayment.amountPaid), 90)
  const staleRemove = await call<Row>('loyalty_pos.removeReward', {
    orderId: 'pos-loyalty',
    programId: 'pos-program',
    expectedRevision: Number(beforePayment.revision) - 1,
  })
  assert.equal(staleRemove.ok, false)
  assert.equal(
    ((await call<Row>('pos.getOrder', { id: 'pos-loyalty' })).lines as Row[]).some(
      (line) => line.lineKind === 'reward',
    ),
    true,
  )
  await call<Row>('loyalty.reward.archive', { id: 'pos-reward', active: false })
  const stale = await call<Row>('loyalty_pos.validateOrder', {
    id: 'pos-loyalty',
    expectedRevision: beforePayment.revision,
  })
  assert.equal(stale.ok, false)
  const unchanged = await call<Row>('pos.getOrder', { id: 'pos-loyalty' })
  assert.equal(unchanged.state, 'draft')
  assert.equal(unchanged.pickingId, null)
  assert.equal(unchanged.accountMoveId, null)
  await call<Row>('loyalty.reward.archive', { id: 'pos-reward', active: true })
  const validated = await call<Row>('loyalty_pos.validateOrder', { id: 'pos-loyalty' })
  assert.equal(validated.ok, true, JSON.stringify(validated))
  await e2e.client.form('/admin/pos/orders/pos-loyalty', { action: 'validate' })
  let order = await call<Row>('pos.getOrder', { id: 'pos-loyalty' })
  assert.equal(order.state, 'paid', JSON.stringify(order))
  assert.equal(order.loyaltyState, 'finalized')
  assert.equal(
    (
      await e2e.adapter!.all('SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?', [
        'fruit-box',
        'wh:stock',
      ])
    )[0]!.quantity,
    '19',
    'discount reward lines must not create an extra stock move',
  )

  await call<Row>('loyalty_pos.refundOrder', {
    id: 'pos-refund',
    originalOrderId: 'pos-loyalty',
    sessionId: 'session',
  })
  await call<Row>('pos.addPayment', {
    id: 'refund-payment',
    orderId: 'pos-refund',
    paymentMethodId: 'cash-method',
    amount: '-90',
  })
  await call<Row>('loyalty_pos.validateOrder', { id: 'pos-refund' })
  order = await call<Row>('pos.getOrder', { id: 'pos-loyalty' })
  const refund = await call<Row>('pos.getOrder', { id: 'pos-refund' })
  assert.equal(refund.state, 'paid')
  assert.equal(refund.loyaltyState, 'reversed')
  assert.equal(order.loyaltyState, 'finalized')
  assert.equal(
    (
      await e2e.adapter!.all('SELECT quantity FROM stock_quant WHERE "productId" = ? AND "locationId" = ?', [
        'fruit-box',
        'wh:stock',
      ])
    )[0]!.quantity,
    '20',
    'refund must return only the stock-relevant product line',
  )
  const applications = (await call<Row>('loyalty.wallet.get', {
    partnerId: 'customer',
    programId: 'pos-program',
  })) as Row | null
  assert.equal(applications === null || Number(applications.balance) >= 0, true)

  await saveProgram(call, { id: 'pos-return-program', appliesOn: 'future', availableSale: false })
  await saveRule(call, {
    id: 'pos-return-rule',
    programId: 'pos-return-program',
    pointAmount: '5',
  })
  await call<Row>('pos.createOrder', {
    id: 'pos-partial-loyalty',
    sessionId: 'session',
    partnerId: 'customer',
  })
  await call<Row>('pos.addLine', {
    id: 'pos-partial-loyalty-line',
    orderId: 'pos-partial-loyalty',
    productId: 'fruit-box',
    productUomId: 'unit',
    qty: '2',
    priceUnit: '100',
  })
  await call<Row>('pos.addPayment', {
    id: 'pos-partial-loyalty-pay',
    orderId: 'pos-partial-loyalty',
    paymentMethodId: 'cash-method',
    amount: '220',
  })
  await call<Row>('loyalty_pos.validateOrder', { id: 'pos-partial-loyalty' })
  const earned = await e2e.adapter!.all(
    'SELECT id, "balanceDelta" FROM loyalty_ledger_entry WHERE "sourceType" = ? AND "sourceId" = ?',
    ['pos', 'pos-partial-loyalty'],
  )
  const earnedTotal = earned.reduce((sum, entry) => sum + Number(entry.balanceDelta), 0)
  assert.equal(earnedTotal > 0, true)

  let returnEligibility = await call<Row>('pos.getReturnEligibility', { id: 'pos-partial-loyalty' })
  await call<Row>('loyalty_pos.refundOrder', {
    id: 'pos-partial-loyalty-return-1',
    originalOrderId: 'pos-partial-loyalty',
    sessionId: 'session',
    expectedRevision: returnEligibility.revision,
    lines: [{ lineId: 'pos-partial-loyalty-line', quantity: '1' }],
  })
  await call<Row>('pos.addPayment', {
    id: 'pos-partial-loyalty-return-1-pay',
    orderId: 'pos-partial-loyalty-return-1',
    paymentMethodId: 'cash-method',
    amount: '-110',
  })
  await call<Row>('loyalty_pos.validateOrder', { id: 'pos-partial-loyalty-return-1' })
  const firstReversal = await e2e.adapter!.all(
    'SELECT "balanceDelta" FROM loyalty_ledger_entry WHERE "sourceType" = ? AND "sourceId" = ?',
    ['pos_return', 'pos-partial-loyalty-return-1'],
  )
  assert.equal(
    firstReversal.reduce((sum, entry) => sum + Number(entry.balanceDelta), 0),
    -earnedTotal / 2,
  )
  assert.equal(
    (
      await e2e.adapter!.all(
        'SELECT state FROM loyalty_application WHERE "orderType" = ? AND "orderId" = ?',
        ['pos', 'pos-partial-loyalty'],
      )
    )[0]!.state,
    'finalized',
  )
  await call<Row>('loyalty_pos.validateOrder', { id: 'pos-partial-loyalty-return-1' })
  assert.equal(
    (
      await e2e.adapter!.all(
        'SELECT COUNT(*) AS n FROM loyalty_ledger_entry WHERE "sourceType" = ? AND "sourceId" = ?',
        ['pos_return', 'pos-partial-loyalty-return-1'],
      )
    )[0]!.n,
    firstReversal.length,
  )

  returnEligibility = await call<Row>('pos.getReturnEligibility', { id: 'pos-partial-loyalty' })
  await call<Row>('loyalty_pos.refundOrder', {
    id: 'pos-partial-loyalty-return-2',
    originalOrderId: 'pos-partial-loyalty',
    sessionId: 'session',
    expectedRevision: returnEligibility.revision,
    lines: [{ lineId: 'pos-partial-loyalty-line', quantity: '1' }],
  })
  await call<Row>('pos.addPayment', {
    id: 'pos-partial-loyalty-return-2-pay',
    orderId: 'pos-partial-loyalty-return-2',
    paymentMethodId: 'cash-method',
    amount: '-110',
  })
  await call<Row>('loyalty_pos.validateOrder', { id: 'pos-partial-loyalty-return-2' })
  const allReversals = await e2e.adapter!.all(
    'SELECT "balanceDelta" FROM loyalty_ledger_entry WHERE "reversedEntryId" IS NOT NULL AND "sourceType" = ? AND "sourceId" IN (?, ?)',
    ['pos_return', 'pos-partial-loyalty-return-1', 'pos-partial-loyalty-return-2'],
  )
  assert.equal(
    allReversals.reduce((sum, entry) => sum + Number(entry.balanceDelta), 0),
    -earnedTotal,
  )
  assert.equal(
    (
      await e2e.adapter!.all(
        'SELECT state FROM loyalty_application WHERE "orderType" = ? AND "orderId" = ?',
        ['pos', 'pos-partial-loyalty'],
      )
    )[0]!.state,
    'reversed',
  )
  const spend = await e2e.adapter!.all('SELECT amount FROM loyalty_spend_entry WHERE "sourceType" = ?', [
    'pos_return:pos-partial-loyalty',
  ])
  assert.equal(
    spend.reduce((sum, entry) => sum + Number(entry.amount), 0),
    -220,
  )

  await call<Row>('pos.createOrder', {
    id: 'pos-reconcile',
    uuid: 'pos-reconcile',
    sessionId: 'session',
    partnerId: 'customer',
  })
  await call<Row>('pos.addLine', {
    id: 'pos-reconcile-line',
    orderId: 'pos-reconcile',
    productId: 'fruit-box',
    productUomId: 'unit',
    qty: '1',
    priceUnit: '100',
  })
  let pending = await call<Row>('pos.getOrder', { id: 'pos-reconcile' })
  await call<Row>('loyalty_pos.applyReward', {
    orderId: 'pos-reconcile',
    programId: 'pos-program',
    rewardId: 'pos-reward',
    expectedRevision: pending.revision,
  })
  pending = await call<Row>('pos.getOrder', { id: 'pos-reconcile' })
  await call<Row>('pos.addPayment', {
    id: 'pos-reconcile-payment',
    orderId: 'pos-reconcile',
    paymentMethodId: 'cash-method',
    amount: '90',
  })
  pending = await call<Row>('pos.getOrder', { id: 'pos-reconcile' })
  const coreValidated = await call<Row>('pos.validateOrder', {
    id: 'pos-reconcile',
    expectedRevision: pending.revision,
  })
  assert.equal(coreValidated.ok, true)
  const queued = await call<Row>('loyalty_pos.reconcileOrderAsync', {
    orderId: 'pos-reconcile',
    idempotencyKey: 'manual-recovery-1',
  })
  assert.equal(queued.ok, true)
  assert.equal((await call<Row>('pos.getOrder', { id: 'pos-reconcile' })).loyaltyState, 'pending_reconcile')
  assert.equal(await e2e.drainJobs(), 1)
  assert.equal((await call<Row>('pos.getOrder', { id: 'pos-reconcile' })).loyaltyState, 'finalized')
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

test('loyalty Sale keeps percentage rewards and posted contra revenue exact beyond safe integers', async (t) => {
  const { e2e, call } = await bootLoyalty(t)
  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Doanh thu', 'income'],
    ['receivable', '131', 'Phải thu khách hàng', 'asset_receivable'],
  ])
    await call<Row>('account.saveAccount', { id, code, name, accountType })
  await call<Row>('account.saveJournal', {
    id: 'sales-journal',
    name: 'Bán hàng',
    code: 'SAL',
    type: 'sale',
  })
  await saveProgram(call, { id: 'exact-program', appliesOn: 'current' })
  await saveRule(call, {
    id: 'exact-rule',
    programId: 'exact-program',
    pointAmount: '5',
    pointMode: 'order',
  })
  await saveReward(call, {
    id: 'exact-reward',
    programId: 'exact-program',
    requiredPoints: '5',
    discount: '10',
    discountMode: 'percent',
  })
  await call<Row>('sale.createOrder', {
    id: 'exact-order',
    partnerId: 'customer',
    warehouseId: 'wh',
  })
  await call<Row>('sale.addLine', {
    id: 'exact-order:line',
    orderId: 'exact-order',
    productId: 'fruit-box',
    productUomQty: '1',
    productUomId: 'unit',
    priceUnit: '9007199254740993',
  })

  const applied = await call<Row>('loyalty_sale.applyReward', {
    orderId: 'exact-order',
    programId: 'exact-program',
    rewardId: 'exact-reward',
  })
  assert.equal(applied.ok, true, JSON.stringify(applied.errors))
  assert.equal((applied.reward as Row).discountAmount, '900719925474099')
  const order = await call<Row>('sale.getOrder', { id: 'exact-order' })
  const rewardLine = (order.lines as Row[]).find((line) => line.lineKind === 'reward')!
  assert.equal(String(rewardLine.priceUnit), '-900719925474099')
  assert.equal(String(rewardLine.priceSubtotal), '-900719925474099')
  assert.equal(String(order.amountTotal), '8106479329266894')

  const confirmed = await call<Row>('loyalty_sale.confirmOrder', { id: 'exact-order' })
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed.errors))
  const invoiced = await call<Row>('sale.createInvoice', {
    id: 'exact-invoice',
    orderId: 'exact-order',
    journalId: 'sales-journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  assert.equal(invoiced.ok, true, JSON.stringify(invoiced.errors))
  assert.equal(invoiced.amountTotal, '8106479329266894')
  const posted = await call<Row>('account.postMove', { id: 'exact-invoice' })
  assert.equal(posted.ok, true, JSON.stringify(posted.errors))

  const move = (
    await e2e.adapter!.all('SELECT "amountUntaxed", "amountTotal" FROM account_move WHERE id = ?', [
      'exact-invoice',
    ])
  )[0]!
  assert.equal(String(move.amountUntaxed), '8106479329266894')
  assert.equal(String(move.amountTotal), '8106479329266894')
  const lines = await e2e.adapter!.all('SELECT debit, credit FROM account_move_line WHERE "moveId" = ?', [
    'exact-invoice',
  ])
  const debit = lines.reduce((sum, line) => sum + BigInt(String(line.debit)), 0n)
  const credit = lines.reduce((sum, line) => sum + BigInt(String(line.credit)), 0n)
  assert.equal(debit, 9007199254740993n)
  assert.equal(credit, debit)
})

test('loyalty Sale adapter keeps tax-inclusive points for legacy lines', async (t) => {
  const { e2e, call } = await bootLoyalty(t)
  await call('account.saveTax', {
    id: 'vat10',
    name: 'VAT 10%',
    typeTaxUse: 'sale',
    amountType: 'percent',
    amount: '10',
  })
  await saveProgram(call, { id: 'legacy-program' })
  await saveRule(call, {
    id: 'legacy-rule',
    programId: 'legacy-program',
    pointAmount: '1',
    pointMode: 'money',
    taxMode: 'incl',
  })
  await call<Row>('sale.createOrder', {
    id: 'legacy-order',
    partnerId: 'customer',
    warehouseId: 'wh',
  })
  await call<Row>('sale.addLine', {
    id: 'legacy-line',
    orderId: 'legacy-order',
    productId: 'fruit-box',
    productUomQty: '1',
    productUomId: 'unit',
    priceUnit: '100',
    taxId: 'vat10',
  })
  await e2e.adapter!.run('UPDATE sale_order_line SET "priceSubtotalIncl" = NULL WHERE id = ?', [
    'legacy-line',
  ])

  const evaluated = await call<Row>('loyalty_sale.evaluateOrder', { orderId: 'legacy-order' })
  assert.equal(((evaluated.programs as Row[])[0]?.points as number) ?? 0, 110)
})
