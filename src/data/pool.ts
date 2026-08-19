// One adapter per database, kept warm and bounded.
//
// This is where the Odoo model hurts most in practice: a database per tenant means
// connections multiply by tenant, and a Postgres cluster has a hard ceiling on them.
// So the pool caps how many databases stay open at once, evicts the least recently
// used, and refuses to close one that a request is still holding.

import type { Adapter } from '../types.ts'

export type PoolOptions = {
  create(key: string): Adapter
  /** How many databases may stay open at once. */
  max?: number
  /** Close an idle database after this long. */
  idleMs?: number
  now?: () => number
}

type Entry = { adapter: Adapter; leases: number; lastUsed: number; opening: Promise<void> | null }

export type AdapterPool = {
  acquire(key: string): Promise<Adapter>
  release(key: string): void
  with<T>(key: string, fn: (adapter: Adapter) => Promise<T>): Promise<T>
  evictIdle(): Promise<number>
  close(): Promise<void>
  readonly open: string[]
  readonly size: number
}

export function createAdapterPool(o: PoolOptions): AdapterPool {
  const max = o.max ?? 32
  const idleMs = o.idleMs ?? 5 * 60_000
  const now = o.now ?? (() => Date.now())
  const entries = new Map<string, Entry>()

  const evictOne = async (): Promise<boolean> => {
    let oldest: [string, Entry] | null = null
    for (const [k, e] of entries) {
      if (e.leases > 0) continue
      if (!oldest || e.lastUsed < oldest[1].lastUsed) oldest = [k, e]
    }
    if (!oldest) return false
    entries.delete(oldest[0])
    await oldest[1].adapter.close()
    return true
  }

  const acquire = async (key: string): Promise<Adapter> => {
    let e = entries.get(key)
    if (!e) {
      // Make room before opening, never after: the cap is on connections actually held.
      while (entries.size >= max) {
        if (!(await evictOne())) {
          throw new Error(`adapter pool is full (${entries.size}/${max}) and every database is in use`)
        }
      }
      const adapter = o.create(key)
      e = { adapter, leases: 0, lastUsed: now(), opening: null }
      entries.set(key, e)
      e.opening = adapter.open()
    }
    if (e.opening) { await e.opening; e.opening = null }
    e.leases++
    e.lastUsed = now()
    return e.adapter
  }

  const release = (key: string): void => {
    const e = entries.get(key)
    if (!e) return
    e.leases = Math.max(0, e.leases - 1)
    e.lastUsed = now()
  }

  return {
    acquire,
    release,
    async with(key, fn) {
      const adapter = await acquire(key)
      try { return await fn(adapter) } finally { release(key) }
    },
    async evictIdle() {
      const cutoff = now() - idleMs
      let n = 0
      for (const [k, e] of [...entries]) {
        if (e.leases > 0 || e.lastUsed > cutoff) continue
        entries.delete(k)
        await e.adapter.close()
        n++
      }
      return n
    },
    async close() {
      for (const [, e] of entries) await e.adapter.close()
      entries.clear()
    },
    get open() { return [...entries.keys()] },
    get size() { return entries.size },
  }
}
