// One server function, three surfaces: an HTTP endpoint, the typed client that
// calls it, and an agent tool descriptor — all read off the same manifest entry.

import { createServer } from 'node:http'
import { pipeline } from 'node:stream/promises'
import type { RouteResult } from './respond.ts'
import { readFile } from 'node:fs/promises'
import { join, normalize, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { callFn } from './fn.ts'
import { createStreams, dbStreamStore, memoryStreamStore } from './stream.ts'
import type { StreamStore } from './stream.ts'
import { agentDescriptor } from '../agent/capabilities.ts'
import { KetError } from '../kernel/errors.ts'
import type { Adapter, Manifest, Scope } from '../types.ts'
import type { AdapterPool } from '../data/pool.ts'
import { KetError as KetErr } from '../kernel/errors.ts'
import type { ThemeRuntime } from '../theme/render.ts'
import { compileRoutes } from '../kernel/routes.ts'
import type { RouteParams } from '../kernel/routes.ts'

type HttpRoute = (url: URL, req: IncomingMessage, params: RouteParams) => Promise<RouteResult> | RouteResult

export type ServeOpts = {
  manifest: Manifest
  /** A single database. Use `pool` + `resolveDatastore` for one database per tenant. */
  adapter?: Adapter | null
  /** One database per tenant, resolved per request and leased from a bounded pool. */
  pool?: AdapterPool
  /**
   * Which database this request belongs to. Resolution happens exactly once, here,
   * because ctx is the only thing that touches data — so a request cannot end up
   * reading the wrong tenant by forgetting to pass something along.
   */
  resolveDatastore?: (url: URL, req: IncomingMessage) => string | null
  theme?: ThemeRuntime | ((url: URL, req: IncomingMessage) => Promise<ThemeRuntime | null>)
  /** Browser modules for islands available to this request. */
  islandClients?:
    | ThemeRuntime['clients']
    | ((url: URL, req: IncomingMessage) => Promise<ThemeRuntime['clients']>)
  port?: number
  /** Defaults to a table on the app's adapter; swap for memory on a single instance. */
  streamStore?: StreamStore
  /**
   * Which language this request is in. Resolved in one place, like the datastore,
   * so a handler cannot answer in the wrong one by forgetting to pass it along.
   */
  resolveLocale?: (url: URL, req: IncomingMessage) => string
  /**
   * Which company and branches this request acts as. Resolved here for the same
   * reason the datastore is: a handler that had to remember to pass it along would
   * eventually forget, and forgetting means answering with another company's rows.
   */
  resolveScope?: (url: URL, req: IncomingMessage) => Scope | Promise<Scope>
  /** Authenticated user id captured into functions and any jobs they enqueue. */
  resolveActor?: (url: URL, req: IncomingMessage) => string | null | Promise<string | null>
  /** Functions this request may call. Null means unrestricted — see boot.ts. */
  resolveAllow?: (url: URL, req: IncomingMessage) => Promise<readonly string[] | null>
  /** Disable PostgreSQL notification while retaining polling correctness. */
  queueNotify?: boolean
  /** Serve files from disk under a URL prefix. Meant for stylesheets during design. */
  /** Static file mounts. One fixed directory, or a resolver that answers per request. */
  assets?: AssetMount | AssetMount[]
  /** Extra routes, matched before the theme takes the request. */
  routes?: Record<string, HttpRoute>
  pageScope?: (url: URL, req: IncomingMessage) => Record<string, unknown> | Promise<Record<string, unknown>>
}

/**
 * A mount is either a directory, or a function from the rest of the path to an
 * absolute file — which is how a module's assets can stop being served the moment
 * the module is uninstalled, without rebuilding the server.
 */
export type AssetMount = {
  prefix: string
  dir?: string
  resolve?: (rest: string, url: URL, req: IncomingMessage) => Promise<string | null>
}

const ASSET_MIME: Record<string, string> = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const s = JSON.stringify(body, null, 2)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(s)
}

