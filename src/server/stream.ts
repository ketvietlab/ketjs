// Resumable streams.
//
// A stream is a durable topic in the log, not an in-memory pipe. A client that
// reloads mid-generation reconnects with its cursor and receives exactly the chunks
// it missed — the case every AI app hits and no framework handles at this level.

import { createLog } from './log.ts'
import type { Adapter } from '../types.ts'

export type Chunk = { seq: number; data: unknown }
export type Since = { chunks: Chunk[]; done: boolean; summary: unknown; nextSeq: number }

export function createStreams(adapter: Adapter, o: { now?: () => string } = {}) {
  const log = createLog(adapter, o)

  const since = (id: string, fromSeq = 0): Since => {
    const entries = log.read(id, fromSeq)
    const chunks = entries.filter(e => e.kind === 'chunk').map(e => ({ seq: e.seq, data: e.data }))
    const end = entries.find(e => e.kind === 'end') ?? log.read(id, 0).find(e => e.kind === 'end')
    return { chunks, done: !!end, summary: end?.data ?? null, nextSeq: log.head(id) }
  }

  return {
    open(id: string): string { log.append(id, 'open', { id }); return id },
    write(id: string, chunk: unknown): number { return log.append(id, 'chunk', chunk) },
    end(id: string, summary: unknown = null): number { return log.append(id, 'end', summary) },
    since,
    async *tail(id: string, fromSeq = 0, opt: { pollMs?: number; timeoutMs?: number } = {}): AsyncGenerator<Chunk> {
      const pollMs = opt.pollMs ?? 10
      const timeoutMs = opt.timeoutMs ?? 10_000
      let cursor = fromSeq
      const started = Date.now()
      for (;;) {
        const s = since(id, cursor)
        for (const c of s.chunks) { cursor = c.seq + 1; yield c }
        if (s.done) return
        if (Date.now() - started > timeoutMs) throw new Error(`stream "${id}" timed out after ${timeoutMs}ms`)
        await new Promise(r => setTimeout(r, pollMs))
      }
    },
    _log: log,
  }
}

// The job queue is the same primitive with a different state machine.
export function createQueue(adapter: Adapter, o: { now?: () => string } = {}) {
  const log = createLog(adapter, o)
  return {
    enqueue(queue: string, payload: unknown): number { return log.append(queue, 'job', payload, 'ready') },
    claim(queue: string) { return log.claim(queue) },
    complete(queue: string, seq: number): void { log.setState(queue, seq, 'done') },
    fail(queue: string, seq: number): void { log.setState(queue, seq, 'failed') },
    pending(queue: string): number { return log.read(queue, 0).filter(e => e.state === 'ready').length },
  }
}
