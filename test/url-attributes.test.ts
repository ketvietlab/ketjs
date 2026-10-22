import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileKtl } from '@ketvietlab/ketjs'
import { countingHost, createRoot, html, renderToString, safeUrl } from '@ketvietlab/ketjs-view'
import { jsx } from '@ketvietlab/ketjs-view/jsx-runtime'

/**
 * A URL attribute bound from data is where escaping stops helping: the danger is
 * the scheme, not the characters. A profile link, a CMS field or a product URL
 * typed by a customer must not be able to say `javascript:` and run script with
 * the page origin when someone follows it, whichever renderer drew the element.
 */
const hostile = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  ' \tjava\nscript:alert(1)',
  '\u0000javascript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
]
const harmless = [
  'https://example.test/a?b=c',
  '/orders/42',
  '#section',
  'mailto:sales@example.test',
  'tel:+84123456789',
  'zalo://chat',
  'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
  'data:image/png;base64,iVBORw0KGgo=',
]

test('url attributes: safeUrl neutralises scripting schemes and leaves URLs alone', () => {
  for (const value of hostile) assert.equal(safeUrl(value), `unsafe:${value}`, JSON.stringify(value))
  for (const value of harmless) assert.equal(safeUrl(value), value, value)
  assert.equal(safeUrl(null), null)
  assert.equal(safeUrl(undefined), undefined)
  assert.equal(safeUrl(false), false)
  assert.equal(safeUrl(new URL('https://example.test/x')), 'https://example.test/x')
})

test('url attributes: server rendering, JSX and the client renderer agree', () => {
  const link = (href: string) => html`<a href=${href}>x</a><img src=${href}><form action=${href}></form>`
  for (const value of hostile) {
    const markup = renderToString(link(value))
    assert.doesNotMatch(markup, /(href|src|action)="(?!unsafe:)/i, markup)
    const jsxMarkup = renderToString(jsx('a', { href: value, children: 'x' }))
    assert.match(jsxMarkup, /href="unsafe:/, jsxMarkup)

    const host = countingHost()
    const root = createRoot(host, host.root())
    root.render(link('/safe'))
    root.render(link(value))
    assert.doesNotMatch(host.html(host.root()), /(href|src|action)="(?!unsafe:)/i)
  }
  assert.match(renderToString(link('/orders/42')), /href="\/orders\/42"/)
  assert.match(
    renderToString(html`<a title=${'javascript:x'}>x</a>`),
    /title="javascript:x"/,
    'not a URL attribute',
  )
  assert.match(
    renderToString(html`<a href="javascript:void(0)">x</a>`),
    /href="javascript:void\(0\)"/,
    'author markup',
  )
})

test('url attributes: a bound srcdoc or string inline handler is refused', () => {
  assert.throws(() => renderToString(html`<iframe srcdoc=${'<script>alert(1)</script>'}></iframe>`), /srcdoc/)
  assert.throws(
    () => renderToString(html`<button onclick=${'alert(1)'}>x</button>`),
    /"onclick" cannot be bound/,
  )
  assert.throws(() => renderToString(jsx('iframe', { srcdoc: '<p>x</p>' })), /srcdoc/)
  assert.doesNotThrow(() => renderToString(html`<iframe srcdoc="<p>static</p>"></iframe>`))
})

test('url attributes: a KTL output that opens a URL attribute is checked', () => {
  const template = compileKtl(
    `<a href="{{ link }}">a</a><img src='{{ link }}'><a href={{ link }}>b</a><a href="/p/{{ link }}">c</a><p title="{{ link }}">{{ link }}</p>`,
    { name: 'card' },
  )
  const out = template.render({ link: 'javascript:alert(1)' })
  assert.equal(
    out,
    '<a href="unsafe:javascript:alert(1)">a</a><img src=\'unsafe:javascript:alert(1)\'><a href=unsafe:javascript:alert(1)>b</a><a href="/p/javascript:alert(1)">c</a><p title="javascript:alert(1)">javascript:alert(1)</p>',
  )
  assert.equal(
    compileKtl(`<a href="{{ link }}">a</a>`).render({ link: '/orders/1' }),
    '<a href="/orders/1">a</a>',
  )
})

test('url attributes: the KTL json filter cannot close a script element', () => {
  const template = compileKtl(`<script type="application/json">{{ raw data | json }}</script>`)
  const data = { note: '</script><script>alert(1)</script>', amp: 'a & b', line: 'x\u2028y' }
  const out = template.render({ data })
  assert.doesNotMatch(out.slice(0, -'</script>'.length), /<\/script|<script>alert/i)
  const text = out.slice('<script type="application/json">'.length, -'</script>'.length)
  assert.deepEqual(JSON.parse(text), data, 'the escaped text reads back as the same value')
  assert.doesNotMatch(text, /[\u2028\u2029]/)
})
