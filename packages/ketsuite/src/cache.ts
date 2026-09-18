// A small cache abstraction shared across ketsuite modules, so an expensive,
// filter-scoped read (partner counts today, more later) can be cached once
// instead of every caller reimplementing TTL bookkeeping and picking a
// backend.
//
// ketsuite can run as more than one process — behind a load balancer, or as
// several pods — where a plain in-process Map is invisible to every process
// but the one that wrote it: a write on process A never invalidates the
// stale entry process B is still serving. Redis fixes that by sharing the
// cache the same way the database is already shared. Set REDIS_URL to use
// it; leave it unset (local dev, tests, a single-process deploy) and this
// falls back to an in-process Map with the same interface and behaviour.

import { Redis } from 'ioredis'

export type Cache = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs: number): Promise<void>
  /**
   * Drops every key starting with `prefix`. Every call site here
   * invalidates by clearing a whole namespace on write, rather than
   * tracking exactly which cached key a given write could affect.
   */
  clear(prefix: string): Promise<void>
}

export function memoryCache(o: { now?: () => number } = {}): Cache {
  const now = o.now ?? (() => Date.now())
  const rows = new Map<string, { value: string; expiresAt: number }>()
  return {
    async get(key) {
      const row = rows.get(key)
      if (!row) return null
      if (row.expiresAt <= now()) {
        rows.delete(key)
        return null
      }
      return row.value
    },
    async set(key, value, ttlMs) {
      rows.set(key, { value, expiresAt: now() + ttlMs })
    },
    async clear(prefix) {
      for (const key of rows.keys()) if (key.startsWith(prefix)) rows.delete(key)
    },
  }
}

export function redisCache(client: Redis): Cache {
  return {
    async get(key) {
      return client.get(key)
    },
    async set(key, value, ttlMs) {
      await client.set(key, value, 'PX', ttlMs)
    },
    async clear(prefix) {
      // SCAN rather than KEYS: this walks the keyspace in bounded chunks
      // instead of blocking a shared Redis for however large it has grown.
      let cursor = '0'
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200)
        if (keys.length) await client.del(...keys)
        cursor = next
      } while (cursor !== '0')
    },
  }
}

let shared: Cache | undefined
/**
 * The cache every module should share — one Redis connection (or one
 * in-memory Map) instead of each caller wiring its own. `REDIS_URL` decides
 * the backend; read once and memoised, since ioredis manages its own
 * reconnection and there is no reason to open a second connection.
 */
export const sharedCache = (): Cache => {
  if (!shared) shared = process.env.REDIS_URL ? redisCache(new Redis(process.env.REDIS_URL)) : memoryCache()
  return shared
}
