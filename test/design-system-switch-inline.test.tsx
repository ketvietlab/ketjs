import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Switch } from '../packages/design-system/src/forms/scalar-fields/index.tsx'

test('inline Switch keeps native label, checked state and responsive toolbar geometry', () => {
  const html = renderToString(<Switch id="selected" name="selected" label="Đã chọn" checked inline />)
  assert.match(html, /data-layout="inline"/)
  assert.match(html, /for="selected"/)
  assert.match(html, /role="switch"/)
  assert.match(html, /aria-checked="true"/)
  assert.doesNotMatch(
    renderToString(<Switch id="ordinary" name="ordinary" label="Ordinary field" />),
    /data-layout="inline"/,
  )
  const css = readFileSync(
    new URL('../packages/design-system/src/forms/scalar-fields/styles.css', import.meta.url),
    'utf8',
  )
  assert.match(css, /\[data-layout="inline"\]\s*\{\s*grid-template-columns: max-content auto;/)
  assert.match(
    css,
    /\[data-layout="inline"\][\s\S]*\[data-ui="switch-control"\]\s*\{\s*grid-column: 2;\s*grid-row: 1;/,
  )
})
