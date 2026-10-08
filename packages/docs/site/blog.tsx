import {
  Badge,
  Breadcrumbs,
  ContentCard,
  EmptyState,
  Icon,
  LinkButton,
  Text,
} from '@ketvietlab/design-system'
import { trustedMarkup } from '@ketvietlab/ketjs-view'
import type { ContentPage } from './model.ts'
import { blogArticles, blogDetails, featuredArticle, relatedArticles } from './blog-data.mjs'

const ArticleMeta = ({ page, author = false }: { page: ContentPage; author?: boolean }) => {
  const details = blogDetails(page)
  return (
    <div class="blog-meta">
      {author && <span>{details.author}</span>}
      {details.date && <time datetime={details.date}>{details.dateLabel}</time>}
      <span>{details.minutes} min read</span>
    </div>
  )
}

// This is a diagram of module composition, not a second set of UI controls.
const ContractDiagram = () => (
  <figure
    class="blog-contract"
    aria-label="Sales, inventory and accounting modules compose into one checked manifest"
  >
    <div class="blog-contract-modules" aria-hidden="true">
      {['Sales', 'Inventory', 'Accounting'].map((label) => (
        <span>{label}</span>
      ))}
    </div>
    <svg class="blog-contract-lines" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">
      <path d="M50 0v20h100m100-20v20H150m0-20v40" fill="none" stroke="currentColor" />
    </svg>
    <div class="blog-contract-manifest" aria-hidden="true">
      <Icon name="package" />
      <Text variant="headingLg">One manifest</Text>
      <Text variant="bodyMd" tone="muted">
        Models · Functions · Permissions · Routes
      </Text>
    </div>
    <figcaption>Compose more. Keep the boundaries explicit.</figcaption>
  </figure>
)

const PreviewContext = () => (
  <div class="blog-preview-context">
    <Badge label="Preview" tone="neutral" />
    <Text as="p" variant="bodySm" tone="muted">
      KetJS is in active review. APIs may change before 1.0. These articles explain the current contracts and
      their limits.
    </Text>
  </div>
)

