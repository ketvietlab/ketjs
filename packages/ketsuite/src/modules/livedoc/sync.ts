import { createStreams } from '@ketvietlab/ketjs'
import type { Writer } from '@ketvietlab/ketjs'
import * as Y from 'yjs'

/**
 * Process-local by design, same as the SSE relay it feeds. A restart or a
 * second server instance loses the live doc and any un-flattened updates —
 * acceptable for now since no deployment target here runs more than one
 * instance; the owner's durable snapshot always has the last flattened state
 * to resume from.
 *
 * Deliberately I/O-free otherwise: `Ctx.storage` only exists on `JobContext`
 * (packages/ketjs/src/types.ts), not on the plain `Ctx` a `defineFn` handler
 * gets, and jobs can run in a separate worker process where this in-memory
 * map would not exist. So the actual bytes — reading a prior snapshot,
 * writing a flattened one — are the caller's job (documents.ts, which has
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

type LiveDoc = {
  doc: Y.Doc
  generation: number
  updateCount: number
  touchedAt: number
  /**
   * Whether the durable snapshot has been read into this document.
   *
   * Separate from whether the registry has an entry, which is what hydration
   * used to test. `getOrCreateLive` publishes the entry before the snapshot is
   * fetched, so a storage read that failed — or one still in flight — left a
   * blank document that every later caller treated as fully loaded. The next
   * push then merged into nothing and flattened the result over the real
   * document.
   */
  hydrated: boolean
}

const live = new Map<string, LiveDoc>()

/**
 * Which document, exactly.
 *
 * All three parts are load-bearing and none may be dropped:
 *
 * `company`, because databases and blob storage are per tenant while this map
 * is per process — a document handed to the wrong company is the one mistake
 * this module could make that nobody would see. (The residual limit is a
 * subdomain-tenant deployment where two tenants share a company id; that pair
 * would still share a document, which is the same single-instance assumption
 * as above.)
 *
 * `kind`, because an id is only unique within its own model. A `flow.Issue`
 * and a `flow.Page` may carry the same uuid, and without the kind they would
 * be handed the same live document and the same topic.
 *
 * Sharing this shape with the topic string keeps the registry and the relay
 * in step by construction.
 */
export type DocRef = { company: string; kind: string; id: string }

const keyFor = (ref: DocRef): string => `${ref.company}:${ref.kind}:${ref.id}`

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
const writers = new Map<string, Promise<Writer>>()

export const FLATTEN_AFTER_UPDATES = 50

/** How long a doc with nothing un-flattened may sit in memory before it is dropped. */
export const EVICT_IDLE_MS = 30 * 60 * 1000

export const topicFor = (ref: DocRef, generation: number): string => `doc:${keyFor(ref)}:${generation}`

export const currentGeneration = (ref: DocRef): number => live.get(keyFor(ref))?.generation ?? 1

export const topicBelongsTo = (topic: string, ref: DocRef): boolean =>
  topic === topicFor(ref, currentGeneration(ref))

/** Whether this process holds the document — i.e. whether it has been hydrated. */
export const isLive = (ref: DocRef): boolean => live.has(keyFor(ref))

/** Creates an empty doc on first access; the caller seeds it via `applySnapshot`. */
export function getOrCreateLive(ref: DocRef): { doc: Y.Doc; isNew: boolean } {
  const key = keyFor(ref)
  const existing = live.get(key)
  if (existing) {
    existing.touchedAt = Date.now()
    return { doc: existing.doc, isNew: false }
  }
  const doc = new Y.Doc()
  live.set(key, { doc, generation: 1, updateCount: 0, touchedAt: Date.now(), hydrated: false })
  return { doc, isNew: true }
}

export function applySnapshot(ref: DocRef, bytes: Uint8Array): void {
  const entry = live.get(keyFor(ref))
  if (entry) Y.applyUpdate(entry.doc, bytes)
}

/** True once the durable snapshot has been read into this process's document. */
export const isHydrated = (ref: DocRef): boolean => live.get(keyFor(ref))?.hydrated === true

/** Marks the document as carrying whatever was stored for it. */
export const markHydrated = (ref: DocRef): void => {
  const entry = live.get(keyFor(ref))
  if (entry) entry.hydrated = true
}

/**
 * Drops a document this process could not load.
 *
 * Leaving the blank entry behind is what turned one unreadable blob into a
 * lost document: the failure was answered once, and every later request found
 * an entry and read it as loaded.
 */
export const forget = (ref: DocRef): void => {
  live.delete(keyFor(ref))
}

