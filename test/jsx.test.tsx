import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countingHost,
  domHost,
  mount,
  renderToStaticString,
  renderToString,
  signal,
} from '@ketvietlab/ketjs-view'
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

test('jsx: siblings written out in source share their parent template and still hydrate', async () => {
  const { mountHydrated } = await import('@ketvietlab/ketjs-view')
  const name = signal('A')
  const view = () => (
    <li>
      <span>{name()}</span>
      <b>{'B'}</b>
    </li>
  )
  const out = renderToString(view())
  // One pair of markers per child: no fragment template wrapped around the siblings.
  assert.equal(
    out,
    '<li><!--k[--><span><!--k[-->A<!--k--></span><!--k--><!--k[--><b><!--k[-->B<!--k--></b><!--k--></li>',
  )

  const container = parseFragment(out)
  const span = container.querySelectorAll('span')[0]!
  mountHydrated(domHost(document), container as unknown as HostNode, view)
  name.set('C')
  assert.equal(container.querySelectorAll('span')[0], span)
  assert.match(span.innerHTML.replace(/<!--k\[?-->/g, ''), /^C$/)
})

test('jsx: a list built at run time stays one hole and renders in order', () => {
  const items = ['x', 'y']
  assert.equal(
    renderToStaticString(
      <ul>
        {items.map((item) => (
          <li>{item}</li>
        ))}
      </ul>,
    ),
    '<ul><li>x</li><li>y</li></ul>',
  )
})

test('jsx: cached shapes never stand in for a different list of attribute names', () => {
  assert.equal(renderToStaticString(jsx('div', { a: '1', b: '2' })), '<div a="1" b="2"></div>')
  assert.equal(renderToStaticString(jsx('div', { a: '1' })), '<div a="1"></div>')
  assert.equal(renderToStaticString(jsx('div', { b: '2', a: '1' })), '<div b="2" a="1"></div>')
  for (let i = 0; i < 2; i++) {
    assert.throws(() => jsx('div', { 'a b': '1' }), /invalid JSX attribute name/)
    assert.throws(() => jsx('div', { class: 'x', className: 'y' }), /provided more than once/)
  }
})

test('jsx: style objects are flattened on every render of a cached shape', () => {
  const box = (width: number) => <div id="box" style={{ width: `${width}px`, marginTop: 0 }} />
  assert.equal(renderToStaticString(box(1)), '<div id="box" style="width:1px;margin-top:0"></div>')
  assert.equal(renderToStaticString(box(2)), '<div id="box" style="width:2px;margin-top:0"></div>')
})

test('jsx: the development runtime keeps written-out siblings in one template', async () => {
  const { jsxDEV } = await import('@ketvietlab/ketjs-view/jsx-dev-runtime')
  const node = jsxDEV('p', { children: ['a', 'b'] }, undefined, true)
  assert.equal(renderToString(node), '<p><!--k[-->a<!--k--><!--k[-->b<!--k--></p>')
  assert.equal(renderToStaticString(jsxDEV('p', { children: ['a', 'b'] }, undefined, false)), '<p>ab</p>')
})
