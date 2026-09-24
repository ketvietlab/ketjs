import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { createLiveDocView } from '@ketvietlab/ketsuite/livedoc'
import { FlowLiveDoc, FlowLiveDocBlocks, FlowLiveDocText, FlowLiveDocLegacyBlocks } from '../src/live-doc.mjs'
import { readFile } from 'node:fs/promises'

test('legacy blocks preserve text, marks, alignment, checkboxes and tables', () => {
  const blocks = FlowLiveDocBlocks([
    { id: 'h', type: 'heading', text: '日本語 và tiếng Việt', bold: true, italic: true, align: 'center' },
    {
      id: 't',
      type: 'table',
      rows: [
        ['A', 'B'],
        ['<img>', 'two\nlines'],
      ],
    },
    { id: 'c', type: 'check', text: 'Done', checked: true },
  ])
  assert.equal(blocks[0].type, 'h2')
  assert.deepEqual(blocks[0].delta[0].attributes, { bold: true, italic: true })
  assert.equal(blocks[0].align, 'center')
  const value = { snapshot: '', blocks }
  assert.deepEqual(FlowLiveDocLegacyBlocks(value)[1].rows, [
    ['A', 'B'],
    ['<img>', 'two\nlines'],
  ])
  assert.equal(FlowLiveDocLegacyBlocks(value)[2].checked, true)
  assert.match(FlowLiveDocText(value), /日本語 và tiếng Việt\n\nA \| B/)
})
test('LiveDoc SSR shell is inert and editor supports Japanese', () => {
  assert.match(
    renderToStaticString(
      FlowLiveDoc({
        id: 'x',
        label: 'Description',
        text: 'hello',
        onChange: () => assert.fail('SSR change'),
      }),
    ),
    /data-flow="live-doc"/,
  )
  const editor = createLiveDocView({ docId: 'ja', local: true, lang: 'ja' })
  assert.match(renderToStaticString(editor.view()), /書式/)
  editor.dispose()
})
test('document reading column has a moderate 1200px cap, separate from full shell', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  const paper = css.match(/\[data-flow="doc-paper"\]\s*\{([^}]+)\}/)[1]
  assert.match(paper, /max-width: 1200px/)
  assert.match(paper, /margin: 0 auto/)
})
