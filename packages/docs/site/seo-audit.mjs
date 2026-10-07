// Audit the site's own generated HTML, including SSR JSON-LD, without executing it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const paths = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.html')) paths.push(path)
  }
}
walk('dist')
const decode = (text) =>
  text
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
const attributes = (tag) =>
  Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]))
const titles = new Set(),
  descriptions = new Set()
const sitemap = readFileSync('dist/sitemap.xml', 'utf8')
const sitemapUrls = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url))
const reports = paths.sort().map((path) => {
  const html = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const route = '/' + relative('dist', path).replace(/index\.html$/, '')
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? ''
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? ''
  const meta = new Map(
    [...head.matchAll(/<meta\b[^>]*>/g)].map(([tag]) => {
      const attr = attributes(tag)
      return [attr.property ?? attr.name, attr.content]
    }),
  )
  const title = decode(/<title>([^<]*)<\/title>/.exec(head)?.[1] ?? '')
  const description = meta.get('description') ?? ''
  const url = `https://ketjs.dev${route}`
  const canonical = [...head.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => attributes(tag))
    .find((attr) => attr.rel === 'canonical')?.href
  const noindex = meta.get('robots')?.includes('noindex') ?? false
  const issues = [],
    notes = []
  const check = (condition, issue) => {
    if (!condition) issues.push(issue)
  }
  check(title.length > 0 && !titles.has(title), 'Missing or duplicate title')
  check(description.length > 0 && !descriptions.has(description), 'Missing or duplicate description')
  titles.add(title)
  descriptions.add(description)
  if (title.length > 65) notes.push('Long title: search engines may truncate it')
  if (description.length > 170) notes.push('Long description: search engines may truncate it')
  check(canonical === url, 'Canonical does not match the production route')
  check(/<html\b[^>]*lang="en"/.test(html), 'Missing English document language')
  check((main.match(/<h1\b/g) ?? []).length === 1, 'Main content must have exactly one H1')
  let level = 0
  for (const [, depth] of main.matchAll(/<h([1-6])\b/g)) {
    check(Number(depth) <= level + 1, `Skipped heading level: H${level} to H${depth}`)
    level = Number(depth)
  }
  for (const key of [
    'og:title',
    'og:description',
    'og:url',
    'og:type',
    'og:image',
    'og:image:alt',
    'twitter:card',
    'twitter:title',
    'twitter:description',
    'twitter:image',
  ])
    check(Boolean(meta.get(key)), `Missing ${key}`)
  for (const key of ['og:title', 'og:description', 'og:url', 'og:type', 'og:image'])
    check(new RegExp(`<meta property="${key}"`).test(head), `${key} must use property`)
  check(
    meta.get('og:title') === title &&
      meta.get('og:description') === description &&
      meta.get('og:url') === url,
    'Social metadata differs from page metadata',
  )
  const image = meta.get('og:image')
  if (image)
    check(
      /\.(png|jpg|jpeg)$/.test(image) && existsSync(join('dist', new URL(image).pathname)),
      'Social image must be an existing PNG/JPEG',
    )
  check(noindex === ['/search/', '/404/'].includes(route), 'Unexpected indexing directive')
  check(sitemapUrls.has(url) === !noindex, 'Sitemap and indexing directive disagree')
  const schemas = []
  for (const [, json] of head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      schemas.push(JSON.parse(json))
    } catch {
      issues.push('Invalid JSON-LD')
    }
  }
  if (!noindex) {
    check(
      schemas.some((schema) => schema.url === url && schema['@context'] === 'https://schema.org'),
      'Missing page-specific JSON-LD',
    )
    if (route !== '/')
      check(
        schemas.some((schema) => schema['@type'] === 'BreadcrumbList'),
        'Missing breadcrumb structured data',
      )
  }
  for (const [tag] of main.matchAll(/<img\b[^>]*>/g))
    check('alt' in attributes(tag), 'Image without alt text')
  return {
    route,
    title,
    description,
    canonical,
    noindex,
    schemaTypes: schemas.map((schema) => schema['@type']),
    issues: [...new Set(issues)],
    notes,
  }
})
const report = {
  scope: 'Local SSG artifacts; not a production crawl or ranking audit',
  pages: reports.length,
  indexable: reports.filter((page) => !page.noindex).length,
  errors: reports.reduce((count, page) => count + page.issues.length, 0),
  reports,
}
const destination = process.argv[2]
if (destination) writeFileSync(destination, JSON.stringify(report, null, 2) + '\n')
console.log(`SEO: ${report.pages} pages, ${report.indexable} indexable, ${report.errors} findings`)
for (const page of reports)
  if (!destination && page.issues.length) console.log(`${page.route}: ${page.issues.join('; ')}`)
if (!destination && report.errors) process.exitCode = 1
