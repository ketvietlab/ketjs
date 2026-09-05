import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { compose } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteSearch } from '@ketvietlab/ketsuite'

const manifest = compose([address, partner, website, websiteSearch, paperTheme])
const client = readFileSync('packages/ketsuite/src/modules/website_search/client/search.mjs', 'utf8')

test('search box: the form points at no path of its own', () => {
  // The box used to submit to /tim-kiem. No module route serves that, and no page
  // had to exist there, so searching landed a visitor on a 404. Matching the
  // rendered attribute rather than the string, because both files still explain
  // that history in a comment.
  const island = readFileSync('packages/ketsuite/src/modules/website_search/islands.ts', 'utf8')
  assert.ok(!/<form[^>]*\saction=/.test(island), 'the server-rendered form declares an action')
  assert.ok(!/<form[^>]*\saction=/.test(client), 'the browser half declares an action')
})

test('search box: the island declares the copy it renders', () => {
  const island = manifest.islands['website.search']
  assert.ok(island)
  assert.deepEqual(Object.keys(island.props ?? {}).sort(), ['emptyLabel', 'label', 'placeholder'])
  for (const [name, spec] of Object.entries(island.props ?? {})) {
    assert.ok(String(spec).endsWith('?'), `${name} must be optional — a theme may place the box bare`)
  }
})

test('search box: results come from the functions the public reader agrees with', () => {
  // Not a private index and not a second query path: the same anonymous
  // functions the sitemap and getEntryByPath are held to.
  for (const fn of ['website.resolveSite', 'website.searchPublished', 'website.countSearchPublished']) {
    assert.ok(client.includes(fn), `the browser half should call ${fn}`)
    assert.ok(manifest.functions[fn], `${fn} is composed`)
    assert.equal(manifest.functions[fn]?.anonymous, true, `${fn} must be callable by a visitor`)
  }
})

test('search box: a query below the floor never reaches the database', () => {
  // searchPublished ignores anything shorter than two characters; asking anyway
  // spends a round trip to be told nothing.
  assert.match(client, /trim\(\)\.length < 2/, 'the client should apply the same floor')
})

test('search box: the query stays in the URL so a result can be linked', () => {
  assert.match(client, /searchParams\.set\('q'/, 'a search should be linkable')
  assert.match(client, /\.get\('q'\)/, 'and reloading should restore it')
})
