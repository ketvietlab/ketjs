import { createHash } from 'node:crypto'
import { json, streamed, text, withHeaders } from '@ketvietlab/ketjs'
import type { IncomingMessage } from 'node:http'
import type { Row, Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../backend/screen.ts'
import { issueScreen } from './screens.tsx'
import {
  applySnapshot,
  currentGeneration,
  getOrCreateLive,
  previewTextOf,
  publishUpdate,
  rollGeneration,
  snapshotBytes,
  tailTopic,
  topicBelongsTo,
  topicFor,
} from './sync.ts'

const encoder = new TextEncoder()
const MAX_BODY_BYTES = 2 * 1024 * 1024

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (!size) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const singleChunk = async function* (bytes: Uint8Array) {
  yield bytes
}

/** True once the caller has passed a real permission check for this issue. */
async function authorized(
  ctx: ServeContext,
  url: URL,
  req: IncomingMessage,
  issueId: string,
): Promise<Record<string, unknown> | null> {
  try {
    return (await ctx.call('flow.issue.get', { id: issueId }, url, req)) as Record<string, unknown> | null
  } catch {
    return null
  }
}

/** Loads the durable snapshot into the live doc on first access; a no-op after that. */
async function hydrate(
  ctx: ServeContext,
  url: URL,
  req: IncomingMessage,
  issueId: string,
  contentAttachmentId: unknown,
): Promise<void> {
  const { isNew } = getOrCreateLive(issueId)
  if (!isNew) return
  const resolved = (await ctx.call(
    'flow_backend.sync.resolveSnapshotKey',
    { attachmentId: contentAttachmentId },
    url,
    req,
  )) as { storeKey: string | null }
  if (!resolved.storeKey) return
  const storage = await ctx.storageOf(url, req)
  const found = await storage.get(resolved.storeKey)
  if (!found) return
  const chunks: Uint8Array[] = []
  for await (const chunk of found.body) chunks.push(chunk)
  applySnapshot(issueId, Buffer.concat(chunks))
}

/** Flattens the live doc, writes the bytes, and records the result — then rolls the topic. */
async function flatten(
  ctx: ServeContext,
  url: URL,
  req: IncomingMessage,
  companyId: string,
  issueId: string,
): Promise<void> {
  const bytes = snapshotBytes(issueId)
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const storeKey = `blobs/${companyId}/${checksum.slice(0, 2)}/${checksum}`
  const storage = await ctx.storageOf(url, req)
  await storage.put(storeKey, singleChunk(bytes), { type: 'application/octet-stream', size: bytes.length })
  await ctx.callUnchecked(
    'flow_backend.sync.commitContent',
    { issueId, storeKey, checksum, size: bytes.length, previewText: previewTextOf(issueId) },
    url,
    req,
  )
  await rollGeneration(companyId, issueId)
}

export const routes: Record<string, RouteEntry> = {
  '/admin/flow/issues/{id}/content':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const issueId = String(params.id)
      const issue = await authorized(ctx, url, req, issueId)
      if (!issue) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      if (!scope.company) return text('company scope required', { status: 400 })
      await hydrate(ctx, url, req, issueId, issue.contentAttachmentId)
      return json({
        snapshot: Buffer.from(snapshotBytes(issueId)).toString('base64'),
        topic: topicFor(scope.company, issueId, currentGeneration(issueId)),
      })
    },

  '/admin/flow/issues/{id}/push':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const issueId = String(params.id)
      if (!(await authorized(ctx, url, req, issueId))) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      if (!scope.company) return text('company scope required', { status: 400 })
      let body: Record<string, unknown>
      try {
        body = await readJsonBody(req)
      } catch {
        return text('bad request', { status: 400 })
      }
      const update = typeof body.update === 'string' ? body.update : ''
      if (!update) return text('bad request', { status: 400 })
      const { shouldFlatten } = await publishUpdate(scope.company, issueId, update)
      if (shouldFlatten) await flatten(ctx, url, req, scope.company, issueId)
      return json({ ok: true })
    },

  /**
   * The framework's own `/_ket/stream/:id` (packages/ketjs/src/server/http.ts)
   * has no auth check at all — fine for the short-lived generation logs it
   * was built for, wrong for a live document edit stream. This wraps the
   * same `streams.tail` primitive behind a real permission check instead of
   * reaching that public route directly.
   *
   * There is no server-side disconnect hook here on purpose: a client abort
   * does not reliably reach the route layer (verified against this same
   * `pipeline()`-backed response — even an aborted `fetch()` does not run an
   * async generator's `finally`, in-process or not), which is the same
   * reason real apps send an explicit "I'm leaving" beacon rather than
   * trust transport-level disconnect detection. `/leave` below is that
   * signal; flattening otherwise only happens on the update-count
   * threshold in `/push`.
   */
  '/admin/flow/issues/{id}/live':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const issueId = String(params.id)
      const topic = url.searchParams.get('topic') ?? ''
      const from = Number(url.searchParams.get('from') ?? 0)
      if (!(await authorized(ctx, url, req, issueId))) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      // A topic name that doesn't actually belong to this issue's current
      // generation is refused rather than relayed — otherwise a caller
      // authorized for issue A could pass issue B's topic string and
      // eavesdrop on edits it was never granted.
      if (!scope.company || !topicBelongsTo(topic, scope.company, issueId))
        return text('unknown topic', { status: 404 })

      async function* relay(): AsyncGenerator<Uint8Array> {
        for await (const chunk of tailTopic(topic, from, { timeoutMs: 30_000 })) {
          yield encoder.encode(`id: ${chunk.seq}\ndata: ${JSON.stringify(chunk.data)}\n\n`)
        }
        yield encoder.encode('event: done\ndata: {}\n\n')
      }

      return withHeaders(streamed(relay(), { type: 'text/event-stream' }), {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
    },

  /**
   * The explicit "I'm done editing" signal — the client calls this
   * (`navigator.sendBeacon` in Phase 4, so it fires reliably on tab close)
   * instead of relying on the SSE connection's own teardown. Flattening is
   * idempotent, so a duplicate or slightly-late beacon just re-persists the
   * same or a slightly newer state.
   */
  '/admin/flow/issues/{id}/leave':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const issueId = String(params.id)
      if (!(await authorized(ctx, url, req, issueId))) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      if (!scope.company) return text('company scope required', { status: 400 })
      await flatten(ctx, url, req, scope.company, issueId)
      return json({ ok: true })
    },

  '/admin/flow/issues/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const issueId = String(params.id)
      const issue = (await authorized(ctx, url, req, issueId)) as Row | null
      if (!issue) return text('not found', { status: 404 })
      const editor = await ctx.joint(url, req, 'flow_backend:screen.issue', { issueId })
      return adminPage(ctx, url, req, {
        title: String(issue.title),
        translate: false,
        body: (_, frame) => issueScreen(_, frame, String(issue.title), editor),
      })
    },
}
