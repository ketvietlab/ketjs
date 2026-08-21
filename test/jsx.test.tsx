import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countingHost, domHost, mount, renderToString, signal } from '@ketvietlab/ketjs-view'
import type { HostNode, TemplateResult } from '@ketvietlab/ketjs-view'
import { jsx } from '@ketvietlab/ketjs-view/jsx-runtime'
import { document, parseFragment } from './helpers/dom.ts'

type CounterProps = { label: string; count: number; onIncrement?: () => void }

function Counter({ label, count, onIncrement }: CounterProps): TemplateResult {
  return (
    <button type="button" class="counter" data-count={count} onClick={onIncrement}>
      {label}: {count}
    </button>
  )
}

test('jsx: compiles through the Ket runtime and escapes dynamic content', () => {
  const out = renderToString(<Counter label={'<script>'} count={2} />)
  assert.match(out, /^<button type="button" class="counter" data-count="2">/)
  assert.match(out, /&lt;script&gt;/)
  assert.ok(!out.includes('<script>'))
  assert.ok(!out.includes('on:click'))
})

test('jsx: preserves authored attribute order for stable server output', () => {
  const out = renderToString(<form data-ui="signout" method="post" action="/logout" />)
  assert.equal(out, '<form data-ui="signout" method="post" action="/logout"></form>')
})

test('jsx: a signal update keeps surgical hole writes', () => {
  const host = countingHost()
  const container = host.root()
  const count = signal(0)
  mount(host, container, () => <Counter label="Count" count={count()} />)
  host.reset()

  count.set(1)
  assert.equal(host.ops.createElement, 0)
  assert.equal(host.ops.insert, 0)
  assert.equal(host.ops.remove, 0)
  assert.equal(host.ops.setAttribute, 1)
  assert.equal(host.ops.setText, 1)
})

test('jsx: event handlers attach once and refresh their closure', () => {
  const host = countingHost()
  const container = host.root()
  const count = signal(0)
  mount(host, container, () => (
    <Counter label="Count" count={count()} onIncrement={() => count.set((value) => value + 1)} />
  ))
  const button = container.children![0]!

  host.fire(button, 'click')
  host.fire(button, 'click')
  assert.equal(count(), 2)
  assert.equal(host.ops.listen, 1)
})

test('jsx: server markup hydrates without replacing its element', async () => {
  const { mountHydrated } = await import('@ketvietlab/ketjs-view')
  const count = signal(3)
  const view = () => <Counter label="Count" count={count()} />
  const container = parseFragment(renderToString(view()))
  const button = container.querySelectorAll('button')[0]!

  mountHydrated(domHost(document), container as unknown as HostNode, view)
  count.set(4)
  assert.equal(container.querySelectorAll('button')[0], button)
  assert.match(button.innerHTML.replace(/<!--k\[?-->/g, ''), /Count: 4/)
})

test('jsx: fragments support authored siblings while dynamic lists stay explicit', () => {
  const out = renderToString(
    <>
      <span>A</span>
      <span>B</span>
    </>,
  )
  assert.match(out, /<span>.*A.*<\/span>.*<span>.*B.*<\/span>/)
})

test('jsx: unsafe HTML and children on void elements fail loudly', () => {
  assert.throws(
    () => renderToString(<div {...{ dangerouslySetInnerHTML: { __html: '<b>x</b>' } }} />),
    /no dangerouslySetInnerHTML/,
  )
  assert.throws(() => renderToString(jsx('input', { children: 'wrong' })), /void element/)
})
