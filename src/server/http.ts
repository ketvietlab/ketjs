// One server function, three surfaces: an HTTP endpoint, the typed client that
// calls it, and an agent tool descriptor — all read off the same manifest entry.

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { callFn } from './fn.ts'
import { createStreams, dbStreamStore, memoryStreamStore } from './stream.ts'
import type { StreamStore } from './stream.ts'
import { agentDescriptor } from '../agent/capabilities.ts'
import { KetError } from '../kernel/errors.ts'
import type { Adapter, Manifest } from '../types.ts'
import type { AdapterPool } from '../data/pool.ts'
import { KetError as KetErr } from '../kernel/errors.ts'
import type { ThemeRuntime } from '../theme/render.ts'

export type ServeOpts = {
  manifest: Manifest
  /** A single database. Use `pool` + `resolveDatastore` for one database per tenant. */
  adapter?: Adapter
  /** One database per tenant, resolved per request and leased from a bounded pool. */
  pool?: AdapterPool
  /**
   * Which database this request belongs to. Resolution happens exactly once, here,
   * because ctx is the only thing that touches data — so a request cannot end up
   * reading the wrong tenant by forgetting to pass something along.
   */
  resolveDatastore?: (url: URL, req: IncomingMessage) => string | null
  theme?: ThemeRuntime
  port?: number
  /** Defaults to a table on the app's adapter; swap for memory on a single instance. */
  streamStore?: StreamStore
  pageScope?: (url: URL) => Record<string, unknown>
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const s = JSON.stringify(body, null, 2)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(s)
}

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

export async function createKetServer(o: ServeOpts) {
  if (!o.adapter && !o.pool) throw new KetErr({ code: 'E_NO_DATABASE', message: 'createKetServer needs either an adapter or a pool' })
  if (o.pool && !o.resolveDatastore) throw new KetErr({ code: 'E_NO_RESOLVER', message: 'a pool needs resolveDatastore to know which database a request belongs to' })

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
  const streams = await createStreams(o.streamStore ?? (o.adapter ? dbStreamStore(o.adapter) : memoryStreamStore()))

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    try {
      if (url.pathname === '/_ket/manifest') return json(res, 200, o.manifest)
      if (url.pathname === '/_ket/agent') return json(res, 200, agentDescriptor(o.manifest))

      // Resumable stream: the client reconnects with ?from=<cursor> and gets
      // exactly what it missed, never a duplicate and never a gap.
      if (url.pathname.startsWith('/_ket/stream/')) {
        const id = url.pathname.slice('/_ket/stream/'.length)
        const from = Number(url.searchParams.get('from') ?? 0)
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        // A client that reloads mid-stream simply disappears. Stop tailing the
        // moment that happens: the durable log keeps the chunks, and the next
        // connection resumes from its cursor.
        let open = true
        const stop = () => { open = false }
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
        const args = await readBody(req)
        const result = await withDb(url, req, adapter => callFn(fnKey, args, {
          adapter,
          manifest: o.manifest,
          dryRun: url.searchParams.get('dryRun') === '1',
          idempotencyKey: req.headers['idempotency-key'] as string | undefined ?? null,
        }))
        return json(res, 200, result)
      }

      if (o.theme) {
        const scope = o.pageScope ? o.pageScope(url) : {}
        const html = o.theme.renderRegion('layout', scope)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end(html)
      }
      return json(res, 404, { code: 'E_NOT_FOUND', message: `no route for ${url.pathname}` })
    } catch (e) {
      // A streaming response has already sent its headers; there is no status code
      // left to send, so the only honest thing is to close the socket.
      if (res.headersSent) { if (!res.writableEnded) res.end(); return }
      if (e instanceof KetError) return json(res, 400, e.toJSON())
      return json(res, 500, { code: 'E_INTERNAL', message: (e as Error).message })
    }
  })

  return {
    server,
    streams,
    listen(port = o.port ?? 3000): Promise<number> {
      return new Promise(resolve => server.listen(port, () => resolve((server.address() as { port: number }).port)))
    },
    close(): Promise<void> { return new Promise(r => server.close(() => r())) },
  }
}
