import { createStreams } from '@ketvietlab/ketjs'
import * as Y from 'yjs'

/**
 * Process-local by design, same as the SSE relay it feeds. A restart or a
 * second server instance loses the live doc and any un-flattened updates —
 * acceptable for now since Flow has no multi-instance deployment target yet
 * (see the plan's sequencing note); the durable snapshot on `flow.Issue`
 * always has the last flattened state to resume from.
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

type LiveDoc = { doc: Y.Doc; generation: number; updateCount: number }

const live = new Map<string, LiveDoc>()

export const FLATTEN_AFTER_UPDATES = 50

export const topicFor = (companyId: string, issueId: string, generation: number): string =>
  `flow:${companyId}:${issueId}:${generation}`

export const currentGeneration = (issueId: string): number => live.get(issueId)?.generation ?? 1

export const topicBelongsTo = (topic: string, companyId: string, issueId: string): boolean =>
  topic === topicFor(companyId, issueId, currentGeneration(issueId))

/** Creates an empty doc on first access; the caller seeds it via `applySnapshot`. */
export function getOrCreateLive(issueId: string): { doc: Y.Doc; isNew: boolean } {
  const existing = live.get(issueId)
  if (existing) return { doc: existing.doc, isNew: false }
  const doc = new Y.Doc()
  live.set(issueId, { doc, generation: 1, updateCount: 0 })
  return { doc, isNew: true }
}

export function applySnapshot(issueId: string, bytes: Uint8Array): void {
  const entry = live.get(issueId)
  if (entry) Y.applyUpdate(entry.doc, bytes)
}

export function snapshotBytes(issueId: string): Uint8Array {
  const entry = live.get(issueId)
  return Y.encodeStateAsUpdate(entry ? entry.doc : new Y.Doc())
}

/**
 * Plain text out of a rich-text tree, for `Issue.previewText` — walks
 * `Y.XmlText` leaves rather than `toString()`-ing the fragment, which would
 * include tag markup instead of the words a list/search screen wants.
 */
function plainTextOf(node: Y.XmlFragment | Y.XmlElement | Y.XmlText): string {
  if (node instanceof Y.XmlText) return node.toString()
  return node
    .toArray()
    .map((child) => plainTextOf(child as Y.XmlFragment | Y.XmlElement | Y.XmlText))
    .join(' ')
    .trim()
}

export function previewTextOf(issueId: string): string {
  const entry = live.get(issueId)
  return entry ? plainTextOf(entry.doc.getXmlFragment('content')) : ''
}

/** Applies a client's update and reports whether the update-count threshold was crossed. */
export async function publishUpdate(
  companyId: string,
  issueId: string,
  updateBase64: string,
): Promise<{ shouldFlatten: boolean }> {
  const { doc } = getOrCreateLive(issueId)
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(updateBase64, 'base64')))
  const entry = live.get(issueId)!
  entry.updateCount += 1
  const writer = await streams.open(topicFor(companyId, issueId, entry.generation))
  writer.write({ update: updateBase64 })
  await writer.flush()
  return { shouldFlatten: entry.updateCount >= FLATTEN_AFTER_UPDATES }
}

/** Ends the current topic and starts a fresh one — what keeps `ket_stream` bounded. */
export async function rollGeneration(companyId: string, issueId: string): Promise<void> {
  const entry = live.get(issueId)
  if (!entry) return
  const writer = await streams.open(topicFor(companyId, issueId, entry.generation))
  await writer.end()
  entry.generation += 1
  entry.updateCount = 0
}
