import { signal, trustedMarkup, type IslandFactory } from '@ketvietlab/ketjs-view'
import { Badge, Button, LinkButton, Text } from '@ketvietlab/design-system'
import { createNavigation } from './navigation.ts'
import { updatePageHead } from './seo.ts'
import type { ContentPage } from './model.ts'

type Lesson = Pick<ContentPage, 'slug' | 'route' | 'title' | 'description' | 'order' | 'metadata'>
type Props = { page: ContentPage; lessons: Lesson[]; index: Lesson }

const learn: IslandFactory<Props> = (props) => {
  const page = signal(props.page)
  const completed = signal<string[]>([])
  const lessons = [...props.lessons].sort((a, b) => a.order - b.order)
  const stages = [...new Set(lessons.map((lesson) => String(lesson.metadata.stage)))]
  const Outline = ({ current = '' }: { current?: string }) => (
    <ol class="learn-outline">
      {lessons.map((lesson) => (
        <li>
          <a href={lesson.route} aria-current={lesson.route === current ? 'page' : null}>
            <span class="learn-step">
              {completed().includes(lesson.slug) ? '✓' : String(lesson.order).padStart(2, '0')}
            </span>
            <span>
              {lesson.title}
              <small>{String(lesson.metadata.duration)} min</small>
            </span>
          </a>
        </li>
      ))}
    </ol>
  )
  return {
    view: () => {
      const current = page()
      const position = lessons.findIndex((lesson) => lesson.slug === current.slug)
      const previous = lessons[position - 1],
        next = lessons[position + 1]
      return (
        <main id="main-content" class={`learn-main ${position === -1 ? 'learn-roadmap' : 'learn-lesson'}`}>
          {position === -1 ? (
            <>
              <header class="learn-header">
                <p class="eyebrow">ONE PATH. REAL PROJECTS.</p>
                <h1 tabindex="-1">{current.title}</h1>
                <p>{current.description}</p>
                <div class="learn-actions">
                  <LinkButton
                    href={lessons[0].route}
                    label="Start learning"
                    variant="primary"
                    icon="chevron-right"
                  />
                  <LinkButton href="/playground/" label="Open playground" />
                </div>
                <p class="metadata">
                  {lessons.length} lessons · {stages.length} stages · View → Server → Data → Security →
                  Operations
                </p>
                <Badge label="0.2.0 Preview — APIs may change" tone="neutral" />
              </header>
              <details class="learn-introduction">
                <summary>How this learning path works</summary>
                <div class="prose">{trustedMarkup(current.html)}</div>
              </details>
              <section class="learn-progress" aria-label="Learning progress">
                <Text variant="bodyMd">
                  {completed().length} of {lessons.length} lessons marked complete
                </Text>
                <progress value={completed().length} max={lessons.length} />
                <p class="metadata">
                  Saved in this browser. Mark a lesson complete after passing its checkpoint.
                </p>
              </section>
              <div class="learn-stages">
                {stages.map((stage, i) => (
                  <section class="learn-stage">
                    <header>
                      <span class="learn-stage-number">{String(i + 1).padStart(2, '0')}</span>
                      <div>
                        <Text as="h2" variant="headingLg">
                          {stage}
                        </Text>
                        <p class="metadata">
                          {lessons.filter((lesson) => lesson.metadata.stage === stage).length}{' '}
                          {lessons.filter((lesson) => lesson.metadata.stage === stage).length === 1
                            ? 'lesson'
                            : 'lessons'}
                        </p>
                      </div>
                    </header>
                    <ol>
                      {lessons
                        .filter((lesson) => lesson.metadata.stage === stage)
                        .map((lesson) => (
                          <li>
                            <a href={lesson.route}>
                              <span class="learn-step">
                                {completed().includes(lesson.slug)
                                  ? '✓'
                                  : String(lesson.order).padStart(2, '0')}
                              </span>
                              <div>
                                <Text as="h3" variant="headingMd">
                                  {lesson.title}
                                </Text>
                                <p>{lesson.description}</p>
                                <span class="metadata">
                                  {String(lesson.metadata.duration)} min · {String(lesson.metadata.lab)}
                                </span>
                              </div>
                              <span aria-hidden="true">→</span>
                            </a>
                          </li>
                        ))}
                    </ol>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <>
              <aside class="learn-sidebar">
                <a href="/learn/">← Learning path</a>
                <p class="metadata">
                  {completed().length} / {lessons.length} complete
                </p>
                <nav aria-label="Course lessons">
                  <Outline current={current.route} />
                </nav>
              </aside>
              <article class="learn-article">
                <a class="back-link" href="/learn/">
                  ← All lessons
                </a>
                <header class="learn-article-header">
                  <p class="eyebrow">
                    STEP {String(current.order).padStart(2, '0')} / {String(current.metadata.stage)}
                  </p>
                  <h1 tabindex="-1">{current.title}</h1>
                  <p>{current.description}</p>
                  <p class="metadata">
                    {String(current.metadata.duration)} min · {String(current.metadata.lab)} · KetJS 0.2.0
                    preview
                  </p>
                </header>
                <details class="learn-mobile-outline">
                  <summary>
                    Course outline · lesson {current.order} of {lessons.length}
                  </summary>
                  <nav aria-label="Mobile course lessons">
                    <Outline current={current.route} />
                  </nav>
                </details>
                <div class="prose">{trustedMarkup(current.html)}</div>
                <div class="learn-completion">
                  <Button
                    id="learn-complete"
                    label={
                      completed().includes(current.slug)
                        ? 'Completed · mark incomplete'
                        : 'Mark lesson complete'
                    }
                    icon={completed().includes(current.slug) ? 'check' : undefined}
                  />
                  <span class="metadata">Completion is your checkpoint, not an automatic assessment.</span>
                </div>
                <nav class="learn-pagination" aria-label="Lesson navigation">
                  {previous ? (
                    <LinkButton href={previous.route} label={`← ${previous.title}`} />
                  ) : (
                    <LinkButton href="/learn/" label="← Learning path" />
                  )}
                  {next ? (
                    <LinkButton href={next.route} label={`${next.title} →`} variant="primary" />
                  ) : (
                    <LinkButton href="/playground/" label="Practice in the playground →" variant="primary" />
                  )}
                </nav>
              </article>
              <nav class="learn-toc" aria-label="In this lesson">
                <Text variant="headingSm">In this lesson</Text>
                {current.toc.map((heading) => (
                  <a href={`#${heading.id}`}>{heading.title}</a>
                ))}
              </nav>
            </>
          )}
        </main>
      )
    },
    mount: ({ root, lifetime }) => {
      if (!(root instanceof HTMLElement)) return
      const storageKey = 'ketjs-learn-0.2.0'
      const known = new Set(lessons.map((lesson) => lesson.slug))
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
        if (Array.isArray(saved))
          completed.set([
            ...new Set(saved.filter((slug): slug is string => typeof slug === 'string' && known.has(slug))),
          ])
      } catch {
        /* Progress is optional in restricted browsers. */
      }
      root.addEventListener(
        'click',
        (event) => {
          if ((event.target as Element).closest('#learn-complete')) {
            const slug = page.peek().slug
            completed.set((items) =>
              items.includes(slug) ? items.filter((item) => item !== slug) : [...items, slug],
            )
            try {
              localStorage.setItem(storageKey, JSON.stringify(completed.peek()))
            } catch {
              /* Keep session progress. */
            }
          }
        },
        { signal: lifetime },
      )
      const routes = new Map([props.index, ...lessons].map((item) => [item.route, item.slug]))
      const navigate = createNavigation(
        props.page,
        {
          busy: (value) =>
            value ? root.setAttribute('aria-busy', 'true') : root.removeAttribute('aria-busy'),
          fallback: (url) => location.assign(url.href),
          load: async (url, signal) => {
            const response = await fetch(`/content/learn/${routes.get(url.pathname)}.json`, { signal })
            if (!response.ok) throw new Error('Lesson unavailable')
            const next = (await response.json()) as ContentPage
            if (
              next.kind !== 'learn' ||
              next.route !== url.pathname ||
              typeof next.html !== 'string' ||
              !Array.isArray(next.toc)
            )
              throw new Error('Invalid lesson')
            return next
          },
          commit: (next, url, pop) => {
            if (!pop) history.pushState({}, '', url)
            page.set(next)
            updatePageHead(next)
            document.dispatchEvent(new Event('ketjs:doc-navigation'))
            root.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
            if (url.hash) document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView()
            else scrollTo(0, 0)
          },
        },
        lifetime,
      )
      document.addEventListener(
        'click',
        (event) => {
          if (
            event.defaultPrevented ||
            event.button ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return
          const link =
            event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
          if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
          const url = new URL(link.href, location.href)
          if (
            url.origin !== location.origin ||
            !routes.has(url.pathname) ||
            url.search ||
            (url.pathname === location.pathname && url.hash)
          )
            return
          event.preventDefault()
          void navigate(url)
        },
        { signal: lifetime },
      )
      window.addEventListener(
        'popstate',
        () => {
          const url = new URL(location.href)
          if (!routes.has(url.pathname)) {
            location.reload()
            return
          }
          if (url.pathname === page.peek().route) return
          void navigate(url, true)
        },
        { signal: lifetime },
      )
    },
  }
}
export default learn
