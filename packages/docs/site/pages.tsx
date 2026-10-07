import { frameworkVersion } from './release.ts'
import { trustedMarkup } from '@ketvietlab/ketjs-view'
import { definePage, island } from '@ketvietlab/ketjs-view-tools'
import { ActionGroup, Badge, Button, ContentCard, Icon, LinkButton, Text } from '@ketvietlab/design-system'
import controls from './controls.tsx'
import documentation from './documentation.tsx'
import { BrandMark } from './logo.tsx'
import type { ContentPage, HomeData } from './model.ts'

import { pageHead } from './seo.ts'
const Prose = ({ page }: { page: ContentPage }) => <div class="prose">{trustedMarkup(page.html)}</div>

const Footer = () => (
  <footer class="site-footer">
    <div class="footer-brand">
      <a class="brand" href="/">
        <BrandMark />
        <Text variant="headingLg">KetJS</Text>
        <Badge label="Preview" tone="neutral" />
      </a>
      <p>A framework that fits together.</p>
      <p class="metadata">MIT licensed. Built with ketjs-view.</p>
      <p class="metadata">
        Preview for evaluation. APIs may change before 1.0; not ready for production workloads.
      </p>
    </div>
    <nav aria-label="Resources">
      <strong>Resources</strong>
      <a href="/docs/">Documentation</a>
      <a href="/learn/">Learn KetJS</a>
      <a href="/examples/">Examples</a>
    </nav>
    <nav aria-label="Project">
      <strong>Project</strong>
      <a href="/blog/">Blog</a>
      <a href="https://github.com/ketvietlab/ketjs">GitHub</a>
      <a href="https://github.com/ketvietlab/ketjs/releases">Releases</a>
    </nav>
    <div class="footer-note">
      Explicit contracts.
      <br />
      Composable applications.
      <br />
      <span class="metadata">© 2026 KETVIET JSC</span>
    </div>
  </footer>
)

function FeatureVisual({ kind }: { kind: string }) {
  if (kind === 'islands')
    return (
      <div class="feature-visual islands-visual" aria-hidden="true">
        <div class="mock-page">
          <span />
          <span />
          <span class="interactive">
            interactive island <b>+ 1</b>
          </span>
          <span />
        </div>
        <span class="visual-caption">HTML everywhere. JS where it matters.</span>
      </div>
    )
  if (kind === 'modules')
    return (
      <div class="feature-visual module-visual" aria-hidden="true">
        <span>catalog</span>
        <span class="join-symbol">+</span>
        <span>inventory</span>
        <span class="join-symbol">+</span>
        <span class="selected-module">your module</span>
      </div>
    )
  if (kind === 'manifest')
    return (
      <div class="feature-visual manifest-visual" aria-hidden="true">
        <span class="manifest-core">
          <BrandMark />
          manifest
        </span>
        <div>
          <span>schema</span>
          <span>routes</span>
          <span>permissions</span>
          <span>jobs</span>
        </div>
      </div>
    )
  if (kind === 'effects')
    return (
      <div class="feature-visual code-visual" aria-hidden="true">
        <pre>
          <code>
            <span class="code-key">effects</span>
            {": [\n  'read:catalog.Product',\n  'write:inventory.Stock'\n]"}
          </code>
        </pre>
      </div>
    )
  if (kind === 'jobs')
    return (
      <div class="feature-visual jobs-visual" aria-hidden="true">
        <span>transaction</span>
        <span>→</span>
        <span>queue</span>
        <span>→</span>
        <span class="done-job">worker ✓</span>
      </div>
    )
  return (
    <div class="feature-visual agents-visual" aria-hidden="true">
      <code>agent.call('inventory.reserve')</code>
      <div>
        <span>permissions ✓</span>
        <span>effects ✓</span>
        <span>idempotency ✓</span>
      </div>
    </div>
  )
}

