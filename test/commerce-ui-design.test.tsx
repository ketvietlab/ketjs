import { vendorPricelistsListScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens/vendor-pricelists-list.tsx'
import { stockOverviewScreen } from '../packages/ketsuite/src/modules/stock_backend/screens/overview.tsx'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MenuNode, Translator } from '@ketvietlab/ketjs'
import { ModalSheet } from '@ketvietlab/design-system'
import { shell } from '../packages/ketsuite/src/ui/index.ts'
import purchaseBackend from '../packages/ketsuite/src/modules/purchase_backend/index.ts'
import { messages as backendMessages } from '../packages/ketsuite/src/modules/backend/messages.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { purchaseOrderModalDefinition } from '../packages/ketsuite/src/modules/purchase_backend/modal/order-modal-view.tsx'
import { saleOrderModalDefinition } from '../packages/ketsuite/src/modules/sale_backend/modal/order-modal-view.tsx'
import { vendorPricelistDefinition } from '../packages/ketsuite/src/modules/purchase_backend/modal/pricelist-view.tsx'
import { invoicingPolicyDefinition } from '../packages/ketsuite/src/modules/sale_backend/modal/policy-view.tsx'
import { inventoryCountDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/inventory-view.tsx'
import { transferModalDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/transfer-view.tsx'
import { stockConfigurationDefinition } from '../packages/ketsuite/src/modules/stock_backend/modal/configuration-view.tsx'
import type {
  RecordModalContext,
  RecordModalDefinition,
} from '../packages/ketsuite/src/ui/client/record-modal.tsx'

const context = <T,>(definition: RecordModalDefinition<T>, creating = false): RecordModalContext<T> => ({
  kind: definition.kind,
  id: 'record-1',
  creating,
  tab: 'info',
  busy: false,
  dialog: null,
  data: {
    record: {
      id: 'record-1',
      name: 'Purchase',
      state: 'draft',
      lines: [],
      moves: [],
      pickings: [],
      bills: [],
    },
    draftId: 'draft-1',
    choices: {},
    permissions: { addLine: true },
    products: [],
    locations: [],
    lots: [],
    rules: [],
    save: true,
    rule: false,
    run: false,
  } as T,
  t: (key) => key,
  fieldError: () => null,
  draft: (_name, value = '') => value,
  draftChecked: (_name, _value, fallback = false) => fallback,
  state: (_name, value = '') => value,
  href: () => '',
  outcome: <V,>() => null as V,
})
const size = <T,>(definition: RecordModalDefinition<T>, creating: boolean) =>
  typeof definition.size === 'function' ? definition.size(context(definition, creating)) : definition.size

test('Commerce modal width depends on record purpose, not active tab', () => {
  for (const definition of [purchaseOrderModalDefinition, saleOrderModalDefinition]) {
    assert.equal(size(definition as RecordModalDefinition<unknown>, true), 'default')
    assert.equal(size(definition as RecordModalDefinition<unknown>, false), 'large')
  }
  assert.equal(size(vendorPricelistDefinition, true), 'default')
  assert.equal(size(vendorPricelistDefinition, false), 'small')
  assert.equal(size(invoicingPolicyDefinition, false), 'small')
  assert.equal(size(inventoryCountDefinition, false), 'small')
  assert.equal(size(transferModalDefinition, true), 'small')
  assert.equal(size(transferModalDefinition, false), 'default')
  for (const key of ['location', 'lot', 'route', 'warehouse', 'picking-type', 'replenishment'] as const) {
    const definition = stockConfigurationDefinition(key)
    assert.equal(size(definition, true), ['location', 'lot', 'route'].includes(key) ? 'small' : 'default')
    assert.equal(
      size(definition, false),
      key === 'location' ? 'small' : key === 'route' ? 'large' : 'default',
    )
  }
})

test('Purchase record keeps product, quantity and unit price inline, permission-gated and busy-safe', () => {
  const c = context(purchaseOrderModalDefinition)
  const tab = purchaseOrderModalDefinition.tabs?.[0]
  assert.ok(tab)
  const markup = renderToString(<>{tab.view(c)}</>)
  assert.match(markup, /data-columns="3"/)
  const product = markup.indexOf('name="productId"')
  const quantity = markup.indexOf('name="productQty"')
  const price = markup.indexOf('name="priceUnit"')
  assert.ok(product > 0 && product < quantity && quantity < price)
  assert.match(markup, /name="productUomId"/)
  assert.match(markup, /name="taxId"/)
  assert.match(renderToString(<>{tab.view({ ...c, busy: true })}</>), /disabled/)
  const denied = { ...c, data: { ...c.data, permissions: { ...c.data.permissions, addLine: false } } }
  assert.doesNotMatch(renderToString(<>{tab.view(denied)}</>), /name="productId"/)
})

test('Commerce shell expands inactive groups too, with independent disclosures', () => {
  const menu: MenuNode[] = ['purchase', 'stock', 'sale'].map((id) => ({
    id,
    label: id,
    path: null,
    icon: 'box',
    active: id === 'purchase',
    secondary: false,
    children: [
      {
        id: `${id}.list`,
        label: `${id} list`,
        path: `/admin/${id}`,
        icon: null,
        active: id === 'purchase',
        secondary: false,
        children: [],
      },
    ],
  }))
  const translate = ((key: string) =>
    String(
      key.startsWith('purchase_backend.')
        ? (purchaseBackend.messages?.vi?.[key.slice(17)] ?? key)
        : (backendMessages.vi[key.replace(/^backend\./, '')] ?? key),
    )) as Translator
  translate.locale = 'vi'
  translate.has = () => true
  translate.resolves = translate.has
  const c = { ...context(purchaseOrderModalDefinition), t: translate }
  const html = renderToString(
    shell(
      translate,
      'Đơn mua hàng',
      <ModalSheet
        id="purchase-preview"
        title="PO-2026-001"
        closeLabel="Đóng"
        closeHref="/admin/purchase/orders"
        presentation="dialog"
        size="large"
        body={purchaseOrderModalDefinition.body?.(c)}
      />,
      {
        menu,
        topbar: false,
        viewer: { name: 'Người dùng kiểm thử', company: 'Két Việt', companies: ['default'] },
      },
    ),
  )
  assert.equal((html.match(/data-ui="navigation-branch"[^>]*open/g) ?? []).length, 3)
  assert.doesNotMatch(html, /<details[^>]*data-ui="navigation-branch"[^>]*name=/)
  const capture = process.env.KET_COMMERCE_UI_CAPTURE
  if (capture) {
    mkdirSync(capture, { recursive: true })
    writeFileSync(join(capture, '30.html'), html)
  }
})

test('Commerce vendor prices and stock queue render collection data without requiring write actions', () => {
  const t = ((key: string) => key) as Translator
  t.locale = 'vi'
  t.has = () => false
  t.resolves = t.has
  const prices = renderToString(
    vendorPricelistsListScreen(t, {
      frame: {},
      methodFields: [],
      action: '/admin/purchase/vendor-pricelists',
      createHref: null,
      rows: [
        {
          id: 'vp-1',
          partnerId: 'vendor-1',
          partnerName: 'Nhà cung cấp miền Bắc',
          productTemplateId: 'p-1',
          productNameDisplay: 'Áo khoác',
          minQty: 5,
          price: 120000,
          discount: 0,
          delay: 3,
        },
      ],
    }),
  )
  assert.match(prices, /Nhà cung cấp miền Bắc/)
  assert.match(prices, /Áo khoác/)
  assert.doesNotMatch(prices, /vendor-pricelists\/new/)
  const queue = renderToString(
    stockOverviewScreen(
      t,
      {},
      {
        rows: [
          {
            id: 'pick-1',
            name: 'WH-IN-001',
            operationType: 'Nhận hàng',
            source: 'Nhà cung cấp',
            destination: 'Kho nhận',
            scheduledDate: '03/10/2026',
            state: 'assigned',
          },
        ],
        at: (path) => path,
        rowHref: (row) => `/admin/stock/transfers?record=stock.transfer:${row.id}`,
        createHref: null,
      },
    ),
  )
  for (const text of ['WH-IN-001', 'Nhận hàng', 'Nhà cung cấp', 'Kho nhận', '03/10/2026'])
    assert.ok(queue.includes(text))
  assert.match(queue, /data-ui="ket-table"/)
})
