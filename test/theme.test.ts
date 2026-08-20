import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileKtl } from 'ketjs/theme'
import { compose, createTheme, defineModule, defineTheme, makeDrop, sealScope, tokensToCss } from 'ketjs'
import { catalog, defaultTheme as theme, inventory } from 'ketsuite'

const render = (src: string, scope: Record<string, unknown> = {}) =>
  compileKtl(src, { name: 't' }).render(scope)

test('ktl: interpolation, filters, loops and conditionals', () => {
  assert.equal(render('{{ p.title }}', { p: { title: 'Áo' } }), 'Áo')
  assert.equal(render('{{ p.cents | money }}', { p: { cents: 150000 } }).replace(/ /g, ' '), '1.500 ₫')
  assert.equal(
    render('{% for x in xs %}[{{ loop.index }}:{{ x }}]{% endfor %}', { xs: ['a', 'b'] }),
    '[0:a][1:b]',
  )
  assert.equal(render('{% if n > 2 %}nhiều{% else %}ít{% endif %}', { n: 5 }), 'nhiều')
  assert.equal(render('{{ missing | default: "-" }}', {}), '-')
})

test('ktl: output is escaped by default', () => {
  assert.equal(render('{{ x }}', { x: '<script>alert(1)</script>' }), '&lt;script&gt;alert(1)&lt;/script&gt;')
  assert.equal(render('{{ raw x }}', { x: '<b>ok</b>' }), '<b>ok</b>')
})

test('sandbox: a theme cannot reach the prototype chain', () => {
  assert.throws(() => render('{{ x.__proto__ }}', { x: {} }), /forbidden property/)
  assert.throws(() => render('{{ x.constructor }}', { x: {} }), /forbidden property/)
})

test('sandbox: a theme cannot call anything', () => {
  assert.throws(() => render('{{ f }}', { f: () => 'boom' }), /reached a function/)
  assert.throws(() => sealScope({ evil: () => 1 }), /is a function/)
})

test('sandbox: a theme cannot reach globals, and unknown filters are refused at compile time', () => {
  assert.equal(render('{{ process.env.HOME }}', {}), '')
  assert.equal(render('{{ globalThis }}', {}), '')
  assert.throws(() => compileKtl('{{ x | exec }}', { name: 't' }), /unknown filter "exec"/)
})

test('view model: a drop exposes exactly the declared fields and nothing else', () => {
  const manifest = compose([catalog, inventory, theme])
  const row = {
    id: 'p1',
    title: 'Áo',
    priceCents: 5000,
    slug: 'ao',
    active: true,
    leadTimeDays: 3,
    warehouse: 'HN',
  }
  const drop = makeDrop(manifest, 'catalog.product', row)
  assert.deepEqual(Object.keys(drop), ['id', 'title', 'priceCents', 'slug'])
  assert.equal('active' in drop, false, 'a field the module did not expose must not leak')
  assert.equal(Object.getPrototypeOf(drop), null)
  assert.throws(() => {
    ;(drop as Record<string, unknown>).title = 'hack'
  })
})

test('theme: renders regions and fills joints from other modules', () => {
  const mods = [catalog, inventory, theme]
  const manifest = compose(mods)
  const rt = createTheme(manifest, mods)
  const html = rt.renderRegion('product.detail', {
    product: { id: 'p1', title: 'Áo thun', priceCents: 150000, leadTimeDays: 3 },
    related: [{ title: 'Quần' }],
  })
  assert.match(html, /<h1>Áo thun<\/h1>/)
  assert.match(html, /Giao sau 3 ngày/, 'the fill contributed by inventory must appear inside the joint')
  assert.match(html, /0\. Quần/)
})

test('theme: a template pointing at an unpublished joint fails at build time', () => {
  const mods = [
    catalog,
    { ...theme, templates: { ...theme.templates, layout: '{% joint "catalog:nope" %}' } },
  ]
  assert.throws(
    () => createTheme(compose(mods as never), mods as never),
    /E_TEMPLATE_UNKNOWN_JOINT|no installed module publishes/,
  )
})

test('theme: omit removes fills from KTL rendering too', () => {
  const owner = defineModule({ name: 'owner', joints: { slot: {} } })
  const fill = defineModule({ name: 'fill', depends: ['owner'], fills: { 'owner:slot': '<b>visible</b>' } })
  const omit = defineModule({ name: 'omit', depends: ['owner'], omits: ['owner:slot'] })
  const shell = defineTheme({
    name: 'shell',
    depends: ['owner'],
    templates: { layout: `<main>{% joint "owner:slot" %}</main>` },
  })
  const modules = [owner, fill, omit, shell]
  assert.equal(createTheme(compose(modules), modules).renderRegion('layout', {}), '<main></main>')
})

test('tokens: become CSS custom properties inside a declared cascade layer', () => {
  const css = tokensToCss({ 'color-accent': 'oklch(0.58 0.19 268)' })
  assert.match(css, /@layer ket\.reset, ket\.theme, ket\.app, ket\.user;/)
  assert.match(css, /--ket-color-accent: oklch\(0\.58 0\.19 268\);/)
})