function Home({ page, content }: { page: ContentPage; content: ContentPage[] }) {
  const data = page.metadata as unknown as HomeData
  return (
    <main id="main-content" class="home-main">
      <section class="hero">
        <div class="hero-grid" aria-hidden="true" />
        <div class="hero-content">
          <p class="eyebrow">{data.eyebrow}</p>
          <h1>
            {data.headline}
            <br />
            <span>{data.accent}</span>
          </h1>
          <p class="hero-description">{page.text}</p>
          <div class="hero-actions">
            <ActionGroup
              actions={[
                <LinkButton
                  href="/docs/quick-start/"
                  label="Get started"
                  variant="primary"
                  icon="chevron-right"
                />,
                <LinkButton href="/docs/" label="Explore the docs" variant="secondary" />,
              ]}
            />
          </div>
          <div class="install-command">
            <span class="terminal-prefix" aria-hidden="true">
              $
            </span>
            <code>{data.command}</code>
            <Button id="copy-command" label="Copy" size="compact" />
          </div>
          <p class="hero-meta">
            Node.js 24+ <span>·</span> MIT licensed <span>·</span>{' '}
            <Badge label={`${frameworkVersion} preview`} tone="info" />
          </p>
          <p class="metadata">Preview for evaluation. APIs may change before 1.0.</p>
        </div>
        <div class="hero-foundation">
          <span>One deployment</span>
          <span>One checked manifest</span>
          <span>One application</span>
        </div>
      </section>
      <section class="marketing-section">
        <div class="section-intro">
          <p class="eyebrow">THE PIECES, ALREADY CONNECTED</p>
          <h2>
            More application.
            <br />
            Less assembly.
          </h2>
          <p>
            Spend less time connecting schemas, permissions, routes and workers. Each module declares the
            contracts they share.
          </p>
        </div>
        <div class="feature-grid">
          {data.features.map((feature) => (
            <ContentCard
              title={feature.title}
              summary={feature.description}
              href={feature.href}
              media={<FeatureVisual kind={feature.visual} />}
            />
          ))}
        </div>
      </section>
      <section class="architecture-section marketing-section">
        <div class="section-intro">
          <p class="eyebrow">DECLARE IT ONCE</p>
          <h2>
            Your modules.
            <br />A complete application.
          </h2>
          <p>A deployment selects the modules. KetJS checks their contracts and composes the runtime.</p>
        </div>
        <div
          class="architecture-map"
          role="img"
          aria-label="Modules compose into one manifest, which defines models, functions, routes, jobs, and agent capabilities"
        >
          <div class="map-inputs">
            <span>catalog</span>
            <span>inventory</span>
            <span>your module</span>
          </div>
          <div class="map-connector" />
          <div class="map-core">
            <BrandMark />
            <strong>Checked manifest</strong>
          </div>
          <div class="map-connector" />
          <div class="map-outputs">
            <span>Models</span>
            <span>Functions</span>
            <span>Routes</span>
            <span>Jobs</span>
            <span>Agents</span>
          </div>
        </div>
      </section>
      <section class="marketing-section choice-section">
        <div class="section-intro">
          <p class="eyebrow">WHY CHOOSE KETJS?</p>
          <h2>{data.choiceTitle}</h2>
          <p>{data.choiceIntro}</p>
        </div>
        <div class="choice-grid">
          {data.reasons.map((reason) => (
            <div class="choice-reason">
              <Text as="h3" variant="headingLg">
                {reason.title}
              </Text>
              <p>{reason.description}</p>
              <a class="back-link" href={reason.href}>
                {reason.link} →
              </a>
            </div>
          ))}
        </div>
        <div class="choice-fit">
          <Text as="h3" variant="headingLg">
            {data.fitTitle}
          </Text>
          <p>{data.fitDescription}</p>
          <p>{data.fitLimit}</p>
          <a class="back-link" href="/docs/benchmarks/">
            See measured performance and its limits →
          </a>
        </div>
      </section>
      <section class="marketing-section starter-section">
        <div class="section-intro">
          <p class="eyebrow">START WITH SOMETHING REAL</p>
          <h2>
            Small beginnings.
            <br />
            Room to compose.
          </h2>
          <p>A fullstack application or a static site. Both start with the public KetJS contracts.</p>
        </div>
        <div class="starter-grid">
          {content
            .filter((p) => p.kind === 'examples' && p.slug !== 'index')
            .map((p) => (
              <ContentCard
                title={p.title}
                summary={p.description}
                href={p.route}
                leading={<Icon name="package" />}
                eyebrow="Runnable example"
              />
            ))}
        </div>
      </section>
      <section class="closing-section">
        <p class="eyebrow">BUILD YOUR NEXT APPLICATION</p>
        <h2>Make the pieces work together.</h2>
        <p>Start with SQLite. Ship the modules you need. Keep the boundaries explicit.</p>
        <LinkButton
          href="/docs/quick-start/"
          label="Build with KetJS"
          variant="primary"
          icon="chevron-right"
        />
        <p class="metadata">KetJS {frameworkVersion} is preview software. APIs may change before 1.0.</p>
      </section>
    </main>
  )
}

