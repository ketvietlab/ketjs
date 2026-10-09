import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const files = []
function visit(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isDirectory()) visit(path)
    else if (item.name.endsWith('.html')) files.push(path)
  }
}
visit('dist')
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const frameworkVersion = manifest.dependencies['@ketvietlab/ketjs-view']
for (const name of ['@ketvietlab/ketjs-view', '@ketvietlab/ketjs-view-tools']) {
  const installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version
  assert.equal(
    installed,
    frameworkVersion,
    `${name}: deployed runtime and tools must match the displayed version`,
  )
}
const errors = []
let links = 0
for (const file of files) {
  const page = readFileSync(file, 'utf8')
  const route = '/' + relative('dist', file).replace(/index\.html$/, '')
  assert.ok(page.includes(`rel="canonical" href="https://ketjs.dev${route}"`), `${file}: canonical URL`)
  assert.equal((page.match(/<main[\s>]/g) ?? []).length, 1, `${file}: exactly one main landmark`)
  assert.ok(!page.includes('[object Object]'), `${file}: template object leaked into output`)
  const header = page.match(/<header class="site-header">([\s\S]*?)<\/header>/)?.[1]
  assert.ok(header, `${file}: site header`)
  assert.equal((header.match(/href="\/spec\/"/g) ?? []).length, 2, `${file}: desktop and mobile Spec links`)
  if (route === '/spec/')
    assert.equal(
      (header.match(/href="\/spec\/" aria-current="page"/g) ?? []).length,
      2,
      'Spec must be current in both navigation layouts',
    )
  for (const [, key] of page.matchAll(/data-key="([^"]*)"/g))
    assert.equal(key, '[]', `${file}: singleton island keys must not contain content`)
  if (route.startsWith('/docs/')) {
    const slug = route === '/docs/' ? 'index' : route.split('/').filter(Boolean).at(-1)
    const data = JSON.parse(readFileSync(`dist/content/docs/${slug}.json`, 'utf8'))
    assert.equal(data.route, route)
    assert.ok(
      page.replace(/<!--[\s\S]*?-->/g, '').includes(`Documentation <span>${frameworkVersion}</span>`),
      `${file}: current framework version`,
    )
    if (slug === 'quick-start')
      assert.ok(
        data.text.includes(`KetJS ${frameworkVersion}`) && !data.html.includes('@ketvietlab/ketjs@0.2.0'),
        'Quick start must document the current release',
      )
    assert.ok(page.includes('data-island="documentation"'))
    assert.ok(page.includes(data.title))
  }
  for (const [, href] of page.matchAll(/\shref="([^"]+)"/g)) {
    const url = new URL(href.replaceAll('&amp;', '&'), `https://ketjs.dev${route}`)
    if (url.origin !== 'https://ketjs.dev') continue
    links++
    const target = join('dist', url.pathname, url.pathname.endsWith('/') ? 'index.html' : '')
    if (!existsSync(target)) {
      errors.push(`${route}: missing target ${href}`)
      continue
    }
    if (url.hash && target.endsWith('.html')) {
      const id = decodeURIComponent(url.hash.slice(1))
      if (!readFileSync(target, 'utf8').includes(`id="${id}"`))
        errors.push(`${route}: missing anchor ${href}`)
    }
  }
}
assert.ok(existsSync('dist/sitemap.xml') && existsSync('dist/robots.txt'))
assert.ok(existsSync('dist/spec/index.html'), 'Spec must be a generated standalone route')
assert.ok(readFileSync('dist/sitemap.xml', 'utf8').includes('https://ketjs.dev/spec/'))
assert.ok(JSON.parse(readFileSync('dist/search-index.json', 'utf8')).some((item) => item.route === '/spec/'))
if (errors.length) {
  console.error(errors.slice(0, 25).join('\n'))
  throw new Error(`${errors.length} invalid internal links`)
}
console.log(
  `Verified ${files.length} rendered pages, ${links} local links/anchors, canonical URLs, landmarks, and static metadata.`,
)
