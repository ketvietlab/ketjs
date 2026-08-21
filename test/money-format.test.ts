import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, translator } from 'ketjs'
import { renderToString } from 'ketjs-view'
import backend, { formatMoney } from 'ketsuite/backend'
import { customerInvoicesScreen } from '../packages/ketsuite/src/modules/account_backend/customer-invoices-screen.tsx'
import { roomTypesScreen } from '../packages/ketsuite/src/modules/hospitality_core/screens.ts'
import { ordersScreen as posOrdersScreen } from '../packages/ketsuite/src/modules/pos_backend/screens.ts'
import { ordersScreen as purchaseOrdersScreen } from '../packages/ketsuite/src/modules/purchase_backend/screens.ts'
import { ordersScreen as saleOrdersScreen } from '../packages/ketsuite/src/modules/sale_backend/screens.ts'

const manifest = compose([backend], { headless: true })
const vi = translator(manifest, 'vi')
const en = translator(manifest, 'en')

test('money format: follows locale and ISO currency precision', () => {
  assert.equal(formatMoney(en, '1234.5', 'usd'), '$1,234.50')
  assert.match(formatMoney(vi, '1234567.89', 'VND'), /^1\.234\.568\s₫$/u)
  assert.equal(formatMoney(en, -0, 'USD'), '$0.00')
})

test('money format: keeps missing and invalid business data visible', () => {
  assert.equal(formatMoney(vi, null, 'VND'), '—')
  assert.equal(formatMoney(vi, 'pending', 'VND'), 'pending')
  assert.match(formatMoney(vi, 1500, 'not-a-currency'), /^1\.500\s₫$/u)
})

test('money format: every money-bearing backend module renders formatted list values', () => {
  const amount = formatMoney(vi, 1234567, 'VND')
  const screens = [
    saleOrdersScreen(vi, {
      title: 'Sales',
      frame: {},
      rows: [
        {
          id: 'sale-1',
          name: 'S0001',
          partnerName: 'Customer',
          dateOrder: '2026-08-20',
          state: 'sale',
          invoiceStatus: 'no',
          amountTotal: 1234567,
          currency: 'VND',
        },
      ],
    }),
    purchaseOrdersScreen(vi, {
      title: 'Purchase',
      frame: {},
      rows: [
        {
          id: 'purchase-1',
          name: 'P0001',
          partnerName: 'Vendor',
          dateOrder: '2026-08-20',
          state: 'purchase',
          invoiceStatus: 'no',
          amountTotal: 1234567,
          currency: 'VND',
        },
      ],
    }),
    posOrdersScreen(vi, {}, [
      {
        id: 'pos-1',
        posReference: 'POS/0001',
        state: 'paid',
        amountTotal: 1234567,
        currency: 'VND',
      },
    ]),
    customerInvoicesScreen(vi, {
      frame: {},
      action: '/moves',
      locale: '',
      fields: [],
      rows: [
        {
          id: 'move-1',
          name: 'INV/0001',
          date: '2026-08-20',
          moveType: 'entry',
          state: 'posted',
          paymentState: 'paid',
          amountTotal: 1234567,
          currency: 'VND',
        },
      ],
    }),
    roomTypesScreen(
      vi,
      [
        {
          id: 'room-type-1',
          propertyId: 'property-1',
          code: 'DLX',
          name: 'Deluxe',
          defaultCapacity: 2,
          baseRate: 1234567,
          published: true,
          active: true,
        },
      ],
      [
        {
          id: 'property-1',
          code: 'PROP',
          name: 'Property',
          accommodationType: 'hotel',
          starRating: 0,
          active: true,
          rooms: 0,
          availableRooms: 0,
          attentionRooms: 0,
        },
      ],
      'property-1',
      'vi',
      {},
    ),
  ]

  for (const screen of screens) {
    const html = renderToString(screen)
    assert.ok(html.includes(amount))
    assert.match(html, /data-kind="currency"/)
  }
})
