import { createStreams } from '@ketvietlab/ketjs'
import type { Writer } from '@ketvietlab/ketjs'
import * as Y from 'yjs'

/**
 * Process-local by design, same as the SSE relay it feeds. A restart or a
 * second server instance loses the live doc and any un-flattened updates —
 * acceptable for now since Flow has no multi-instance deployment target yet
 * (see the plan's sequencing note); the durable snapshot on `flow.Issue`
 * always has the last flattened state to resume from.
 *
 * Every entry is keyed by company and issue, never by issue alone. Databases
 * and blob storage are per tenant while this map is per process, so an issue
 * id on its own is not a name that means one thing here — and a document
 * handed to the wrong company is the one mistake this module could make that
 * nobody would see. Sharing the key with the topic string keeps the two in
 * step. The residual limit is a subdomain-tenant deployment where two tenants
 * use the same company id: that pair would still share a document, which is
 * the same single-deployment assumption as the paragraph above.
 *
 * Deliberately I/O-free otherwise: `Ctx.storage` only exists on `JobContext`
 * (packages/ketjs/src/types.ts), not on the plain `Ctx` a `defineFn` handler
 * gets, and jobs can run in a separate worker process where this in-memory
 * map would not exist. So the actual bytes — reading a prior snapshot,
 * writing a flattened one — are the caller's job (routes.ts, which has
 * `ServeContext.storageOf`), and this module stays pure state + the stream
 * primitive.
 */
const streams = await createStreams()

/**
 * A stand-in for `streams.tail`'s own chunk type, which isn't exported from
 * ketjs's public entry — TypeScript refuses to emit a declaration file for
 * anything whose inferred type names an unexported type, so this wrapper
 * gives the relay loop in routes.ts an explicit, self-contained shape to
 * import instead of `streams` itself.
 */
export type StreamChunk = { seq: number; data: unknown }

export async function* tailTopic(
  topic: string,
  from: number,
  opts: { timeoutMs?: number } = {},
): AsyncGenerator<StreamChunk> {
  for await (const chunk of streams.tail(topic, from, opts)) yield { seq: chunk.seq, data: chunk.data }
}

type LiveDoc = { doc: Y.Doc; generation: number; updateCount: number; touchedAt: number }

const live = new Map<string, LiveDoc>()

const keyFor = (companyId: string, issueId: string): string => `${companyId}:${issueId}`

/**
 * One writer per topic, not one per request.
 *
 * `stream.ts` states the invariant plainly: "a stream has exactly one
 * producer, so the sequence number belongs to the writer". A writer opened
 * per `/push` reads `head()` at open time, so two editors typing at once both
 * read the same head and both write that sequence — survivable in the memory
 * store, a `PRIMARY KEY (topic, seq)` violation the moment anyone swaps in
 * `dbStreamStore`. Holding the writer keeps the sequence monotonic.
 */
const writers = new Map<string, Writer>()

export const FLATTEN_AFTER_UPDATES = 50

/** How long a doc with nothing un-flattened may sit in memory before it is dropped. */
export const EVICT_IDLE_MS = 30 * 60 * 1000

export const topicFor = (companyId: string, issueId: string, generation: number): string =>
  `flow:${keyFor(companyId, issueId)}:${generation}`

export const currentGeneration = (companyId: string, issueId: string): number =>
  live.get(keyFor(companyId, issueId))?.generation ?? 1

export const topicBelongsTo = (topic: string, companyId: string, issueId: string): boolean =>
  topic === topicFor(companyId, issueId, currentGeneration(companyId, issueId))

/** Whether this process holds the issue's document — i.e. whether it has been hydrated. */
export const isLive = (companyId: string, issueId: string): boolean => live.has(keyFor(companyId, issueId))

/** Creates an empty doc on first access; the caller seeds it via `applySnapshot`. */
export function getOrCreateLive(companyId: string, issueId: string): { doc: Y.Doc; isNew: boolean } {
  const key = keyFor(companyId, issueId)
  const existing = live.get(key)
  if (existing) {
    existing.touchedAt = Date.now()
    return { doc: existing.doc, isNew: false }
  }
  const doc = new Y.Doc()
  live.set(key, { doc, generation: 1, updateCount: 0, touchedAt: Date.now() })
  return { doc, isNew: true }
}

