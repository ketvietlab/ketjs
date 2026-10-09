import assert from 'node:assert/strict'
import test from 'node:test'
import { searchItems } from '../site/search.ts'

const item = (title, description = '', keywords = '') => ({
  title,
  description,
  keywords,
  route: `/${title.toLowerCase().replaceAll(' ', '-')}/`,
})

test('an exact title remains discoverable past the eight-result limit', () => {
  const items = Array.from({ length: 10 }, (_, index) => item(`Guide ${index}`, 'Inspect a contract'))
  items.push(item('Spec'))
  const matches = searchItems(items, ' SPEC ')
  assert.equal(matches.length, 8)
  assert.equal(matches[0].route, '/spec/')
  assert.equal(items.at(-1).title, 'Spec', 'search must not reorder the index')
})

test('title matches precede prose matches and equal ranks preserve reading order', () => {
  const items = [
    item('First guide', '', 'spec'),
    item('Build Spec'),
    item('Spec hosting'),
    item('Spec'),
    item('Second guide', 'inspect'),
  ]
  assert.deepEqual(
    searchItems(items, 'spec').map(({ title }) => title),
    ['Spec', 'Spec hosting', 'Build Spec', 'First guide', 'Second guide'],
  )
})

test('empty search preserves suggestions and missing terms return no matches', () => {
  const items = Array.from({ length: 10 }, (_, index) => item(`Guide ${index}`))
  assert.deepEqual(searchItems(items, '  '), items.slice(0, 8))
  assert.deepEqual(searchItems(items, 'unlisted'), [])
})