export function BlogIndex({ page, content }: { page: ContentPage; content: ContentPage[] }) {
  const articles = blogArticles(content)
  const featured = featuredArticle(articles)
  const latest = articles.filter((item) => item.route !== featured?.route)
  return (
    <main id="main-content" class="blog-main">
      <header class="blog-masthead">
        <div class="blog-masthead-copy">
          <p class="eyebrow">THE KETJS JOURNAL</p>
          <Text as="h1" variant="heading3xl">
            {page.title}
          </Text>
          <Text as="p" variant="bodyLg" tone="muted">
            {page.description}
          </Text>
        </div>
        <LinkButton href="/docs/" label="Explore the docs" variant="tertiary" icon="chevron-right" />
      </header>
      {featured ? (
        <>
          <section class="blog-feature" aria-labelledby="featured-title">
            <div class="blog-feature-copy">
              <div class="blog-feature-label">
                <Badge label="Editor's pick" tone="neutral" />
                <span class="blog-category">{blogDetails(featured).category}</span>
              </div>
              <Text as="h2" id="featured-title" variant="heading2xl">
                <a href={featured.route}>{featured.title}</a>
              </Text>
              <Text as="p" variant="bodyLg" tone="muted">
                {featured.description}
              </Text>
              <ArticleMeta page={featured} author />
              <LinkButton
                href={featured.route}
                label="Read the article"
                variant="primary"
                icon="chevron-right"
              />
            </div>
            <ContractDiagram />
          </section>
          {latest.length > 0 && (
            <section class="blog-latest" aria-labelledby="latest-title">
              <div class="blog-section-head">
                <Text as="h2" id="latest-title" variant="headingLg">
                  Latest articles
                </Text>
                <Text variant="bodySm" tone="muted">
                  {articles.length} articles · From the KetJS team
                </Text>
              </div>
              <div class="blog-story-list">
                {latest.map((article) => (
                  <article class="blog-story">
                    <div class="blog-story-context">
                      <span class="blog-category">{blogDetails(article).category}</span>
                      <ArticleMeta page={article} />
                    </div>
                    <div class="blog-story-copy">
                      <Text as="h3" variant="headingLg">
                        <a href={article.route}>{article.title}</a>
                      </Text>
                      <Text as="p" variant="bodyLg" tone="muted">
                        {article.description}
                      </Text>
                    </div>
                    <a class="blog-story-open" href={article.route} aria-label={`Read ${article.title}`}>
                      <Icon name="chevron-right" />
                    </a>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <EmptyState
          title="Stories are on their way"
          message="Explore the documentation and learning path while we prepare the next engineering article."
          actions={<LinkButton href="/learn/" label="Start learning" />}
        />
      )}
      <PreviewContext />
    </main>
  )
}

export function BlogArticle({ page, content }: { page: ContentPage; content: ContentPage[] }) {
  const details = blogDetails(page)
  const related = relatedArticles(page, blogArticles(content))
  return (
    <main id="main-content" class="blog-main blog-article-main">
      <Breadcrumbs
        label="Article location"
        items={[{ label: 'Blog', href: '/blog/' }, { label: details.category }]}
      />
      <div class="blog-reading-layout">
        <article class="blog-reading" aria-labelledby="article-title">
          <header class="blog-article-header">
            <Text as="h1" id="article-title" variant="heading3xl">
              {page.title}
            </Text>
            <Text as="p" variant="bodyLg" tone="muted">
              {page.description}
            </Text>
            <ArticleMeta page={page} author />
          </header>
          {page.toc.length > 0 && (
            <details class="blog-mobile-toc">
              <summary>
                In this article <Icon name="chevron-down" />
              </summary>
              <nav aria-label="Article sections">
                {page.toc
                  .filter((item) => item.depth === 2)
                  .map((item) => (
                    <a href={`#${item.id}`}>{item.title}</a>
                  ))}
              </nav>
            </details>
          )}
          <div class="prose blog-prose">{trustedMarkup(page.html)}</div>
          <div class="blog-article-end">
            <Text as="p" variant="bodySm" tone="muted">
              Written by {details.author}. Explore the maintained documentation for exact APIs and
              configuration.
            </Text>
            <LinkButton href="/blog/" label="All articles" variant="secondary" />
          </div>
        </article>
        <aside class="blog-reading-aside" aria-label="Article navigation">
          <div class="blog-aside-content">
            {page.toc.length > 0 && (
              <nav aria-label="On this page" class="blog-toc">
                <Text as="h2" variant="headingMd">
                  In this article
                </Text>
                {page.toc
                  .filter((item) => item.depth === 2)
                  .map((item) => (
                    <a href={`#${item.id}`}>{item.title}</a>
                  ))}
              </nav>
            )}
            <div class="blog-aside-help">
              <Text as="h2" variant="headingMd">
                Put it into practice
              </Text>
              <Text as="p" variant="bodySm" tone="muted">
                Follow a guided project, or look up the exact contract.
              </Text>
              <a href="/learn/">
                Follow the learning path <Icon name="chevron-right" />
              </a>
              <a href="/docs/">
                Browse the docs <Icon name="chevron-right" />
              </a>
            </div>
          </div>
        </aside>
      </div>
      {related.length > 0 && (
        <section class="blog-related" aria-labelledby="related-title">
          <div class="blog-section-head">
            <Text as="h2" id="related-title" variant="headingLg">
              Keep reading
            </Text>
            <a href="/blog/">
              All articles <Icon name="chevron-right" />
            </a>
          </div>
          <div class="blog-related-grid">
            {related.map((article) => (
              <ContentCard
                title={article.title}
                summary={article.description}
                href={article.route}
                eyebrow={blogDetails(article).category}
                meta={<ArticleMeta page={article} />}
              />
            ))}
          </div>
        </section>
      )}
      <PreviewContext />
    </main>
  )
}
