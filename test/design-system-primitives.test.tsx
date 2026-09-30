import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  CataloguePage,
  PrimitiveHarness,
  componentRegistry,
  primitiveSections,
} from '@ketvietlab/design-system/catalogue'

const render = (view: Parameters<typeof renderToString>[0]) =>
  renderToString(view).replace(/<!--.*?-->/gs, '')
const sheet = (path: string) => readFileSync(`packages/design-system/src/${path}`, 'utf8')

test('primitive harness covers every registered primitive exactly once', () => {
  const covered = primitiveSections.flatMap((section) => [...section.components])
  const registered = componentRegistry
    .filter((component) => component.source.startsWith('primitives/'))
    .map((component) => component.name)
  assert.deepEqual([...covered].sort(), registered.sort())
  const html = render(<PrimitiveHarness />)
  for (const section of primitiveSections) {
    assert.match(
      html,
      new RegExp(`id="primitive-${section.id}" aria-labelledby="primitive-${section.id}-title"`),
    )
    assert.ok(html.includes(`href="#primitive-${section.id}"`))
  }
  for (const hook of [
    'action',
    'avatar',
    'badge',
    'code',
    'count-badge',
    'media-label',
    'tag',
    'text',
    'field',
    'breadcrumbs',
    'nav-item',
    'tabs',
    'tab',
    'tab-panel',
    'tabbed-view',
    'empty',
    'loading',
    'notice',
    'progress',
  ]) {
    assert.ok(html.includes(`data-ui="${hook}"`), `missing ${hook} sample`)
  }
})

test('primitive harness preserves native control states and accessible descriptions', () => {
  const html = render(<PrimitiveHarness />)
  const tag = (id: string) => html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0] ?? ''
  assert.match(tag('primitive-email'), /aria-invalid="true"/)
  assert.match(tag('primitive-email'), /aria-describedby="primitive-email-help primitive-email-error"/)
  assert.match(tag('primitive-reference'), /readonly/)
  assert.match(tag('primitive-owner'), /disabled/)
  assert.match(tag('primitive-region'), /^<select /)
  assert.match(tag('primitive-select-invalid'), /aria-invalid="true"/)
  assert.match(tag('primitive-select-invalid'), /aria-describedby="primitive-select-invalid-error"/)
  assert.match(tag('primitive-select-disabled'), /disabled/)
  assert.match(tag('primitive-notify'), /checked/)
  assert.match(html, /<button[^>]*disabled[^>]*aria-busy="true"[^>]*>.*?Opening project/s)
  assert.doesNotMatch(html, /<a[^>]*>[^<]*Opening project/)
  assert.match(html, /role="progressbar"[^>]*aria-label="Not started"[^>]*aria-valuenow="0"/)
  assert.match(html, /role="progressbar"[^>]*aria-label="All tasks complete"[^>]*aria-valuenow="100"/)
  assert.match(html, /data-ui="loading" role="status" aria-live="polite"/)
  assert.match(html, /data-tone="danger" role="alert"/)
})

test('primitive harness route tabs preserve preferences and associate the active panel', () => {
  for (const tab of ['overview', 'activity'] as const) {
    const html = render(<CataloguePage mode="primitives" theme="dark" density="compact" primitiveTab={tab} />)
    assert.match(html, /data-theme="dark" data-density="compact"/)
    assert.ok(html.includes(`/primitives?theme=dark&amp;density=compact&amp;tab=${tab}#primitive-navigation`))
    assert.ok(html.includes(`/primitives?tab=${tab}&amp;theme=light&amp;density=compact`))
    assert.match(html, new RegExp(`id="primitive-project-tabs-${tab}-tab"[^>]*aria-current="page"`))
    assert.match(
      html,
      new RegExp(`data-ui="tab-panel"[^>]*aria-labelledby="primitive-project-tabs-${tab}-tab"`),
    )
    assert.doesNotMatch(html, /role="tab(?:list)?"/)
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
    assert.equal(new Set(ids).size, ids.length, 'all labels, controls and panels have unique ids')
    const references = [
      ...html.matchAll(/\s(?:for|aria-controls|aria-labelledby|aria-describedby)="([^"]+)"/g),
    ].flatMap((match) => match[1]!.split(' '))
    for (const id of references) assert.ok(ids.includes(id), `unresolved reference: ${id}`)
  }
})

test('primitive harness owns only its specimen layout and stays render-pure', () => {
  const css = sheet('catalogue/primitives.css')
  const hooks = [...css.matchAll(/\[data-ui="([^"]+)"\]/g)].map((match) => match[1]!)
  assert.ok(hooks.length > 0)
  assert.ok(hooks.every((hook) => hook.startsWith('primitive-')))
  const source = sheet('catalogue/primitives.tsx')
  assert.doesNotMatch(source, /\b(?:document|window|history|fetch)\s*[.(]/)
  assert.doesNotMatch(source, /<(?:button|input|select|textarea)\b/)
  const catalogue = sheet('catalogue/index.tsx')
  for (const hook of new Set(hooks)) assert.ok(catalogue.includes(`'${hook}'`), `${hook} is declared`)
})

test('primitive content pressure is handled by component-owned CSS', () => {
  const fields = sheet('primitives/field/styles.css')
  assert.match(
    fields,
    /select\[data-ui="field-control"\] \{[^}]*appearance: none;[^}]*padding-inline-end: var\(--kv-space-8\);/,
  )
  assert.match(
    fields,
    /:has\(> select\)::after \{[^}]*margin-inline-end: var\(--kv-space-3\);[^}]*pointer-events: none;/,
  )
  assert.equal(
    [
      ...fields.matchAll(
        /:has\(> select\)::after,\s*[^{}]+select\[data-ui="field-control"\] \{\s*grid-column: 1 \/ -1;\s*grid-row: 2;/g,
      ),
    ].length,
    2,
  )
  assert.match(fields, /\[data-ui="field-option-input"\] \{[^}]*margin: 0;/)
  assert.match(
    fields,
    /\[data-ui="field"\]:has\(> \[data-ui="field-options"\]\[data-orientation="vertical"\]\) \{\s*align-items: start;/,
  )
  const actions = sheet('primitives/actions/styles.css')
  for (const hook of ['action-leading', 'action-spinner']) {
    assert.match(actions, new RegExp(`\\[data-ui="${hook}"\\] \\{[^}]*flex: none;`))
  }
  const status = sheet('primitives/status/styles.css')
  assert.match(status, /\[data-ui="tag"\] \{[^}]*max-width: 100%;[^}]*overflow-wrap: anywhere;/)
  assert.match(status, /\[data-ui="tag-remove"\] \{[^}]*flex: none;/)
  const feedback = sheet('primitives/feedback/styles.css')
  assert.match(feedback, /container: kv-notice \/ inline-size;/)
  assert.match(feedback, /\[data-ui="notice-copy"\] \{[^}]*flex: 1 1 0%;/)
  assert.match(feedback, /@container kv-notice[^}]*\[data-ui="notice-actions"\][^}]*flex-basis: 100%;/)
  const progress = sheet('primitives/progress/styles.css')
  assert.match(progress, /\[data-ui="progress-value"\] \{[^}]*flex: none;/)
})
