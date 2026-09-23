import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createSearchFilterView } from '../packages/design-system/src/interactions/search-filter/index.tsx'
import { searchFilterDemoConfig } from '../packages/design-system/src/interactions/search-filter/demo.ts'
import { attributeSearchFilterConfig } from '../packages/ketsuite/src/modules/product_backend/attributes-search.ts'
import { attributesListPage } from '../packages/ketsuite/src/modules/product_backend/screens/attributes.tsx'
const translate = ((key: string) => key) as Translator
translate.locale = 'vi'
translate.has = () => true
translate.resolves = translate.has

test('attribute SearchFilter shares compact Product island with supported URL-backed presets only', () => {
  const url = new URL(
    'http://ket.local/admin/product/attributes?lang=vi&q=Blue&displayType=color,pills,invalid&createVariant=always&page=8&columns=name,values',
  )
  const config = attributeSearchFilterConfig(translate, url)
  assert.equal(config.size, 'compact')
  assert.deepEqual(
    config.filters.filter((filter) => filter.active).map((filter) => filter.id),
    ['displayType:pills', 'displayType:color', 'createVariant:always'],
  )
  assert.equal(config.filters.length, 7)
  assert.ok(config.facets.some((facet) => facet.type === 'field' && facet.label === 'Blue'))
  assert.equal(config.manager?.applyFunction, 'product_backend.applyAttributeSearchFilter')
  assert.equal(config.manager?.bodyId, 'product-attribute-list')
  assert.equal(config.manager?.applyInput?.returnTo, url.pathname + url.search)
  const view = createSearchFilterView({ id: 'attributes-filter', config }).view()
  const markup = renderToString(view)
  assert.match(markup, /data-ui="search-filter"[^>]*data-size="compact"/)
  assert.match(markup, /data-ui="search-filter-columns" data-columns="1"/)
  assert.doesNotMatch(markup, /data-facet-type="groupBy"|data-facet-type="favorite"|data-ui="custom-filter"/)
  const rows = [
    { id: 'blue', name: 'Blue', displayType: 'color', createVariant: 'always', values: [] },
    { id: 'blue-pill', name: 'Blue pill', displayType: 'pills', createVariant: 'always', values: [] },
    { id: 'blue-select', name: 'Blue select', displayType: 'select', createVariant: 'always', values: [] },
    { id: 'blue-policy', name: 'Blue policy', displayType: 'color', createVariant: 'no_variant', values: [] },
  ]
  const html = renderToString(
    attributesListPage(translate, rows, {
      collectionUrl: url.pathname + url.search,
      chrome: { searchContent: view },
    }),
  )
  assert.match(html, /data-ui="chrome-search-content"[\s\S]*?data-ui="search-filter"/)
  assert.doesNotMatch(html, /data-ui="chrome-search"/)
  assert.match(html, /record=product.attribute%3Ablue-pill/)
  assert.doesNotMatch(html, /record=product.attribute%3Ablue-select|record=product.attribute%3Ablue-policy/)
})
test('existing full SearchFilter keeps grouping, favorites and custom rules by default', () => {
  const html = renderToString(
    createSearchFilterView({ id: 'full-search', config: searchFilterDemoConfig }).view(),
  )
  assert.match(html, /data-ui="search-filter-columns" data-columns="3"/)
  assert.match(html, /data-facet-type="groupBy"/)
  assert.match(html, /data-facet-type="favorite"/)
  assert.match(html, /data-ui="custom-filter"/)
})
