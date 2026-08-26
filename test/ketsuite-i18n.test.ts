import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, formatMissing, missingMessages, renderToString, translator } from '@ketvietlab/ketjs'
import backend from '@ketvietlab/ketsuite/backend'
import {
  account,
  accountBackend,
  accountPartner,
  accountPartnerBackend,
  address,
  addressBackend,
  company,
  partner,
  partnerBackend,
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
} from '@ketvietlab/ketsuite'
import { attributesScreen } from '../packages/ketsuite/src/modules/product_backend/screens/attributes.tsx'
import { pricelistDetailScreen } from '../packages/ketsuite/src/modules/pricing_backend/screens.tsx'
import { stockScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/index.ts'

const modules = [
  address,
  partner,
  partnerBackend,
  company,
  user,
  storage,
  uom,
  product,
  productMedia,
  pricing,
  stock,
  account,
  accountPartner,
  purchase,
  sale,
  pos,
  backend,
  addressBackend,
  productBackend,
  pricingBackend,
  stockBackend,
  accountBackend,
  accountPartnerBackend,
  purchaseBackend,
  saleBackend,
  posBackend,
]
const manifest = compose(modules, { headless: true })

test('ketsuite i18n: business catalogues have complete vi/en parity', () => {
  const gaps = missingMessages(manifest, ['vi', 'en'])
  assert.deepEqual(gaps, {}, formatMissing(gaps))
})

test('ketsuite i18n: Product selection labels are translated, not leaked as storage codes', () => {
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
