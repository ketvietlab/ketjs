import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const runtime = readFileSync('packages/design-system/src/runtime/index.js', 'utf8')
const timeframe = readFileSync(
  'packages/design-system/src/data-operations/timeframe-filter/index.tsx',
  'utf8',
)
const listControls = readFileSync(
  'packages/design-system/src/data-operations/list-controls/index.tsx',
  'utf8',
)
const searchFilter = readFileSync('packages/design-system/src/interactions/search-filter/index.tsx', 'utf8')

test('design system: popups built on details close on an outside click and on Escape', () => {
  // The period filter and view settings are <details> popups, like the action menu.
  assert.match(timeframe, /<details data-ui="timeframe-menu">/u)
  assert.match(listControls, /<details data-ui="view-settings">/u)
  const declared = runtime.match(/const DISMISSIBLE_POPUPS = \[(.*?)\]\n/u)?.[1] ?? ''
  for (const hook of ['timeframe-menu', 'view-settings'])
    assert.match(declared, new RegExp(`\\[data-ui="${hook}"\\]`, 'u'), `${hook} is dismissible`)

  const click = runtime.slice(
    runtime.indexOf('const onDocumentClick'),
    runtime.indexOf("document.addEventListener('click', onDocumentClick)"),
  )
  assert.match(
    click,
    /for \(const popup of root\.querySelectorAll\(DISMISSIBLE_POPUPS_OPEN\)\)[\s\S]*?!popup\.contains\(target\)\) popup\.open = false/u,
    'a click outside an open popup closes it',
  )
  assert.match(
    runtime,
    /event\.key === 'Escape' && openPopup instanceof HTMLDetailsElement\) \{\s*openPopup\.open = false/u,
    'Escape closes the open popup and returns focus to its summary',
  )
})

test('search filter: autocomplete suggestions close on an outside click without clearing the query', () => {
  const mount = searchFilter.slice(
    searchFilter.indexOf('mount: ({ root, lifetime }) => {'),
    searchFilter.indexOf('dispose: () => {'),
  )
  assert.match(
    mount,
    /document\.addEventListener\([\s\S]*?'click'/u,
    'the island owns its non-details popup dismissal',
  )
  assert.match(
    mount,
    /if \(target instanceof Node && \(root as unknown as Node\)\.contains\(target\)\) return[\s\S]*?suggestionsOpen\.set\(false\)/u,
    'only clicks outside the search filter dismiss suggestions',
  )
  assert.doesNotMatch(mount, /query\.set\(/u, 'dismissing suggestions preserves the unfinished query')
})
