import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { groups, parseContent } from '../site/content.mjs'
import { readContent } from '../site/content-store.ts'
import { frameworkVersion } from '../site/release.ts'

const markdown = (body) => `---\ntitle: A guide\ndescription: A useful guide\n---\n${body}`
test('VERSION expands metadata, code and release links before Markdown parsing', () => {
  const page = parseContent(
    `---\ntitle: KetJS {{VERSION}}\ndescription: Install {{VERSION}}\n---\n## Current {{VERSION}}\n\n[Release](https://github.com/ketvietlab/ketjs/releases/tag/v{{VERSION}})\n\n\`\`\`bash\n# Run from: projects\nnpx @ketvietlab/ketjs@{{VERSION}} new demo\n\`\`\``,
    { slug: 'release' },
  )
  assert.equal(page.title, `KetJS ${frameworkVersion}`)
  assert.equal(page.description, `Install ${frameworkVersion}`)
  assert.ok(page.html.includes(`/tag/v${frameworkVersion}`))
  assert.ok(page.text.includes(`@ketvietlab/ketjs@${frameworkVersion}`))
  assert.ok(!page.html.includes('{{VERSION}}'))
})
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

test('the overview names every responsibility and lists its guides once in navigation order', () => {
  const docs = readContent(fileURLToPath(new URL('..', import.meta.url))).filter(
    (page) => page.kind === 'docs',
  )
  const overview = docs.find((page) => page.slug === 'index')
  const sections = [
    ...overview.html.matchAll(/<section class="docs-topic" aria-label="([^"]+)">([\s\S]*?)<\/section>/g),
  ]
  assert.deepEqual(
    sections.map((section) => section[1]),
    groups,
  )
  const allRoutes = []
  for (const [, group, body] of sections) {
    assert.ok(body.includes('<h3'), `${group}: a visible heading`)
    assert.ok(body.includes('<ol>'), `${group}: a reading order`)
    const routes = [...body.matchAll(/href="(\/docs\/[^"#]+)"/g)].map((link) => link[1])
    assert.deepEqual(
      routes,
      docs.filter((page) => page.group === group && page.slug !== 'index').map((page) => page.route),
    )
    allRoutes.push(...routes)
  }
  assert.equal(new Set(allRoutes).size, docs.length - 1)
  assert.equal(allRoutes.length, docs.length - 1)
})
