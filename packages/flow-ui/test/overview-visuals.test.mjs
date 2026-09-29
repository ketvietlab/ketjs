import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import {
  FlowColumnChart,
  FlowSegmentBar,
  FlowStatGrid,
  FlowMeterList,
  FlowEvidenceTask,
} from '../src/workspace.mjs'
import { readFileSync } from 'node:fs'

test('column chart keeps an outlier off the shared scale but reports its exact value', () => {
  const html = renderToStaticString(
    FlowColumnChart({
      label: 'Due',
      selected: 'b',
      onSelect: () => {},
      items: [
        { id: 'late', label: 'Overdue', value: 90, tone: 'red', outlier: true },
        { id: 'a', label: 'Mon', value: 5 },
        { id: 'b', label: 'Tue', value: 10, current: true },
        { id: 'c', label: 'Sat', value: 0, muted: true },
      ],
    }),
  )
  assert.match(html, /aria-label="Overdue: 90"/)
  assert.match(html, /data-clipped="true" style="height:100%"/)
  assert.match(html, /style="height:50%"/, 'Mon is half of the tallest non-outlier')
  assert.match(html, /aria-pressed="true"[^>]*aria-current="date"/)
  assert.match(html, /data-muted="true"/)
  assert.equal((html.match(/data-clipped/g) ?? []).length, 1)
})

test('segment bar drops empty segments from the track and spacing segments from its label', () => {
  const html = renderToStaticString(
    FlowSegmentBar({
      label: 'Load',
      segments: [
        { id: 'late', label: 'Overdue', value: 0, tone: 'red' },
        { id: 'open', label: 'Open', value: 3, tone: 'blue' },
        { id: 'room', label: '', value: 2, tone: 'neutral' },
      ],
    }),
  )
  assert.match(html, /aria-label="Load: Overdue 0 · Open 3"/)
  assert.doesNotMatch(html, /data-state="red"/)
  assert.equal((html.match(/style="flex:/g) ?? []).length, 2)
})

test('overview tiles and meters never use the shared data-tone tint', () => {
  const html =
    renderToStaticString(
      FlowStatGrid({
        label: 'Stats',
        items: [{ id: 'x', label: 'Overdue', value: '3', tone: 'red', onClick: () => {} }],
      }),
    ) +
    renderToStaticString(
      FlowMeterList({
        label: 'Goals',
        items: [
          { id: 'g', title: 'Goal', value: '40%', bar: '', onClick: () => {} },
          { id: 'h', title: 'Plain', value: '1', bar: '' },
        ],
      }),
    )
  assert.doesNotMatch(html, /data-tone/)
  assert.match(html, /data-flow="stat" data-state="red"/)
  assert.equal((html.match(/<button/g) ?? []).length, 2, 'only clickable meters render a button')
})

test('resource cards keep the folder default and put eyebrow and status on the top row', async () => {
  const { FlowResourceCard } = await import('../src/workspace.mjs')
  const { FlowTag } = await import('../src/index.mjs')
  const plain = renderToStaticString(FlowResourceCard({ title: 'P', description: 'd', onOpen: () => {} }))
  assert.match(plain, /<span data-flow="resource-head"><span data-flow="resource-symbol"><svg/)
  assert.doesNotMatch(plain, /<small>|data-flow="tag"/)
  const rich = renderToStaticString(
    FlowResourceCard({
      title: 'P',
      description: 'd',
      icon: 'link',
      eyebrow: 'KV',
      status: FlowTag({ label: 'Connected', tone: 'green' }),
      onOpen: () => {},
    }),
  )
  assert.match(
    rich,
    /<span data-flow="resource-head">[\s\S]*?<\/span><small>KV<\/small><span data-flow="tag" data-tone="green">Connected<\/span><\/span><strong>P<\/strong>/,
  )
  assert.notEqual(
    plain.match(/<path d="([^"]+)"/)[1],
    rich.match(/<path d="([^"]+)"/)[1],
    'icon prop replaces the folder glyph',
  )
})

test('evidence task without a short id renders no empty id slot', () => {
  assert.doesNotMatch(
    renderToStaticString(FlowEvidenceTask({ title: 'Goal', onOpen: () => {} })),
    /<small>/,
    'records without a short id render no empty id slot',
  )
})

test('a field row with one field gives the button only its own width, bottom-aligned', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\s+/g, '')
  assert.match(
    css,
    /\[data-flow="field-row"\]\{display:grid;grid-template-columns:minmax\(0,1fr\)minmax\(88px,120px\)auto;gap:var\(--kv-space-2\);align-items:end;\}/,
  )
  assert.match(
    css,
    /\[data-flow="field-row"\]:has\(>:nth-child\(2\):last-child\)\{grid-template-columns:minmax\(0,1fr\)auto;\}/,
  )
})
