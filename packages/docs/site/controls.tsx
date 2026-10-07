import { attachDiagrams } from './diagrams.ts'
import { Badge, Button, Field, Icon, IconButton, Text } from '@ketvietlab/design-system'
import type { IslandFactory } from '@ketvietlab/ketjs-view'
import { BrandMark } from './logo.tsx'
import { DiagramViewer } from './diagram-viewer.tsx'
import { MenuIcon, ThemeIcon } from './header-icons.tsx'

type SearchItem = { title: string; description: string; route: string; keywords: string }
type Props = { active: string }
const links = [
  { label: 'Docs', href: '/docs/' },
  { label: 'Learn', href: '/learn/' },
  { label: 'Examples', href: '/examples/' },
  { label: 'Blog', href: '/blog/' },
]

const controls: IslandFactory<Props> = (props) => ({
  view: () => (
    <>
      <header class="site-header">
        <a class="brand" href="/" aria-label="KetJS preview homepage">
          <BrandMark />
          <Text variant="headingLg">
            KetJS<span class="brand-dot">.</span>
          </Text>
          <Badge label="Preview" tone="neutral" />
        </a>
        <nav class="desktop-navigation" aria-label="Main navigation">
          {links.map((link) => (
            <a href={link.href} aria-current={props.active.startsWith(link.href) ? 'page' : null}>
              {link.label}
            </a>
          ))}
        </nav>
        <div class="header-actions">
          <span class="desktop-search">
            <Button id="open-search" label="Search docs" icon="search" />
          </span>
          <span class="mobile-search">
            <IconButton id="open-search-mobile" label="Search docs" icon={<Icon name="search" />} />
          </span>
          <span class="shortcut" aria-hidden="true">
            ⌘ K
          </span>
          <span class="desktop-theme">
            <Button id="theme-toggle" label="Theme" variant="tertiary" size="compact" />
          </span>
          <span class="mobile-theme">
            <IconButton id="theme-toggle-mobile" label="Switch theme" icon={<ThemeIcon />} />
          </span>
          <a class="github-link" href="https://github.com/ketvietlab/ketjs">
            GitHub ↗
          </a>
        </div>
        <div class="mobile-menu">
          <IconButton
            id="mobile-menu-toggle"
            label="Open navigation"
            icon={<MenuIcon />}
            expanded={false}
            controls="mobile-navigation"
          />
          <nav id="mobile-navigation" aria-label="Mobile navigation" hidden>
            {links.map((link) => (
              <a href={link.href} aria-current={props.active.startsWith(link.href) ? 'page' : null}>
                {link.label}
              </a>
            ))}
            <a href="/search/">Browse all topics</a>
            <a href="https://github.com/ketvietlab/ketjs">GitHub ↗</a>
          </nav>
        </div>
      </header>
      <dialog class="site-search" id="search-dialog" aria-labelledby="search-title">
        <div class="search-heading">
          <Text as="h2" id="search-title" variant="headingLg">
            Search KetJS
          </Text>
          <Button id="close-search" label="Close" size="compact" />
        </div>
        <form action="/search/" method="get" class="search-form">
          <Field
            id="search-query"
            name="q"
            label="Search documentation"
            labelHidden
            type="search"
            placeholder="Try modules, islands, or jobs…"
          />
          <Button label="Search" type="submit" />
        </form>
        <p class="search-hint" id="search-count" role="status" aria-live="polite">
          Search titles, descriptions, and section headings.
        </p>
        <ul class="search-results" id="search-results" aria-label="Search results" />
        <div class="search-footer">
          <span>Tab to navigate · Enter to open · Esc to close</span>
          <a href="/search/">Browse all topics →</a>
        </div>
      </dialog>
      <DiagramViewer />
      <span class="sr-only" id="site-status" role="status" aria-live="polite" />
    </>
  ),
  mount({ root, lifetime }) {
    if (!(root instanceof HTMLElement)) return
    const dialog = root.querySelector<HTMLDialogElement>('#search-dialog')!
    const input = root.querySelector<HTMLInputElement>('#search-query')!
    const results = root.querySelector<HTMLUListElement>('#search-results')!
    const count = root.querySelector<HTMLElement>('#search-count')!
    const theme = root.querySelector<HTMLButtonElement>('#theme-toggle')!
    const mobileTheme = root.querySelector<HTMLButtonElement>('#theme-toggle-mobile')!
    const menu = root.querySelector<HTMLButtonElement>('#mobile-menu-toggle')!
    const mobileNavigation = root.querySelector<HTMLElement>('#mobile-navigation')!
    const toggleMenu = (open: boolean) => {
      mobileNavigation.hidden = !open
      menu.setAttribute('aria-expanded', String(open))
      menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation')
    }
    menu.addEventListener('click', () => toggleMenu(Boolean(mobileNavigation.hidden)), { signal: lifetime })
    document.addEventListener(
      'click',
      (event) => {
        if (event.target instanceof Node && !menu.parentElement!.contains(event.target)) toggleMenu(false)
        else if (event.target instanceof Element && event.target.closest('#mobile-navigation a'))
          toggleMenu(false)
      },
      { signal: lifetime },
    )
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && !mobileNavigation.hidden) {
          toggleMenu(false)
          menu.focus()
        }
      },
      { signal: lifetime },
    )
    const status = root.querySelector<HTMLElement>('#site-status')!
    const searchButton = root.querySelector<HTMLButtonElement>('#open-search')!
    let returnFocus: HTMLElement | null = null
    let items: SearchItem[] = []
    let index: Promise<void> | undefined
    const loadIndex = () =>
      (index ??= fetch('/search-index.json', { signal: lifetime })
        .then((response) => {
          if (!response.ok) throw new Error('Search unavailable')
          return response.json()
        })
        .then((data) => {
          items = data
          renderResults()
        })
        .catch(() => {
          count.textContent = 'Search unavailable. Browse all topics below.'
        }))
    const renderResults = () => {
      const query = input.value.trim().toLowerCase()
      const matches = items
        .filter(
          (item) =>
            !query || `${item.title} ${item.description} ${item.keywords}`.toLowerCase().includes(query),
        )
        .slice(0, 8)
      results.replaceChildren(
        ...matches.map((item) => {
          const li = document.createElement('li'),
            link = document.createElement('a'),
            title = document.createElement('strong'),
            description = document.createElement('span')
          link.href = item.route
          title.textContent = item.title
          description.textContent = item.description
          link.append(title, description)
          li.append(link)
          return li
        }),
      )
      count.textContent = matches.length
        ? `${matches.length} ${query ? 'matching' : 'suggested'} topics`
        : 'No topics found. Try a shorter term or browse all topics.'
    }
    const open = () => {
      if (dialog.open) return
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : searchButton
      dialog.showModal()
      count.textContent = 'Loading search…'
      void loadIndex()
      if (items.length) renderResults()
      input.focus()
    }
    const close = () => dialog.close()
    document.addEventListener(
      'ketjs:doc-navigation',
      () => {
        if (dialog.open) {
          returnFocus = null
          close()
        }
      },
      { signal: lifetime },
    )
    for (const button of root.querySelectorAll<HTMLButtonElement>('#open-search, #open-search-mobile'))
      button.addEventListener('click', open, { signal: lifetime })
    root.querySelector('#close-search')!.addEventListener('click', close, { signal: lifetime })
    input.addEventListener('input', renderResults, { signal: lifetime })
    dialog.addEventListener('close', () => returnFocus?.focus(), { signal: lifetime })
    dialog.addEventListener(
      'click',
      (event) => {
        const rect = dialog.getBoundingClientRect()
        if (
          event.target === dialog &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
        )
          close()
      },
      { signal: lifetime },
    )
    root.querySelector('.search-form')!.addEventListener(
      'submit',
      (event) => {
        event.preventDefault()
        const first = results.querySelector<HTMLAnchorElement>('a')
        if (first) first.click()
      },
      { signal: lifetime },
    )
    const saved = (() => {
      try {
        return localStorage.getItem('ketjs-theme')
      } catch {
        return null
      }
    })()
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved
    const updateThemeLabel = () => {
      const dark =
        document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
      for (const button of [theme, mobileTheme])
        button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`)
    }
    updateThemeLabel()
    attachDiagrams(lifetime)
    for (const button of [theme, mobileTheme])
      button.addEventListener(
        'click',
        () => {
          const next = theme.getAttribute('aria-label') === 'Switch to light theme' ? 'light' : 'dark'
          document.documentElement.dataset.theme = next
          try {
            localStorage.setItem('ketjs-theme', next)
          } catch {
            /* Storage may be disabled. */
          }
          updateThemeLabel()
          document.dispatchEvent(new Event('ketjs:theme-change'))
        },
        { signal: lifetime },
      )
    document.addEventListener(
      'keydown',
      (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          open()
        }
      },
      { signal: lifetime },
    )
    document.querySelector('#copy-command')?.addEventListener(
      'click',
      async () => {
        const command = document.querySelector('.install-command code')?.textContent ?? ''
        try {
          await navigator.clipboard.writeText(command)
          status.textContent = 'Install command copied.'
        } catch {
          status.textContent = 'Copy unavailable. Select the command to copy it manually.'
        }
      },
      { signal: lifetime },
    )
    const query = new URL(location.href).searchParams.get('q')
    if (props.active === '/search/' && query) {
      input.value = query
      open()
    }
    lifetime.addEventListener(
      'abort',
      () => {
        if (dialog.open) dialog.close()
      },
      { once: true },
    )
  },
})

export default controls
