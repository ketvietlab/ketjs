import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { liveRegion } from '@ketvietlab/ketsuite/backend'

const island = readFileSync('packages/ketsuite/src/ui/client/table-selection-view.tsx', 'utf8')
const behaviour = island.slice(
  island.indexOf('const installLiveRegion'),
  island.indexOf('const installRouteModal'),
)

test('live region: it says what is happening, to a screen reader as well', () => {
  const html = renderToString(liveRegion({ label: 'Đang dựng lại', stream: 'care-backfill:run-1' }))
  // The reader who cannot see the page is the one a timed reload served worst:
  // it interrupted them every thirty seconds and said nothing about why.
  assert.match(html, /role="status"/u)
  assert.match(html, /aria-live="polite"/u)
  assert.match(html, /Đang dựng lại/u)
})

test('live region: the address is the public id, and only that', () => {
  const html = renderToString(liveRegion({ label: 'x', stream: 'care-backfill:run-1' }))
  assert.match(html, /data-ui="live-region" data-stream="care-backfill:run-1"/u)
})

test('live region: without a stream it is a status line and nothing more', () => {
  // Which is the honest rendering for a screen that has no way to be told: it
  // still says work is happening, and the runtime opens nothing.
  const html = renderToString(liveRegion({ label: 'Đang dựng lại' }))
  assert.match(html, /data-ui="live-region"/u)
  assert.doesNotMatch(html, /data-stream/u)
})

test('live island: it opens nothing when the browser has no EventSource', () => {
  // The screens this serves are server-rendered and correct without it, so an
  // old browser loses the liveness and keeps the page.
  assert.match(behaviour, /^ {2}if \(typeof EventSource !== 'function'\) return$/mu)
})

test('live island: the connection belongs to the element, and follows a swap', () => {
  // A fragment navigation replaces the region, so the old connection has to go
  // with the old element rather than outliving it.
  assert.match(behaviour, /if \(region === watched\) return/u)
  assert.match(behaviour, /^ {4}close\(\)$/mu)
  assert.match(
    behaviour,
    /new MutationObserver\(sync\)\.observe\(document\.body, \{ childList: true, subtree: true \}\)/u,
  )
})

test('live island: what a chunk says is not this layer to read', () => {
  // The screen is server-rendered: the way to learn what changed is to ask for
  // it, so any message is the same message.
  assert.match(behaviour, /const refresh = \(\) => navigateTo\(location\.href\)/u)
  assert.match(behaviour, /source\.onmessage = refresh/u)
})

test('live island: an ended stream is let go, not retried forever', () => {
  // EventSource reconnects by itself, and a swept stream answers 404. Without
  // this the page would reconnect to a gone topic for as long as it stayed open.
  assert.match(behaviour, /addEventListener\('done'/u)
  assert.match(behaviour, /if \(source\?\.readyState === EventSource\.CLOSED\) close\(\)/u)
})
