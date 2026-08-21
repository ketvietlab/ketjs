import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, createJoints, defineModule, restrictManifest } from 'ketjs'
import { html, renderToString } from 'ketjs-view'

/**
 * Extension points in first-party screens.
 *
 * The screens are `html`` ` — typed, interactive, ours. What fills them is KTL —
 * stringly-typed, sandboxed, somebody else's. That split is the same one the
 * storefront makes: the code that runs is ours, the code that extends is theirs
 * and cannot run.
 *
 * A fill addresses a joint *by name*. That is the whole difference from Odoo's
 * XPath, where an extension addresses a node upstream never promised would exist:
 * rename the field and every extension breaks. Here the markup around a joint can
 * change freely.
 */
const owner = defineModule({
  name: 'screen',
  joints: { 'card.actions': { props: { app: 'json' }, multiple: true } },
})
const filler = (name: string, template: string, extra: Record<string, unknown> = {}) =>
  defineModule({ name, depends: ['screen'], fills: { 'screen:card.actions': template }, ...extra })

const render = (mods: Parameters<typeof compose>[0], props: Record<string, unknown> = { app: {} }) =>
  createJoints(compose(mods)).render('screen:card.actions', props).html

test('fill: renders into the joint it names', () => {
  assert.equal(render([owner, filler('a', `<a href="/x">Kho</a>`)]), '<a href="/x">Kho</a>')
})

test('fill: nobody filling it renders nothing, not a hole', () => {
  assert.equal(render([owner]), '')
})

test('fill: several are concatenated in dependency order', () => {
  const first = filler('first', `<i>1</i>`)
  const second = defineModule({
    name: 'second',
    depends: ['screen', 'first'],
    fills: { 'screen:card.actions': `<i>2</i>` },
  })
  assert.equal(
    render([owner, first, second]),
    '<i>1</i><i>2</i>',
    'a module extending another appears after it',
  )
})

test('fill: values are escaped by the compiler, once', () => {
  // KTL escapes; the view inserts the result verbatim. Escaping again would show
  // the tags as text, which is what a plain string value correctly does.
  const out = render([owner, filler('a', `<b>{{ app.name }}</b>`)], { app: { name: '<script>x</script>' } })
  assert.equal(out, '<b>&lt;script&gt;x&lt;/script&gt;</b>')
})

test('fill: it receives the declared props and nothing else', () => {
  const out = render([owner, filler('a', `[{{ app.name }}][{{ secret }}]`)], { app: { name: 'ok' } })
  assert.equal(out, '[ok][]', 'a prop nobody passed is empty, not an error and not a leak')
})

test('fill: a function cannot be smuggled in through props', () => {
  assert.throws(
    () => render([owner, filler('a', `x`)], { evil: () => 'boom' }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_SCOPE_CALLABLE')
      return true
    },
  )
})

test('fill: declared prop types are checked at the extension boundary', () => {
  assert.throws(
    () => render([owner, filler('a', `x`)], { app: 'not an object' }),
    /joint "screen:card.actions" prop "app" expects json/,
  )
})

test('fill: required props cannot be missing or null', () => {
  assert.throws(() => render([owner, filler('a', `x`)], {}), /prop "app" expects json/)
  assert.throws(() => render([owner, filler('a', `x`)], { app: null }), /prop "app" expects json/)

  const optionalOwner = defineModule({
    name: 'optional',
    joints: { slot: { props: { note: 'text?' } } },
  })
  const optionalFill = defineModule({
    name: 'optional_fill',
    depends: ['optional'],
    fills: { 'optional:slot': `[{{ note }}]` },
  })
  assert.equal(createJoints(compose([optionalOwner, optionalFill])).render('optional:slot').html, '[]')
})

test('fill: nested callables and non-finite numbers cannot cross as data', () => {
  assert.throws(
    () => render([owner, filler('a', `{{ app.callback }}`)], { app: { callback: () => 'secret' } }),
    /contains a non-data value/,
  )
  assert.throws(
    () => render([owner, filler('a', `{{ app.total }}`)], { app: { total: Number.POSITIVE_INFINITY } }),
    /contains a non-data value/,
  )
})

test('fill: a singleton joint refuses ambiguous contributors at compose time', () => {
  const singleton = defineModule({
    name: 'single',
    joints: { slot: { multiple: false } },
  })
  assert.throws(
    () =>
      compose([
        singleton,
        defineModule({ name: 'left', depends: ['single'], fills: { 'single:slot': 'left' } }),
        defineModule({ name: 'right', depends: ['single'], fills: { 'single:slot': 'right' } }),
      ]),
    /accepts one fill but 2 modules fill it/,
  )
})

test('fill: recursive joints fail with the chain instead of overflowing the stack', () => {
  const recursive = filler('recursive', `{% joint "screen:card.actions" %}`)
  assert.throws(
    () => render([owner, recursive]),
    /joint recursion: screen:card.actions -> screen:card.actions/,
  )
})

