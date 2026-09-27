import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, createKetServer, sqliteAdapter } from '@ketvietlab/ketjs'
import type { BrowserNavigation } from '@ketvietlab/ketjs'

type Options = NonNullable<Parameters<BrowserNavigation['navigate']>[1]> & { context?: unknown }
type Navigate = (href: string, mode?: string, scroll?: number[] | null, options?: Options) => Promise<void>

// Execute the published bootstrap's navigation functions, with deterministic IO.
// This catches request/history ordering and cancellation without a second router.
const runtime = (source: string) => {
  const location = new URL('http://example.test/orders?q=old')
  const calls: string[] = []
  const events: string[] = []
  const attributes = new Set<string>()
  const viewport = { id: 'table', scrollLeft: 140, scrollTop: 60 }
  const document = {
    body: {},
    activeElement: null as unknown,
    documentElement: {
      setAttribute: (name: string) => attributes.add(name),
      removeAttribute: (name: string) => attributes.delete(name),
    },
    querySelectorAll: () => [viewport],
    querySelector: (path: string) => (path === '#sort' ? sort : path === '#table' ? viewport : null),
    getElementById: () => null,
  }
  const sort = {
    id: 'sort',
    localName: 'a',
    rel: 'next',
    directionAttribute: 'rel',
    getAttribute: (name: string): string | null => (name === sort.directionAttribute ? sort.rel : null),
    getClientRects: () => [1],
    focus: () => {
      document.activeElement = sort
    },
  }
  document.activeElement = sort
  const window = {
    scrollX: 0,
    scrollY: 200,
    scrollTo: (x: number, y: number) => {
      window.scrollX = x
      window.scrollY = y
    },
  }
  const states: Array<{ url: string; state: unknown }> = []
  const history = {
    state: {} as Record<string, unknown>,
    replaceState: (state: Record<string, unknown>, _title: string, url: string) => {
      history.state = state
      location.href = new URL(url, location).href
    },
    pushState: (state: Record<string, unknown>, _title: string, url: string) => {
      states.push({ state, url })
      history.state = state
      location.href = url
    },
  }
  let fetcher = async (_url: URL, _init: RequestInit): Promise<Response> => new Response('rows')
  let applications = 0
  const requireActive = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Navigation aborted', 'AbortError')
  }
  const applyResponse = async (_response: Response, signal: AbortSignal) => {
    requireActive(signal)
    applications++
    document.activeElement = document.body
    viewport.scrollLeft = viewport.scrollTop = 0
    return []
  }
  const code = source.slice(source.indexOf('let active = null'), source.indexOf('const optedOut = '))
  assert.ok(code.includes('const navigate = '))
  const navigate = new Function(
    'document',
    'window',
    'location',
    'history',
    'fetch',
    'applyResponse',
    'requireActive',
    'event',
    'hardNavigate',
    'fragmentsType',
    'buildId',
    'CSS',
    `${code}\nreturn navigate`,
  )(
    document,
    window,
    location,
    history,
    (url: URL, init: RequestInit) => fetcher(url, init),
    applyResponse,
    requireActive,
    (name: string) => events.push(name),
    (url: string) => calls.push(url),
    'text/vnd.ket.fragments+html',
    'test-build',
    { escape: (value: string) => value },
  ) as Navigate
  return {
    navigate,
    location,
    history,
    states,
    calls,
    events,
    attributes,
    document,
    sort,
    window,
    viewport,
    applications: () => applications,
    fetch: (fn: typeof fetcher) => {
      fetcher = fn
    },
  }
}