function Collection({ page, content }: { page: ContentPage; content: ContentPage[] }) {
  const children = content.filter((p) => p.kind === page.kind && p.slug !== 'index')
  return (
    <main id="main-content" class="editorial-main">
      <header class="editorial-header">
        <p class="eyebrow">{page.kind.toUpperCase()}</p>
        <h1>{page.title}</h1>
        <p>{page.description}</p>
      </header>
      <Prose page={page} />
      {children.length > 0 && (
        <section class="collection-section">
          <Text as="h2" variant="headingLg">
            {page.kind === 'learn'
              ? 'Learning guides'
              : page.kind === 'blog'
                ? 'Project notes'
                : 'Runnable examples'}
          </Text>
          <div class="collection-grid">
            {children.map((child) => (
              <ContentCard
                title={child.title}
                summary={child.description}
                href={child.route}
                eyebrow={child.date ?? (page.kind === 'examples' ? 'Runnable example' : 'KetJS')}
              />
            ))}
          </div>
        </section>
      )}
      {page.kind === 'learn' && (
        <div class="editorial-cta">
          <LinkButton href="/docs/quick-start/" label="Create your first application" variant="primary" />
        </div>
      )}
    </main>
  )
}

function Editorial({ page }: { page: ContentPage }) {
  return (
    <main id="main-content" class="editorial-main">
      <a class="back-link" href={`/${page.kind}/`}>
        ← All {page.kind}
      </a>
      <header class="editorial-header">
        <p class="eyebrow">
          {page.kind.toUpperCase()}
          {page.date ? ` / ${page.date}` : ''}
        </p>
        <h1>{page.title}</h1>
        <p>{page.description}</p>
      </header>
      <article>
        <Prose page={page} />
      </article>
    </main>
  )
}

function Search({ content }: { content: ContentPage[] }) {
  return (
    <main id="main-content" class="editorial-main search-page">
      <header class="editorial-header">
        <p class="eyebrow">FIND YOUR WAY</p>
        <h1>Search KetJS</h1>
        <p>Browse guides and examples, or use the search button to find a topic.</p>
      </header>
      <div class="search-directory">
        {content
          .filter((p) => p.kind !== 'home')
          .map((page) => (
            <a class="directory-entry" href={page.route}>
              <strong>{page.title}</strong>
              <p>{page.description}</p>
              <span>{page.kind}</span>
            </a>
          ))}
      </div>
    </main>
  )
}

export function createPage(route: string, content: ContentPage[]) {
  const page = content.find((item) => item.route === route)
  return definePage({
    path: route,
    head: pageHead(route, page),
    view: () => (
      <div data-kv-design-system="" class="site">
        <a class="skip-link" href="#main-content">
          Skip to content
        </a>
        {island('controls', controls, { active: route }, { key: [] })}
        <noscript>
          <div class="no-script">
            <a href="/search/">Browse the documentation index</a>
          </div>
        </noscript>
        {route === '/search/' ? (
          <Search content={content} />
        ) : !page ? (
          <main id="main-content" class="editorial-main">
            <p class="eyebrow">404</p>
            <h1>This page has not been composed.</h1>
            <p>Try the documentation or return to the homepage.</p>
            <LinkButton href="/docs/" label="Explore the docs" variant="primary" />
          </main>
        ) : page.kind === 'home' ? (
          <Home page={page} content={content} />
        ) : page.kind === 'docs' ? (
          island(
            'documentation',
            documentation,
            {
              page,
              content: content
                .filter((p) => p.kind === 'docs')
                .map(({ kind, slug, route, title, group }) => ({ kind, slug, route, title, group })),
            },
            { key: [] },
          )
        ) : page.slug === 'index' ? (
          <Collection page={page} content={content} />
        ) : (
          <Editorial page={page} />
        )}
        <Footer />
      </div>
    ),
  })
}
