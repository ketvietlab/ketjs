import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { html, renderToString } from '@ketvietlab/ketjs-view'
import { productDetailScreen } from '../packages/ketsuite/src/modules/product_backend/screens/detail.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('product detail: renders contributed template actions without owning their route', () => {
  const output = renderToString(
    productDetailScreen(
      translate,
      {
        id: 'water-500',
        name: 'Water 500ml',
        type: 'goods',
        listPrice: 10_000,
        uomId: 'unit',
        active: true,
      },
      { status: 'ready', images: [] },
      {
        uoms: [{ value: 'unit', label: 'Unit' }],
        categories: [],
        brands: [],
        taxes: [],
        variantAttributes: [],
        variants: [],
        attributeLines: [],
        actions: html`<a data-ui="action" href="/admin/sale-channels/products/water-500"
          >Sales channels</a
        >`,
      },
      '',
    ),
  )

  assert.match(output, /data-ui="form-cluster"[\s\S]*?Sales channels/)
  assert.match(output, /href="\/admin\/sale-channels\/products\/water-500"/)
})
