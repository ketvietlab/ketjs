// One adapter per database, kept warm and bounded.
//
// This is where the domain contract model hurts most in practice: a database per tenant means
// connections multiply by tenant, and a Postgres cluster has a hard ceiling on them.
// So the pool caps how many databases stay open at once, evicts the least recently
// used, and refuses to close one that a request is still holding.

import type { Adapter } from '../types.ts'

export type PoolOptions = {
  /** Create a fresh adapter for this pool entry; the pool owns its open/close lifecycle. */
  create(key: string): Adapter | Promise<Adapter>
  /** How many databases may stay open at once. */
  max?: number
  /** Close an idle database after this long. */
  idleMs?: number
  now?: () => number
}

type Entry = { adapter: Adapter | null; leases: number; lastUsed: number; opening: Promise<void> | null }

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
  const closing = new Set<Entry>()
  let state: 'open' | 'closing' | 'closed' = 'open'
  let closePromise: Promise<void> | null = null
  const assertOpen = (): void => {
    if (state !== 'open') throw new Error('adapter pool is closed')
  }
  // Admission is separate from leasing an existing entry. Opening another
  // datastore may have to close an idle one first, and that closing connection
  // still consumes capacity until close() settles. Serializing this small path
  // keeps a later acquire from slipping into the temporarily empty Map slot.
  let admissionTail: Promise<void> = Promise.resolve()
  const withAdmission = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = admissionTail
    let release!: () => void
    admissionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }

  const evictOne = async (): Promise<boolean> => {
    let oldest: [string, Entry] | null = null
    for (const [k, e] of entries) {
      if (e.leases > 0 || e.opening || closing.has(e)) continue
      if (!oldest || e.lastUsed < oldest[1].lastUsed) oldest = [k, e]
    }
    if (!oldest) return false
    const [key, entry] = oldest
    closing.add(entry)
    try {
      await entry.adapter?.close()
    } finally {
      // Keep the tombstone visible to size/open until close has settled. The
      // admission lock keeps another datastore from claiming it meanwhile.
      if (entries.get(key) === entry) entries.delete(key)
      closing.delete(entry)
    }
    return true
  }

  const acquire = async (key: string): Promise<Adapter> => {
    assertOpen()
    let e = entries.get(key)
    if (e && closing.has(e)) e = undefined
    if (!e) {
      e = await withAdmission(async () => {
        assertOpen()
        // Another acquire for this key may have won admission while we waited.
        const admitted = entries.get(key)
        if (admitted) {
          // Eviction normally owns the admission lock for the whole close, so a
          // closing entry here would mean that lifecycle invariant was broken.
          // Never lease it even if a future close path forgets that invariant.
          if (closing.has(admitted))
            throw new Error(`adapter pool entry "${key}" is closing during admission`)
          return admitted
        }

        // Make room before opening, never after: the cap is on connections
        // actually held, including a victim whose close() is still in flight.
        while (entries.size >= max) {
          if (!(await evictOne())) {
            throw new Error(`adapter pool is full (${entries.size}/${max}) and every database is in use`)
          }
        }
        // close() marks the pool terminal before waiting for admission. An
        // acquire already queued here must not create an adapter after shutdown.
        assertOpen()

        const entry: Entry = { adapter: null, leases: 0, lastUsed: now(), opening: null }
        entries.set(key, entry)
        entry.opening = (async () => {
          const adapter = await o.create(key)
          entry.adapter = adapter
          try {
            await adapter.open()
          } catch (error) {
            await adapter.close().catch(() => {})
            entry.adapter = null
            throw error
          }
        })().catch((error) => {
          if (entries.get(key) === entry) entries.delete(key)
          throw error
        })
        return entry
      })
    }
    if (closing.has(e)) throw new Error(`adapter pool entry "${key}" is closing`)
    assertOpen()
    e.leases++
    const opening = e.opening
    if (opening) {
      try {
        await opening
      } catch (error) {
        e.leases = Math.max(0, e.leases - 1)
        throw error
      }
      if (e.opening === opening) e.opening = null
    }
    if (state !== 'open') {
      e.leases = Math.max(0, e.leases - 1)
      throw new Error('adapter pool is closed')
    }
    e.lastUsed = now()
    if (!e.adapter) throw new Error(`adapter pool failed to open "${key}"`)
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
      try {
        return await fn(adapter)
      } finally {
        release(key)
      }
    },
    evictIdle() {
      return withAdmission(async () => {
        const cutoff = now() - idleMs
        let n = 0
        for (const [k, e] of [...entries]) {
          if (e.leases > 0 || e.opening || closing.has(e) || e.lastUsed > cutoff) continue
          closing.add(e)
          try {
            await e.adapter?.close()
            n++
          } finally {
            if (entries.get(k) === e) entries.delete(k)
            closing.delete(e)
          }
        }
        return n
      })
    },
    close() {
      if (closePromise) return closePromise

      // Terminal state is visible synchronously. The actual drain is queued
      // behind admission so it cannot race an eviction or a new datastore.
      state = 'closing'
      closePromise = withAdmission(async () => {
        const errors: unknown[] = []
        for (const [key, e] of [...entries]) {
          closing.add(e)
          try {
            if (e.opening) await e.opening.catch(() => {})
            await e.adapter?.close()
          } catch (error) {
            errors.push(error)
          } finally {
            e.adapter = null
            e.opening = null
            if (entries.get(key) === e) entries.delete(key)
            closing.delete(e)
          }
        }
        entries.clear()
        if (errors.length === 1) throw errors[0]
        if (errors.length > 1) throw new AggregateError(errors, 'adapter pool failed to close')
      }).finally(() => {
        state = 'closed'
      })
      return closePromise
    },
    get open() {
      return [...entries.keys()]
    },
    get size() {
      return entries.size
    },
  }
}
