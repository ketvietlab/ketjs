import { domHost, html, mountHydrated, signal } from '@ketvietlab/ketjs-view'
import { browserTable, type BrowserListState, type BrowserWidgetRenderer } from '../browser-list.tsx'
import {
  browserLoadError,
  browserListInitialState,
  BrowserListLoader,
  type BrowserFetch,
  type BrowserListBootstrap,
} from './browser-list-loader.ts'

const parseBootstrap = (root: HTMLElement): BrowserListBootstrap => {
  const encoded = root.getAttribute('data-lego-bootstrap')
  if (!encoded) throw new Error('missing browser-list bootstrap')
  return JSON.parse(encoded) as BrowserListBootstrap
}

const install = (root: HTMLElement): void => {
  const bootstrap = parseBootstrap(root)
  const initial = signal<BrowserListState>(browserListInitialState(bootstrap))
  const renderers = signal<Record<string, BrowserWidgetRenderer>>({})
  const status = signal(bootstrap.initial.status)
  // The server places this view in an html-template child hole, so its marker
  // pair is part of the DOM contract and the client must hydrate the same shape.
  const hydrationStarted = performance.now()
  const mounted = mountHydrated(
    domHost(document),
    root as never,
    () =>
      html`${browserTable(bootstrap.plan, initial(), renderers(), {
        status: status(),
        emptyTitle: bootstrap.emptyTitle,
        emptyMessage: bootstrap.emptyMessage,
        loadingLabel: bootstrap.loadingLabel,
        locale: bootstrap.locale,
        rowHref: bootstrap.rowBase
          ? (row) => {
              const target = new URL(
                `${bootstrap.rowBase}/${encodeURIComponent(String(row[bootstrap.plan.screen.rowKey]))}`,
                location.origin,
              )
              if (bootstrap.rowQuery) target.search = bootstrap.rowQuery
              return `${target.pathname}${target.search}`
            }
          : undefined,
        responsive: 'stack',
        selection: bootstrap.selection,
        selectAllLabel: bootstrap.selectAllLabel,
        selectRowLabel: bootstrap.selectRowLabel,
      })}`,
  )
  root.dataset.legoHydrateMs = String(performance.now() - hydrationStarted)
  let updateRenderMs = 0
  let firstRow: Element | null = null
  const mark = (phase: BrowserListState['phase']): void => {
    const name = `ket-lego-${phase}`
    performance.mark(name)
    root.dispatchEvent(new CustomEvent('ket:lego-phase', { bubbles: true, detail: { phase } }))
    if (phase === 'primary' && !root.dataset.legoPrimaryMs) {
      root.dataset.legoPrimaryMs = String(performance.now())
      firstRow = root.querySelector('[data-ui="row"]')
    }
    if (phase === 'complete') {
      root.dataset.legoRowStable = String(!firstRow || firstRow === root.querySelector('[data-ui="row"]'))
      const navigation = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined
      root.dataset.legoCompleteMs = String(performance.now() - (navigation?.startTime ?? 0))
    }
  }
  const markRequired = (): void => {
    if (root.dataset.legoRequiredMs) return
    performance.mark('ket-lego-required')
    root.dataset.legoRequiredMs = String(performance.now())
    root.dispatchEvent(new CustomEvent('ket:lego-required', { bubbles: true }))
  }
  let lastPhase = initial().phase
  let lastRequiredReady = initial().requiredReady
  const loader = new BrowserListLoader(
    bootstrap,
    (next) => {
      const renderStarted = performance.now()
      initial.set(next)
      updateRenderMs += performance.now() - renderStarted
      root.dataset.legoRenderMs = String(updateRenderMs)
      if (next.phase !== lastPhase) {
        lastPhase = next.phase
        queueMicrotask(() => mark(next.phase))
      }
      if (next.requiredReady && !lastRequiredReady) {
        lastRequiredReady = true
        queueMicrotask(markRequired)
      }
    },
    globalThis.fetch.bind(globalThis) as BrowserFetch,
  )

  queueMicrotask(() => {
    if (lastPhase === 'primary') mark('primary')
    if (lastRequiredReady) markRequired()
  })

  const widgetLoads: Promise<void>[] = []
  for (const widget of Object.values(bootstrap.plan.widgets)) {
    if (!widget.client) continue
    widgetLoads.push(
      import(widget.client.src)
        .then((module) => {
          const renderStarted = performance.now()
          const renderer = (module as Record<string, unknown>)[widget.client!.export]
          if (typeof renderer !== 'function') throw new Error(`missing export ${widget.client!.export}`)
          renderers.set({ ...renderers(), [widget.id]: renderer as BrowserWidgetRenderer })
          updateRenderMs += performance.now() - renderStarted
          root.dataset.legoRenderMs = String(updateRenderMs)
        })
        .catch((error) => {
          root.dataset.legoWidgetError = browserLoadError(error)
        }),
    )
  }
  void Promise.all(widgetLoads).then(() => {
    root.dataset.legoWidgetsMs = String(performance.now())
  })

  void loader.start().catch((error) => {
    root.dataset.legoFatal = browserLoadError(error)
  })
  addEventListener(
    'pagehide',
    () => {
      loader.dispose()
      mounted.dispose()
    },
    { once: true },
  )
}

if (typeof document !== 'undefined') {
  for (const root of document.querySelectorAll<HTMLElement>('[data-lego-bootstrap]')) install(root)
}
