// Repeatable local data for browser review of Loyalty screens.
// The target must be an explicit, new SQLite file; this tool never replaces data.

import { existsSync } from 'node:fs'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

const path = process.env.KET_VISUAL_SQLITE
if (!path) throw new Error('set KET_VISUAL_SQLITE to a new SQLite file')
if (existsSync(path)) throw new Error(`refusing to replace existing visual database: ${path}`)

const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : [])]
const manifest = compose(modules)
const adapter = sqliteAdapter(path)
await adapter.open()
await migrateOne(adapter, manifest)
registerFunctions(modules)

const scope = {
  company: 'default',
  companies: ['default'],
  branch: 'root:default',
  branches: ['root:default'],
}
const call = async (name: string, input: Record<string, unknown>) => {
  const result = await callFn(name, input, { adapter, manifest, scope })
  const value = result.value as { ok?: boolean; errors?: unknown }
  if (value?.ok === false) throw new Error(`${name}: ${JSON.stringify(value.errors)}`)
  return result.value as Row
}

try {
  await call('partner.savePartner', {
    id: 'company-party',
    kind: 'company',
    name: 'Công ty Cổ phần King Fruit',
    email: 'hello@kingfruit.example',
  })
  await call('partner.savePartner', {
    id: 'minh-anh',
    kind: 'person',
    name: 'Nguyễn Minh Anh',
    ref: 'KH-00128',
    email: 'minhanh@example.test',
    phone: '0903 456 789',
  })
  await call('company.saveCompany', {
    id: 'default',
    code: 'KING',
    partnerId: 'company-party',
    currency: 'VND',
  })
  await call('user.createUser', {
    id: 'visual-admin',
    login: 'admin',
    password: 'loyalty-demo',
    name: 'Quản trị King Fruit',
    partnerId: 'minh-anh',
    defaultCompanyId: 'default',
    defaultBranchId: 'root:default',
    superuser: true,
  })
  await call('user.grantCompany', {
    id: 'visual-admin:default',
    userId: 'visual-admin',
    companyId: 'default',
  })
  await call('user.grantBranch', {
    id: 'visual-admin:root',
    userId: 'visual-admin',
    branchId: 'root:default',
  })
  await call('uom.saveUnit', { id: 'unit', name: 'Giỏ', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'fruit-template',
    name: 'Giỏ trái cây Premium',
    type: 'goods',
    uomId: 'unit',
    listPrice: '1250000',
    saleOk: true,
  })
  await call('product.saveVariant', {
    id: 'fruit-box',
    templateId: 'fruit-template',
    defaultCode: 'PREMIUM-01',
    combinationKey: '',
  })
  await call('stock.configureProduct', {
    templateId: 'fruit-template',
    isStorable: true,
    tracking: 'none',
  })
  await call('stock.saveWarehouse', { id: 'wh', name: 'Kho King Fruit', code: 'KING' })
  await call('stock.saveLocation', { id: 'inventory', name: 'Kiểm kê', usage: 'inventory' })
  await call('stock.adjustInventory', {
    id: 'opening',
    productId: 'fruit-box',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory',
    countedQuantity: '100',
    productUomId: 'unit',
  })
  await call('pricing.savePricelist', { id: 'retail', name: 'Bảng giá bán lẻ' })

  const programs = [
    {
      id: 'king-club',
      name: 'King Club 2026',
      programType: 'loyalty',
      appliesOn: 'both',
      trigger: 'auto',
      portalVisible: true,
      pointName: 'King Point',
    },
    {
      id: 'fresh-code',
      name: 'Mã mùa trái cây tươi',
      programType: 'promo_code',
      appliesOn: 'current',
      trigger: 'with_code',
      portalVisible: false,
      pointName: 'Điểm ưu đãi',
    },
    {
      id: 'gift-card',
      name: 'Thẻ quà tặng King Fruit',
      programType: 'gift_card',
      appliesOn: 'future',
      trigger: 'with_code',
      portalVisible: true,
      pointName: 'VND',
    },
    {
      id: 'next-order',
      name: 'Phiếu cho đơn hàng kế tiếp',
      programType: 'next_order_coupons',
      appliesOn: 'future',
      trigger: 'auto',
      portalVisible: false,
      pointName: 'Phiếu',
    },
  ]
  for (const [sequence, program] of programs.entries())
    await call('loyalty.program.save', {
      ...program,
      sequence: sequence * 10,
      currency: 'VND',
      availableSale: true,
      availablePos: true,
    })

  await call('loyalty.rule.save', {
    id: 'king-club:rule',
    programId: 'king-club',
    priority: 10,
    pointAmount: '1',
    pointMode: 'money',
    minimumQuantity: '1',
    minimumAmount: '100000',
    taxMode: 'excl',
    mode: 'auto',
  })
  await call('loyalty.reward.save', {
    id: 'king-club:reward',
    programId: 'king-club',
    description: 'Giảm 200.000 đ bằng King Point',
    rewardType: 'discount',
    discount: '200000',
    discountMode: 'per_order',
    discountApplicability: 'order',
    requiredPoints: '200',
  })
  await call('loyalty.rule.save', {
    id: 'fresh-code:rule',
    programId: 'fresh-code',
    priority: 1,
    pointAmount: '1',
    pointMode: 'order',
    minimumQuantity: '1',
    minimumAmount: '0',
    taxMode: 'excl',
    mode: 'with_code',
    code: 'KINGFRESH',
  })
  await call('loyalty.reward.save', {
    id: 'fresh-code:reward',
    programId: 'fresh-code',
    description: 'Giảm 10% mùa trái cây tươi',
    rewardType: 'discount',
    discount: '10',
    discountMode: 'percent',
    discountApplicability: 'order',
    discountMaximum: '300000',
    requiredPoints: '1',
  })
  await call('loyalty.tier.save', {
    id: 'silver',
    name: 'Thành viên Bạc',
    code: 'silver',
    sequence: 10,
    minimumSpend: '0',
    redeemPercent: '20',
  })
  await call('loyalty.tier.save', {
    id: 'gold',
    name: 'Thành viên Vàng',
    code: 'gold',
    sequence: 20,
    minimumSpend: '5000000',
    redeemPercent: '40',
  })
  await call('loyalty.membership.config.save', {
    id: 'king-club:config',
    programId: 'king-club',
    windowMonths: 12,
    pointValue: '1000',
    minimumRedeemStep: '10',
    fallbackCurrencyPerPoint: '1000',
    fallbackEnabled: true,
  })
  await call('loyalty.wallet.create', {
    id: 'king-wallet',
    programId: 'king-club',
    partnerId: 'minh-anh',
    code: 'KING-00128',
    initialBalance: '1250',
  })
  await call('loyalty.wallet.adjust', {
    id: 'king-wallet',
    amount: '150',
    sourceId: 'birthday-2026',
    note: 'Tặng điểm sinh nhật',
  })

  for (const [id, code, name, accountType] of [
    ['revenue', '5111', 'Doanh thu', 'income'],
    ['receivable', '131', 'Phải thu khách hàng', 'asset_receivable'],
    ['cash', '1111', 'Tiền mặt', 'asset_cash'],
  ])
    await call('account.saveAccount', { id, code, name, accountType })
  await call('account.saveJournal', {
    id: 'sales-journal',
    name: 'Bán hàng',
    code: 'SAL',
    type: 'sale',
  })
  await call('account.saveJournal', {
    id: 'cash-journal',
    name: 'Tiền mặt',
    code: 'CSH',
    type: 'cash',
    defaultAccountId: 'cash',
  })
  await call('pos.saveConfig', {
    id: 'king-store',
    name: 'Cửa hàng King Fruit',
    warehouseId: 'wh',
    pricelistId: 'retail',
    salesJournalId: 'sales-journal',
    revenueAccountId: 'revenue',
    receivableAccountId: 'receivable',
  })
  await call('pos.savePaymentMethod', {
    id: 'cash-method',
    name: 'Tiền mặt',
    journalId: 'cash-journal',
    isCash: true,
  })
  await call('pos.linkPaymentMethod', {
    id: 'king-store:cash',
    configId: 'king-store',
    paymentMethodId: 'cash-method',
  })
  await call('pos.createSession', {
    id: 'visual-session',
    configId: 'king-store',
    userId: 'visual-admin',
    openingCash: '0',
  })
  await call('pos.openSession', { id: 'visual-session' })

  for (const [id, reference] of [
    ['so-before', 'WEB/BEFORE'],
    ['so-code', 'WEB/CODE'],
    ['so-reward', 'WEB/REWARD'],
  ]) {
    await call('sale.createOrder', {
      id,
      partnerId: 'minh-anh',
      warehouseId: 'wh',
      pricelistId: 'retail',
      clientOrderRef: reference,
    })
    await call('sale.addLine', {
      id: `${id}:line`,
      orderId: id,
      productId: 'fruit-box',
      productUomQty: '2',
      productUomId: 'unit',
      priceUnit: '1250000',
    })
  }
  await call('loyalty_sale.applyCode', { orderId: 'so-code', code: 'KINGFRESH' })
  await call('loyalty_sale.applyCode', { orderId: 'so-reward', code: 'KINGFRESH' })
  await call('loyalty_sale.applyReward', {
    orderId: 'so-reward',
    programId: 'fresh-code',
    rewardId: 'fresh-code:reward',
  })

  await call('pos.createOrder', {
    id: 'pos-visual',
    uuid: 'pos-visual',
    sessionId: 'visual-session',
    partnerId: 'minh-anh',
  })
  await call('pos.addLine', {
    id: 'pos-visual:line',
    orderId: 'pos-visual',
    productId: 'fruit-box',
    productUomId: 'unit',
    qty: '1',
    priceUnit: '1250000',
  })
  await call('loyalty_pos.applyCode', { orderId: 'pos-visual', code: 'KINGFRESH' })
  await call('loyalty_pos.applyReward', {
    orderId: 'pos-visual',
    programId: 'fresh-code',
    rewardId: 'fresh-code:reward',
  })
  await call('pos.addPayment', {
    id: 'pos-visual:payment',
    orderId: 'pos-visual',
    paymentMethodId: 'cash-method',
    amount: '1125000',
  })

  await call('loyalty.order.finalize', {
    order: {
      orderType: 'sale',
      orderId: 'historic-order',
      partnerId: 'minh-anh',
      currency: 'VND',
      date: '2026-08-01T08:00:00.000Z',
      lines: [
        {
          id: 'historic-order:line',
          productId: 'fruit-box',
          quantity: 4,
          untaxed: 5000000,
          total: 5000000,
          lineKind: 'product',
        },
      ],
    },
  })

  console.log(`loyalty visual database ready: ${path}`)
  console.log('sign in with admin / loyalty-demo')
} finally {
  await (adapter as Adapter).close()
}
