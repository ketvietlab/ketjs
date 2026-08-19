import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileKtl, loadTemplates } from 'ketjs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `{% render %}` — composition without inheritance.
 *
 * Shopify made the same call and the reason holds here twice over: a partial that
 * can only see what it was passed is a partial you can read on its own, and a theme
 * is a stranger's code, so a partial that silently saw the page scope would leak
 * whatever the page happened to be carrying.
 */
const theme = (templates: Record<string, string>) => {
  const compiled: Record<string, ReturnType<typeof compileKtl>> = {}
  let depth = 0
  const renderTemplate = (name: string, scope: Record<string, unknown>, from: string): string => {
    const t = compiled[name]
    if (!t) throw new Error(`${from} renders "${name}", which does not exist`)
    if (depth >= 16) throw new Error(`${from} renders "${name}" too deep`)
    depth++
    try { return t.render(scope) } finally { depth-- }
  }
  for (const [name, src] of Object.entries(templates)) compiled[name] = compileKtl(src, { name, renderTemplate })
  return (name: string, scope: Record<string, unknown>) => compiled[name]!.render(scope)
}

test('render: a partial receives what it was passed', () => {
  const r = theme({
    list: `<ul>{% for i in items %}{% render 'row', label: i.name %}{% endfor %}</ul>`,
    row: `<li>{{ label }}</li>`,
  })
  assert.equal(r('list', { items: [{ name: 'a' }, { name: 'b' }] }), '<ul><li>a</li><li>b</li></ul>')
})

test('render: and nothing else — the caller scope is not visible', () => {
  const r = theme({
    page: `{% render 'leak' %}`,
    leak: `[{{ secret }}]`,
  })
  assert.equal(r('page', { secret: 'do-not-leak' }), '[]',
    'a partial that could read its caller would be a partial you cannot read on its own')
})

test('render: values are escaped in the partial exactly as in the caller', () => {
  const r = theme({ a: `{% render 'b', v: danger %}`, b: `<p>{{ v }}</p>` })
  assert.equal(r('a', { danger: '<script>x</script>' }), '<p>&lt;script&gt;x&lt;/script&gt;</p>')
})

test('render: a literal argument needs no scope at all', () => {
  const r = theme({ a: `{% render 'b', label: 'hi', on: true %}`, b: `{{ label }}{% if on %}!{% endif %}` })
  assert.equal(r('a', {}), 'hi!')
})

test('render: naming a template that does not exist says which template asked', () => {
  const r = theme({ a: `{% render 'nope' %}` })
  assert.throws(() => r('a', {}), /template "a" line 1 renders "nope"/)
})

test('render: a template that renders itself is stopped, not left to overflow the stack', () => {
  const r = theme({ loop: `{% render 'loop' %}` })
  assert.throws(() => r('loop', {}), /too deep/)
})

test('render: a malformed argument list is a syntax error naming the line', () => {
  assert.throws(() => compileKtl(`\n{% render 'x', bad %}`, { name: 't' }), /render argument needs "name: value" at line 2/)
})

// ── comments and files ───────────────────────────────────────────────────────

test('ktl: a comment is dropped, not rendered', () => {
  assert.equal(compileKtl(`a{# not output #}b`, { name: 't' }).render({}), 'ab')
})

test('ktl: an unterminated comment says so', () => {
  assert.throws(() => compileKtl(`{# open`, { name: 't' }), /unterminated \{#/)
})

test('ktl: an unknown filter names the template and the line', () => {
  assert.throws(() => compileKtl(`x\ny\n{{ v | nope }}`, { name: 'card' }), /template "card" line 3 uses unknown filter "nope"/)
})

test('loadTemplates: the file name is the template name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ktl-'))
  writeFileSync(join(dir, 'layout.ktl'), '<html></html>')
  writeFileSync(join(dir, 'website.hero.ktl'), '<h1>{{ heading }}</h1>')
  writeFileSync(join(dir, 'notes.md'), 'ignored')
  const t = loadTemplates(pathToFileURL(dir + '/'))
  assert.deepEqual(Object.keys(t).sort(), ['layout', 'website.hero'])
  assert.equal(t['website.hero'], '<h1>{{ heading }}</h1>')
})

test('loadTemplates: a directory with no templates is a mistake worth naming', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ktl-'))
  assert.throws(() => loadTemplates(pathToFileURL(dir + '/')), /contains no .ktl files/)
})

test('loadTemplates: a missing directory says what it wanted', () => {
  assert.throws(() => loadTemplates(pathToFileURL('/nowhere/at/all/')), /no template directory/)
})
