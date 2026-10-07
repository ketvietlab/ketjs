import { signal, type IslandFactory } from '@ketvietlab/ketjs-view'
import { createNavigation } from './navigation.ts'
import { DocLayout } from './docs-view.tsx'
import { updatePageHead } from './seo.ts'
import type { ContentPage, DocNavItem } from './model.ts'

type Props = { page: ContentPage; content: DocNavItem[] }

// The same pure TSX view renders at build time and reacts in the browser.
const documentation: IslandFactory<Props> = (props) => {
  const page = signal(props.page)
  return {
    view: () => <DocLayout page={page()} content={props.content} />,
    mount({ root, lifetime }) {
      if (!(root instanceof HTMLElement)) return
      const routes = new Map(props.content.map((item) => [item.route, item.slug]))
      const previousRestoration = history.scrollRestoration
      history.scrollRestoration = 'manual'
      const saveScroll = () => history.replaceState({ ...history.state, ketjsScroll: [scrollX, scrollY] }, '')
      saveScroll()
      const navigate = createNavigation(
        props.page,
        {
          busy: (value) =>
            value ? root.setAttribute('aria-busy', 'true') : root.removeAttribute('aria-busy'),
          fallback: (url) => location.assign(url.href),
          load: async (url, signal) => {
            const response = await fetch(`/content/docs/${routes.get(url.pathname)}.json`, { signal })
            if (!response.ok) throw new Error('Documentation content unavailable')
            const next = (await response.json()) as ContentPage
            if (next.route !== url.pathname || typeof next.html !== 'string' || !Array.isArray(next.toc))
              throw new Error('Invalid documentation content')
            return next
          },
          commit: (next, url, pop, position) => {
            if (!pop) {
              saveScroll()
              history.pushState({ ketjsScroll: [0, 0] }, '', url)
            }
            page.set(next)
            const mobileDocs = root.querySelector<HTMLDetailsElement>('.mobile-docs')
            if (mobileDocs) mobileDocs.open = false
            updatePageHead(next)
            document.dispatchEvent(new Event('ketjs:doc-navigation'))
            root.querySelector<HTMLHeadingElement>('h1')?.focus({ preventScroll: true })
            if (pop && position) scrollTo(position[0] ?? 0, position[1] ?? 0)
            else if (url.hash)
              document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView()
            else scrollTo(0, 0)
            const status = document.querySelector('#site-status')
            if (status) status.textContent = `${next.title} loaded.`
          },
        },
        lifetime,
      )
      document.addEventListener(
        'click',
        (event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return
          const link =
            event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
          if (
            !link ||
            link.hasAttribute('download') ||
            (link.target && link.target !== '_self') ||
            link.rel.includes('external')
          )
            return
          const url = new URL(link.href, location.href)
          if (url.origin !== location.origin || !routes.has(url.pathname) || url.search) return
          if (url.pathname === location.pathname && url.hash) return
          event.preventDefault()
          void navigate(url)
        },
        { signal: lifetime },
      )
      window.addEventListener(
        'popstate',
        (event) => {
          const url = new URL(location.href)
          if (!routes.has(url.pathname)) {
            location.reload()
            return
          }
          // Same-document hash history needs no content fetch or island render.
          if (url.pathname === page.peek().route) {
            if (event.state?.ketjsScroll) scrollTo(...(event.state.ketjsScroll as [number, number]))
            else if (url.hash)
              document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView()
            return
          }
          void navigate(url, true, event.state?.ketjsScroll)
        },
        { signal: lifetime },
      )
      window.addEventListener('scroll', saveScroll, { signal: lifetime, passive: true })
      lifetime.addEventListener(
        'abort',
        () => {
          history.scrollRestoration = previousRestoration
        },
        { once: true },
      )
    },
  }
}

export default documentation
