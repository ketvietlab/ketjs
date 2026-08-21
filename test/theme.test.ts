import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileKtl } from '@ketvietlab/ketjs/theme'
import {
  compose,
  createKetServer,
  createTheme,
  defineModule,
  defineTheme,
  makeDrop,
  sealScope,
  sqliteAdapter,
  tokensToCss,
} from '@ketvietlab/ketjs'
import { catalog, defaultTheme as theme, inventory } from '@ketvietlab/ketsuite'

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

test('view model: a view-typed prop is projected, not merely type-checked', () => {
  const mods = [catalog, inventory, theme]
  const manifest = compose(mods)
  const rt = createTheme(manifest, mods)
  // `active` is on catalog.Product and in nobody's view. The joint declares
  // `product: 'catalog.product'`, so the row the page happens to hold is not what
  // crosses — the declaration is.
  const html = rt.renderRegion('product.detail', {
    product: { id: 'p1', title: 'Áo', priceCents: 1000, active: true, leadTimeDays: 3 },
    related: [],
  })
  assert.match(html, /Giao sau 3 ngày/, 'a module reads back the field it added and declared a view over')

  const owner = defineModule({
    name: 'shop',
    models: { Item: { scope: 'shared', fields: { id: 'id', name: 'text', cost: 'int' } } },
    views: { item: { of: 'shop.Item', fields: ['id', 'name'] } },
    joints: { 'item.badge': { props: { item: 'shop.item' } } },
  })
  const nosy = defineModule({
    name: 'nosy',
    depends: ['shop'],
    fills: { 'shop:item.badge': `[{{ item.name }}][{{ item.cost }}]` },
  })
  const shell = defineTheme({
    name: 'nosy_shell',
    depends: ['shop'],
    templates: { layout: `{% joint "shop:item.badge" %}` },
  })
  const nosyMods = [owner, nosy, shell]
  const out = createTheme(compose(nosyMods), nosyMods).renderRegion('layout', {
    item: { id: 'i1', name: 'Ghế', cost: 990 },
  })
  assert.equal(out, '[Ghế][]', 'a field no view declares does not reach a fill, whoever wrote it')
})

test('sandbox: a function nested inside scope data is refused too', () => {
  assert.throws(() => sealScope({ order: { total: () => 1 } }), /scope key "order\.total" is a function/)
  assert.throws(() => sealScope({ rows: [{ act: () => 1 }] }), /scope key "rows\[0\]\.act" is a function/)
  const cyclic: Record<string, unknown> = {}
  cyclic['self'] = cyclic
  assert.doesNotThrow(() => sealScope({ cyclic }), 'a cycle is data, not a reason to hang')
})

test('sections: a placement carries only the settings its section declared', () => {
  const owner = defineModule({
    name: 'blocks',
    sections: { 'blocks.note': { settings: { body: 'text', tone: 'text?' } } },
  })
  const shell = defineTheme({
    name: 'blocks_shell',
    depends: ['blocks'],
    templates: {
      layout: `{% sections %}`,
      'blocks.note': `[{{ body }}][{{ tone }}][{{ leftover }}]`,
    },
  })
  const mods = [owner, shell]
  const out = createTheme(compose(mods), mods).renderRegion('layout', {
    sections: [{ type: 'blocks.note', settings: { body: 'xin chào', leftover: 'bí mật' } }],
  })
  // A stored layout written before the schema changed still carries `leftover`.
  // The declaration decides what a theme reads, and an absent setting is null.
  assert.equal(out, '[xin chào][][]')
})

test('tokens: the theme runtime carries the CSS of what it actually renders', () => {
  const mods = [catalog, inventory, theme]
  const rt = createTheme(compose(mods), mods)
  assert.match(rt.tokensCss, /@layer ket\.reset, ket\.theme, ket\.app, ket\.user;/)
  assert.match(rt.tokensCss, /--ket-color-accent:/, 'a declared token has to reach a page as CSS')

  const bare = defineModule({ name: 'bare' })
  const bareTheme = defineTheme({ name: 'bare_shell', templates: { layout: 'x' } })
  const bareMods = [bare, bareTheme]
  assert.equal(
    createTheme(compose(bareMods), bareMods).tokensCss,
    '',
    'a deployment that declares no token gets no stylesheet to link',
  )
})

test('templates: two modules cannot claim one template name in silence', () => {
  const first = defineModule({ name: 'first_mod', templates: { 'shared.row': 'a' } })
  const second = defineModule({ name: 'second_mod', templates: { 'shared.row': 'b' } })
  const shell = defineTheme({ name: 'collide_shell', templates: { layout: 'x' } })
  const mods = [first, second, shell]
  assert.throws(() => createTheme(compose(mods), mods), /E_TEMPLATE_DUPLICATE|already provided by/)

  // A theme overriding a module's template is the whole point of a theme.
  const override = defineTheme({
    name: 'override_shell',
    templates: { layout: `{% render 'shared.row' %}`, 'shared.row': 'themed' },
  })
  const ok = [first, override]
  assert.equal(createTheme(compose(ok), ok).renderRegion('layout', {}), 'themed')
})

test('tokens: a page links the stylesheet the framework serves for it', async () => {
  const shop = defineModule({ name: 'token_shop', tokens: { 'space-1': '0.5rem' } })
  const shell = defineTheme({
    name: 'token_shell',
    depends: ['token_shop'],
    tokens: { 'color-accent': 'oklch(0.55 0.18 275)' },
    templates: { layout: `<html><head><title>x</title></head><body><main>ok</main></body></html>` },
  })
  const modules = [shop, shell]
  const manifest = compose(modules)
  const adapter = sqliteAdapter()
  await adapter.open()
  const server = await createKetServer({
    manifest,
    adapter,
    theme: createTheme(manifest, modules),
    pageScope: () => ({}),
  })
  const port = await server.listen(0)
  const base = `http://127.0.0.1:${port}`
  try {
    const page = await fetch(base).then((r) => r.text())
    assert.match(
      page,
      /<link rel="stylesheet" href="\/_ket\/tokens\.css"><\/head>/,
      'a declared token is worth nothing until a document links it',
    )

    const css = await fetch(`${base}/_ket/tokens.css`)
    assert.equal(css.status, 200)
    assert.match(css.headers.get('content-type') ?? '', /^text\/css/)
    const source = await css.text()
    assert.match(source, /--ket-color-accent: oklch\(0\.55 0\.18 275\);/)
    assert.match(source, /--ket-space-1: 0\.5rem;/, "a module's tokens travel with the theme that renders")
  } finally {
    await server.close()
    await adapter.close()
  }
})
