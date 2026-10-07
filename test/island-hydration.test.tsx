import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  HydrationMismatch,
  createIslandManager,
  domHost,
  html,
  hydrateIslands,
  renderIsland,
  signal,
  trustedMarkup,
} from '@ketvietlab/ketjs-view'
import type { HydratedIsland, IslandElement, IslandFactory, Signal } from '@ketvietlab/ketjs-view'
import { document, parseFragment } from './helpers/dom.ts'

type Page = ReturnType<typeof parseFragment>

// Each island instance keeps its signal here so a test can drive it after hydration.
const counters: Signal<number>[] = []
const counter: IslandFactory<{ start: number }> = (props) => {
  const count = signal(props.start)
  counters.push(count)
  return () => html`<p class="counter"><span>Count: ${count()}</span></p>`
}
const jsxCounter: IslandFactory<{ start: number }> = (props) => {
  const count = signal(props.start)
  counters.push(count)
  return () => (
    <p class="counter">
      <span>Count: {count()}</span>
    </p>
  )
}
const inner: IslandFactory<{ label: string }> = (props) => () => html`<em>${props.label}</em>`
const outer: IslandFactory<{ title: string }> = (props) => () =>
  html`<section><h2>${props.title}</h2>${trustedMarkup(renderIsland('inner', inner, { label: 'nested' }))}</section>`

const registry = { counter, jsxCounter, inner, outer } as Record<string, IslandFactory>

const page = (...islands: string[]): Page => parseFragment(islands.join(''))
const root = (node: Page) => node as unknown as IslandElement
const spans = (node: Page) => node.querySelectorAll('span')
const text = (node: { innerHTML: string }) => node.innerHTML.replace(/<!--k\[?-->/g, '')

test('island hydration: html and JSX islands adopt their own server markup', () => {
  counters.length = 0
  const server = page(
    renderIsland('counter', counter, { start: 1 }),
    renderIsland('jsxCounter', jsxCounter, { start: 2 }),
  )
  const [first, second] = spans(server)
  const reported: unknown[] = []
  const live = hydrateIslands(domHost(document), root(server), registry, {
    onHydrationMismatch: (error) => reported.push(error),
  })

  assert.deepEqual(
    live.map((island) => island.name),
    ['counter', 'jsxCounter'],
  )
  assert.deepEqual(reported, [])
  counters[2]?.set(5)
  counters[3]?.set(6)
  assert.equal(spans(server)[0], first, 'the html island adopts its span')
  assert.equal(spans(server)[1], second, 'the JSX island adopts its span')
  assert.match(text(server), /Count: 5.*Count: 6/)
})

test('island hydration: a mismatched island renders on the client and the islands after it still hydrate', () => {
  counters.length = 0
  // The first island's markup no longer matches its view, as with a stale deploy or an edited DOM.
  const stale = renderIsland('counter', counter, { start: 1 })
    .replace('<span>', '<b>')
    .replace('</span>', '</b>')
  const server = page(stale, renderIsland('counter', counter, { start: 2 }))
  const adopted = spans(server)[0]
  const reported: Array<{ error: unknown; island: HydratedIsland }> = []

  const live = hydrateIslands(domHost(document), root(server), registry, {
    onHydrationMismatch: (error, island) => reported.push({ error, island }),
  })

  assert.equal(live.length, 2, 'both islands are live')
  assert.equal(reported.length, 1)
  assert.ok(reported[0]?.error instanceof HydrationMismatch)
  assert.equal(reported[0]?.island, live[0])
  assert.equal(server.querySelectorAll('b').length, 0, 'the stale server DOM is discarded')
  // counters[0..1] are the server render; [2] is the recovered island and [3] the adopted one.
  counters[2]?.set(10)
  counters[3]?.set(20)
  assert.match(text(server), /Count: 10.*Count: 20/)
  assert.equal(spans(server)[1], adopted, 'the matching island still adopts its server DOM')
})

test('island hydration: a recovered mismatch is logged when no handler is given', (t) => {
  const logged = t.mock.method(console, 'error', () => {})
  const stale = renderIsland('counter', counter, { start: 1 })
    .replace('<span>', '<b>')
    .replace('</span>', '</b>')
  hydrateIslands(domHost(document), root(page(stale)), registry)
  assert.equal(logged.mock.callCount(), 1)
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /island "counter" did not match its server markup/)
  assert.ok(logged.mock.calls[0]?.arguments[1] instanceof HydrationMismatch)
})

test('island hydration: hydrationMismatch "throw" keeps the failure loud', () => {
  const stale = renderIsland('counter', counter, { start: 1 })
    .replace('<span>', '<b>')
    .replace('</span>', '</b>')
  assert.throws(
    () => hydrateIslands(domHost(document), root(page(stale)), registry, { hydrationMismatch: 'throw' }),
    HydrationMismatch,
  )
})

test('island hydration: errors other than a mismatch still throw', () => {
  const broken: IslandFactory = () => () => {
    throw new TypeError('view failed')
  }
  const server = page(
    renderIsland('counter', counter, { start: 1 }).replace('data-island="counter"', 'data-island="broken"'),
  )
  assert.throws(() => hydrateIslands(domHost(document), root(server), { broken }), /view failed/)
  assert.throws(
    () =>
      hydrateIslands(
        domHost(document),
        root(page('<ket-island data-island="missing"></ket-island>')),
        registry,
      ),
    /no composed module provides/,
  )
})

test('island hydration: islands nested in discarded markup are hydrated from the new render', () => {
  const stale = renderIsland('outer', outer, { title: 'Hello' })
    .replace('<h2>', '<h3>')
    .replace('</h2>', '</h3>')
  const server = page(stale)
  const discarded = server.querySelectorAll('ket-island')[1]
  const manager = createIslandManager(domHost(document), registry, { onHydrationMismatch: () => {} })

  const live = manager.hydrate(root(server))

  assert.deepEqual(
    live.map((island) => island.name),
    ['outer', 'inner'],
  )
  const nested = live[1]?.element as unknown as Page
  assert.notEqual(nested, discarded, 'the stale nested host is not hydrated')
  assert.ok(
    server.querySelectorAll('ket-island').includes(nested),
    'the nested island lives in the new render',
  )
  assert.match(
    text(server),
    /<section><h2>Hello<\/h2><ket-island[^>]*><em>nested<\/em><\/ket-island><\/section>/,
  )
  // A second pass over the same root finds both islands already running.
  assert.deepEqual(manager.hydrate(root(server)), live)
  manager.dispose(root(server))
})
