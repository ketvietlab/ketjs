import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFragment, document } from './helpers/dom.ts'
import type { TNode } from './helpers/dom.ts'
import {
  compose,
  createKetServer,
  createTheme,
  defineModule,
  defineTheme,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { KetError } from '@ketvietlab/ketjs'
import {
  ISLAND_TAG,
  createIslandManager,
  domHost,
  html,
  hydrateIslands,
  renderIsland,
  signal,
} from '@ketvietlab/ketjs-view'
import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'
import { address, partner, website, websiteSearch } from '@ketvietlab/ketsuite'

// A module provides behaviour...
let cartInstances = 0
const cart = defineModule({
  name: 'cart',
  islands: {
    'cart.widget': {
      props: { qty: 'int' },
      view: (props: IslandProps) => {
        cartInstances++
        const clicks = signal(0)
        return () =>
          html`<button on:click=${() => clicks.set((c) => c + 1)}>Giỏ (${(props.qty as number) + clicks()})</button>`
      },
    },
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
  assert.deepEqual(manifest.islands, { 'cart.widget': { by: 'cart', props: { qty: 'int' } } })

  const rt = createTheme(manifest, [cart, shop])
  const out = rt.renderRegion('page', { title: 'Cửa hàng', qty: 2 })
  assert.match(out, /<h1>Cửa hàng<\/h1>/)
  assert.match(out, new RegExp(`<${ISLAND_TAG} data-island="cart.widget"`))
  assert.match(out, /data-key="\{&quot;qty&quot;:2\}"/)
  assert.match(out, /Giỏ \(<!--k\[-->2<!--k-->\)/, 'the island was rendered on the server too')
  assert.ok(!out.includes('on:'), 'and its handler stayed behind')
  const serializedProps = /data-props="([^"]*)"/.exec(out)?.[1] ?? ''
  assert.ok(!serializedProps.includes('Cửa hàng'), 'only declared island props cross into data-props')
  assert.throws(
    () => rt.renderRegion('page', { title: 'Cửa hàng', qty: '2' }),
    /island "cart.widget" prop "qty" expects int/,
  )
  assert.throws(
    () => rt.renderRegion('page', { title: 'Cửa hàng' }),
    /island "cart.widget" prop "qty" expects int/,
    'required island props fail on the server instead of hydrating with a different tree',
  )
})

test('island: a theme declaring one is refused outright', () => {
  const e = (() => {
    try {
      defineTheme({
        name: 't',
        islands: { x: { view: () => () => html`<b>x</b>` } },
      })
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
    /places island "ghost.widget", which no composed module provides/,
  )
})

test('island: two modules cannot claim the same island', () => {
  const otherIsland: IslandDefinition = { view: () => () => html`<b>x</b>` }
  const other = defineModule({ name: 'other', islands: { 'cart.widget': otherIsland } })
  assert.throws(() => compose([cart, other]), /already provided by "cart"/)
})

test('island: prop contracts and browser module paths are validated while composing', () => {
  assert.throws(
    () =>
      compose([
        defineModule({
          name: 'bad_props',
          islands: { bad: { props: { value: 'mystery' }, view: () => () => html`<b>x</b>` } },
        }),
      ]),
    /prop "value" has unknown type "mystery"/,
  )
  assert.throws(
    () =>
      compose([
        defineModule({
          name: 'bad_client',
          assets: new URL('.', import.meta.url),
          islands: { bad: { client: '../escape.mjs', view: () => () => html`<b>x</b>` } },
        }),
      ]),
    /client path must stay inside/,
  )
  assert.throws(
    () =>
      compose([
        defineModule({
          name: 'bad_key',
          islands: {
            bad: { props: { id: 'id?', payload: 'json' }, key: ['id', 'payload'], view: () => () => html`x` },
          },
        }),
      ]),
    /key prop .* must be a declared, required scalar/,
  )
})

test('island: only the island hydrates; the rest of the page stays inert', () => {
  const manifest = compose([cart, shop])
  const rt = createTheme(manifest, [cart, shop])
  const container = parseFragment(rt.renderRegion('page', { title: 'Cửa hàng', qty: 2 }))

  const h1 = container.querySelectorAll('h1')[0] as TNode
  const button = container.querySelectorAll('button')[0] as TNode
  assert.equal(button.innerHTML.replace(/<!--k\[?-->/g, ''), 'Giỏ (2)')

  cartInstances = 0
  const live = hydrateIslands(domHost(document), container as never, rt.islands)
  assert.equal(live.length, 1)
  assert.equal(live[0]!.name, 'cart.widget')
  assert.equal(container.querySelectorAll('h1')[0], h1, 'markup outside the island is untouched')
  assert.equal(container.querySelectorAll('button')[0], button, 'and the island adopts rather than rebuilds')

  button.fire('click')
  assert.equal(button.innerHTML.replace(/<!--k\[?-->/g, ''), 'Giỏ (3)', 'the island is alive')
  assert.equal(
    cartInstances,
    1,
    'reactive renders reuse one factory closure instead of resetting local state',
  )

  live[0]!.dispose()
  button.fire('click')
  assert.equal(button.innerHTML.replace(/<!--k\[?-->/g, ''), 'Giỏ (3)', 'and stops when disposed')
})

test('island: a controller owns browser cleanup and server instances are finalized', () => {
  let disposed = 0
  const factory = () => ({
    view: () => html`<button>controlled</button>`,
    dispose: () => disposed++,
  })
  const markup = renderIsland('controlled', factory, {})
  assert.equal(disposed, 1, 'the short-lived SSR controller is finalized')

  const container = parseFragment(markup)
  const live = hydrateIslands(domHost(document), container as never, { controlled: factory })
  assert.equal(disposed, 1)
  live[0]!.dispose()
  live[0]!.dispose()
  assert.equal(disposed, 2, 'browser cleanup runs once even if disposal is repeated')
})

test('island manager: same identity preserves DOM and local reactive state', () => {
  const factory = (props: IslandProps) => {
    const clicks = signal(0)
    return () =>
      html`<button on:click=${() => clicks.set((value) => value + 1)}>${props.label}: ${clicks()}</button>`
  }
  const first = parseFragment(renderIsland('counter', factory, { id: 'one', label: 'A' }, { key: ['id'] }))
  const manager = createIslandManager(domHost(document), { counter: factory })
  manager.hydrate(first as never)
  const island = first.querySelectorAll(ISLAND_TAG)[0]!
  const button = first.querySelectorAll('button')[0]!
  button.fire('click')

  const next = parseFragment(renderIsland('counter', factory, { id: 'one', label: 'A' }, { key: ['id'] }))
  manager.reconcile(first as never, next as never)
  assert.equal(first.querySelectorAll(ISLAND_TAG)[0], island)
  assert.equal(first.querySelectorAll('button')[0], button)
  assert.match(button.innerHTML.replace(/<!--k\[?-->/g, ''), /A: 1/)
})

test('island manager: changed props update a controller or remount a plain view', () => {
  let updates = 0
  const controlled = (props: IslandProps) => {
    const label = signal(String(props.label))
    return {
      view: () => html`<span>${label()}</span>`,
      update: (next: Readonly<IslandProps>) => {
        updates++
        label.set(String(next.label))
      },
    }
  }
  const first = parseFragment(renderIsland('label', controlled, { id: 'one', label: 'A' }, { key: ['id'] }))
  const manager = createIslandManager(domHost(document), { label: controlled })
  manager.hydrate(first as never)
  const island = first.querySelectorAll(ISLAND_TAG)[0]!
  const next = parseFragment(renderIsland('label', controlled, { id: 'one', label: 'B' }, { key: ['id'] }))
  manager.reconcile(first as never, next as never)
  assert.equal(first.querySelectorAll(ISLAND_TAG)[0], island)
  assert.equal(updates, 1)
  assert.match(first.innerHTML.replace(/<!--k\[?-->/g, ''), />B</)

  let disposed = 0
  const plain = (props: IslandProps) => ({
    view: () => html`<i>${props.label}</i>`,
    dispose: () => disposed++,
  })
  const oldPlain = parseFragment(renderIsland('plain', plain, { id: 'one', label: 'A' }, { key: ['id'] }))
  disposed = 0
  const plainManager = createIslandManager(domHost(document), { plain })
  plainManager.hydrate(oldPlain as never)
  const oldIsland = oldPlain.querySelectorAll(ISLAND_TAG)[0]!
  const nextPlain = parseFragment(renderIsland('plain', plain, { id: 'one', label: 'B' }, { key: ['id'] }))
  disposed = 0
  plainManager.reconcile(oldPlain as never, nextPlain as never)
  assert.notEqual(oldPlain.querySelectorAll(ISLAND_TAG)[0], oldIsland)
  assert.equal(disposed, 1, 'the replaced browser controller is disposed once')
})

test('island manager: duplicate identities remount and warn instead of preserving ambiguously', () => {
  const factory = (props: IslandProps) => () => html`<b>${props.label}</b>`
  const first = parseFragment(renderIsland('label', factory, { id: 'one', label: 'A' }, { key: ['id'] }))
  const manager = createIslandManager(domHost(document), { label: factory })
  manager.hydrate(first as never)
  const oldIsland = first.querySelectorAll(ISLAND_TAG)[0]!
  const markup = renderIsland('label', factory, { id: 'one', label: 'A' }, { key: ['id'] })
  const next = parseFragment(markup + markup)
  const warnings: string[] = []
  const previousWarn = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    manager.reconcile(first as never, next as never)
  } finally {
    console.warn = previousWarn
  }

  assert.equal(first.querySelectorAll(ISLAND_TAG).length, 2)
  assert.notEqual(first.querySelectorAll(ISLAND_TAG)[0], oldIsland)
  assert.deepEqual(warnings.length, 1)
  assert.match(warnings[0]!, /duplicate key.*remounting ambiguous instances/)
})

test('island: the server publishes a tenant-specific browser bootstrap and view runtime', async () => {
  const shell = defineTheme({
    name: 'island_shell',
    depends: ['website_search'],
    templates: {
      layout: `<html><body><main data-ket-slot="website.page">{% island "website.search" %}</main></body></html>`,
      'website.page': '<main></main>',
    },
  })
  const modules = [address, partner, website, websiteSearch, shell]
  const manifest = compose(modules)
  const theme = createTheme(manifest, modules)
  const adapter = sqliteAdapter()
  await adapter.open()
  const server = await createKetServer({
    manifest,
    adapter,
    theme,
    assets: { prefix: '/_ket/asset/website_search/', dir: manifest.assets['website_search']! },
    pageScope: () => ({ label: 'Tìm' }),
  })
  const port = await server.listen(0)
  const base = `http://127.0.0.1:${port}`
  try {
    const page = await fetch(base).then((response) => response.text())
    assert.match(page, /<ket-island/)
    assert.match(page, /<script type="module" src="\/_ket\/islands\.js"><\/script><\/body>/)

    const bootstrap = await fetch(`${base}/_ket/islands.js`)
    assert.match(bootstrap.headers.get('content-type') ?? '', /^text\/javascript/)
    const bootstrapSource = await bootstrap.text()
    assert.match(bootstrapSource, /\/_ket\/asset\/website_search\/search\.mjs/)
    assert.match(bootstrapSource, /createIslandManager/)
    assert.match(bootstrapSource, /x-ket-navigation/)
    assert.match(bootstrapSource, /navigation fragment contains unknown island/)

    const runtime = await fetch(`${base}/_ket/view/index.js`)
    assert.equal(runtime.status, 200)
    assert.match(runtime.headers.get('content-type') ?? '', /^text\/javascript/)

    const client = await fetch(`${base}/_ket/asset/website_search/search.mjs`)
    assert.equal(client.status, 200)
    assert.match(client.headers.get('content-type') ?? '', /^text\/javascript/)
  } finally {
    await server.close()
    await adapter.close()
  }
})

test('island: hydrating one nobody registered says which', () => {
  const container = parseFragment(`<${ISLAND_TAG} data-island="ghost" data-props="{}"></${ISLAND_TAG}>`)
  assert.throws(
    () => hydrateIslands(domHost(document), container as never, {}),
    /island "ghost", which no composed module provides/,
  )
  assert.deepEqual(
    hydrateIslands(domHost(document), container as never, {}, { strict: false }),
    [],
    'the production bootstrap may leave an explicitly server-only island inert',
  )
})

test('island: props must be plain JSON all the way down', () => {
  assert.throws(
    () =>
      renderIsland('unsafe', () => () => html`<i>x</i>`, {
        nested: { callback: () => 'not data' },
      }),
    /not JSON-serializable/,
  )
})

test('island: an initially empty text hole hydrates and can become content', () => {
  const value = signal('')
  const empty = defineModule({
    name: 'empty_island',
    islands: {
      empty: {
        view: () => () => html`<div>${value()}<i>stable</i></div>`,
      },
    },
  })
  const manifest = compose([empty])
  const rt = createTheme(manifest, [empty])
  const markup = renderIsland('empty', rt.islands.empty!, {})
  assert.match(markup, /<!--k\[--><!--k-->/, 'SSR correctly emits no empty text node')
  const container = parseFragment(markup)
  const live = hydrateIslands(domHost(document), container as never, rt.islands)
  value.set('now visible')
  assert.match(container.innerHTML, /now visible/)
  live[0]!.dispose()
})
