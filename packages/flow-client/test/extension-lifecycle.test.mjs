import test from 'node:test'
import assert from 'node:assert/strict'
import { html, renderToStaticString } from '@ketvietlab/ketjs-view'
import { registerFlowExtension } from '@ketvietlab/flow-client/extensions.mjs'
import { createFlowWorkspace } from '@ketvietlab/flow-client/workspace.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { createFnClient } from '@ketvietlab/flow-client/api.mjs'
let ctx
const calls = []
registerFlowExtension({
  name: 'lifecycle-probe',
  routes: { probe: { title: 'Probe', pattern: 'workspace', scope: 'workspace' } },
  forms: { 'probe-form': { title: 'Probe form', back: 'probe' } },
  create(context) {
    ctx = context
    return {
      view: () => html`<p>extension page</p>`,
      modal: () => html`<p>extension form</p>`,
      topAction: () => html`<span>extension action</span>`,
      navigation: (group) =>
        group === 'workspace' ? [{ key: 'probe', label: 'Probe navigation', icon: 'grid' }] : [],
      urlParams: () => ({ extensionState: 'preserved' }),
      readUrl: (p) => calls.push(['readUrl', p.extensionState]),
      sync: () => calls.push(['sync']),
      afterRender: () => calls.push(['afterRender']),
      beforeNavigate: (key) => calls.push(['beforeNavigate', key]),
      reset: () => calls.push(['reset']),
      dispose: () => calls.push(['dispose']),
      mutationError: (e) => (e.code === 'testError' ? { message: 'handled extension error' } : undefined),
    }
  },
})
const tick = () => new Promise((r) => setImmediate(r))
test('host invokes registered navigation, URL, refresh, feedback and resource lifecycle hooks', async (t) => {
  const previous = Object.fromEntries(
      ['window', 'MutationObserver', 'location', 'history', 'requestAnimationFrame'].map((k) => [
        k,
        globalThis[k],
      ]),
    ),
    observers = []
  t.after(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete globalThis[k]
      else globalThis[k] = v
    }
  })
  globalThis.requestAnimationFrame = (fn) => fn()
  globalThis.window = new EventTarget()
  globalThis.MutationObserver = class {
    constructor(fn) {
      this.fn = fn
      observers.push(this)
    }
    observe() {}
    disconnect() {}
  }
  globalThis.location = { href: 'http://flow.test/flow/probe?lang=en&extensionState=initial' }
  globalThis.history = {
    state: null,
    replaceState(state, _title, url) {
      this.state = state
      if (url) location.href = new URL(url, location.href).href
    },
    pushState(state, _title, url) {
      this.replaceState(state, _title, url)
    },
  }
  const fixture = createOrganizationSession(),
    call = createFnClient({
      fetch: async (url, request) =>
        new Response(
          JSON.stringify(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
        ),
    })
  const root = Object.assign(new EventTarget(), {
    ownerDocument: new EventTarget(),
    querySelector: () => null,
    querySelectorAll: () => [],
  })
  const lifetime = new AbortController(),
    island = createFlowWorkspace(
      { screen: 'probe' },
      {
        call: async (name, ...args) => {
          if (name === 'test.failure') throw Object.assign(Error('original error'), { code: 'testError' })
          return call(name, ...args)
        },
      },
    )
  t.after(() => {
    lifetime.abort()
    island.dispose()
  })
  island.mount({ root, lifetime: lifetime.signal })
  await tick()
  assert.ok(calls.some((c) => c[0] === 'readUrl' && c[1] === 'initial'))
  assert.ok(calls.some((c) => c[0] === 'sync'))
  assert.match(renderToStaticString(island.view()), /extension page/)
  assert.match(renderToStaticString(island.view()), /extension action/)
  assert.match(renderToStaticString(island.view()), /Probe navigation/)
  observers[0].fn()
  assert.ok(calls.some((c) => c[0] === 'afterRender'))
  ctx.navigate('probe-form')
  assert.match(renderToStaticString(island.view()), /extension form/)
  assert.ok(calls.some((c) => c[0] === 'beforeNavigate' && c[1] === 'probe-form'))
  ctx.navigate('probe')
  assert.equal(new URL(location.href).searchParams.get('extensionState'), 'preserved')
  await ctx.mutate('test.failure')
  assert.match(renderToStaticString(island.view()), /handled extension error/)
  assert.doesNotMatch(renderToStaticString(island.view()), /original error/)
  location.href = 'http://flow.test/flow/probe?company=north&lang=en'
  window.dispatchEvent(new Event('popstate'))
  await tick()
  assert.ok(calls.some((c) => c[0] === 'reset'))
  calls.length = 0
  location.href = 'http://flow.test/flow/probe?company=north&workspace=north-operations&lang=en'
  window.dispatchEvent(new Event('popstate'))
  await tick()
  assert.ok(calls.some((c) => c[0] === 'reset'))
  island.dispose()
  assert.ok(calls.some((c) => c[0] === 'dispose'))
})