test('fill: an island can render inside a first-party screen joint', () => {
  const extension = defineModule({
    name: 'interactive',
    depends: ['screen'],
    islands: {
      panel: {
        props: { app: 'json' },
        view: (props) => {
          const app = props.app as { name: string }
          return () => html`<button>${app.name}</button>`
        },
      },
    },
    fills: { 'screen:card.actions': `{% island "panel" %}` },
  })
  const manifest = compose([owner, extension])
  const markup = createJoints(manifest, { islands: { panel: extension.islands.panel!.view } }).render(
    'screen:card.actions',
    { app: { name: 'Kho' }, secret: 'no' },
  ).html
  assert.match(markup, /data-island="panel"/)
  assert.match(markup, /><!--k\[-->Kho<!--k--><\/button>/)
  assert.ok(!markup.includes('secret'))
})

test('fill: unknown joints fail consistently for render() and shows()', () => {
  const joints = createJoints(compose([owner]))
  assert.throws(() => joints.render('screen:nope'), /no installed module publishes/)
  assert.throws(() => joints.shows('screen:nope'), /no installed module publishes/)
})

test('fill: naming a joint nobody publishes is a build error, with a suggestion', () => {
  assert.throws(
    () =>
      compose([
        owner,
        defineModule({ name: 'b', depends: ['screen'], fills: { 'screen:card.action': `x` } }),
      ]),
    /no installed module publishes/,
  )
})

test('fill: filling without depending on the owner is refused', () => {
  assert.throws(
    () => compose([owner, defineModule({ name: 'b', fills: { 'screen:card.actions': `x` } })]),
    /does not depend on "screen"/,
  )
})

// ── omit ─────────────────────────────────────────────────────────────────────

test('omit: removes the joint, so nothing renders there at all', () => {
  const hider = defineModule({ name: 'lean', depends: ['screen'], omits: ['screen:card.actions'] })
  assert.equal(
    render([owner, filler('a', `<i>x</i>`), hider]),
    '',
    'removed at the server: the markup never travels and the tab order never walks through it',
  )
})

test('omit: shows() is how a screen knows to skip its own default too', () => {
  const j = createJoints(
    compose([owner, defineModule({ name: 'lean', depends: ['screen'], omits: ['screen:card.actions'] })]),
  )
  assert.equal(j.shows('screen:card.actions'), false)
  assert.equal(createJoints(compose([owner])).shows('screen:card.actions'), true)
})

test('omit: an omission by a module that is switched off is not an omission', () => {
  const full = compose([
    owner,
    filler('a', `<i>x</i>`),
    defineModule({ name: 'lean', depends: ['screen'], omits: ['screen:card.actions'] }),
  ])
  const live = restrictManifest(full, new Set(['screen', 'a']))
  assert.equal(
    createJoints(live).render('screen:card.actions', { app: {} }).html,
    '<i>x</i>',
    'the joint comes back, exactly as its fills would',
  )
  assert.deepEqual(live.patches, [], 'the live diagnostics do not report an omission that is switched off')
})

test('omit: omitting a joint nobody publishes is a build error', () => {
  assert.throws(
    () => compose([owner, defineModule({ name: 'b', depends: ['screen'], omits: ['screen:nope'] })]),
    /no installed module publishes/,
  )
})

test('omit: omitting without depending on the owner is refused', () => {
  assert.throws(
    () => compose([owner, defineModule({ name: 'b', omits: ['screen:card.actions'] })]),
    /does not depend on "screen"/,
  )
})

test('omit: a fill that will never render is recorded rather than left to be discovered', () => {
  const m = compose([
    owner,
    filler('a', `<i>x</i>`),
    defineModule({ name: 'lean', depends: ['screen'], omits: ['screen:card.actions'] }),
  ])
  const note = m.patches.find((p) => p.target === 'screen:card.actions')
  assert.ok(note, 'nothing recorded')
  assert.match(note!.reason, /fills from a will not render/)
})

// ── in a screen ──────────────────────────────────────────────────────────────

test('screen: the fill lands verbatim between the hydration markers', () => {
  const markup = createJoints(compose([owner, filler('a', `<a href="/x">Kho</a>`)])).render(
    'screen:card.actions',
    { app: {} },
  )
  const out = renderToString(html`<div data-ui="app-actions">${markup}</div>`)
  assert.equal(out, '<div data-ui="app-actions"><!--k[--><a href="/x">Kho</a><!--k--></div>')
})

test('bridge: a module does not depend on the admin just to add a button to it', async () => {
  // Putting the fill in `product` made every test that composes a catalogue
  // without an admin fail with E_MISSING_DEPENDENCY — a headless API could not
  // have products. CI found it; running only the tests I had touched did not,
  // because I had touched product without thinking of it that way.
  //
  // The fill belongs in a bridge that installs itself once both sides are there,
  // which is what install:'auto' was built for and what Odoo does with sale_stock.
  const { address, company, partner, product, productBackend, productMedia, storage, uom } = await import(
    'ketsuite'
  )
  const backend = (await import('ketsuite/backend')).default

  const catalogueOnly = compose([uom, product])
  assert.ok(catalogueOnly.modules['product'], 'a catalogue composes with no admin at all')

  const both = compose([
    address,
    partner,
    company,
    storage,
    uom,
    product,
    productMedia,
    backend,
    productBackend,
  ])
  assert.equal(
    both.modules['product_backend']!.install,
    'auto',
    'so it appears when the admin does, and not before',
  )
  assert.equal(both.fills.filter((f) => f.joint === 'backend:app-card.actions').length, 1)
})
