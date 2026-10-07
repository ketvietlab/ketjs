import type { ContentPage } from './model.ts'

type Ports = {
  load(url: URL, signal: AbortSignal): Promise<ContentPage>
  commit(page: ContentPage, url: URL, pop: boolean, position?: number[]): void
  fallback(url: URL): void
  busy(value: boolean): void
}

// Request ordering and cache are independent of DOM, history and the pure view.
export function createNavigation(initial: ContentPage, ports: Ports, lifetime: AbortSignal) {
  const cache = new Map([[initial.route, initial]])
  let pending: AbortController | undefined
  let revision = 0
  lifetime.addEventListener('abort', () => pending?.abort(), { once: true })
  return async (url: URL, pop = false, position?: number[]) => {
    pending?.abort()
    const request = new AbortController()
    pending = request
    const current = ++revision
    ports.busy(true)
    try {
      const next = cache.get(url.pathname) ?? (await ports.load(url, request.signal))
      if (current !== revision || lifetime.aborted) return
      cache.set(url.pathname, next)
      if (cache.size > 30) cache.delete(cache.keys().next().value!)
      ports.commit(next, url, pop, position)
    } catch {
      if (!request.signal.aborted && !lifetime.aborted) ports.fallback(url)
    } finally {
      if (current === revision) ports.busy(false)
    }
  }
}