const contentType = (type: string): string => {
  const lower = type.toLowerCase()
  const textual =
    lower.startsWith('text/') ||
    lower === 'application/json' ||
    lower.endsWith('+json') ||
    lower === 'application/xml' ||
    lower.endsWith('+xml') ||
    lower === 'image/svg+xml'
  return textual && !lower.includes('charset=') ? `${type}; charset=utf-8` : type
}

const islandScript = '<script type="module" src="/_ket/islands.js"></script>'
const viewRuntimeUrl = '/_ket/view/index.js'

const bootstrapDocument = (body: string): string => {
  if (
    (!body.includes('<ket-island') && !body.includes('data-ket-slot=')) ||
    body.includes('src="/_ket/islands.js"')
  )
    return body
  const closingBody = body.lastIndexOf('</body>')
  return closingBody < 0
    ? body + islandScript
    : body.slice(0, closingBody) + islandScript + body.slice(closingBody)
}

const browserBootstrap = (clients: ThemeRuntime['clients']): string => `import {
  createIslandManager,
  domHost,
} from ${JSON.stringify(viewRuntimeUrl)}

const definitions = ${JSON.stringify(clients)}
const registry = Object.create(null)
const loading = new Map()
const loadFactory = async (name) => {
  if (registry[name]) return registry[name]
  const definition = definitions[name]
  if (!definition) return null
  if (loading.has(name)) return loading.get(name)
  const pending = (async () => {
  const module = await import(definition.src)
  const factory = module[definition.export]
  if (typeof factory !== 'function') {
    throw new TypeError('island "' + name + '" does not export a factory named "' + definition.export + '"')
  }
  registry[name] = factory
    return factory
  })()
  loading.set(name, pending)
  try { return await pending } finally { loading.delete(name) }
}
const loadPlaced = async (root) => {
  const names = new Set(Array.from(root.querySelectorAll('ket-island'), (element) => element.getAttribute('data-island')).filter(Boolean))
  await Promise.all(Array.from(names, loadFactory))
}

await loadPlaced(document)
const islands = createIslandManager(domHost(), registry, { strict: false })
islands.hydrate(document)

const event = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }))
const hardNavigate = (target) => window.location.assign(String(target))
const fragmentsType = 'text/vnd.ket.fragments+html'
const slotSelector = (name) => '[data-ket-slot="' + name + '"]'

const applyFragments = async (markup) => {
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  const envelope = parsed.querySelector('ket-fragments')
  if (!envelope) throw new Error('navigation response has no ket-fragments envelope')
  const templates = Array.from(envelope.querySelectorAll('template[data-ket-slot]'))
  if (!templates.length) throw new Error('navigation response has no slots')
  const names = new Set()
  for (const template of templates) {
    const name = template.getAttribute('data-ket-slot')
    if (!name || names.has(name)) throw new Error('navigation response has a missing or duplicate slot')
    names.add(name)
    if (document.querySelectorAll(slotSelector(name)).length !== 1)
      throw new Error('current document does not have exactly one slot named "' + name + '"')
  }
  await Promise.all(templates.map((template) => loadPlaced(template.content)))
  const changed = []
  for (const template of templates) {
    const name = template.getAttribute('data-ket-slot')
    const slot = document.querySelector(slotSelector(name))
    islands.reconcile(slot, template.content)
    changed.push(slot)
  }
  const title = envelope.getAttribute('data-title')
  if (title !== null) document.title = title
  return changed
}

let active = null
const saveScroll = () => {
  const state = { ...(history.state ?? {}), __ketScroll: [window.scrollX, window.scrollY] }
  history.replaceState(state, '', location.href)
}
const focusAfterNavigation = (url, changed, scroll) => {
  if (url.hash) {
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)))
    if (target) {
      target.focus?.({ preventScroll: true })
      target.scrollIntoView()
      return
    }
  }
  const [x, y] = scroll ?? [0, 0]
  window.scrollTo(x, y)
  const target = changed.find((slot) => slot.matches?.('[data-ket-slot$="content"], main')) ?? changed[0]
  if (!target) return
  const hadTabIndex = target.hasAttribute('tabindex')
  if (!hadTabIndex) target.setAttribute('tabindex', '-1')
  target.focus?.({ preventScroll: true })
  if (!hadTabIndex) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
}

const navigate = async (asked, mode = 'push', scroll = null) => {
  const target = new URL(asked, location.href)
  if (mode === 'push') saveScroll()
  active?.abort()
  const controller = new AbortController()
  active = controller
  document.documentElement.setAttribute('data-ket-navigating', '')
  document.documentElement.setAttribute('aria-busy', 'true')
  event('ket:navigation-start', { url: target.href, mode })
  let fallback = target.href
  try {
    const response = await fetch(target, {
      credentials: 'same-origin',
      headers: {
        accept: fragmentsType + ', text/html;q=0.9',
        'x-ket-navigation': 'fragment-v1',
      },
      signal: controller.signal,
    })
    fallback = response.url || fallback
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith(fragmentsType))
      throw new Error('server did not return a navigation fragment')
    const changed = await applyFragments(await response.text())
    const finalUrl = new URL(response.url || target.href)
    if (mode === 'push') history.pushState({ __ketScroll: [0, 0] }, '', finalUrl.href)
    focusAfterNavigation(finalUrl, changed, scroll)
    event('ket:navigation-complete', { url: finalUrl.href, mode })
  } catch (caught) {
    if (controller.signal.aborted) return
    event('ket:navigation-error', { url: fallback, mode, error: caught })
    hardNavigate(fallback)
  } finally {
    if (active === controller) {
      active = null
      document.documentElement.removeAttribute('data-ket-navigating')
      document.documentElement.removeAttribute('aria-busy')
    }
  }
}

const optedOut = (element) => Boolean(element.closest?.('[data-ket-reload]'))
document.addEventListener('click', (click) => {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return
  const anchor = click.target.closest?.('a[href]')
  if (!anchor || optedOut(anchor) || anchor.hasAttribute('download')) return
  if (anchor.target && anchor.target !== '_self') return
  const target = new URL(anchor.href, location.href)
  if (target.origin !== location.origin) return
  if (target.pathname === location.pathname && target.search === location.search && target.hash !== location.hash) return
  click.preventDefault()
  void navigate(target)
})

document.addEventListener('submit', (submit) => {
  if (submit.defaultPrevented) return
  const form = submit.target
  if (!(form instanceof HTMLFormElement) || optedOut(form) || String(form.method || 'get').toLowerCase() !== 'get') return
  const target = new URL(form.action || location.href, location.href)
  if (target.origin !== location.origin || (form.target && form.target !== '_self')) return
  target.search = ''
  for (const [name, value] of new FormData(form, submit.submitter))
    target.searchParams.append(name, typeof value === 'string' ? value : value.name)
  submit.preventDefault()
  void navigate(target)
})

history.scrollRestoration = 'manual'
if (!history.state?.__ketScroll) history.replaceState({ ...(history.state ?? {}), __ketScroll: [window.scrollX, window.scrollY] }, '', location.href)
window.addEventListener('popstate', (pop) => void navigate(location.href, 'pop', pop.state?.__ketScroll ?? [0, 0]))
globalThis.__ketNavigation = { applyFragments, navigate, islands }
`

