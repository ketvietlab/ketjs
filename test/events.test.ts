import { test } from 'node:test'
import assert from 'node:assert/strict'
import { document, parseFragment } from './helpers/dom.ts'
import {
  countingHost,
  createRoot,
  domHost,
  each,
  html,
  hydrateRoot,
  mount,
  mountHydrated,
  renderToString,
  signal,
  trustedMarkup,
} from '@ketvietlab/ketjs-view'
import type { HostNode } from '@ketvietlab/ketjs-view'

test('events: on:click attaches a listener, not an attribute', () => {
  const host = countingHost()
  const container = host.root()
  let clicks = 0
  createRoot(host, container).render(html`<button on:click=${() => clicks++}>bấm</button>`)

  const button = container.children![0]!
  assert.equal(host.ops.listen, 1)
  assert.deepEqual(button.attrs, {}, 'a handler must not become an attribute')
  host.fire(button, 'click')
  assert.equal(clicks, 1)
})

test('events: re-rendering swaps the handler without touching the listener', () => {
  const host = countingHost()
  const container = host.root()
  const log: string[] = []
  const view = (name: string) => html`<button on:click=${() => log.push(name)}>x</button>`
  const root = createRoot(host, container)

  root.render(view('first'))
  const button = container.children![0]!
  host.fire(button, 'click')

  for (let i = 0; i < 50; i++) root.render(view('later'))
  assert.equal(host.ops.listen, 1, 'fifty renders, still one listener')
  host.fire(button, 'click')
  assert.deepEqual(log, ['first', 'later'], 'and the newest closure is the one that runs')
})

test('events: a removed element detaches its listener', () => {
  const host = countingHost()
  const container = host.root()
  let fired = 0
  const view = (ids: number[]) =>
    html`<ul>${each(
      ids,
      (i) => i,
      (i) => html`<li on:click=${() => fired++}>${i}</li>`,
    )}</ul>`
  const root = createRoot(host, container)
  root.render(view([1, 2]))
  const ul = container.children![0]!
  const second = ul.children![1]!

  root.render(view([1]))
  host.fire(second, 'click')
  assert.equal(fired, 0, 'a detached row must not still respond')
})

test('events: the server renders no handler at all', () => {
  const out = renderToString(html`<button class="b" on:click=${() => {}} disabled=${false}>bấm</button>`)
  assert.equal(out, '<button class="b">bấm</button>')
  assert.ok(!out.includes('on:'), 'behaviour is not markup')
})

test('events: hydration is where a handler first attaches', () => {
  let clicks = 0
  const view = () =>
    html`<button on:click=${() => {
      clicks++
    }}>đã bấm</button>`
  const server = renderToString(view())
  assert.ok(!server.includes('on:'), 'the server sent no handler')

  const container = parseFragment(server)
  const button = container.querySelectorAll('button')[0]!
  hydrateRoot(domHost(document), container as unknown as HostNode, view())

  assert.equal(button.getAttribute('on:click'), null, 'no attribute is left behind')
  button.fire('click')
  assert.equal(clicks, 1, 'the button works only because hydration attached it')
})

test('mount: reading a signal in the view subscribes the view to it', () => {
  const host = countingHost()
  const container = host.root()
  const count = signal(0)
  const other = signal('unused')

  const m = mount(host, container, () => html`<p>đếm: ${count()}</p>`)
  assert.equal(host.text(container), 'đếm: 0')
  host.reset()

  count.set(1)
  assert.equal(host.text(container), 'đếm: 1')
  assert.deepEqual(
    host.ops,
    {
      createElement: 0,
      createText: 0,
      setText: 1,
      setAttribute: 0,
      insert: 0,
      remove: 0,
      move: 0,
      listen: 0,
    },
    'a signal change costs exactly the one write it implies',
  )

  other.set('still unused')
  assert.equal(host.ops.setText, 1, 'an untracked signal triggers nothing')

  count.set(1)
  assert.equal(host.ops.setText, 1, 'writing the same value triggers nothing')

  m.dispose()
  count.set(99)
  assert.equal(host.text(container), 'đếm: 1', 'after dispose the view stops following')
})

test('mount: dispose detaches listeners from the DOM it leaves behind', () => {
  const host = countingHost()
  const container = host.root()
  let clicks = 0
  const mounted = mount(host, container, () => html`<button on:click=${() => clicks++}>x</button>`)
  const button = container.children![0]!

  mounted.dispose()
  host.fire(button, 'click')
  assert.equal(clicks, 0)
})

test('view: trusted markup is materialised and replaced on the client', () => {
  const container = parseFragment('')
  const root = createRoot(domHost(document), container as unknown as HostNode)
  const view = (markup: string) => html`<section>${trustedMarkup(markup)}</section>`

  root.render(view('<b>một</b><i>hai</i>'))
  assert.equal(container.querySelectorAll('section')[0]!.innerHTML, '<b>một</b><i>hai</i>')
  root.render(view('<em>ba</em>'))
  assert.equal(container.querySelectorAll('section')[0]!.innerHTML, '<em>ba</em>')
})

test('view: hydration adopts trusted markup and can update it', () => {
  const view = (markup: string) => html`<section>${trustedMarkup(markup)}</section>`
  const container = parseFragment(renderToString(view('<b>server</b>')))
  const section = container.querySelectorAll('section')[0]!
  const serverNode = container.querySelectorAll('b')[0]!
  const root = hydrateRoot(domHost(document), container as unknown as HostNode, view('<b>server</b>'))

  assert.equal(container.querySelectorAll('b')[0], serverNode)
  root.render(view('<i>client</i>'))
  assert.equal(container.querySelectorAll('section')[0], section)
  assert.equal(section.innerHTML.replace(/<!--k\[?-->/g, ''), '<i>client</i>')
})

test('mount: a click drives a signal drives the DOM, end to end', () => {
  const host = countingHost()
  const container = host.root()
  const n = signal(0)
  mount(host, container, () => html`<button on:click=${() => n.set((v) => v + 1)}>Đã bấm ${n()} lần</button>`)

  assert.equal(host.text(container), 'Đã bấm 0 lần')
  const button = container.children![0]!
  host.fire(button, 'click')
  host.fire(button, 'click')
  assert.equal(host.text(container), 'Đã bấm 2 lần')
  assert.equal(host.ops.listen, 1, 'still the one listener from the first render')
})

test('mount: hydrating then going reactive keeps the server DOM', () => {
  const n = signal(5)
  let renders = 0
  const view = () => {
    renders++
    return html`<p>giá trị ${n()}</p>`
  }
  const container = parseFragment(renderToString(view()))
  const p = container.querySelectorAll('p')[0]!
  renders = 0

  mountHydrated(domHost(document), container as unknown as HostNode, view)
  assert.equal(renders, 1, 'the initial reactive pass hydrates and subscribes at once')
  assert.equal(container.querySelectorAll('p')[0], p, 'the server node survives')

  n.set(6)
  assert.match(p.innerHTML.replace(/<!--k\[?-->/g, ''), /giá trị 6/)
  assert.equal(container.querySelectorAll('p')[0], p, 'and survives the update too')
})
