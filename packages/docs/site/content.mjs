import { Marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import { parse as parseYaml } from 'yaml'
import { createHighlighter, createCssVariablesTheme } from 'shiki'

export const origin = 'https://ketjs.dev'
export const groups = [
  'Set up KetJS',
  'Application composition',
  'Request execution',
  'Data contracts',
  'Identity and access',
  'ketjs-view and KTL',
  'Runtime services',
  'Verify and deploy',
  'API and tooling',
  'Project evolution',
]
const highlighter = await createHighlighter({
  themes: [createCssVariablesTheme({ name: 'ket', variablePrefix: '--syntax-' })],
  langs: ['typescript', 'tsx', 'javascript', 'json', 'bash', 'html', 'css', 'sql', 'markdown', 'yaml'],
})

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function parseContent(source, { slug, kind = 'docs' }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Invalid content slug: ${slug}`)
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  if (!front) throw new Error(`${slug}: Markdown needs YAML frontmatter`)
  const metadata = parseYaml(front[1], { maxAliasCount: 0 })
  if (
    !metadata ||
    typeof metadata.title !== 'string' ||
    !metadata.title.trim() ||
    typeof metadata.description !== 'string'
  ) {
    throw new Error(`${slug}: title and description must be strings`)
  }
  const toc = []
  const usedIds = new Map()
  let previousDepth = 1
  const parser = new Marked({ gfm: true })
  parser.use({
    renderer: {
      heading({ tokens, depth }) {
        depth = Math.min(Math.max(2, depth), previousDepth + 1)
        previousDepth = depth
        const inline = this.parser.parseInline(tokens)
        const title = sanitizeHtml(inline, { allowedTags: [], allowedAttributes: {} })
        const base = slugify(title) || 'section'
        const occurrence = usedIds.get(base) ?? 0
        usedIds.set(base, occurrence + 1)
        const id = occurrence ? `${base}-${occurrence}` : base
        if (depth === 2 || depth === 3) toc.push({ id, title, depth })
        return `<h${depth} id="${id}">${inline}<a class="heading-anchor" href="#${id}" aria-label="Link to ${sanitizeHtml(title, { allowedTags: [], allowedAttributes: {} }).replaceAll('"', '&quot;')}">#</a></h${depth}>`
      },
      code({ text, lang }) {
        const requested = (lang ?? 'text').split(/\s/)[0]
        if (requested === 'mermaid') {
          const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
          return `<figure class="mermaid-diagram"><div class="mermaid-canvas"></div><details class="mermaid-source" open><summary>Diagram source</summary><pre><code class="language-mermaid">${escaped}</code></pre></details></figure>`
        }
        const language = highlighter.getLoadedLanguages().includes(requested) ? requested : 'text'
        return highlighter.codeToHtml(text, { lang: language, theme: 'ket' })
      },
    },
  })
  const body = source
    .slice(front[0].length)
    .replace(/^\s*# [^\n]+\n/, '')
    .replace(
      /:::(\w+)(?:\[([^\]]+)\])?\n([\s\S]*?)\n:::/g,
      (_, tone, title, content) =>
        `> **${title ?? tone}**\n>\n${content
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')}`,
    )
  const rendered = parser.parse(body)
  const html = sanitizeHtml(rendered, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'details', 'summary', 'figure'],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['id', 'class', 'aria-label'],
      a: ['href', 'title', 'rel', 'aria-label', 'class'],
      img: ['src', 'alt', 'width', 'height', 'loading'],
      pre: ['class', 'style', 'tabindex'],
      span: ['class', 'style'],
      code: ['class'],
      details: ['class', 'open'],
    },
    allowedStyles: {
      '*': {
        color: [/^var\(--syntax-[\w-]+\)$/],
        'background-color': [/^var\(--syntax-[\w-]+\)$/],
        'font-style': [/^italic$/],
        'font-weight': [/^bold$/],
        'text-decoration': [/^underline$/],
      },
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
  })
  const route = kind === 'home' ? '/' : slug === 'index' ? `/${kind}/` : `/${kind}/${slug}/`
  return {
    slug,
    kind,
    route,
    title: metadata.title,
    description: metadata.description,
    group: metadata.group ?? 'API and tooling',
    order: metadata.order ?? metadata.sidebar?.order ?? 50,
    date: metadata.date ? String(metadata.date) : null,
    metadata,
    html,
    toc,
    text: sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim(),
  }
}

export function normalizeLinks(source) {
  return source
    .replace(/docs\/src\/content\/docs\/ketjs\//g, 'packages/docs/content/docs/')
    .replace(/\]\(\/ketjs\//g, '](/docs/')
    .replace(/\]\(\/architecture\/decisions\//g, '](/docs/architecture-decisions/')
    .replace(/\]\(\/architecture\/open-questions\//g, '](/docs/open-questions/')
    .replace(/\]\(\/operations\/benchmarks\//g, '](/docs/benchmarks/')
    .replace(/https:\/\/ketjs\.ketviet\.vn/g, origin)
}
