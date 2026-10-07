// Prepare content data and licensed assets; native ket-view owns HTML generation.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'

export function prepareAssets(pages) {
  const writeChanged = (path, value) => {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== value) writeFileSync(path, value)
  }
  mkdirSync('public/content/docs', { recursive: true })
  if (existsSync('measurements')) {
    mkdirSync('public/measurements', { recursive: true })
    for (const name of readdirSync('measurements'))
      writeChanged(`public/measurements/${name}`, readFileSync(`measurements/${name}`, 'utf8'))
  }
  const docs = pages.filter((page) => page.kind === 'docs')
  const names = new Set(docs.map((page) => `${page.slug}.json`))
  for (const name of readdirSync('public/content/docs'))
    if (!names.has(name)) rmSync(`public/content/docs/${name}`)
  for (const page of docs) writeChanged(`public/content/docs/${page.slug}.json`, JSON.stringify(page))
  mkdirSync('public/_vendor/mermaid', { recursive: true })
  writeChanged(
    'public/_vendor/mermaid/mermaid.tiny.js',
    readFileSync('node_modules/@mermaid-js/tiny/dist/mermaid.tiny.js', 'utf8'),
  )
  writeChanged(
    'public/_vendor/mermaid/LICENSE',
    readFileSync('node_modules/@mermaid-js/tiny/LICENSE', 'utf8'),
  )
  writeChanged(
    'public/_vendor/Inter-LICENSE.txt',
    readFileSync('node_modules/@fontsource-variable/inter/LICENSE', 'utf8'),
  )
  writeChanged(
    'public/search-index.json',
    JSON.stringify(
      pages
        .filter((page) => page.kind !== 'home')
        .map((page) => ({
          title: page.title,
          description: page.description,
          route: page.route,
          keywords: page.toc.map((item) => item.title).join(' '),
        })),
    ),
  )
  writeChanged(
    'public/sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((page) => `<url><loc>https://ketjs.dev${page.route}</loc></url>`).join('')}</urlset>`,
  )
  writeChanged('public/robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://ketjs.dev/sitemap.xml\n')
}
