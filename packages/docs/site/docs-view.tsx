import { frameworkVersion } from './release.ts'
import { trustedMarkup } from '@ketvietlab/ketjs-view'
import { LinkButton } from '@ketvietlab/design-system'
import type { ContentPage, DocNavItem } from './model.ts'
import { BenchmarkCharts, type BenchmarkReport } from './benchmark-charts.tsx'

const Prose = ({ page }: { page: ContentPage }) => <div class="prose">{trustedMarkup(page.html)}</div>

function Sidebar({ content, active }: { content: DocNavItem[]; active: string }) {
  const groups = [...new Set(content.map((page) => page.group))]
  return (
    <nav class="docs-nav" aria-label="Documentation navigation">
      <a class="docs-overview" href="/docs/" aria-current={active === '/docs/' ? 'page' : null}>
        Documentation <span>{frameworkVersion}</span>
      </a>
      {groups.map((group) => (
        <div class="nav-group">
          <strong>{group}</strong>
          {content
            .filter((p) => p.kind === 'docs' && p.group === group && p.slug !== 'index')
            .map((page) => (
              <a href={page.route} aria-current={page.route === active ? 'page' : null}>
                {page.title}
              </a>
            ))}
        </div>
      ))}
    </nav>
  )
}

export function DocLayout({ page, content }: { page: ContentPage; content: DocNavItem[] }) {
  const docs = content.filter((p) => p.kind === 'docs')
  const position = docs.findIndex((p) => p.route === page.route)
  const previous = docs[position - 1],
    next = docs[position + 1]
  return (
    <main id="main-content" class="docs-layout">
      <aside class="docs-sidebar">
        <Sidebar content={content} active={page.route} />
      </aside>
      <div class="doc-column">
        <details class="mobile-docs">
          <summary>Browse documentation</summary>
          <Sidebar content={content} active={page.route} />
        </details>
        <article class="doc-article">
          <div class="article-breadcrumb">
            <a href="/docs/">Docs</a>
            <span>/</span>
            <span>{page.group}</span>
          </div>
          <h1 tabindex={-1}>{page.title}</h1>
          <p class="article-description">{page.description}</p>
          {page.slug === 'index' && (
            <div class="docs-start">
              <LinkButton
                href="/docs/quick-start/"
                label="Start the quick start"
                variant="primary"
                icon="chevron-right"
              />
            </div>
          )}
          {Array.isArray(page.metadata.benchmarkReports) && (
            <BenchmarkCharts reports={page.metadata.benchmarkReports as BenchmarkReport[]} />
          )}
          <Prose page={page} />
          <div class="article-end">
            <a
              href={`https://github.com/ketvietlab/ketjs/blob/integration/packages/docs/content/docs/${page.slug}.md`}
            >
              View source on GitHub ↗
            </a>
            <span>KetJS {frameworkVersion} preview</span>
          </div>
          <nav class="page-pagination" aria-label="Previous and next pages">
            {previous ? (
              <a href={previous.route}>
                <span>Previous</span>
                <strong>← {previous.title}</strong>
              </a>
            ) : (
              <span />
            )}
            {next && (
              <a href={next.route}>
                <span>Next</span>
                <strong>{next.title} →</strong>
              </a>
            )}
          </nav>
        </article>
      </div>
      <aside class="page-toc">
        <nav aria-label="On this page">
          <strong>On this page</strong>
          {page.toc
            .filter((item) => item.depth === 2)
            .map((item) => (
              <a href={`#${item.id}`}>{item.title}</a>
            ))}
        </nav>
        <div class="toc-help">
          <p>Learning the framework?</p>
          <a href="/learn/">Follow the learning path →</a>
        </div>
      </aside>
    </main>
  )
}
