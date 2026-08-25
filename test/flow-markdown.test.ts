// The Markdown reader behind typing and pasting in the Flow editor.
//
// Pure, so it is tested here rather than in a browser: what the binding does
// with these blocks needs a contenteditable, but whether `## Rollout` is a
// heading does not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inlineDelta, parseMarkdown } from '../packages/ketsuite/src/ui/client/live-doc-markdown.ts'
import type { MarkdownBlock } from '../packages/ketsuite/src/ui/client/live-doc-markdown.ts'

const shape = (source: string) =>
  parseMarkdown(source).map((block: MarkdownBlock) => [
    block.type,
    block.delta.map((op) => op.insert).join(''),
  ])

test('flow markdown: block markers become the blocks the editor has', () => {
  assert.deepEqual(shape(['# Rollout', '## Steps', '- freeze', '2. tag', '> ship Friday'].join('\n')), [
    ['h1', 'Rollout'],
    ['h2', 'Steps'],
    ['bullet', 'freeze'],
    ['ordered', 'tag'],
    ['quote', 'ship Friday'],
  ])
})

test('flow markdown: a task list keeps whether it is done', () => {
  const blocks = parseMarkdown('- [x] shipped\n- [ ] announced')
  assert.deepEqual(
    blocks.map((block: MarkdownBlock) => [block.type, block.checked]),
    [
      ['check', true],
      ['check', false],
    ],
  )
})

/**
 * Markdown's own rule, and the reason pasting a soft-wrapped README does not
 * arrive as forty one-line paragraphs.
 */
test('flow markdown: plain lines join into a paragraph and a blank line ends it', () => {
  assert.deepEqual(shape('one\ntwo\n\nthree'), [
    ['p', 'one two'],
    ['p', 'three'],
  ])
})

test('flow markdown: a fenced block is characters, delimiters and all', () => {
  const blocks = parseMarkdown('before\n\n```sh\nnpm run **verify**\ncd build\n```\n\nafter')
  assert.deepEqual(
    blocks.map((block: MarkdownBlock) => block.type),
    ['p', 'code', 'p'],
  )
  // No marks inside: what is in a code block is what was typed.
  assert.deepEqual(blocks[1]?.delta, [{ insert: 'npm run **verify**\ncd build' }])
})

test('flow markdown: an unclosed fence still becomes a code block', () => {
  const blocks = parseMarkdown('```\nnpm test')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]?.type, 'code')
  assert.equal(blocks[0]?.delta[0]?.insert, 'npm test')
})

test('flow markdown: emphasis becomes marks', () => {
  assert.deepEqual(inlineDelta('a **bold** and *slanted* and ~~gone~~ and `code`'), [
    { insert: 'a ' },
    { insert: 'bold', attributes: { bold: true } },
    { insert: ' and ' },
    { insert: 'slanted', attributes: { italic: true } },
    { insert: ' and ' },
    { insert: 'gone', attributes: { strike: true } },
    { insert: ' and ' },
    { insert: 'code', attributes: { code: true } },
  ])
})

/**
 * The italic rule could open on the first `*` of a bold pair and swallow the
 * second one as content, so `**now**` came out italic. Found by typing it.
 */
test('flow markdown: a bold pair is bold, not italic wrapped in asterisks', () => {
  assert.deepEqual(inlineDelta('**now**'), [{ insert: 'now', attributes: { bold: true } }])
  assert.deepEqual(inlineDelta('~~gone~~'), [{ insert: 'gone', attributes: { strike: true } }])
})

test('flow markdown: marks nest', () => {
  assert.deepEqual(inlineDelta('**_both_**'), [{ insert: 'both', attributes: { bold: true, italic: true } }])
})

test('flow markdown: a link keeps its address', () => {
  assert.deepEqual(inlineDelta('see [the docs](https://example.com/a)'), [
    { insert: 'see ' },
    { insert: 'the docs', attributes: { link: 'https://example.com/a' } },
  ])
})

/** Emphasis needs a non-space character against its delimiter, or arithmetic slants. */
test('flow markdown: a lone asterisk is a lone asterisk', () => {
  assert.deepEqual(inlineDelta('2 * 3 * 4'), [{ insert: '2 * 3 * 4' }])
  assert.deepEqual(inlineDelta('snake_case_name'), [{ insert: 'snake_case_name' }])
})

test('flow markdown: a backslash keeps the character after it', () => {
  assert.deepEqual(inlineDelta('literal \\*stars\\*'), [{ insert: 'literal *stars*' }])
})

/** Nothing the editor can draw is dropped, and nothing it cannot is invented. */
test('flow markdown: what it does not understand stays text', () => {
  assert.deepEqual(shape('| a | b |\n| - | - |'), [['p', '| a | b | | - | - |']])
  assert.deepEqual(shape('#### too deep'), [['p', '#### too deep']])
})

test('flow markdown: nothing in, nothing out', () => {
  assert.deepEqual(parseMarkdown(''), [])
  assert.deepEqual(parseMarkdown('   \n\n  '), [])
})
