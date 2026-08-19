// Resumable streams.
//
// A stream has exactly one producer, so the sequence number belongs to the writer,
// not to the database. The old implementation read SELECT MAX(seq) before every
// single chunk — two round trips per token, plus a race it did not need to have.
// Now the sequence is recovered once when the writer opens, and never read again.
//
// Chunks are also batched: "resumable" means a reader never sees a gap or a
// duplicate, not that every token is its own transaction.

import { memoryStreamStore } from './streamstore.ts'
import type { StreamStore, SinceResult } from './streamstore.ts'

export type Chunk = { seq: number; data: unknown }
export type Since = { chunks: Chunk[]; done: boolean; summary: unknown; nextSeq: number }

export type StreamOptions = {
  store?: StreamStore
  /** Flush the buffer at least this often. Bounds how much a reader can replay. */
  flushMs?: number
  /** Flush early once this many chunks are buffered. */
  flushEvery?: number
}

export type Writer = {
  readonly id: string
  write(chunk: unknown): void
  flush(): Promise<void>
  end(summary?: unknown): Promise<void>
}

const expand = (r: SinceResult): Since => ({
  chunks: r.batches.flatMap(b => b.chunks.map((data, i) => ({ seq: b.seq + i / 1000, data }))),
  done: r.done,
  summary: r.summary,
  nextSeq: r.nextSeq,
})

export async function createStreams(store: StreamStore = memoryStreamStore(), o: StreamOptions = {}) {
  const flushMs = o.flushMs ?? 50
  const flushEvery = o.flushEvery ?? 32
  await store.init()

  return {
    store,

    async open(id: string): Promise<Writer> {
      // The only sequence read there is: once, at open, so a writer that restarts
      // mid-stream continues after what is already durable instead of overwriting it.
      let seq = await store.head(id)
      let buffer: unknown[] = []
      let timer: NodeJS.Timeout | null = null
      let chain: Promise<void> = Promise.resolve()

      const flushNow = (): Promise<void> => {
        if (timer) { clearTimeout(timer); timer = null }
        if (!buffer.length) return chain
        const batch = buffer
        const at = seq++
        buffer = []
        chain = chain.then(() => store.append(id, at, batch))
        return chain
      }

      return {
        id,
        write(chunk) {
          buffer.push(chunk)
          if (buffer.length >= flushEvery) { void flushNow(); return }
          timer ??= setTimeout(() => { void flushNow() }, flushMs)
        },
        flush: flushNow,
        async end(summary = null) {
          await flushNow()
          await store.markEnd(id, seq++, summary)
        },
      }
    },

    async since(id: string, fromSeq = 0): Promise<Since> {
      return expand(await store.since(id, Math.floor(fromSeq)))
    },

    /**
     * Live tail. A reader on the same instance is woken by the writer and never
     * polls; the slow poll is only a fallback for a writer on another instance.
     */
    async *tail(id: string, fromSeq = 0, opt: { pollMs?: number; timeoutMs?: number } = {}): AsyncGenerator<Chunk> {
      const pollMs = opt.pollMs ?? 250
      const timeoutMs = opt.timeoutMs ?? 30_000
      let cursor = Math.floor(fromSeq)
      const started = Date.now()

      let wake: (() => void) | null = null
      const unsubscribe = store.subscribe(id, () => { wake?.() })
      try {
        for (;;) {
          const s = expand(await store.since(id, cursor))
          if (s.chunks.length) cursor = Math.floor(s.chunks[s.chunks.length - 1]!.seq) + 1
          for (const c of s.chunks) yield c
          if (s.done) return
          if (Date.now() - started > timeoutMs) throw new Error(`stream "${id}" timed out after ${timeoutMs}ms`)
          await new Promise<void>(resolve => {
            const t = setTimeout(resolve, pollMs)
            wake = () => { clearTimeout(t); wake = null; resolve() }
          })
        }
      } finally {
        unsubscribe()
      }
    },

    /** Drop finished streams past their grace period. Nothing else expires them. */
    sweep(olderThanMs = 10 * 60_000): Promise<number> { return store.sweep(olderThanMs) },
  }
}

export type Streams = Awaited<ReturnType<typeof createStreams>>
export { memoryStreamStore, dbStreamStore } from './streamstore.ts'
export type { StreamStore } from './streamstore.ts'
