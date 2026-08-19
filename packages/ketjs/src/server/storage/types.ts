import { KetError } from '../../kernel/errors.ts'

export type Stored = {
  key: string
  size: number
  type: string
  etag?: string
  modifiedAt?: string
}

export type Storage = {
  name: string
  put(key: string, body: AsyncIterable<Uint8Array>, options: { type: string; size?: number }): Promise<Stored>
  get(key: string): Promise<{ body: AsyncIterable<Uint8Array>; meta: Stored } | null>
  head(key: string): Promise<Stored | null>
  remove(key: string): Promise<void>
  list(
    prefix: string,
    options?: { after?: string; limit?: number },
  ): Promise<{ keys: string[]; next?: string }>
  signedUrl(key: string, options: { expiresIn: number }): Promise<string | null>
}

export type OpenStorage = (config: import('../config.ts').RuntimeConfig) => Storage | Promise<Storage>

export type StorageEffect = 'storage:read' | 'storage:write' | 'storage:remove'

/** Apply the same declared-effect boundary to blob I/O that Ctx applies to database I/O. */
export function effectStorage(storage: Storage, effects: readonly string[], operation: string): Storage {
  const need = (effect: StorageEffect): void => {
    if (effects.includes(effect)) return
    throw new KetError({
      code: 'E_EFFECT_NOT_DECLARED',
      message: `"${operation}" attempted ${effect} but declares effects [${effects.join(', ') || 'none'}]`,
      hint: `add "${effect}" to the job's effects, or stop performing that storage operation`,
    })
  }
  return {
    name: storage.name,
    put(key, body, options) {
      need('storage:write')
      return storage.put(key, body, options)
    },
    get(key) {
      need('storage:read')
      return storage.get(key)
    },
    head(key) {
      need('storage:read')
      return storage.head(key)
    },
    remove(key) {
      need('storage:remove')
      return storage.remove(key)
    },
    list(prefix, options) {
      need('storage:read')
      return storage.list(prefix, options)
    },
    signedUrl(key, options) {
      need('storage:read')
      return storage.signedUrl(key, options)
    },
  }
}

export const storageKey = (key: string): string => {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    key.endsWith('.ketmeta') ||
    key.includes('.ket-tmp-')
  )
    throw new Error(`unsafe storage key "${key}"`)
  return key
}

export function namespacedStorage(storage: Storage, namespace: string): Storage {
  const safe = storageKey(namespace)
  const prefix = `${safe}/`
  const keyOf = (key: string) => prefix + storageKey(key)
  const strip = (key: string) => key.slice(prefix.length)
  return {
    name: `${storage.name}:${safe}`,
    put: (key, body, options) => storage.put(keyOf(key), body, options).then((meta) => ({ ...meta, key })),
    async get(key) {
      const found = await storage.get(keyOf(key))
      return found ? { ...found, meta: { ...found.meta, key } } : null
    },
    async head(key) {
      const found = await storage.head(keyOf(key))
      return found ? { ...found, key } : null
    },
    remove: (key) => storage.remove(keyOf(key)),
    async list(wanted, options = {}) {
      const result = await storage.list(prefix + wanted, {
        ...options,
        ...(options.after ? { after: keyOf(options.after) } : {}),
      })
      return {
        keys: result.keys.map(strip),
        ...(result.next ? { next: strip(result.next) } : {}),
      }
    },
    signedUrl: (key, options) => storage.signedUrl(keyOf(key), options),
  }
}
