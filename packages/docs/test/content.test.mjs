import assert from 'node:assert/strict'
import test from 'node:test'
import { parseContent } from '../site/content.mjs'

const markdown = (body) => `---\ntitle: A guide\ndescription: A useful guide\n---\n${body}`
test('Markdown removes executable markup and unsafe links while preserving code examples', () => {
  const page = parseContent(
    markdown('<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n```ts\nconst value = 1\n```'),
    { slug: 'safe-guide' },
  )
  assert.ok(!page.html.includes('<script'))
  assert.ok(!page.html.includes('href="javascript:'))
  assert.ok(page.html.includes('<pre'))
  assert.ok(page.html.includes('--syntax-token'))
})
test('duplicate headings receive unique anchors and stable table-of-contents entries', () => {
  const page = parseContent(markdown('## Install\n\nFirst\n\n## Install\n\nSecond'), { slug: 'install' })
  assert.deepEqual(
    page.toc.map((heading) => heading.id),
    ['install', 'install-1'],
  )
})
test('content refuses missing metadata and unsafe route slugs', () => {
  assert.throws(() => parseContent('# Missing metadata', { slug: 'missing' }), /frontmatter/)
  assert.throws(() => parseContent(markdown('Safe'), { slug: '../escape' }), /Invalid content slug/)
  assert.throws(
    () => parseContent('---\ntitle: []\ndescription: x\n---\nBody', { slug: 'invalid' }),
    /must be strings/,
  )
})

test('the page owns its H1 and Markdown keeps a consecutive heading hierarchy', () => {
  const page = parseContent(
    markdown('# A guide\n\nIntroduction\n\n### Start\n\n#### Detail\n\n# Another section'),
    { slug: 'headings' },
  )
  assert.ok(!page.html.includes('<h1'))
  assert.ok(!page.html.includes('>A guide<'))
  assert.deepEqual(
    page.toc.map(({ depth }) => depth),
    [2, 3, 2],
  )
})

test('Mermaid keeps escaped source and an accessible fallback for static visitors', () => {
  const page = parseContent(
    markdown('```mermaid\ngraph TD\nA["<script>alert(1)</script>"] --> B[Done]\n```'),
    { slug: 'diagram' },
  )
  assert.ok(page.html.includes('class="mermaid-diagram"'))
  assert.ok(page.html.includes('<summary>Diagram source</summary>'))
  assert.ok(page.html.includes('&lt;script&gt;'))
  assert.ok(!page.html.includes('<script>'))
  assert.ok(page.html.includes('open'))
})
