import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Ctx } from '@ketvietlab/ketjs'
import { attributeSearchHref } from '../packages/ketsuite/src/modules/product_backend/attribute-search-state.ts'
import { functions } from '../packages/ketsuite/src/modules/product_backend/functions.ts'

const path = '/admin/product/attributes'
const urlOf = (href: string) => new URL(href, 'http://ket.local')
const filter = (id: string) => ({ id, type: 'filter', label: id })
const field = (label: string) => ({ id: `query:${label}`, type: 'field', label })

test('attribute search: applies field search and OR presets per group while preserving list context', () => {
  const href = attributeSearchHref({
    returnTo: `${path}?lang=en&columns=name,values&cols=name&sort=name:desc&page=9&record=product.attribute:red&tab=details`,
    query: '',
    facets: [
      field(' Red & blue '),
      filter('displayType:color'),
      filter('displayType:radio'),
      filter('displayType:radio'),
      filter('createVariant:no_variant'),
    ],
  })
  const url = urlOf(href)
  assert.equal(url.pathname, path)
  assert.equal(url.searchParams.get('q'), 'Red & blue')
  assert.equal(url.searchParams.get('displayType'), 'radio,color')
  assert.equal(url.searchParams.get('createVariant'), 'no_variant')
  assert.equal(url.searchParams.get('lang'), 'en')
  assert.equal(url.searchParams.get('columns'), 'name,values')
  assert.equal(url.searchParams.get('cols'), 'name')
  assert.equal(url.searchParams.get('sort'), 'name:desc')
  for (const key of ['page', 'record', 'tab']) assert.equal(url.searchParams.has(key), false)
})

test('attribute search: removing/changing facets replaces prior selections and preserves query field', () => {
  const prior = `${path}?lang=vi&q=Old&displayType=radio,color&createVariant=always&page=4`
  const changed = urlOf(
    attributeSearchHref({ returnTo: prior, query: '', facets: [field('Old'), filter('displayType:pills')] }),
  )
  assert.equal(changed.searchParams.get('q'), 'Old')
  assert.equal(changed.searchParams.get('displayType'), 'pills')
  assert.equal(changed.searchParams.has('createVariant'), false)
  const cleared = urlOf(
    attributeSearchHref({
      returnTo: changed.pathname + changed.search,
      query: '',
      facets: [],
      filters: ['displayType:color'],
    }),
  )
  assert.deepEqual(
    [...cleared.searchParams],
    [['lang', 'vi']],
    'empty facets override stale fallback filters',
  )
})

test('attribute search: typed query wins, latest query chip follows and removed query clears', () => {
  assert.equal(
    urlOf(attributeSearchHref({ query: ' New ', facets: [field('Old')] })).searchParams.get('q'),
    'New',
  )
  assert.equal(
    urlOf(attributeSearchHref({ query: '', facets: [field('Old'), field('Newest')] })).searchParams.get('q'),
    'Newest',
  )
  assert.equal(attributeSearchHref({ returnTo: `${path}?q=Old`, query: '', facets: [] }), path)
})

test('attribute search: filters-only payload and partial query updates retain unrelated state', () => {
  const selected = urlOf(
    attributeSearchHref({
      returnTo: `${path}?q=Keep&lang=en`,
      filters: [
        'createVariant:no_variant',
        'createVariant:always',
        'displayType:multi',
        'displayType:unknown',
        'bogus',
      ],
    }),
  )
  assert.equal(selected.searchParams.get('createVariant'), 'always,no_variant')
  assert.equal(selected.searchParams.get('displayType'), 'multi')
  assert.equal(selected.searchParams.get('q'), 'Keep')
  const changed = urlOf(
    attributeSearchHref({ returnTo: selected.pathname + selected.search, query: 'Changed' }),
  )
  assert.equal(changed.searchParams.get('displayType'), 'multi')
  assert.equal(changed.searchParams.get('q'), 'Changed')
})

test('attribute search: malformed facets and unsupported advanced state cannot become filters', () => {
  const href = attributeSearchHref({
    returnTo: `${path}?displayType=radio&createVariant=always`,
    facets: [
      null,
      [],
      7,
      { id: 'displayType:color', type: 'groupBy' },
      filter('preset:displayType:color'),
      { id: {}, type: 'filter' },
    ],
    groupBy: ['name'],
    favoriteId: 'other',
    customFilters: [{ field: 'name', operator: 'equals', value: 'unsafe' }],
  })
  assert.equal(href, path)
})

test('attribute search: rejects external, malformed and different-collection return targets', () => {
  for (const returnTo of [
    'https://evil.test/admin/product/attributes?lang=en',
    '//evil.test/admin/product/attributes',
    '/\\evil.test/admin/product/attributes',
    'javascript:alert(1)',
    '/admin/product/templates?lang=en',
    '/admin/product/attributes/../templates',
    '/admin/product/attributes\n?lang=en',
    'http://[broken',
    '/?returnTo=https://evil.test',
    null,
  ]) {
    assert.equal(attributeSearchHref({ returnTo, query: 'Red' }), `${path}?q=Red`, String(returnTo))
  }
  assert.equal(attributeSearchHref({ returnTo: `${path}?lang=en#external` }), `${path}?lang=en`)
})

test('attribute search: fixture override is restricted and preserves its attributes screen and locale', () => {
  const href = attributeSearchHref(
    {
      returnTo: '/__atlas/product/screen?screen=attributes&lang=vi&columns=name,values&page=3',
      facets: [filter('displayType:color')],
    },
    { basePath: '/__atlas/product/screen' },
  )
  const url = urlOf(href)
  assert.equal(url.pathname, '/__atlas/product/screen')
  assert.equal(url.searchParams.get('screen'), 'attributes')
  assert.equal(url.searchParams.get('lang'), 'vi')
  assert.equal(url.searchParams.get('columns'), 'name,values')
  assert.equal(url.searchParams.get('displayType'), 'color')
  assert.equal(url.searchParams.has('page'), false)
  assert.equal(attributeSearchHref({}, { basePath: 'https://evil.test' as never }), path)
  assert.equal(
    attributeSearchHref(
      { returnTo: '/__atlas/product/screen?screen=templates' },
      { basePath: '/__atlas/product/screen' },
    ),
    '/__atlas/product/screen?screen=attributes',
  )
})

test('attribute search: registered apply function uses the shared transform and read-only effect', async () => {
  const command = functions.applyAttributeSearchFilter!
  assert.deepEqual(command.effects, ['read:product.Attribute'])
  const input = { returnTo: `${path}?lang=en`, query: 'Blue', facets: [filter('displayType:color')] }
  assert.deepEqual(await command.handler!({} as Ctx, input), { href: attributeSearchHref(input) })
})
