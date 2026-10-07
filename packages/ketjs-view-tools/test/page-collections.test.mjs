import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { buildProject, checkProject } from '../dist/index.js'

function fixture(t, pages, collection = true) {
  const root = mkdtempSync(join(tmpdir(), 'ketjs-page-collection-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'pages'))
  mkdirSync(join(root, 'node_modules/@ketvietlab'), { recursive: true })
  for (const name of ['ketjs-view', 'ketjs-view-tools'])
    symlinkSync(
      fileURLToPath(new URL(`../../${name}`, import.meta.url)),
      join(root, `node_modules/@ketvietlab/${name}`),
      'dir',
    )
  writeFileSync(join(root, 'ket-view.config.ts'), `export default { pages: 'pages' }`)
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { jsx: 'react-jsx', jsxImportSource: '@ketvietlab/ketjs-view' } }),
  )
  writeFileSync(
    join(root, 'pages/content.tsx'),
    `import { ${collection ? 'definePages' : 'definePage'} } from '@ketvietlab/ketjs-view-tools';\nexport default ${collection ? 'definePages' : 'definePage'}(${collection ? pages : pages.slice(1, -1)})`,
  )
  return root
}
test('one collection emits multiple explicit routes through the standard static builder', async (t) => {
  const root = fixture(
    t,
    `await Promise.resolve([{ path: '/docs/start/', head: { title: 'Start' }, view: () => <h1>Start</h1> }, { path: '/docs/models/', head: { title: 'Models' }, view: () => <h1>Models</h1> }])`,
  )
  const checked = await checkProject(root)
  assert.deepEqual(
    checked.pages.map((page) => page.route),
    ['/docs/start/', '/docs/models/'],
  )
  await buildProject(root)
  assert.match(readFileSync(join(root, 'dist/docs/models/index.html'), 'utf8'), /<h1>Models<\/h1>/)
})
test('collections refuse missing paths rather than silently using the source filename', async (t) => {
  const root = fixture(t, `[{ head: { title: 'Missing' }, view: () => <p>Missing</p> }]`)
  await assert.rejects(() => checkProject(root), /explicit path/)
})
test('colliding content routes identify both collection entries', async (t) => {
  const root = fixture(
    t,
    `[{ path: '/same/', head: { title: 'One' }, view: () => <p>One</p> }, { path: '/same/', head: { title: 'Two' }, view: () => <p>Two</p> }]`,
  )
  await assert.rejects(() => checkProject(root), /duplicate page route.*page 1.*page 2/)
})
test('content routes cannot escape the output directory', async (t) => {
  const root = fixture(t, `[{ path: '/../escape/', head: { title: 'Unsafe' }, view: () => <p>Unsafe</p> }]`)
  await assert.rejects(() => buildProject(root), /unsafe page route/)
})

test('escaped code examples are not mistaken for live islands', async (t) => {
  const root = fixture(
    t,
    `[{ path: '/example/', head: { title: 'Example' }, view: () => <code>{'<div data-island="unregistered">Example</div>'}</code> }]`,
    false,
  )
  await checkProject(root)
  await buildProject(root)
  assert.match(readFileSync(join(root, 'dist/example/index.html'), 'utf8'), /&lt;div data-island=/)
})

test('real island hosts still require a registered client module', async (t) => {
  const root = fixture(
    t,
    `[{ path: '/island/', head: { title: 'Island' }, view: () => <div data-island="unregistered">Island</div> }]`,
    false,
  )
  await assert.rejects(() => checkProject(root), /does not register it/)
})

test('static styles bundle fonts without a server-framework dependency', async (t) => {
  const root = fixture(t, `[{ path: '/font/', head: { title: 'Font' }, view: () => <p>Font</p> }]`, false)
  writeFileSync(join(root, 'ket-view.config.ts'), `export default { pages: 'pages', styles: ['style.css'] }`)
  writeFileSync(join(root, 'style.css'), `@font-face { font-family: Test; src: url('./font.woff2') }`)
  writeFileSync(join(root, 'font.woff2'), Buffer.from([0, 1, 2, 3]))
  const result = await buildProject(root)
  assert.ok(result.assets.some((asset) => asset.endsWith('.woff2')))
})

test('page heads support Open Graph properties and safely serialize JSON-LD', async (t) => {
  const text = '</script><script>alert(1)</script>&\u2028\u2029'
  const root = fixture(
    t,
    `[{ path: '/seo/', head: { title: 'SEO', meta: [{ property: 'og:title', content: 'Title & details' }, { name: 'robots', content: 'index,follow' }], structuredData: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: ${JSON.stringify(text)} }] }, view: () => <h1>SEO</h1> }]`,
  )
  await buildProject(root)
  const html = readFileSync(join(root, 'dist/seo/index.html'), 'utf8')
  assert.match(html, /<meta property="og:title" content="Title &amp; details">/)
  assert.match(html, /<meta name="robots" content="index,follow">/)
  assert.equal((html.match(/<script\b/g) ?? []).length, 1)
  const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1]
  assert.ok(json && !/[<>&\u2028\u2029]/.test(json))
  assert.equal(JSON.parse(json).name, text)
})

test('a classic head script runs before the stylesheet and is not implicitly deferred', async (t) => {
  const root = fixture(
    t,
    `[{ path: '/theme/', head: { title: 'Theme', scripts: [{ src: '/theme.js?v=1&mode=light' }] }, view: () => <h1>Theme</h1> }]`,
  )
  writeFileSync(join(root, 'ket-view.config.ts'), `export default { pages: 'pages', styles: ['style.css'] }`)
  writeFileSync(join(root, 'style.css'), 'body { color: black }')
  await buildProject(root)
  const html = readFileSync(join(root, 'dist/theme/index.html'), 'utf8')
  const script = '<script src="/theme.js?v=1&amp;mode=light"></script>'
  assert.ok(html.includes(script))
  assert.ok(html.indexOf(script) < html.indexOf('rel="stylesheet"'))
  assert.ok(html.indexOf(script) < html.indexOf('<body>'))
})
