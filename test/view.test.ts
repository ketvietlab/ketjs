import { test } from 'node:test'
import assert from 'node:assert/strict'
import { batch, computed, countingHost, createRoot, each, effect, html, signal, when } from 'ketjs-view'

test('signals: effects track what they read, and a no-op write costs nothing', () => {
  const a = signal(1), b = signal(10)
  let runs = 0
  effect(() => { runs++; void a() })
  assert.equal(runs, 1)
  a.set(2); assert.equal(runs, 2)
  a.set(2); assert.equal(runs, 2, 'writing the same value must not re-run')
  b.set(99); assert.equal(runs, 2, 'an untracked signal must not re-run it')
})

test('signals: batch collapses several writes into one run', () => {
  const a = signal(0)
  let runs = 0
  effect(() => { runs++; void a() })
  batch(() => { a.set(1); a.set(2); a.set(3) })
  assert.equal(runs, 2)
  assert.equal(a(), 3)
})

test('signals: computed derives without a manual subscription', () => {
  const price = signal(100), qty = signal(2)
  const total = computed(() => price() * qty())
  assert.equal(total(), 200)
  qty.set(3)
  assert.equal(total(), 300)
})

type Item = { id: number; name: string }
const view = (items: Item[]) =>
  html`<ul>${each(items, it => (it as Item).id, it => html`<li data-id=${(it as Item).id}>${(it as Item).name}</li>`)}</ul>`

test('view: updating one row of 1000 costs exactly one host operation', () => {
  const host = countingHost()
  const root = createRoot(host, host.root())
  let items: Item[] = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `n${i}` }))
  root.render(view(items))
  host.reset()

  items = items.map(i => (i.id === 500 ? { ...i, name: 'DOI' } : i))
  root.render(view(items))
  assert.deepEqual(host.ops, { createElement: 0, createText: 0, setText: 1, setAttribute: 0, insert: 0, remove: 0, move: 0, listen: 0 })
})

test('view: re-rendering unchanged data touches nothing', () => {
  const host = countingHost()
  const root = createRoot(host, host.root())
  const items: Item[] = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
  root.render(view(items))
  host.reset()
  root.render(view(items))
  assert.equal(Object.values(host.ops).reduce((a, b) => a + b, 0), 0)
})

test('view: swapping two rows of 1000 costs two moves, not a cascade', () => {
  const host = countingHost()
  const root = createRoot(host, host.root())
  const items: Item[] = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `n${i}` }))
  root.render(view(items))
  host.reset()
  const swapped = [...items]
  const a = swapped[10]!, b = swapped[900]!
  swapped[10] = b; swapped[900] = a
  root.render(view(swapped))
  assert.equal(host.ops.move, 2)
  assert.equal(host.ops.createElement, 0)
})

test('view: removing a middle row does not move its neighbours', () => {
  const host = countingHost()
  const root = createRoot(host, host.root())
  const items: Item[] = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `n${i}` }))
  root.render(view(items))
  host.reset()
  root.render(view(items.filter(i => i.id !== 50)))
  assert.equal(host.ops.move, 0)
  assert.equal(host.ops.createElement, 0)
})

test('view: rendered markup is correct, attributes and all', () => {
  const host = countingHost()
  const container = host.root()
  const root = createRoot(host, container)
  root.render(html`<div class="box" data-n=${3}><span>${'xin chào'}</span>${when(true, () => html`<b>có</b>`)}</div>`)
  assert.equal(host.html(container.children![0]!), '<div class="box" data-n="3"><span>xin chào</span><b>có</b></div>')
})

test('view: an attribute is only written when its value actually changes', () => {
  const host = countingHost()
  const root = createRoot(host, host.root())
  const tpl = (cls: string) => html`<div class=${cls}>x</div>`
  root.render(tpl('a'))
  host.reset()
  root.render(tpl('a'))
  assert.equal(host.ops.setAttribute, 0)
  root.render(tpl('b'))
  assert.equal(host.ops.setAttribute, 1)
})
