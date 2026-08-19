import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFragment, document } from './helpers/dom.ts'
import type { TNode } from './helpers/dom.ts'
import { compose, createTheme, defineModule, defineTheme } from 'ketjs'
import type { KetError } from 'ketjs'
import { ISLAND_TAG, domHost, html, hydrateIslands, signal } from 'ketjs-view'
import type { IslandProps } from 'ketjs-view'

// A module provides behaviour...
const clicks = signal(0)
const cart = defineModule({
  name: 'cart',
  islands: {
    'cart.widget': (props: IslandProps) =>
      html`<button on:click=${() => clicks.set((c) => c + 1)}>Giỏ (${(props.qty as number) + clicks()})</button>`,
  },
})

// ...and a theme only says where it goes.
const shop = defineTheme({
  name: 'theme_shop',
  depends: ['cart'],
  templates: {
    page: `<div class="shop"><h1>{{ title }}</h1>{% island "cart.widget" %}</div>`,
  },
})

test('island: a theme places behaviour it cannot write', () => {
  const manifest = compose([cart, shop])
  assert.deepEqual(manifest.islands, { 'cart.widget': { by: 'cart' } })

  const rt = createTheme(manifest, [cart, shop])
  const out = rt.renderRegion('page', { title: 'Cửa hàng', qty: 2 })
  assert.match(out, /<h1>Cửa hàng<\/h1>/)
  assert.match(out, new RegExp(`<${ISLAND_TAG} data-island="cart.widget"`))
  assert.match(out, /Giỏ \(<!--k\[-->2<!--k-->\)/, 'the island was rendered on the server too')
  assert.ok(!out.includes('on:'), 'and its handler stayed behind')
})

test('island: a theme declaring one is refused outright', () => {
  const e = (() => {
    try {
      defineTheme({ name: 't', islands: { x: () => html`<b>x</b>` } })
    } catch (err) {
      return err as KetError
    }
  })()!
  assert.equal(e.code, 'E_THEME_OVERREACH')
  assert.match(e.hint!, /places an island .* but never defines one/)
})

test('island: placing one nobody provides fails at build time', () => {
  const bad = defineTheme({ name: 't2', templates: { p: `{% island "ghost.widget" %}` } })
  assert.throws(
    () => createTheme(compose([cart, bad]), [cart, bad]),
    /places island "ghost.widget", which no installed module provides/,
  )
})

test('island: two modules cannot claim the same island', () => {
  const other = defineModule({ name: 'other', islands: { 'cart.widget': () => html`<b>x</b>` } })
  assert.throws(() => compose([cart, other]), /already provided by "cart"/)
})

test('island: only the island hydrates; the rest of the page stays inert', () => {
  const manifest = compose([cart, shop])
  const rt = createTheme(manifest, [cart, shop])
  const container = parseFragment(rt.renderRegion('page', { title: 'Cửa hàng', qty: 2 }))

  const h1 = container.querySelectorAll('h1')[0] as TNode
  const button = container.querySelectorAll('button')[0] as TNode
  assert.equal(button.innerHTML.replace(/<!--k\[?-->/g, ''), 'Giỏ (2)')

  const live = hydrateIslands(domHost(document), container as never, rt.islands)
  assert.equal(live.length, 1)
  assert.equal(live[0]!.name, 'cart.widget')
  assert.equal(container.querySelectorAll('h1')[0], h1, 'markup outside the island is untouched')
  assert.equal(container.querySelectorAll('button')[0], button, 'and the island adopts rather than rebuilds')

  button.fire('click')
  assert.equal(button.innerHTML.replace(/<!--k\[?-->/g, ''), 'Giỏ (3)', 'the island is alive')

  live[0]!.dispose()
  button.fire('click')
  assert.equal(button.innerHTML.replace(/<!--k\[?-->/g, ''), 'Giỏ (3)', 'and stops when disposed')
})

test('island: hydrating one nobody registered says which', () => {
  const container = parseFragment(`<${ISLAND_TAG} data-island="ghost" data-props="{}"></${ISLAND_TAG}>`)
  assert.throws(
    () => hydrateIslands(domHost(document), container as never, {}),
    /island "ghost", which no installed module provides/,
  )
})
