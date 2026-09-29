import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowGroup } from '../src/workspace.mjs'

test('groups open by default, can start collapsed and report the user toggle', () => {
  assert.match(
    renderToStaticString(FlowGroup({ title: 'A', count: 1, children: 'x' })),
    /<details data-flow="group" open="true"/,
  )
  assert.doesNotMatch(
    renderToStaticString(FlowGroup({ title: 'A', count: 1, open: false, children: 'x' })),
    /<details[^>]*open/,
  )
  const seen = [],
    view = FlowGroup({ title: 'A', count: 1, onToggle: (o) => seen.push(o), children: 'x' })
  const i = view.strings.findIndex((s) => s.endsWith('on:toggle='))
  view.values[i]({ currentTarget: { open: false } })
  assert.deepEqual(seen, [false])
})

test('a group inside a padded section aligns with the section header instead of adding its own gutter', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.match(css, /\[data-flow="section"\] \[data-flow="group"\] \{\s*margin: 0;\s*\}/)
})
