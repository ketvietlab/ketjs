import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  pricelistCreateModal,
  pricelistDetailScreen,
  pricelistsScreen,
} from '../packages/ketsuite/src/modules/pricing_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('pricelist collection uses ListPage and route-owned navigation', () => {
  const html = renderToString(
    pricelistsScreen(translate, {}, {
      rows: [
        {
          id: 'retail/a',
          name: 'Retail',
          currency: 'VND',
          state: 'active',
          sequence: '16',
          detailHref: '/admin/pricing/pricelists/retail%2Fa?lang=en',
        },
      ],
      createHref: '/admin/pricing/pricelists?lang=en&create=1',
    }),
  )
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-row-href="\/admin\/pricing\/pricelists\/retail%2Fa\?lang=en"/)
  assert.match(html, /href="\/admin\/pricing\/pricelists\?lang=en&amp;create=1"/)
})

test('pricelist create is a URL-addressable modal with stable identity', () => {
  const html = renderToString(
    pricelistCreateModal(translate, {
      action: '/admin/pricing/pricelists?lang=en&create=1',
      closeHref: '/admin/pricing/pricelists?lang=en',
      values: { id: 'draft-id', name: 'Retail', sequence: 5 },
      errors: ['name: invalid'],
    }),
  )
  assert.match(html, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(html, /name="id" value="draft-id"/)
  assert.match(html, /name="action" value="create"/)
  assert.match(html, /name="name"[^>]*value="Retail"/)
})

test('pricelist detail uses FormPage and preserves rejected rule values', () => {
  const html = renderToString(
    pricelistDetailScreen(translate, {}, {
      action: '/admin/pricing/pricelists/retail%2Fa?lang=en',
      cancelHref: '/admin/pricing/pricelists?lang=en',
      values: { id: 'retail/a', name: 'Retail', currency: 'VND', sequence: 16, active: true },
      items: [],
      itemValues: {
        id: 'rule-id',
        appliedOn: '3_global',
        minQuantity: '-1',
        base: 'list_price',
        computePrice: 'fixed',
      },
      itemErrors: ['minQuantity: invalid'],
    }),
  )
  assert.match(html, /data-ui="form-page" data-scope="pricelist-detail-page"/)
  assert.match(html, /form="pricelist-settings-form"/)
  assert.match(html, /name="action" value="save-pricelist"/)
  assert.match(html, /name="action" value="add-item"/)
  assert.match(html, /name="id" value="rule-id"/)
  assert.match(html, /name="minQuantity"[^>]*value="-1"/)
})