/**
 * The live document's bytes, or `null` when this process has none.
 *
 * Null rather than an empty document on purpose. Returning
 * `Y.encodeStateAsUpdate(new Y.Doc())` for a record nobody has opened here
 * reads as "this document is empty", and the caller happily persists that
 * over the real one — which is exactly what a `/leave` beacon arriving after
 * a restart used to do. The absence of a document is not the same fact as an
 * empty document, so it gets its own value.
 */
export function snapshotBytes(ref: DocRef): Uint8Array | null {
  const entry = live.get(keyFor(ref))
  return entry ? Y.encodeStateAsUpdate(entry.doc) : null
}

/**
 * Plain text out of a rich-text tree, for the owner's preview column.
 *
 * `Y.XmlText.prototype.toString()` is NOT plain text — it renders every
 * formatting attribute as a wrapping XML tag, so a bold run came out as
 * `Deploy <bold>the release</bold> on Friday` and landed in the list column
 * and the search index that way (`flow/search.ts` makes `previewText`
 * searchable). `toDelta()` is the projection that yields the characters the
 * user actually typed; live-doc-view.tsx's own `plainTextOf` says the same
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

export function previewTextOf(ref: DocRef): string {
  const entry = live.get(keyFor(ref))
  return entry ? plainTextOf(entry.doc.getXmlFragment('content')) : ''
}

/**
 * The pending open is what gets cached, not the opened writer.
 *
 * Caching the resolved writer left a gap across the `await`: two pushes for a
 * topic with no writer yet both saw nothing, both opened one, and the second
 * replaced the first in the map. `streams.open` reads the head once, so both
 * started at the same sequence — survivable in the memory store, a
 * `PRIMARY KEY (topic, seq)` violation the moment anyone swaps in
 * `dbStreamStore`, which is exactly what holding one writer per topic was
 * meant to prevent. A failed open is not cached, so the next caller retries.
 */
const writerFor = (topic: string): Promise<Writer> => {
  const held = writers.get(topic)
  if (held) return held
  const opening = streams.open(topic).catch((failed: unknown) => {
    writers.delete(topic)
    throw failed
  })
  writers.set(topic, opening)
  return opening
}

/** Applies a client's update and reports whether the update-count threshold was crossed. */
export async function publishUpdate(
  ref: DocRef,
  updateBase64: string,
): Promise<{ shouldFlatten: boolean }> {
  const { doc } = getOrCreateLive(ref)
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(updateBase64, 'base64')))
  const entry = live.get(keyFor(ref))!
  entry.updateCount += 1
  entry.touchedAt = Date.now()
  const writer = await writerFor(topicFor(ref, entry.generation))
  writer.write({ update: updateBase64 })
  await writer.flush()
  return { shouldFlatten: entry.updateCount >= FLATTEN_AFTER_UPDATES }
}

/**
 * Relays who is looking at a document, on the same topic as its edits.
 *
 * Deliberately not applied to the doc and deliberately not counted towards the
 * flatten threshold: presence is who is here *now*, and the moment it were
 * persisted it would outlive the person. The generation this rides on is
 * ended by the next flatten, which is what keeps these frames from
 * accumulating — so the client only announces while somebody is actually
 * working, since a room with viewers and no edits never rolls its topic.
 *
 * Nothing is published for a record this process holds no document for: there
 * is no topic to publish onto, and no reader to hear it.
 */
export async function publishPresence(ref: DocRef, presence: Record<string, unknown>): Promise<void> {
  const entry = live.get(keyFor(ref))
  if (!entry) return
  entry.touchedAt = Date.now()
  const writer = await writerFor(topicFor(ref, entry.generation))
  writer.write({ presence })
  await writer.flush()
}

/**
 * How many updates the document holds right now.
 *
 * Read before a flatten and handed back to `rollGeneration`, so an update that
 * arrives while the bytes are being written is not counted as flattened.
 */
export const updateCountOf = (ref: DocRef): number => live.get(keyFor(ref))?.updateCount ?? 0

/**
 * Ends the current topic and starts a fresh one — what keeps `ket_stream`
 * bounded — and forgets only the updates that were actually persisted.
 *
 * `flattened` is subtracted rather than the counter being reset, because
 * flattening is not instant: it captures the bytes, then awaits a blob write
 * and a commit. An update applied during that window is not in the snapshot,
 * and zeroing the counter told `sweepLive` the durable copy was current — so a
 * document holding an acknowledged edit became evictable, and the edit was
 * lost with it.
 */
export async function rollGeneration(ref: DocRef, flattened = Number.POSITIVE_INFINITY): Promise<void> {
  const entry = live.get(keyFor(ref))
  if (!entry) return
  const topic = topicFor(ref, entry.generation)
  await (await writerFor(topic)).end()
  writers.delete(topic)
  entry.generation += 1
  entry.updateCount = Math.max(0, entry.updateCount - flattened)
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
