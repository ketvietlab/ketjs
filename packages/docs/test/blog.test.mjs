import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { buildSync } from 'esbuild'
import { blogArticles, blogDetails, featuredArticle, relatedArticles } from '../site/blog-data.mjs'
import { parseContent } from '../site/content.mjs'

const article = (slug, date, metadata = {}) => ({
  kind: 'blog',
  slug,
  route: `/blog/${slug}/`,
  title: slug,
  date,
  metadata,
  order: 1,
  description: 'A complete engineering article.',
  html: '<p>Article body.</p>',
  text: Array(461).fill('word').join(' '),
  toc: [],
})
const pages = readdirSync('content/blog')
  .filter((file) => file.endsWith('.md'))
  .map((file) =>
    parseContent(readFileSync(`content/blog/${file}`, 'utf8'), { slug: file.slice(0, -3), kind: 'blog' }),
  )
const bundle = buildSync({
  stdin: {
    contents: `import { BlogIndex, BlogArticle } from './site/blog.tsx'; import { pageHead } from './site/seo.ts'; export const head = page => pageHead(page.route, page); import { renderToString } from '@ketvietlab/ketjs-view'; export const index = (page, content) => renderToString(BlogIndex({page, content})); export const article = (page, content) => renderToString(BlogArticle({page, content}));`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'iife',
  globalName: 'Blog',
  platform: 'browser',
  write: false,
  jsx: 'automatic',
  jsxImportSource: '@ketvietlab/ketjs-view',
}).outputFiles[0].text
const context = {}
runInNewContext(bundle, context)
const render = context.Blog
const index = pages.find((page) => page.slug === 'index')

test('reading time uses the complete plain text and dates validate calendar days in UTC', () => {
  assert.equal(blogDetails(article('valid', '2026-09-18')).minutes, 3)
  assert.equal(blogDetails(article('valid', '2026-09-18')).dateLabel, 'Sep 18, 2026')
  for (const date of [null, 'not-a-date', '2026-02-30', '2026-13-01']) {
    assert.equal(blogDetails(article('invalid', date)).date, null)
    assert.equal(blogDetails(article('invalid', date)).dateLabel, null)
  }
  assert.equal(blogDetails({ ...article('empty', null), text: '' }).minutes, 1)
})

test('the index selects an explicit editorial pick and orders remaining articles by publication date', () => {
  const old = article('old', '2026-08-12', { featured: true })
  const newest = article('new', '2026-10-06')
  const undated = article('undated', null)
  const input = [old, index, undated, newest]
  const sorted = blogArticles(input)
  assert.deepEqual(
    sorted.map((item) => item.slug),
    ['new', 'old', 'undated'],
  )
  assert.equal(featuredArticle(sorted), old)
  assert.equal(featuredArticle([newest]), newest)
  assert.equal(featuredArticle([]), null)
  assert.equal(input[0], old)
})

test('related articles prefer the same subject and never include the current article', () => {
  const current = article('current', '2026-09-18', { category: 'Frontend' })
  const newer = article('newer', '2026-10-06', { category: 'Project' })
  const same = article('same', '2026-09-09', { category: 'Frontend' })
  assert.deepEqual(
    relatedArticles(current, [newer, current, same]).map((item) => item.slug),
    ['same', 'newer'],
  )
  assert.deepEqual(relatedArticles(current, [current]), [])
})

test('the real journal renders every article once as a story and retains native reading links', () => {
  const html = render.index(index, pages)
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1)
  assert.equal((html.match(/class="blog-story"/g) ?? []).length, 7)
  assert.ok(html.indexOf('evaluating-preview/') < html.indexOf('reading-benchmarks/'))
  for (const page of blogArticles(pages)) assert.ok(html.includes(`href="${page.route}"`))
  assert.ok(!html.includes('A reading path through the framework'))
})

test('empty and partial metadata states render valid content with recovery links', () => {
  const empty = render.index(index, [])
  assert.ok(empty.includes('Stories are on their way'))
  assert.ok(empty.includes('href="/learn/"'))
  const partial = render.article(article('partial', null), [])
  assert.ok(partial.includes('KetJS team'))
  assert.ok(partial.includes('Engineering'))
  assert.ok(!partial.includes('Invalid Date'))
  assert.ok(!partial.includes('undefined'))
  assert.ok(!partial.includes('class="blog-toc"'))
})

test('every article has valid section anchors and blog metadata in the generated head', () => {
  for (const page of blogArticles(pages)) {
    const html = render.article(page, pages)
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1)
    for (const item of page.toc.filter((item) => item.depth === 2)) {
      assert.ok(html.includes(`href="#${item.id}"`), page.slug)
      assert.ok(html.includes(`id="${item.id}"`), page.slug)
    }
    assert.ok(html.includes(`datetime="${page.date}"`), page.slug)
    assert.ok(html.includes('href="/blog/"'), page.slug)
    const head = render.head(page)
    const schema = head.structuredData.find((item) => item['@type'] === 'BlogPosting')
    assert.equal(schema.datePublished, page.date)
    assert.equal(schema.author.name, page.metadata.author)
    assert.equal(schema.articleSection, page.metadata.category)
  }
})
