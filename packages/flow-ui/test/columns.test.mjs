import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { html, renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowQualityColumns } from '../src/workspace.mjs'

test('shared main/aside columns preserve content and own their responsive styles', async () => {
  const output = renderToStaticString(
    FlowQualityColumns({ main: html`<p>Main</p>`, aside: html`<p>Context</p>` }),
  )
  assert.match(output, /data-flow="quality-columns"><div><p>Main<\/p><\/div><aside><p>Context<\/p><\/aside>/)
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.match(css, /\[data-flow-ui\] \[data-flow="quality-columns"\]/)
  assert.match(
    css,
    /@container\s*\(max-width:\s*1000px\)[\s\S]*?quality-columns[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  )
})
