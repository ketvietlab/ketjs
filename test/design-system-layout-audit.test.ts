import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { auditLayoutCss } from '../packages/design-system/src/contract/index.ts'
import { runLayoutAudit } from '../packages/design-system/src/layout-audit-cli.ts'

const rules = (css: string) => auditLayoutCss(css).map((violation) => `${violation.rule}:${violation.line}`)

test('owned-hook: frame, spacing and heading type on a design-system subject', () => {
  assert.deepEqual(rules('.panel [data-ui="surface"] {\n  padding: 0;\n}'), ['owned-hook:2'])
  assert.deepEqual(rules('.x :is([data-ui="surface"], .y) { border: 0 }'), ['owned-hook:1'])
  assert.deepEqual(rules('[data-pattern="data-table"] { margin-inline: 4px }'), ['owned-hook:1'])
  assert.deepEqual(rules('[data-ui="section-title"] { font-size: 12px }'), ['owned-hook:1'])
  assert.deepEqual(rules('[data-ui="surface"] > [data-ui="surface-head"] { gap: 2px; color: red }'), [
    'owned-hook:1',
  ])
})

test('owned-hook: an app element beside or inside a design-system element is the app’s own', () => {
  assert.deepEqual(rules('[data-ui="section-body"] .product-list { padding: 4px; border: 0 }'), [])
  assert.deepEqual(rules('.divider:not([data-ui="disclosure"]) { margin: 0 }'), [])
  assert.deepEqual(rules('.row:has([data-ui="badge"]) { gap: 4px }'), [])
  assert.deepEqual(rules('.my-list > * + * { border-block-start: 1px solid; padding-block-start: 4px }'), [])
  assert.deepEqual(rules('[data-ui="stack"] > * + * { padding-block-start: 4px }'), ['owned-hook:1'])
  assert.deepEqual(rules('[data-ui="surface"] > :first-child::before { margin: 0 }'), ['owned-hook:1'])
  // Layout and colour that decide nothing about a frame stay open.
  assert.deepEqual(rules('[data-ui="surface"] { display: grid; color: red; min-width: 0 }'), [])
})

test('hand-made-frame: a full border with a radius or a fill, not a divider', () => {
  assert.deepEqual(rules('.strip {\n  border: 1px solid var(--line);\n  border-radius: 6px;\n}'), [
    'hand-made-frame:2',
  ])
  assert.deepEqual(rules('.strip { border: 1px solid; background: white }'), ['hand-made-frame:1'])
  assert.deepEqual(rules('.divided > * + * { border-block-start: 1px solid; border-radius: 0 }'), [])
  assert.deepEqual(rules('.reset { border: 0; border-radius: 4px; background: none }'), [])
  assert.deepEqual(rules('.reset { border: none; border-radius: 4px }'), [])
  assert.deepEqual(rules('.outline { border: 1px solid }'), [])
})

test('revert-layer is reported wherever it appears', () => {
  assert.deepEqual(rules('.x { border: revert-layer }'), ['revert-layer:1'])
  assert.deepEqual(rules('[data-ui="table-scroll"] { border-radius: revert-layer }'), [
    'revert-layer:1',
    'owned-hook:1',
  ])
})

test('comments, strings, at-rules and nesting keep selectors and lines exact', () => {
  assert.deepEqual(rules('/* [data-ui="surface"] { padding: 0 } */\n.a { color: red }'), [])
  assert.deepEqual(rules('.a::before { content: "}{"; }\n[data-ui="surface"] { padding: 0 }'), [
    'owned-hook:2',
  ])
  assert.deepEqual(
    rules('@layer app {\n  @media (width > 1px) {\n    [data-ui="surface"] { margin: 0 }\n  }\n}'),
    ['owned-hook:3'],
  )
  assert.deepEqual(rules('@keyframes spin { from { padding: 0 } to { padding: 1px } }'), [])
  assert.deepEqual(rules('.panel {\n  color: red;\n  & > [data-ui="surface"] { padding: 0 }\n}'), [
    'owned-hook:3',
  ])
  assert.deepEqual(rules('.panel {\n  [data-ui="surface"] & { padding: 0 }\n}'), [])
  assert.deepEqual(rules('.a { padding: 0 }\n.b, [data-ui="metric"] { padding: 0 }'), ['owned-hook:2'])
})

test('the care configuration workaround that motivated the rules is caught', () => {
  const css = `[data-kv-design-system] .cc-config-group .cc-panel[data-flush="true"] > [data-ui="surface"] > :not([data-ui="surface-head"]) {
  margin: var(--kv-space-4) var(--kv-space-5) var(--kv-space-5);
}
[data-kv-design-system] .cc-config-group .cc-panel[data-flush="true"] [data-ui="table-scroll"][data-pattern="data-table"] {
  border: revert-layer;
  border-radius: revert-layer;
}`
  // `> :not(...)` styles the surface's own children, so the margin belongs to the surface.
  assert.deepEqual(rules(css), [
    'owned-hook:2',
    'revert-layer:5',
    'owned-hook:5',
    'revert-layer:6',
    'owned-hook:6',
  ])
})

test('runLayoutAudit enforces a config, and a glob that matches nothing fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'ket-layout-audit-'))
  try {
    mkdirSync(join(root, 'clean'))
    mkdirSync(join(root, 'dirty'))
    writeFileSync(join(root, 'clean/a.css'), '.a { color: red }\n')
    writeFileSync(join(root, 'dirty/b.css'), '.b [data-ui="surface"] { padding: 0 }\n')

    writeFileSync(join(root, 'ok.json'), JSON.stringify({ enforce: ['clean/**/*.css'] }))
    const clean = runLayoutAudit(['--config', 'ok.json'], root)
    assert.equal(clean.code, 0, clean.lines.join('\n'))
    assert.match(clean.lines.at(-1) ?? '', /1 stylesheet\(s\), 0 violation\(s\), 0 config problem\(s\)/u)

    writeFileSync(join(root, 'dirty.json'), JSON.stringify({ enforce: ['clean/**/*.css', 'dirty/*.css'] }))
    const dirty = runLayoutAudit(['--config', 'dirty.json'], root)
    assert.equal(dirty.code, 1)
    assert.ok(
      dirty.lines.some((line) => line.startsWith('dirty/b.css:1  owned-hook')),
      dirty.lines.join('\n'),
    )

    writeFileSync(join(root, 'stale.json'), JSON.stringify({ enforce: ['clean/**/*.css', 'moved/**/*.css'] }))
    const stale = runLayoutAudit(['--config', 'stale.json'], root)
    assert.equal(stale.code, 1)
    assert.ok(stale.lines.includes('moved/**/*.css: matches no stylesheet (stale or mistyped entry)'))

    writeFileSync(join(root, 'bad.json'), JSON.stringify({ enforce: 'clean' }))
    assert.equal(runLayoutAudit(['--config', 'bad.json'], root).code, 2)
    assert.equal(runLayoutAudit([], root).code, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
