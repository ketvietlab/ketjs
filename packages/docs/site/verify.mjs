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
const frameworkVersion = JSON.parse(readFileSync('../ketjs/package.json', 'utf8')).version
const errors = []
let links = 0
for (const file of files) {
  const page = readFileSync(file, 'utf8')
  const route = '/' + relative('dist', file).replace(/index\.html$/, '')
  assert.ok(page.includes(`rel="canonical" href="https://ketjs.dev${route}"`), `${file}: canonical URL`)
  assert.equal((page.match(/<main[\s>]/g) ?? []).length, 1, `${file}: exactly one main landmark`)
  assert.ok(!page.includes('[object Object]'), `${file}: template object leaked into output`)
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
        !data.html.includes('0.1.1') && !data.html.includes('0.1.3'),
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
if (errors.length) {
  console.error(errors.slice(0, 25).join('\n'))
  throw new Error(`${errors.length} invalid internal links`)
}
console.log(
  `Verified ${files.length} rendered pages, ${links} local links/anchors, canonical URLs, landmarks, and static metadata.`,
)
