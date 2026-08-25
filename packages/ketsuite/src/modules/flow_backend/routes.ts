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
  isLive,
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

const permitted = async (
  ctx: ServeContext,
  fn: string,
  url: URL,
  req: IncomingMessage,
  issueId: string,
): Promise<Record<string, unknown> | null> => {
  try {
    return (await ctx.call(fn, { id: issueId }, url, req)) as Record<string, unknown> | null
  } catch {
    return null
  }
}

/** True once the caller has passed a read permission check for this issue. */
const readable = (ctx: ServeContext, url: URL, req: IncomingMessage, issueId: string) =>
  permitted(ctx, 'flow.issue.get', url, req, issueId)

/**
 * The same check for the routes that *change* the description.
 *
 * `/push` rewrites an issue's description and `/leave` persists that rewrite,
 * so gating them on `flow.issue.get` made the description the one piece of
 * Flow data whose write path was granted by a read permission: a role holding
 * only `flow.issue.get` and `flow.issue.list` could POST over any issue's
 * text. Permissions here are per-function-key (modules/user/roles.ts), so the
 * fix is a separate key an administrator grants deliberately.
 */
const writable = (ctx: ServeContext, url: URL, req: IncomingMessage, issueId: string) =>
  permitted(ctx, 'flow.issue.editDescription', url, req, issueId)

/**
 * Loads the durable snapshot into the live doc on first access.
 *
 * Every route that reads or writes the document calls this first. It used to
 * hang off `/content` alone, which meant a `/push` or a `/leave` arriving at a
 * process that had never opened the issue — after a restart, or from a plain
 * `curl` — worked against a blank document and then persisted it.
 *
 * Returns false when the durable snapshot could not be read, so a caller that
 * is about to overwrite it can decline instead.
 */
async function hydrate(
  ctx: ServeContext,
  url: URL,
  req: IncomingMessage,
  companyId: string,
  issueId: string,
  contentAttachmentId: unknown,
): Promise<boolean> {
  const { isNew } = getOrCreateLive(companyId, issueId)
  if (!isNew) return true
  const resolved = (await ctx.call(
    'flow_backend.sync.resolveSnapshotKey',
    { attachmentId: contentAttachmentId },
    url,
    req,
  )) as { storeKey: string | null }
  // No stored snapshot is a genuine empty description, not a failure to read one.
  if (!resolved.storeKey) return true
  const storage = await ctx.storageOf(url, req)
  const found = await storage.get(resolved.storeKey)
  if (!found) return false
  const chunks: Uint8Array[] = []
  for await (const chunk of found.body) chunks.push(chunk)
  applySnapshot(companyId, issueId, Buffer.concat(chunks))
  return true
}

/** Flattens the live doc, writes the bytes, and records the result — then rolls the topic. */
async function flatten(
  ctx: ServeContext,
  url: URL,
  req: IncomingMessage,
  companyId: string,
  issueId: string,
): Promise<void> {
  const bytes = snapshotBytes(companyId, issueId)
  // Nothing to flatten is not the same as an empty description: persisting a
  // document this process does not hold would replace the real one with a
  // blank. See sync.ts's note on snapshotBytes.
  if (!bytes) return
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const storeKey = `blobs/${companyId}/${checksum.slice(0, 2)}/${checksum}`
  const storage = await ctx.storageOf(url, req)
  await storage.put(storeKey, singleChunk(bytes), { type: 'application/octet-stream', size: bytes.length })
  await ctx.callUnchecked(
    'flow_backend.sync.commitContent',
    { issueId, storeKey, checksum, size: bytes.length, previewText: previewTextOf(companyId, issueId) },
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
      const issue = await readable(ctx, url, req, issueId)
      if (!issue) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      if (!scope.company) return text('company scope required', { status: 400 })
      if (!(await hydrate(ctx, url, req, scope.company, issueId, issue.contentAttachmentId)))
        return text('stored description could not be read', { status: 503 })
      return json({
        snapshot: Buffer.from(snapshotBytes(scope.company, issueId) ?? new Uint8Array()).toString('base64'),
        topic: topicFor(scope.company, issueId, currentGeneration(scope.company, issueId)),
      })
    },

  '/admin/flow/issues/{id}/push':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const issueId = String(params.id)
      const issue = await writable(ctx, url, req, issueId)
      if (!issue) return text('forbidden', { status: 403 })
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
      // Before the update is merged, not after: an incremental update applied
      // to a blank document keeps only what it carries.
      if (!(await hydrate(ctx, url, req, scope.company, issueId, issue.contentAttachmentId)))
        return text('stored description could not be read', { status: 503 })
      let shouldFlatten: boolean
      try {
        ;({ shouldFlatten } = await publishUpdate(scope.company, issueId, update))
      } catch {
        // A malformed update is the client's problem, not a 500.
        return text('bad request', { status: 400 })
      }
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
      if (!(await readable(ctx, url, req, issueId))) return text('forbidden', { status: 403 })
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
   * (`navigator.sendBeacon`, so it fires reliably on tab close) instead of
   * relying on the SSE connection's own teardown. Flattening is idempotent,
   * so a duplicate or slightly-late beacon just re-persists the same or a
   * slightly newer state.
   *
   * A beacon for a document this process never held is answered without
   * writing anything: it carries no state to save, and the old behaviour —
   * flatten whatever `live` returned — turned every post-restart tab close
   * into a silent wipe of the stored description.
   */
  '/admin/flow/issues/{id}/leave':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const issueId = String(params.id)
      if (!(await writable(ctx, url, req, issueId))) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      if (!scope.company) return text('company scope required', { status: 400 })
      if (!isLive(scope.company, issueId)) return json({ ok: true, flattened: false })
      await flatten(ctx, url, req, scope.company, issueId)
      return json({ ok: true, flattened: true })
    },

  '/admin/flow/issues/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const issueId = String(params.id)
      const issue = (await readable(ctx, url, req, issueId)) as Row | null
      if (!issue) return text('not found', { status: 404 })
      const editor = await ctx.joint(url, req, 'flow_backend:screen.issue', {
        issueId,
        lang: url.searchParams.get('lang') ?? '',
      })
      return adminPage(ctx, url, req, {
        title: String(issue.title),
        translate: false,
        body: (_, frame) => issueScreen(_, frame, String(issue.title), editor),
      })
    },
}
