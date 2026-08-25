// What a module has to say for one of its models to hold a live document.
//
// The split between here and the owner is not arbitrary. Effects are declared
// per function (`E_EFFECT_NOT_DECLARED` refuses an undeclared write), so a
// generic "record the flattened document" function living in this module could
// not write `flow.Issue` — it would have to declare `write:flow.Issue`, and
// then every model that ever holds a document would have to be listed here.
// So the owner supplies that one function, and everything that does not depend
// on which model it is — hydration, blob writing, permission gating, the topic
// — lives in this module and is written once.

import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { ServeContext } from '@ketvietlab/ketjs'
import {
  type DocRef,
  applySnapshot,
  forget,
  getOrCreateLive,
  isHydrated,
  markHydrated,
  previewTextOf,
  rollGeneration,
  snapshotBytes,
  updateCountOf,
} from './sync.ts'

/**
 * One model that may hold a live document.
 *
 * The two permission keys are separate on purpose. Gating writes on the read
 * function made the document the one piece of a module's data whose write path
 * was granted by a read permission: a role holding only `…get` and `…list`
 * could POST over any record's text. Permissions are per-function-key
 * (modules/user/roles.ts), so the fix is a key an administrator grants
 * deliberately.
 */
export type DocumentOwner = {
  /** Names this owner's documents in the topic, the live registry and the attachment. */
  kind: string
  /** Function key whose permission grants reading the document. Called with `{ id }`. */
  readFn: string
  /** Function key whose permission grants rewriting it. Called with `{ id }`. */
  writeFn: string
  /** Reads the stored-snapshot pointer off a row the read function returned. */
  attachmentOf: (row: Record<string, unknown>) => unknown
  /**
   * Function key that records a flattened document against the row, called
   * with `{ id, storeKey, checksum, size, previewText }`. The owner's, because
   * only the owner's module may declare the effect of writing its own model.
   */
  commitFn: string
}

const permitted = async (
  ctx: ServeContext,
  fn: string,
  url: URL,
  req: IncomingMessage,
  id: string,
): Promise<Record<string, unknown> | null> => {
  try {
    return (await ctx.call(fn, { id }, url, req)) as Record<string, unknown> | null
  } catch {
    return null
  }
}

/** The row, once the caller has passed the owner's read check — or null. */
export const readable = (
  ctx: ServeContext,
  owner: DocumentOwner,
  url: URL,
  req: IncomingMessage,
  id: string,
) => permitted(ctx, owner.readFn, url, req, id)

/** The same, for the routes that *change* the document. */
export const writable = (
  ctx: ServeContext,
  owner: DocumentOwner,
  url: URL,
  req: IncomingMessage,
  id: string,
) => permitted(ctx, owner.writeFn, url, req, id)

/**
 * Loads the durable snapshot into the live doc on first access.
 *
 * Every route that reads or writes the document calls this first. It used to
 * hang off `/content` alone, which meant a `/push` or a `/leave` arriving at a
 * process that had never opened the record — after a restart, or from a plain
 * `curl` — worked against a blank document and then persisted it.
 *
 * Returns false when the durable snapshot could not be read, so a caller that
 * is about to overwrite it can decline instead.
 */
export async function hydrate(
  ctx: ServeContext,
  url: URL,
  req: IncomingMessage,
  ref: DocRef,
  attachmentId: unknown,
): Promise<boolean> {
  getOrCreateLive(ref)
  // Whether the snapshot has been read, not whether the registry has an entry.
  // `getOrCreateLive` publishes the entry first, so testing for its presence
  // meant a failed or still-running load looked finished — see `hydrated`.
  if (isHydrated(ref)) return true
  // Unchecked, like the commit in `flatten` below and for the same reason:
  // these are `exposure: 'internal'` helpers of a route that has already run
  // its own permission check, and `ctx.call` would ask for a second grant
  // nobody has any reason to hold. It used to be a checked call, and it worked
  // only because the line above usually returns first — a reader-role viewer
  // opening a record this process had not already loaded got
  // `E_FN_NOT_PERMITTED` for a function they never named.
  const resolved = (await ctx.callUnchecked(
    'livedoc.sync.resolveSnapshotKey',
    { attachmentId },
    url,
    req,
  )) as { storeKey: string | null }
  // No stored snapshot is a genuine empty document, not a failure to read one.
  if (!resolved.storeKey) {
    markHydrated(ref)
    return true
  }
  const storage = await ctx.storageOf(url, req)
  const found = await storage.get(resolved.storeKey)
  // The blank document this process just created is dropped rather than kept:
  // a caller that retries has to actually retry, and one that gives up must
  // not leave something behind that later reads as the real document.
  if (!found) {
    forget(ref)
    return false
  }
  const chunks: Uint8Array[] = []
  try {
    for await (const chunk of found.body) chunks.push(chunk)
  } catch {
    forget(ref)
    return false
  }
  applySnapshot(ref, Buffer.concat(chunks))
  markHydrated(ref)
  return true
}

const singleChunk = async function* (bytes: Uint8Array) {
  yield bytes
}

/** Flattens the live doc, writes the bytes, and records the result — then rolls the topic. */
export async function flatten(
  ctx: ServeContext,
  owner: DocumentOwner,
  url: URL,
  req: IncomingMessage,
  ref: DocRef,
): Promise<void> {
  const bytes = snapshotBytes(ref)
  // Nothing to flatten is not the same as an empty document: persisting a
  // document this process does not hold would replace the real one with a
  // blank. See sync.ts's note on snapshotBytes.
  if (!bytes) return
  // Counted with the bytes, so an update that arrives while they are being
  // written is still owed a flatten afterwards.
  const flattened = updateCountOf(ref)
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const storeKey = `blobs/${ref.company}/${checksum.slice(0, 2)}/${checksum}`
  const storage = await ctx.storageOf(url, req)
  await storage.put(storeKey, singleChunk(bytes), { type: 'application/octet-stream', size: bytes.length })
  await ctx.callUnchecked(
    owner.commitFn,
    { id: ref.id, storeKey, checksum, size: bytes.length, previewText: previewTextOf(ref) },
    url,
    req,
  )
  await rollGeneration(ref, flattened)
}
