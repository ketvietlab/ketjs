import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { createSearchFilterView } from '../packages/design-system/src/interactions/search-filter/index.tsx'
import { searchFilterDemoConfig } from '../packages/design-system/src/interactions/search-filter/demo.ts'

test('search filter: active group-by fields render as one ordered pipeline, not search chips', () => {
  const html = renderToString(
    createSearchFilterView({ id: 'search-filter-grouping-test', config: searchFilterDemoConfig }).view(),
  )

  assert.match(html, /data-ui="search-filter-grouping"/)
  assert.match(html, /data-ui="search-filter-grouping-order">[\s\S]*?1</)
  assert.match(html, /data-ui="search-filter-grouping-label">[\s\S]*?Customer/)
  assert.match(html, /data-ui="search-filter-grouping-clear"[\s\S]*?Clear all/)
  assert.doesNotMatch(
    html,
    /data-ui="search-filter-facet" data-type="groupBy"/,
    'grouping state stays in its ordered control rather than consuming the search field',
  )
})

test('search filter: compact is an explicit public density variant', () => {
  const html = renderToString(
    createSearchFilterView({
      id: 'search-filter-compact-test',
      config: { ...searchFilterDemoConfig, size: 'compact' },
    }).view(),
  )

  assert.match(html, /data-ui="search-filter"[^>]*data-size="compact"/)
})

test('search filter: layout is constrained by the component container, not application chrome', async () => {
  const styles = await readFile('packages/design-system/src/interactions/search-filter/styles.css', 'utf8')

  assert.match(styles, /@container search-filter/)
  assert.doesNotMatch(styles, /kv-sidebar-width|data-ui="app-main"/)
})

test('search filter: backend does not override private popup geometry or main stacking', async () => {
  const styles = await readFile('packages/ketsuite/src/modules/backend/design/lists.css', 'utf8')

  assert.doesNotMatch(styles, /data-variant="search-filter"/)
})

test('search filter: reaching the grouping limit disables new groups but keeps removal available', () => {
  const html = renderToString(
    createSearchFilterView({
      id: 'limited-filter',
      config: {
        ...searchFilterDemoConfig,
        maxGroupBy: 1,
      },
    }).view(),
  )
  assert.match(html, /data-ui="custom-group-by"[^>]*disabled/)
  assert.match(html, /data-ui="search-filter-grouping-clear"[^>]*type="button"/)
  assert.doesNotMatch(html, /role="menuitemcheckbox"|role="menu"/)
})
