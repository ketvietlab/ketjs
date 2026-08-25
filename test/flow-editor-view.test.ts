// The Flow editor's document serializer, on its own.
//
// The binding around it needs a browser — a contenteditable, a selection and an
// IME — and is verified there. This half needs none of that: it turns a list of
// blocks into HTML, and every rule it follows is one the binding then reads
// back. Two of them were found the expensive way, by typing into a real editor
// and watching text disappear, and both are pinned here so they stay found.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentHtml, presenceHtml } from '../packages/ketsuite/src/ui/client/flow-editor-view.mjs'

const text = (insert: string, attributes?: Record<string, unknown>) => ({ insert, attributes })
const block = (type: string, delta: Array<{ insert: string }>, checked = false) => ({
  type,
  delta,
  checked,
})

test('flow editor: a run of list items shares one wrapper, a different kind starts another', () => {
  const html = documentHtml(
    [
      block('bullet', [text('one')]),
      block('bullet', [text('two')]),
      block('ordered', [text('three')]),
      block('p', [text('after')]),
    ],
    'en',
  )
  assert.equal(html.match(/<ul /g)?.length, 1)
  assert.equal(html.match(/<ol /g)?.length, 1)
  // The numbering comes from the wrapper, which is the whole reason a run of
  // items shares one instead of each getting its own.
  assert.match(html, /<ol data-ui="flow-editor-list" data-kind="ordered"><li[^>]*>three<\/li><\/ol>/)
  assert.match(html, /<\/ol><p data-block="p" data-index="3">after<\/p>/)
})

test('flow editor: every block carries the index the binding finds it by', () => {
  const html = documentHtml([block('h1', [text('Title')]), block('bullet', [text('item')])], 'en')
  assert.match(html, /<h1 data-block="h1" data-index="0">/)
  // Nested inside its <ul>, so position among the container's children is not
  // the index — which is exactly why the index is written down.
  assert.match(html, /<li data-block="bullet" data-index="1">/)
})

test('flow editor: a checklist item keeps its tick box out of the text', () => {
  const html = documentHtml([block('check', [text('Call the vendor')], true)], 'en')
  assert.match(html, /data-checked="true"/)
  assert.match(html, /<span data-ui="flow-editor-check" contenteditable="false"[^>]*aria-checked="true"/)
  // The text lives in its own span: an empty item has no text node, and the
  // caret has to land after the tick box rather than before it.
  assert.match(html, /<span data-ui="flow-editor-line">Call the vendor<\/span>/)
})

test('flow editor: marks nest and their text is escaped', () => {
  const html = documentHtml([block('p', [text('<script>', { bold: true, italic: true, code: true })])], 'en')
  assert.equal(
    html,
    '<p data-block="p" data-index="0"><i><b><code data-ui="flow-editor-code">&lt;script&gt;</code></b></i></p>',
  )
})

/**
 * A link's address is whatever somebody typed, and it goes straight into an
 * `href` that the *next* reader clicks on a page already holding their session.
 */
test('flow editor: only http, https and mailto survive as a link address', () => {
  const unsafe = documentHtml([block('p', [text('click', { link: 'javascript:alert(1)' })])], 'en')
  assert.match(unsafe, /href="#"/)
  assert.doesNotMatch(unsafe, /javascript:/)
  const safe = documentHtml([block('p', [text('docs', { link: 'https://example.com/a"b' })])], 'en')
  assert.match(safe, /href="https:\/\/example\.com\/a&quot;b"/)
})

/**
 * Found by pressing Enter at the end of a code block and typing: the next line
 * landed on the end of the previous one. The renderer emitted one `<br>` per
 * newline, the binding drops one trailing `<br>` as the empty-line placeholder,
 * and so a newline at the very end read back as no newline at all.
 */
test('flow editor: a trailing newline gets a placeholder <br> of its own', () => {
  assert.equal(
    documentHtml([block('code', [text('cd build\n')])], 'en'),
    '<pre data-block="code" data-index="0">cd build<br><br></pre>',
  )
  // A newline in the middle needs no such help.
  assert.equal(
    documentHtml([block('code', [text('cd build\nmake')])], 'en'),
    '<pre data-block="code" data-index="0">cd build<br>make</pre>',
  )
})

test('flow editor: an empty block still gets a line box', () => {
  assert.equal(documentHtml([block('p', [])], 'en'), '<p data-block="p" data-index="0"><br></p>')
})

/** The point of a code block is that what is inside it is characters. */
test('flow editor: a code block carries no marks', () => {
  const html = documentHtml([block('code', [text('const x = 1', { bold: true })])], 'en')
  assert.equal(html, '<pre data-block="code" data-index="0">const x = 1</pre>')
})

test('flow editor: an unknown block type renders as a paragraph rather than an unknown tag', () => {
  assert.match(documentHtml([block('marquee', [text('no')])], 'en'), /^<p data-block="p"/)
})

test('flow editor: whoever is in a block is marked inside it', () => {
  const html = documentHtml([block('p', [text('first')]), block('p', [text('second')])], 'en', [
    { id: 'u2', name: 'Le Thi Mai', index: 1 },
  ])
  assert.doesNotMatch(html.split('data-index="1"')[0] ?? '', /flow-editor-viewer/)
  assert.match(html, /<p data-block="p" data-index="1">second<span data-ui="flow-editor-viewer"/)
  // Inert to the binding's own position arithmetic, which walks a block's text
  // and rejects anything the user cannot put a caret in.
  assert.match(html, /data-ui="flow-editor-viewer" contenteditable="false"/)
})

test('flow editor: two people in the same block are both marked', () => {
  const html = documentHtml([block('p', [text('shared')])], 'en', [
    { id: 'u2', name: 'Le Thi Mai', index: 0 },
    { id: 'u3', name: 'Tran Van Binh', index: 0 },
  ])
  assert.equal(html.match(/flow-editor-viewer/g)?.length, 2)
})

test('flow editor: nobody else here renders nothing at all', () => {
  assert.equal(presenceHtml([], 'en'), '')
  assert.equal(presenceHtml(undefined, 'en'), '')
})

/**
 * The colour is what lets you match the initials beside a paragraph to the chip
 * in the row without reading either, so it has to be the same colour in every
 * tab — which means it comes from the person, not from who arrived first.
 */
test('flow editor: a person keeps the same colour wherever they appear', () => {
  const row = presenceHtml([{ id: 'u2', name: 'Le Thi Mai', index: 3 }], 'en')
  const inBlock = documentHtml([block('p', [text('x')])], 'en', [{ id: 'u2', name: 'Le Thi Mai', index: 0 }])
  const hue = /--flow-viewer-hue:(\d+)/
  assert.equal(row.match(hue)?.[1], inBlock.match(hue)?.[1])
  assert.match(row, />LM</)
  assert.match(row, /Also here:/)
})
