import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, formatMissing, missingMessages, renderToString, translator } from 'ketjs'
import backend, { appsScreen } from 'ketsuite/backend'
import {
  company,
  account,
  accountBackend,
  partner,
  pricing,
  pricingBackend,
  product,
  productBackend,
  productMedia,
  purchase,
  purchaseBackend,
  sale,
  saleBackend,
  pos,
  posBackend,
  stock,
  stockBackend,
  storage,
  uom,
  user,
} from 'ketsuite'
import { attributesScreen } from '../packages/ketsuite/src/modules/product_backend/screens.ts'
import { pricelistDetailScreen } from '../packages/ketsuite/src/modules/pricing_backend/screens.ts'
import { stockScreen } from '../packages/ketsuite/src/modules/stock_backend/screens.ts'

const modules = [
  partner,
  company,
  user,
  storage,
  uom,
  product,
  productMedia,
  pricing,
  stock,
  account,
  purchase,
  sale,
  pos,
  backend,
  productBackend,
  pricingBackend,
  stockBackend,
  accountBackend,
  purchaseBackend,
  saleBackend,
  posBackend,
]
const manifest = compose(modules, { headless: true })

test('ketsuite i18n: business catalogues have complete vi/en parity', () => {
  const gaps = missingMessages(manifest, ['vi', 'en'])
  assert.deepEqual(gaps, {}, formatMissing(gaps))
})

test('ketsuite i18n: app metadata is translated instead of falling back to Vietnamese literals', () => {
  const rows = [
    product,
    productMedia,
    pricing,
    stock,
    account,
    purchase,
    sale,
    pos,
    storage,
    productBackend,
    pricingBackend,
    stockBackend,
    accountBackend,
    purchaseBackend,
    saleBackend,
    posBackend,
  ].map((module) => ({
    name: module.name,
    title: module.title ?? module.name,
    summary: module.summary ?? '',
    category: module.category ?? '',
    state: 'installed' as const,
    depends: [...module.depends],
    dependents: [],
  }))
  const html = renderToString(appsScreen(translator(manifest, 'en'), rows))

  assert.match(html, /Product images/)
  assert.match(html, /Odoo 19 stock, transfers, and replenishment/)
  assert.match(html, /Manage company pricelists/)
  assert.doesNotMatch(html, /Hình ảnh sản phẩm/)
  assert.doesNotMatch(html, /Tồn kho, dịch chuyển/)
  assert.doesNotMatch(html, /Danh sách bảng giá theo company/)
})

test('ketsuite i18n: Product selection labels are translated, not leaked as Odoo codes', () => {
  const rows = [
    { id: 'attribute', name: 'Màu', displayType: 'pills', createVariant: 'no_variant', values: [] },
  ]
  const vi = renderToString(attributesScreen(translator(manifest, 'vi'), rows, {}))
  const en = renderToString(attributesScreen(translator(manifest, 'en'), rows, {}))

  assert.match(vi, /Nút dạng thẻ/)
  assert.match(vi, /Không tạo biến thể/)
  assert.match(en, /Pills/)
  assert.match(en, /Never create variants/)
  assert.doesNotMatch(vi, />pills</)
  assert.doesNotMatch(en, />no_variant</)
})

test('ketsuite i18n: Pricing and Stock badges render localized labels while retaining stable codes', () => {
  const vi = translator(manifest, 'vi')
  const en = translator(manifest, 'en')
  const item = {
    id: 'item',
    appliedOn: '3_global',
    computePrice: 'formula',
    minQuantity: '0',
    base: 'list_price',
  }
  const list = { id: 'list', name: 'Retail', currency: 'VND', sequence: 16, active: true }
  const viPricing = renderToString(pricelistDetailScreen(vi, list, [item], {}))
  const enPricing = renderToString(pricelistDetailScreen(en, list, [item], {}))
  const viStock = renderToString(
    stockScreen(vi, 'Kho', [{ id: 'move', name: 'WH/OUT/1', kind: 'outgoing', state: 'assigned' }], {}),
  )
  const enStock = renderToString(
    stockScreen(en, 'Inventory', [{ id: 'move', name: 'WH/OUT/1', kind: 'outgoing', state: 'assigned' }], {}),
  )

  assert.match(viPricing, /Tất cả sản phẩm/)
  assert.match(viPricing, /Công thức/)
  assert.match(enPricing, /All products/)
  assert.match(enPricing, /Formula/)
  assert.match(viStock, /Xuất kho/)
  assert.match(viStock, /Đã giữ hàng/)
  assert.match(enStock, /Delivery/)
  assert.match(enStock, /Ready/)
  assert.match(enStock, /data-value="assigned"/)
})