const send = async (res: ServerResponse, result: RouteResult): Promise<void> => {
  if (typeof result.body === 'string' || result.body instanceof Uint8Array) {
    const body =
      typeof result.body === 'string' &&
      (result.type ?? 'text/html').toLowerCase().startsWith('text/html') &&
      (result.body.includes('<ket-island') || result.body.includes('data-ket-slot='))
        ? bootstrapDocument(result.body)
        : result.body
    res.writeHead(result.status ?? 200, {
      'content-type': contentType(result.type ?? 'text/html'),
      ...result.headers,
    })
    res.end(body)
    return
  }
  res.writeHead(result.status ?? 200, {
    'content-type': contentType(result.type ?? 'text/html'),
    ...result.headers,
  })
  // pipeline owns backpressure and destroys the source when the client disappears.
  // Awaiting 'drain' by hand never settles on an abort — the response emits only
  // 'close' — which hung the handler and leaked one fd per cancelled download.
  await pipeline(result.body, res)
}

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

export async function createKetServer(o: ServeOpts) {
  if (!o.adapter && !o.pool)
    throw new KetErr({ code: 'E_NO_DATABASE', message: 'createKetServer needs either an adapter or a pool' })
  if (o.pool && !o.resolveDatastore)
    throw new KetErr({
      code: 'E_NO_RESOLVER',
      message: 'a pool needs resolveDatastore to know which database a request belongs to',
    })

  // Compile once: matching stays cheap per request, and an ambiguous surface is
  // refused before the server starts rather than depending on object insertion order.
  const matchRoute = compileRoutes(o.routes ?? {})

  // Per-request database resolution. The single-adapter case is the same code path
  // with a resolver that always answers the same thing.
  const withDb = async <T>(url: URL, req: IncomingMessage, fn: (a: Adapter) => Promise<T>): Promise<T> => {
    if (!o.pool) return fn(o.adapter as Adapter)
    const key = (o.resolveDatastore as NonNullable<ServeOpts['resolveDatastore']>)(url, req)
    if (!key) {
      throw new KetErr({
        code: 'E_UNKNOWN_TENANT',
        message: `no datastore for ${url.host}${url.pathname}`,
        hint: 'resolveDatastore returned null — the request names a tenant this app does not serve',
      })
    }
    return o.pool.with(key, fn)
  }

  // With one database the stream store lives in it. With a database per tenant it
  // does not: whose database a stream belongs to is a separate question, so the
  // default stays in memory and the caller passes a store when they have answered it.
  const configuredMounts: AssetMount[] = o.assets ? (Array.isArray(o.assets) ? o.assets : [o.assets]) : []
  // Browser-safe ketjs-view output is framework infrastructure, like /_ket/fn:
  // callers should not need to find and mount a transitive package themselves.
  const mounts: AssetMount[] = [
    {
      prefix: '/_ket/view/',
      // `tsx` resolves the workspace package to src/index.ts while production
      // resolves its export to dist/index.js. Both entries share this dist root.
      dir: fileURLToPath(new URL('../dist/', import.meta.resolve('ketjs-view'))),
    },
    ...configuredMounts,
  ]

  const resolveTheme = async (url: URL, req: IncomingMessage): Promise<ThemeRuntime | null> =>
    !o.theme ? null : typeof o.theme === 'function' ? o.theme(url, req) : o.theme
  const resolveIslandClients = async (
    url: URL,
    req: IncomingMessage,
    theme?: ThemeRuntime | null,
  ): Promise<ThemeRuntime['clients']> => {
    if (typeof o.islandClients === 'function') return o.islandClients(url, req)
    return o.islandClients ?? theme?.clients ?? {}
  }

  const streams = await createStreams(
    o.streamStore ?? (o.adapter ? dbStreamStore(o.adapter) : memoryStreamStore()),
  )

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    try {
      // Static files. Several mounts, because the app has its own and every
      // installed module may ship some — and a module's must stop being served the
      // moment it is switched off, which is what `resolve` is for: it answers per
      // request instead of being fixed when the server was built.
      for (const mount of mounts) {
        if (!url.pathname.startsWith(mount.prefix)) continue
        // Path traversal is the one thing a static handler must not get wrong.
        const rel = normalize(url.pathname.slice(mount.prefix.length)).replace(/^(\.\.[/\\])+/, '')
        const file =
          mount.dir !== undefined
            ? rel && !rel.startsWith('..')
              ? join(mount.dir, rel)
              : null
            : await (mount.resolve as NonNullable<AssetMount['resolve']>)(rel, url, req)
        if (file === null) break
        try {
          const body = await readFile(file)
          const type = ASSET_MIME[extname(rel)] ?? 'application/octet-stream'
          res.writeHead(200, { 'content-type': contentType(type), 'cache-control': 'no-cache' })
          return res.end(body)
        } catch {
          break
        }
      }
      if (mounts.some((m) => url.pathname.startsWith(m.prefix))) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        return res.end('not found')
      }

      const route = matchRoute(url.pathname)
      if (route) {
        const r = await route.value(url, req, route.params)
        return await send(res, r)
      }

      if (url.pathname === '/_ket/manifest') return json(res, 200, o.manifest)
      if (url.pathname === '/_ket/agent') return json(res, 200, agentDescriptor(o.manifest))
      if (url.pathname === '/_ket/islands.js') {
        const theme = await resolveTheme(url, req)
        const clients = await resolveIslandClients(url, req, theme)
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-cache',
        })
        return res.end(browserBootstrap(clients))
      }

      // Resumable stream: the client reconnects with ?from=<cursor> and gets
      // exactly what it missed, never a duplicate and never a gap.
      if (url.pathname.startsWith('/_ket/stream/')) {
        const id = url.pathname.slice('/_ket/stream/'.length)
        const from = Number(url.searchParams.get('from') ?? 0)
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        // A client that reloads mid-stream simply disappears. Stop tailing the
        // moment that happens: the durable log keeps the chunks, and the next
        // connection resumes from its cursor.
        let open = true
        const stop = () => {
          open = false
        }
        req.on('close', stop)
        res.on('close', stop)
        for await (const chunk of streams.tail(id, from, { timeoutMs: 30_000 })) {
          if (!open || res.writableEnded) return
          res.write(`id: ${chunk.seq}\ndata: ${JSON.stringify(chunk.data)}\n\n`)
        }
        if (!open || res.writableEnded) return
        res.write('event: done\ndata: {}\n\n')
        return res.end()
      }

      if (url.pathname.startsWith('/_ket/fn/') && req.method === 'POST') {
        const fnKey = decodeURIComponent(url.pathname.slice('/_ket/fn/'.length))
        const meta = o.manifest.functions[fnKey]
        if (meta?.exposure === 'internal') {
          throw new KetError({
            code: 'E_FUNCTION_INTERNAL',
            message: `server function "${fnKey}" is internal and has no generic HTTP endpoint`,
            hint: 'call it from the trusted route that owns its security policy',
          })
        }
        const args = await readBody(req)
        // Resolved before the pool lease, so a session lookup never holds one.
        const scope = await o.resolveScope?.(url, req)
        const allow = await o.resolveAllow?.(url, req)
        const actor = await o.resolveActor?.(url, req)
        const result = await withDb(url, req, (adapter) =>
          callFn(fnKey, args, {
            adapter,
            manifest: o.manifest,
            scope,
            allow,
            actor,
            queueNotify: o.queueNotify,
            dryRun: url.searchParams.get('dryRun') === '1',
            idempotencyKey: (req.headers['idempotency-key'] as string | undefined) ?? null,
          }),
        )
        return json(res, 200, result)
      }

      if (o.theme) {
        const theme = await resolveTheme(url, req)
        if (!theme) {
          res.writeHead(404, { 'content-type': 'text/plain' })
          return res.end('not found')
        }
        const scope = o.pageScope ? await o.pageScope(url, req) : {}
        const html = bootstrapDocument(theme.renderRegion('layout', scope))
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end(html)
      }
      return json(res, 404, { code: 'E_NOT_FOUND', message: `no route for ${url.pathname}` })
    } catch (e) {
      // A streaming response has already sent its headers; there is no status code
      // left to send, so the only honest thing is to close the socket.
      if (res.headersSent) {
        if (!res.writableEnded) res.destroy(e as Error)
        return
      }
      if (e instanceof KetError) return json(res, e.code === 'E_PAYLOAD_TOO_LARGE' ? 413 : 400, e.toJSON())
      return json(res, 500, { code: 'E_INTERNAL', message: (e as Error).message })
    }
  })

  return {
    server,
    streams,
    listen(port = o.port ?? 3000): Promise<number> {
      return new Promise((resolve) =>
        server.listen(port, () => resolve((server.address() as { port: number }).port)),
      )
    },
    close(): Promise<void> {
      return new Promise((r) => server.close(() => r()))
    },
  }
}