export function applySnapshot(companyId: string, issueId: string, bytes: Uint8Array): void {
  const entry = live.get(keyFor(companyId, issueId))
  if (entry) Y.applyUpdate(entry.doc, bytes)
}

/**
 * The live document's bytes, or `null` when this process has none.
 *
 * Null rather than an empty document on purpose. Returning
 * `Y.encodeStateAsUpdate(new Y.Doc())` for an issue nobody has opened here
 * reads as "this issue's description is empty", and the caller happily
 * persists that over the real one — which is exactly what a `/leave` beacon
 * arriving after a restart used to do. The absence of a document is not the
 * same fact as an empty document, so it gets its own value.
 */
export function snapshotBytes(companyId: string, issueId: string): Uint8Array | null {
  const entry = live.get(keyFor(companyId, issueId))
  return entry ? Y.encodeStateAsUpdate(entry.doc) : null
}

/**
 * Plain text out of a rich-text tree, for `Issue.previewText`.
 *
 * `Y.XmlText.prototype.toString()` is NOT plain text — it renders every
 * formatting attribute as a wrapping XML tag, so a bold run came out as
 * `Deploy <bold>the release</bold> on Friday` and landed in the list column
 * and the search index that way (`flow/search.ts` makes `previewText`
 * searchable). `toDelta()` is the projection that yields the characters the
 * user actually typed; editor-view.ts's own `plainTextOf` says the same
 * thing for the same reason.
 */
type Delta = Array<{ insert: string }>

function plainTextOf(node: Y.XmlFragment | Y.XmlElement | Y.XmlText): string {
  if (node instanceof Y.XmlText) return (node.toDelta() as Delta).map((op) => op.insert).join('')
  return node
    .toArray()
    .map((child) => plainTextOf(child as Y.XmlFragment | Y.XmlElement | Y.XmlText))
    .join(' ')
    .trim()
}

export function previewTextOf(companyId: string, issueId: string): string {
  const entry = live.get(keyFor(companyId, issueId))
  return entry ? plainTextOf(entry.doc.getXmlFragment('content')) : ''
}

const writerFor = async (topic: string): Promise<Writer> => {
  const held = writers.get(topic)
  if (held) return held
  const opened = await streams.open(topic)
  writers.set(topic, opened)
  return opened
}

/** Applies a client's update and reports whether the update-count threshold was crossed. */
export async function publishUpdate(
  companyId: string,
  issueId: string,
  updateBase64: string,
): Promise<{ shouldFlatten: boolean }> {
  const { doc } = getOrCreateLive(companyId, issueId)
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(updateBase64, 'base64')))
  const entry = live.get(keyFor(companyId, issueId))!
  entry.updateCount += 1
  entry.touchedAt = Date.now()
  const writer = await writerFor(topicFor(companyId, issueId, entry.generation))
  writer.write({ update: updateBase64 })
  await writer.flush()
  return { shouldFlatten: entry.updateCount >= FLATTEN_AFTER_UPDATES }
}

/** Ends the current topic and starts a fresh one — what keeps `ket_stream` bounded. */
export async function rollGeneration(companyId: string, issueId: string): Promise<void> {
  const entry = live.get(keyFor(companyId, issueId))
  if (!entry) return
  const topic = topicFor(companyId, issueId, entry.generation)
  await (await writerFor(topic)).end()
  writers.delete(topic)
  entry.generation += 1
  entry.updateCount = 0
  entry.touchedAt = Date.now()
}

/**
 * Drops idle documents and finished topics.
 *
 * Only a doc with nothing un-flattened is evicted: its durable snapshot is
 * already current, so the next reader hydrates back to the same state. A doc
 * still holding updates stays, however long it has been idle — evicting that
 * one would throw away the only copy.
 */
export function sweepLive(now = Date.now(), idleMs = EVICT_IDLE_MS): number {
  let dropped = 0
  for (const [key, entry] of live)
    if (entry.updateCount === 0 && now - entry.touchedAt >= idleMs) {
      live.delete(key)
      dropped++
    }
  return dropped
}

/**
 * Ended topics keep their chunks until somebody asks for them to go — the
 * memory store has no expiry of its own. Unref'd so it never holds the
 * process open.
 */
const sweeper = setInterval(() => {
  sweepLive()
  void streams.store.sweep(EVICT_IDLE_MS).catch(() => {})
}, 60_000)
sweeper.unref()