test('collection navigation uses the shared bootstrap for every route', async (t) => {
  const adapter = sqliteAdapter()
  await adapter.open()
  const server = await createKetServer({ manifest: compose([]), adapter })
  const port = await server.listen(0)
  try {
    const source = await fetch(`http://127.0.0.1:${port}/_ket/islands.js`).then((response) => response.text())
    await t.test(
      'an interrupted response body is retryable and build changes keep the reload fallback',
      async () => {
        const reloads: string[] = []
        const code = source.slice(
          source.indexOf('const applyResponse = '),
          source.indexOf('let active = null'),
        )
        const apply = new Function(
          'requireActive',
          'buildId',
          'hardNavigate',
          'location',
          'fragmentsType',
          'applyFragments',
          'history',
          `${code}\nreturn applyResponse`,
        )(
          () => {},
          'test-build',
          (href: string) => reloads.push(href),
          { href: '/orders' },
          'text/vnd.ket.fragments+html',
          () => assert.fail('a broken response must not change content'),
          {},
        ) as (response: unknown) => Promise<void>
        await assert.rejects(
          apply({
            headers: new Headers({
              'x-ket-build': 'test-build',
              'content-type': 'text/vnd.ket.fragments+html',
            }),
            text: () => Promise.reject(new TypeError('body interrupted')),
          }),
          (error: unknown) => (error as { retryable: boolean }).retryable === true,
        )
        await assert.rejects(
          apply({ headers: new Headers({ 'x-ket-build': 'next-build' }) }),
          /builds differ/,
        )
        assert.deepEqual(reloads, ['/orders'])
      },
    )
    await t.test('success applies content before history and restores focus and nested scroll', async () => {
      for (const route of [
        '/admin/product/templates',
        '/admin/sales/orders',
        '/admin/partners',
        '/admin/crm/followups',
      ]) {
        const app = runtime(source)
        app.fetch(async (_url, init) => {
          assert.equal(app.states.length, 0)
          assert.equal((init.headers as Record<string, string>)['x-ket-navigation'], 'fragment-v1')
          assert.equal(init.credentials, 'same-origin')
          return new Response('rows')
        })
        const target = `${route}?q=shirt&group=state&assignee=u1&includeUnassigned=1&page=2`
        await app.navigate(target, 'push', null, { preserveContext: true, fallback: 'error' })
        assert.equal(app.location.pathname + app.location.search, target)
        assert.equal(app.applications(), 1)
        assert.equal(app.states.length, 1)
        assert.deepEqual(app.calls, [])
        assert.equal(app.document.activeElement, app.sort)
        assert.equal(app.viewport.scrollLeft, 140)
        assert.equal(app.viewport.scrollTop, 60)
        assert.equal(app.window.scrollY, 200)
        assert.equal(app.attributes.size, 0)
      }
    })
    await t.test(
      'network and 5xx failures are retryable; 403 is not; old content and URL survive',
      async () => {
        for (const failure of ['network', 503, 403]) {
          const app = runtime(source)
          app.fetch(async () => {
            if (failure === 'network') throw new TypeError('offline')
            return new Response('', { status: failure as number })
          })
          await assert.rejects(
            app.navigate('?q=new', 'push', null, { fallback: 'error' }),
            (error: unknown) => {
              assert.equal((error as { retryable: boolean }).retryable, failure !== 403)
              return true
            },
          )
          assert.equal(app.applications(), 0)
          assert.equal(app.location.search, '?q=old')
          assert.deepEqual(app.calls, [])
          assert.equal(app.attributes.size, 0)
        }
      },
    )
    await t.test(
      'new navigation and caller abort both reject stale results without history entries',
      async () => {
        const app = runtime(source)
        let resolve!: (response: Response) => void
        app.fetch(
          () =>
            new Promise((done) => {
              resolve = done
            }),
        )
        const first = app.navigate('?q=slow', 'push', null, { fallback: 'error' })
        const firstRejected = assert.rejects(first, { name: 'AbortError' })
        app.fetch(async () => new Response('latest'))
        await app.navigate('?q=latest', 'push', null, { fallback: 'error' })
        resolve(new Response('stale'))
        await firstRejected
        assert.equal(app.location.search, '?q=latest')
        assert.equal(app.applications(), 1)
        assert.equal(app.states.length, 1)

        const controller = new AbortController()
        app.fetch(
          () =>
            new Promise((done) => {
              resolve = done
            }),
        )
        const pending = app.navigate('?q=cancelled', 'push', null, {
          signal: controller.signal,
          fallback: 'error',
        })
        const cancelled = assert.rejects(pending, { name: 'AbortError' })
        controller.abort()
        resolve(new Response('cancelled'))
        await cancelled
        assert.equal(app.applications(), 1)
        assert.equal(app.location.search, '?q=latest')
      },
    )
    await t.test('a missing next-page control cannot restore focus to the previous-page action', async () => {
      // The three pager adapters name direction differently.
      for (const attribute of ['rel', 'data-direction', 'data-dir']) {
        const app = runtime(source)
        app.sort.directionAttribute = attribute
        app.fetch(async () => {
          app.sort.rel = 'prev'
          return new Response('last page')
        })
        await app.navigate('?page=last', 'push', null, { preserveContext: true })
        assert.equal(app.document.activeElement, app.document.body, attribute)
      }
    })
    await t.test(
      'pop restores the entry without creating another entry; native fallback remains available',
      async () => {
        const app = runtime(source)
        await app.navigate('?page=2', 'pop', [0, 320], { context: { scrolls: [['#table', 90, 30]] } })
        assert.equal(app.states.length, 0)
        assert.equal(app.window.scrollY, 320)
        assert.equal(app.viewport.scrollLeft, 90)
        app.fetch(async () => {
          throw new TypeError('offline')
        })
        await app.navigate('?page=3')
        assert.deepEqual(app.calls, ['http://example.test/orders?page=3'])
      },
    )
  } finally {
    await server.close()
    await adapter.close()
  }
})
