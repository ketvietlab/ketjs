// Mirror: a server-state cache on signals.
//
// The browser holds a mirror of what a server answered, never the truth. Mirror keeps
// those answers by key, shares one request between readers, shows the last answer
// while it asks again, and forgets everything when the scope (user, organization,
// tenant) changes. It performs no I/O of its own: every load and write is a function
// the application passes in, so any HTTP, GraphQL or SDK transport works. Nothing
// loads, polls or listens before attach(), so a server render stays pure.
import type { ReadonlySignal } from './form.ts'
import { share } from './mirror-share.ts'
import { batch, computed, effect, signal, untracked } from './signal.ts'
import type { Signal } from './signal.ts'

/** A JSON key whose first element names the resource: `['orders', { status }]`. */
export type MirrorKey = readonly [string, ...unknown[]]
export type MirrorStatus = 'idle' | 'loading' | 'ready' | 'failed'

export type MirrorRetry = {
  /** Retries after the first attempt. */
  attempts: number
  /** Wait before retry `attempt` (0-based). Defaults to 500 ms doubling, capped at 30 s. */
  delayMs?: (attempt: number) => number
  /** Whether an error is worth another attempt. Defaults to every error. */
  when?: (error: unknown) => boolean
}

export type MirrorOptions = {
  /** Identity the cached data belongs to. A different value drops every entry. */
  scope?: () => string
  /** How long an answer stays fresh. Defaults to 0: stale as soon as it lands. */
  staleMs?: number
  /** How long an unobserved entry is kept. Defaults to five minutes. */
  gcMs?: number
  /** Retry policy for reads. Defaults to none. */
  retry?: MirrorRetry
  /** Refetch observed stale entries when the page becomes visible or the network returns. */
  refetchOn?: { focus?: boolean; reconnect?: boolean }
  /** Keep unchanged parts of a new answer by reference. Defaults to true. */
  structuralSharing?: boolean
}

export type MirrorLoadContext = { signal: AbortSignal }

export type MirrorReadOptions<K extends MirrorKey, T> = {
  /** Reactive key; null disables the read. */
  key: () => K | null
  load: (key: K, context: MirrorLoadContext) => Promise<unknown>
  /** Validates the payload. A throw is a failed load, never a cached value. */
  parse: (raw: unknown) => T
  tags?: (key: K) => readonly string[]
  staleMs?: number
  /** Refetch while observed and attached. */
  pollMs?: number
  /** Show the previous key's data until the new key has its own. */
  keepPrevious?: boolean
  structuralSharing?: boolean
}

export type MirrorReading<T> = {
  data: ReadonlySignal<T | undefined>
  status: ReadonlySignal<MirrorStatus>
  /** A load for the current key is in flight, including a background refetch. */
  fetching: ReadonlySignal<boolean>
  stale: ReadonlySignal<boolean>
  /** data() belongs to the previous key (keepPrevious). */
  previous: ReadonlySignal<boolean>
  error: ReadonlySignal<unknown>
  updatedAt: ReadonlySignal<number | null>
  /** Load the current key again, superseding a load in flight. */
  refetch(): Promise<void>
  /** Resolves when the current key has no load in flight. */
  settled(): Promise<void>
  dispose(): void
}

export type MirrorPagesOptions<K extends MirrorKey, C, P> = Omit<
  MirrorReadOptions<K, P>,
  'load' | 'parse'
> & {
  /** The first page is loaded with a null cursor. */
  load: (key: K, cursor: C | null, context: MirrorLoadContext) => Promise<unknown>
  parse: (raw: unknown) => P
  /** The cursor after `last`, or null when there is no further page. */
  next: (last: P, pages: readonly P[]) => C | null | undefined
}

export type MirrorPaging<P> = MirrorReading<readonly P[]> & {
  more: ReadonlySignal<boolean>
  loadingMore: ReadonlySignal<boolean>
  loadMore(): Promise<void>
}

export type MirrorPatch = {
  /** Replace a cached value; skipped when the key has no entry. */
  update<T>(key: MirrorKey, fn: (current: T | undefined) => T): void
}

export type MirrorWriteContext = {
  signal: AbortSignal
  /** Stable across retries of one run(); send it as an Idempotency-Key header. */
  idempotencyKey: string
}

export type MirrorWriteOptions<I, R> = {
  run: (input: I, context: MirrorWriteContext) => Promise<R>
  /** Tags whose entries are stale after success; observed ones reload. */
  invalidates?: (input: I, result: R) => readonly string[]
  /** Patch cached entries before run(); rolled back if it fails. */
  optimistic?: (cache: MirrorPatch, input: I) => void
  /** exclusive (default) rejects a run while one is pending; queue runs them in order. */
  concurrency?: 'exclusive' | 'queue'
  retry?: MirrorRetry
}

export type MirrorWriteOutcome<R> =
  | { status: 'done'; value: R }
  | { status: 'failed'; error: unknown; rolledBack: boolean }
  | { status: 'rejected' }
  | { status: 'aborted' }

export type MirrorWriting<I, R> = {
  run(input: I): Promise<MirrorWriteOutcome<R>>
  pending: ReadonlySignal<boolean>
  error: ReadonlySignal<unknown>
  /** Abort runs in flight; their outcome is 'aborted'. */
  dispose(): void
}

export type MirrorSnapshotEntry = {
  key: MirrorKey
  data: unknown
  updatedAt: number | null
  tags: readonly string[]
  cursors?: readonly unknown[]
}

/** JSON handoff of cached answers, for example from a server render to the browser. */
export type MirrorSnapshot = { version: 1; scope: string; entries: MirrorSnapshotEntry[] }

/** A tag, or a predicate over an entry's tags and key. */
export type MirrorMatch = string | ((tags: readonly string[], key: MirrorKey) => boolean)

export type MirrorPrefetchOptions<K extends MirrorKey, T> = Omit<
  MirrorReadOptions<K, T>,
  'key' | 'keepPrevious' | 'pollMs'
> & { key: K }

export type Mirror = {
  read<K extends MirrorKey, T>(options: MirrorReadOptions<K, T>): MirrorReading<T>
  pages<K extends MirrorKey, C, P>(options: MirrorPagesOptions<K, C, P>): MirrorPaging<P>
  write<I, R>(options: MirrorWriteOptions<I, R>): MirrorWriting<I, R>
  /** Mark matching entries stale; observed ones reload while attached. */
  invalidate(match: MirrorMatch): Promise<void>
  /** Load a key now, attached or not; for server renders and route preloading. */
  prefetch<K extends MirrorKey, T>(options: MirrorPrefetchOptions<K, T>): Promise<void>
  peek<T>(key: MirrorKey): T | undefined
  /** Store an answer the application already holds. It is trusted, not parsed. */
  seed<T>(key: MirrorKey, value: T, options?: { updatedAt?: number; tags?: readonly string[] }): void
  snapshot(): MirrorSnapshot
  /** Adopt a snapshot taken in the same scope; its data is parsed by the read that binds it. */
  restore(snapshot: MirrorSnapshot): number
  /** Start loading, polling, refetch listeners and GC until lifetime aborts. */
  attach(lifetime: AbortSignal): void
  readonly attached: ReadonlySignal<boolean>
  dispose(): void
}

type Timer = ReturnType<typeof setTimeout>

type PagesState = {
  cursors: unknown[]
  next: (last: unknown, pages: readonly unknown[]) => unknown
  loadPage: (cursor: unknown, signal: AbortSignal) => Promise<unknown>
  parsePage: (raw: unknown) => unknown
}

type Entry = {
  key: MirrorKey
  hash: string
  kind: 'read' | 'pages' | null
  data: Signal<unknown>
  error: Signal<unknown>
  status: Signal<MirrorStatus>
  fetching: Signal<boolean>
  stale: Signal<boolean>
  updatedAt: Signal<number | null>
  tags: readonly string[]
  observers: number
  load: ((signal: AbortSignal) => Promise<unknown>) | null
  parse: ((raw: unknown) => unknown) | null
  pages: PagesState | null
  restored: { data: unknown; updatedAt: number | null; cursors?: readonly unknown[] } | null
  staleMs: number
  sharing: boolean
  inflight: { promise: Promise<void>; controller: AbortController } | null
  staleTimer: Timer | null
  gcTimer: Timer | null
  /** Changes on every write to data, even one that keeps the same reference. */
  revision: number
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

function canonical(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item, i) => canonical(item, `${path}[${i}]`))
  if (isPlain(value)) {
    const out: Record<string, unknown> = {}
    for (const name of Object.keys(value).sort()) {
      if (value[name] !== undefined) out[name] = canonical(value[name], `${path}.${name}`)
    }
    return out
  }
  throw new TypeError(`A Mirror key holds JSON values only; ${path} is not one`)
}

/** Object keys are sorted, so `{ a, b }` and `{ b, a }` name the same entry. */
function hashKey(key: MirrorKey): string {
  if (!Array.isArray(key) || typeof key[0] !== 'string')
    throw new TypeError('A Mirror key is an array whose first element names the resource')
  return JSON.stringify(canonical(key, 'key'))
}

const later = (fn: () => void, ms: number): Timer => {
  const timer = setTimeout(fn, ms)
  ;(timer as { unref?: () => void }).unref?.()
  return timer
}

const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = later(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })

const shouldRetry = (
  policy: MirrorRetry | undefined,
  error: unknown,
  attempt: number,
): policy is MirrorRetry => !!policy && attempt < policy.attempts && (policy.when ?? (() => true))(error)

const retryDelay = (policy: MirrorRetry, attempt: number): number =>
  (policy.delayMs ?? ((n) => Math.min(30_000, 500 * 2 ** n)))(attempt)

// randomUUID exists only in secure contexts; getRandomValues exists everywhere.
function newIdempotencyKey(): string {
  const crypto = globalThis.crypto
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

type Undo = {
  entry: Entry
  before: { data: unknown; status: MirrorStatus; revision: number }
  revision: number
}

export function createMirror(options: MirrorOptions = {}): Mirror {
  const defaultStaleMs = options.staleMs ?? 0
  const gcMs = options.gcMs ?? 300_000
  const defaultSharing = options.structuralSharing ?? true
  const scopeOf = options.scope ?? (() => '')
  const entries = new Map<string, Entry>()
  const attached = signal(false)
  const writeControllers = new Set<AbortController>()
  let listeners: AbortController | null = null
  let activeScope: string | null = null
  let disposed = false
  let revisions = 0

  const clearTimers = (entry: Entry) => {
    if (entry.staleTimer) clearTimeout(entry.staleTimer)
    if (entry.gcTimer) clearTimeout(entry.gcTimer)
    entry.staleTimer = entry.gcTimer = null
  }

  const forget = (entry: Entry) => {
    entry.inflight?.controller.abort()
    entry.inflight = null
    clearTimers(entry)
  }

  // A different scope never sees the previous one's data: drop it all, loads included.
  const enterScope = (scope: string) => {
    if (activeScope !== null && activeScope !== scope) {
      for (const entry of entries.values()) forget(entry)
      entries.clear()
    }
    activeScope = scope
  }

  const entryFor = (key: MirrorKey, scope: string): Entry => {
    const hash = hashKey(key)
    enterScope(scope)
    let entry = entries.get(hash)
    if (!entry) {
      entry = {
        key,
        hash,
        kind: null,
        data: signal<unknown>(undefined),
        error: signal<unknown>(null),
        status: signal<MirrorStatus>('idle'),
        fetching: signal(false),
        stale: signal(false),
        updatedAt: signal<number | null>(null),
        tags: [],
        observers: 0,
        load: null,
        parse: null,
        pages: null,
        restored: null,
        staleMs: defaultStaleMs,
        sharing: defaultSharing,
        inflight: null,
        staleTimer: null,
        gcTimer: null,
        revision: 0,
      }
      entries.set(hash, entry)
    }
    return entry
  }

  const isStale = (entry: Entry): boolean => {
    const at = entry.updatedAt.peek()
    return entry.stale.peek() || at === null || Date.now() - at >= entry.staleMs
  }

  const needsLoad = (entry: Entry): boolean =>
    !entry.inflight && !!entry.load && (entry.data.peek() === undefined || isStale(entry))

  const scheduleStale = (entry: Entry) => {
    if (entry.staleTimer) clearTimeout(entry.staleTimer)
    entry.staleTimer = null
    const at = entry.updatedAt.peek()
    if (!attached.peek() || at === null || entry.stale.peek() || !Number.isFinite(entry.staleMs)) return
    const remaining = entry.staleMs - (Date.now() - at)
    if (remaining <= 0) entry.stale.set(true)
    else
      entry.staleTimer = later(() => {
        entry.staleTimer = null
        entry.stale.set(true)
      }, remaining)
  }

  const scheduleGc = (entry: Entry) => {
    if (entry.gcTimer) clearTimeout(entry.gcTimer)
    entry.gcTimer = null
    if (!attached.peek() || entry.observers > 0 || !Number.isFinite(gcMs)) return
    if (entries.get(entry.hash) !== entry) return
    entry.gcTimer = later(() => {
      entry.gcTimer = null
      if (entry.observers > 0 || entries.get(entry.hash) !== entry) return
      forget(entry)
      entries.delete(entry.hash)
    }, gcMs)
  }

  const retain = (entry: Entry) => {
    entry.observers++
    if (entry.gcTimer) clearTimeout(entry.gcTimer)
    entry.gcTimer = null
  }

  const release = (entry: Entry) => {
    entry.observers = Math.max(0, entry.observers - 1)
    if (entry.observers === 0) scheduleGc(entry)
  }

  const commit = (entry: Entry, value: unknown, updatedAt = Date.now()) => {
    // A confirmed answer is a new revision even when sharing keeps the same reference.
    entry.revision = ++revisions
    batch(() => {
      entry.data.set(entry.sharing ? share(entry.data.peek(), value) : value)
      entry.error.set(null)
      entry.status.set('ready')
      entry.fetching.set(false)
      entry.updatedAt.set(updatedAt)
      entry.stale.set(entry.staleMs <= 0 || Date.now() - updatedAt >= entry.staleMs)
    })
    scheduleStale(entry)
  }

  const fail = (entry: Entry, error: unknown) =>
    batch(() => {
      entry.error.set(error)
      entry.status.set('failed')
      entry.fetching.set(false)
    })

  // One load per entry at a time; force supersedes the one in flight (latest wins).
  const loadEntry = (entry: Entry, force: boolean): Promise<void> => {
    const load = entry.load
    const parse = entry.parse
    if (disposed || !load) return Promise.resolve()
    if (entry.inflight && !force) return entry.inflight.promise
    entry.inflight?.controller.abort()
    const controller = new AbortController()
    batch(() => {
      entry.fetching.set(true)
      if (entry.data.peek() === undefined) entry.status.set('loading')
    })
    const attempt = async (): Promise<void> => {
      // Application code starts on the next microtask, outside any binding effect.
      await undefined
      for (let n = 0; ; n++) {
        try {
          const raw = await load(controller.signal)
          if (controller.signal.aborted) return
          commit(entry, parse ? parse(raw) : raw)
          return
        } catch (error) {
          if (controller.signal.aborted) return
          if (shouldRetry(options.retry, error, n)) {
            await pause(retryDelay(options.retry, n), controller.signal)
            if (controller.signal.aborted) return
            continue
          }
          fail(entry, error)
          return
        }
      }
    }
    const inflight = { controller, promise: Promise.resolve() }
    inflight.promise = attempt().finally(() => {
      if (entry.inflight === inflight) entry.inflight = null
    })
    entry.inflight = inflight
    return inflight.promise
  }

  // Restored data is parsed by the first read that binds it; a failure means "load it".
  const applyRestored = (entry: Entry) => {
    const restored = entry.restored
    if (!restored) return
    let value: unknown
    try {
      if (entry.kind === 'pages' && entry.pages) {
        if (!Array.isArray(restored.data)) throw new TypeError('restored pages are not an array')
        value = restored.data.map(entry.pages.parsePage)
      } else if (entry.parse) value = entry.parse(restored.data)
      else return
    } catch {
      entry.restored = null
      return
    }
    entry.restored = null
    if (entry.pages) entry.pages.cursors = [...(restored.cursors ?? [])]
    commit(entry, value, restored.updatedAt ?? Date.now())
  }

  const claim = (entry: Entry, kind: 'read' | 'pages') => {
    if (entry.kind && entry.kind !== kind)
      throw new TypeError(`The Mirror key ${entry.hash} is used by both read() and pages()`)
    entry.kind = kind
  }

  const configureRead = <K extends MirrorKey, T>(
    entry: Entry,
    key: K,
    opts: Omit<MirrorReadOptions<K, T>, 'key'>,
  ) => {
    claim(entry, 'read')
    entry.load = (signal) => opts.load(key, { signal })
    entry.parse = opts.parse
    if (opts.tags) entry.tags = opts.tags(key)
    entry.staleMs = opts.staleMs ?? defaultStaleMs
    entry.sharing = opts.structuralSharing ?? defaultSharing
    applyRestored(entry)
  }

  const configurePages = <K extends MirrorKey, C, P>(
    entry: Entry,
    key: K,
    opts: MirrorPagesOptions<K, C, P>,
  ) => {
    claim(entry, 'pages')
    const state: PagesState = entry.pages ?? {
      cursors: [],
      next: () => null,
      loadPage: () => Promise.resolve(undefined),
      parsePage: (raw) => raw,
    }
    state.next = opts.next as PagesState['next']
    state.parsePage = opts.parse
    state.loadPage = (cursor, signal) => opts.load(key, cursor as C | null, { signal })
    entry.pages = state
    // A refetch reloads as many pages as are loaded now, following next() again.
    entry.load = async (signal) => {
      const pages: unknown[] = []
      const cursors: unknown[] = []
      const wanted = Math.max(1, state.cursors.length)
      let cursor: unknown = null
      for (let i = 0; i < wanted; i++) {
        const page = state.parsePage(await state.loadPage(cursor, signal))
        pages.push(page)
        cursors.push(cursor)
        const after = state.next(page, pages)
        if (after === null || after === undefined) break
        cursor = after
      }
      return { pages, cursors }
    }
    entry.parse = (raw) => {
      const loaded = raw as { pages: unknown[]; cursors: unknown[] }
      state.cursors = loaded.cursors
      return loaded.pages
    }
    if (opts.tags) entry.tags = opts.tags(key)
    entry.staleMs = opts.staleMs ?? defaultStaleMs
    entry.sharing = opts.structuralSharing ?? defaultSharing
    applyRestored(entry)
  }

  type Observer = {
    current: Signal<Entry | null>
    reading: MirrorReading<unknown>
    bound: () => Entry | null
  }

  const observe = <K extends MirrorKey>(
    keyOf: () => K | null,
    configure: (entry: Entry, key: K) => void,
    keepPrevious: boolean,
    pollMs: number | undefined,
  ): Observer => {
    const current = signal<Entry | null>(null)
    const previousEntry = signal<Entry | null>(null)
    let bound: Entry | null = null
    let boundScope: string | null = null
    let closed = false
    const stopBinding = effect(() => {
      const key = keyOf()
      const scope = scopeOf()
      const live = attached()
      untracked(() => {
        if (closed) return
        if (disposed) {
          if (bound) release(bound)
          bound = null
          current.set(null)
          previousEntry.set(null)
          return
        }
        const scopeChanged = boundScope !== null && boundScope !== scope
        boundScope = scope
        if (scopeChanged) previousEntry.set(null)
        // Before the key: signing out can turn the key null in the same write that changes the scope.
        enterScope(scope)
        const next = key ? entryFor(key, scope) : null
        if (next !== bound) {
          if (bound) {
            if (keepPrevious && !scopeChanged && bound.data.peek() !== undefined) previousEntry.set(bound)
            release(bound)
          }
          bound = next
          if (next && key) {
            configure(next, key)
            retain(next)
          }
          current.set(next)
        }
        if (next && live && needsLoad(next)) void loadEntry(next, false)
      })
    })
    const stopPolling =
      pollMs && pollMs > 0
        ? effect(() => {
            const entry = current()
            if (!entry || !attached()) return
            const timer = setInterval(() => {
              if (!entry.inflight) void loadEntry(entry, false)
            }, pollMs)
            ;(timer as { unref?: () => void }).unref?.()
            return () => clearInterval(timer)
          })
        : null
    const data = computed(() => {
      const value = current()?.data()
      return value !== undefined || !keepPrevious ? value : previousEntry()?.data()
    })
    const previous = computed(
      () => keepPrevious && current()?.data() === undefined && previousEntry()?.data() !== undefined,
    )
    const status = computed<MirrorStatus>(() => current()?.status() ?? 'idle')
    const fetching = computed(() => current()?.fetching() ?? false)
    const stale = computed(() => current()?.stale() ?? false)
    const error = computed(() => current()?.error() ?? null)
    const updatedAt = computed(() => current()?.updatedAt() ?? null)
    const derived = [data, previous, status, fetching, stale, error, updatedAt]
    const reading: MirrorReading<unknown> = {
      data,
      status,
      fetching,
      stale,
      previous,
      error,
      updatedAt,
      refetch: () => (bound && !disposed && !closed ? loadEntry(bound, true) : Promise.resolve()),
      settled: async () => {
        while (bound?.inflight) await bound.inflight.promise
      },
      dispose: () => {
        if (closed) return
        closed = true
        stopBinding()
        stopPolling?.()
        for (const signal of derived) signal.dispose()
        if (bound) release(bound)
        bound = null
      },
    }
    return { current, reading, bound: () => bound }
  }

  const patchFor = (undo: Undo[]): MirrorPatch => ({
    update(key, fn) {
      const hash = hashKey(key)
      enterScope(untracked(scopeOf))
      const entry = entries.get(hash)
      if (!entry) return
      // A load in flight would land on top of the optimistic value.
      entry.inflight?.controller.abort()
      entry.inflight = null
      const before = { data: entry.data.peek(), status: entry.status.peek(), revision: entry.revision }
      const after = fn(before.data as never)
      entry.revision = ++revisions
      undo.push({ entry, before, revision: entry.revision })
      entry.data.set(after)
      entry.fetching.set(false)
      entry.stale.set(true)
      if (after !== undefined) entry.status.set('ready')
    },
  })

  // Restore what this write patched, unless something newer already replaced it. The
  // revision, not the reference, decides: an answer equal to the patch shares its reference.
  const rollback = (undo: Undo[]): boolean => {
    let rolledBack = false
    batch(() => {
      for (const step of [...undo].reverse()) {
        if (step.entry.revision !== step.revision) continue
        step.entry.data.set(step.before.data)
        step.entry.status.set(step.before.status)
        step.entry.revision = step.before.revision
        rolledBack = true
      }
    })
    return rolledBack
  }

  // An aborted write has an unknown outcome: ask the server instead of guessing.
  const reloadPatched = (undo: Undo[]) => {
    for (const { entry } of undo) if (entry.observers > 0 && attached.peek()) void loadEntry(entry, true)
  }

  const invalidate = (match: MirrorMatch): Promise<void> => {
    if (disposed) return Promise.resolve()
    enterScope(untracked(scopeOf))
    const loads: Promise<void>[] = []
    batch(() => {
      for (const entry of entries.values()) {
        const hit = typeof match === 'string' ? entry.tags.includes(match) : match(entry.tags, entry.key)
        if (!hit) continue
        entry.stale.set(true)
        if (entry.observers > 0 && attached.peek()) loads.push(loadEntry(entry, true))
      }
    })
    return Promise.all(loads).then(() => undefined)
  }

  const detach = () => {
    listeners?.abort()
    listeners = null
    batch(() => {
      for (const entry of entries.values()) {
        clearTimers(entry)
        if (!entry.inflight) continue
        entry.inflight.controller.abort()
        entry.inflight = null
        entry.fetching.set(false)
        if (entry.data.peek() === undefined) entry.status.set('idle')
      }
      attached.set(false)
    })
  }

  const refetchObserved = () => {
    for (const entry of entries.values())
      if (entry.observers > 0 && needsLoad(entry)) void loadEntry(entry, false)
  }

  return {
    attached,

    read<K extends MirrorKey, T>(opts: MirrorReadOptions<K, T>): MirrorReading<T> {
      if (disposed) throw new Error('This Mirror is disposed')
      if (typeof opts.parse !== 'function')
        throw new TypeError('A Mirror read needs parse(): validate the payload where it enters')
      return observe(
        opts.key,
        (entry, key) => configureRead(entry, key, opts),
        !!opts.keepPrevious,
        opts.pollMs,
      ).reading as MirrorReading<T>
    },

    pages<K extends MirrorKey, C, P>(opts: MirrorPagesOptions<K, C, P>): MirrorPaging<P> {
      if (disposed) throw new Error('This Mirror is disposed')
      if (typeof opts.parse !== 'function')
        throw new TypeError('Mirror pages need parse(): validate each page where it enters')
      const loadingMore = signal(false)
      const observer = observe(
        opts.key,
        (entry, key) => configurePages(entry, key, opts),
        !!opts.keepPrevious,
        opts.pollMs,
      )
      const reading = observer.reading as MirrorReading<readonly P[]>
      const more = computed(() => {
        const pages = reading.data()
        if (!pages?.length) return false
        const cursor = opts.next(pages[pages.length - 1] as P, pages)
        return cursor !== null && cursor !== undefined
      })
      const loadMore = async (): Promise<void> => {
        const entry = observer.bound()
        if (!entry?.pages || disposed) return
        // A refetch can start while this call waits; append only to the pages it lands.
        while (entry.inflight) {
          await entry.inflight.promise
          if (observer.bound() !== entry || disposed) return
        }
        const state = entry.pages
        const loaded = entry.data.peek() as unknown[] | undefined
        if (!loaded?.length || !state) return
        const revision = entry.revision
        const cursor = state.next(loaded[loaded.length - 1], loaded)
        if (cursor === null || cursor === undefined) return
        const controller = new AbortController()
        batch(() => {
          loadingMore.set(true)
          entry.fetching.set(true)
        })
        const inflight = { controller, promise: Promise.resolve() }
        inflight.promise = (async () => {
          await undefined
          try {
            for (let n = 0; ; n++) {
              try {
                const page = state.parsePage(await state.loadPage(cursor, controller.signal))
                if (controller.signal.aborted) return
                // Pages written meanwhile (a seed, a restore) are newer than the ones this extends.
                if (entry.revision !== revision) {
                  entry.fetching.set(false)
                  return
                }
                entry.revision = ++revisions
                batch(() => {
                  entry.data.set([...loaded, page])
                  entry.error.set(null)
                  entry.fetching.set(false)
                })
                state.cursors = [...state.cursors, cursor]
                return
              } catch (error) {
                if (controller.signal.aborted) return
                if (shouldRetry(options.retry, error, n)) {
                  await pause(retryDelay(options.retry, n), controller.signal)
                  if (controller.signal.aborted) return
                  continue
                }
                // The loaded pages stay; error() holds why the next one did not arrive.
                batch(() => {
                  entry.error.set(error)
                  entry.fetching.set(false)
                })
                return
              }
            }
          } finally {
            loadingMore.set(false)
            if (entry.inflight === inflight) entry.inflight = null
          }
        })()
        entry.inflight = inflight
        return inflight.promise
      }
      const dispose = reading.dispose
      return {
        ...reading,
        more,
        loadingMore,
        loadMore,
        dispose: () => {
          dispose()
          more.dispose()
        },
      }
    },

    write<I, R>(opts: MirrorWriteOptions<I, R>): MirrorWriting<I, R> {
      const pending = signal(false)
      const error = signal<unknown>(null)
      const concurrency = opts.concurrency ?? 'exclusive'
      const controllers = new Set<AbortController>()
      let running = 0
      let tail: Promise<unknown> = Promise.resolve()
      let closed = false

      const execute = async (input: I): Promise<MirrorWriteOutcome<R>> => {
        const controller = new AbortController()
        const undo: Undo[] = []
        try {
          if (disposed || closed) return { status: 'aborted' }
          controllers.add(controller)
          writeControllers.add(controller)
          if (opts.optimistic) {
            const optimistic = opts.optimistic
            try {
              batch(() => untracked(() => optimistic(patchFor(undo), input)))
            } catch (cause) {
              // A patch that throws half way is undone before anything is sent.
              const rolledBack = rollback(undo)
              error.set(cause)
              return { status: 'failed', error: cause, rolledBack }
            }
          }
          const idempotencyKey = newIdempotencyKey()
          for (let n = 0; ; n++) {
            try {
              const value = await opts.run(input, { signal: controller.signal, idempotencyKey })
              // A transport that ignores the signal may still answer; the write was abandoned.
              if (controller.signal.aborted) {
                reloadPatched(undo)
                return { status: 'aborted' }
              }
              error.set(null)
              let tags: readonly string[] = []
              try {
                tags = opts.invalidates?.(input, value) ?? []
              } catch (cause) {
                // The write itself succeeded; surface the callback bug without changing that.
                queueMicrotask(() => {
                  throw cause
                })
              }
              for (const tag of tags) void invalidate(tag)
              return { status: 'done', value }
            } catch (cause) {
              if (controller.signal.aborted) {
                reloadPatched(undo)
                return { status: 'aborted' }
              }
              if (shouldRetry(opts.retry, cause, n)) {
                await pause(retryDelay(opts.retry, n), controller.signal)
                if (controller.signal.aborted) {
                  reloadPatched(undo)
                  return { status: 'aborted' }
                }
                continue
              }
              const rolledBack = rollback(undo)
              error.set(cause)
              return { status: 'failed', error: cause, rolledBack }
            }
          }
        } finally {
          controllers.delete(controller)
          writeControllers.delete(controller)
          running--
          pending.set(running > 0)
        }
      }

      return {
        pending,
        error,
        run(input: I): Promise<MirrorWriteOutcome<R>> {
          if (disposed || closed) return Promise.resolve({ status: 'aborted' })
          if (concurrency === 'exclusive' && running > 0) return Promise.resolve({ status: 'rejected' })
          running++
          pending.set(true)
          if (concurrency === 'exclusive') return execute(input)
          const result = tail.then(() => execute(input))
          tail = result.catch(() => undefined)
          return result
        },
        dispose() {
          closed = true
          for (const controller of controllers) controller.abort()
        },
      }
    },

    invalidate,

    async prefetch<K extends MirrorKey, T>(opts: MirrorPrefetchOptions<K, T>): Promise<void> {
      if (disposed) return
      const entry = entryFor(opts.key, untracked(scopeOf))
      untracked(() => configureRead(entry, opts.key, opts))
      if (needsLoad(entry)) await loadEntry(entry, false)
      else if (entry.inflight) await entry.inflight.promise
      if (entry.observers === 0) scheduleGc(entry)
    },

    peek<T>(key: MirrorKey): T | undefined {
      const hash = hashKey(key)
      enterScope(untracked(scopeOf))
      return entries.get(hash)?.data.peek() as T | undefined
    },

    seed<T>(
      key: MirrorKey,
      value: T,
      seedOptions: { updatedAt?: number; tags?: readonly string[] } = {},
    ): void {
      if (disposed) return
      const entry = entryFor(key, untracked(scopeOf))
      entry.restored = null
      if (seedOptions.tags) entry.tags = seedOptions.tags
      commit(entry, value, seedOptions.updatedAt ?? Date.now())
      scheduleGc(entry)
    },

    snapshot(): MirrorSnapshot {
      const scope = untracked(scopeOf)
      enterScope(scope)
      const out: MirrorSnapshotEntry[] = []
      for (const entry of entries.values()) {
        const restored = entry.restored
        const data = restored ? restored.data : entry.data.peek()
        if (data === undefined) continue
        const cursors = restored ? restored.cursors : entry.pages?.cursors
        out.push({
          key: entry.key,
          data,
          updatedAt: restored ? restored.updatedAt : entry.updatedAt.peek(),
          tags: entry.tags,
          ...(cursors ? { cursors: [...cursors] } : {}),
        })
      }
      return { version: 1, scope, entries: out }
    },

    restore(snapshot: MirrorSnapshot): number {
      if (disposed) return 0
      if (snapshot?.version !== 1 || !Array.isArray(snapshot.entries) || typeof snapshot.scope !== 'string')
        throw new TypeError('Not a Mirror snapshot')
      const scope = untracked(scopeOf)
      // A snapshot taken for one user or tenant is never adopted by another.
      if (snapshot.scope !== scope) return 0
      let restored = 0
      for (const item of snapshot.entries) {
        const entry = entryFor(item.key, scope)
        if (entry.data.peek() !== undefined || entry.inflight) continue
        entry.restored = {
          data: item.data,
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : null,
          ...(item.cursors ? { cursors: item.cursors } : {}),
        }
        entry.tags = Array.isArray(item.tags) ? item.tags : []
        untracked(() => applyRestored(entry))
        scheduleGc(entry)
        restored++
      }
      return restored
    },

    attach(lifetime: AbortSignal): void {
      if (disposed) throw new Error('This Mirror is disposed')
      if (attached.peek()) throw new Error('This Mirror is already attached; attach it once per lifetime')
      if (lifetime.aborted) return
      listeners = new AbortController()
      const signal = listeners.signal
      const doc = (globalThis as { document?: Document }).document
      if (options.refetchOn?.focus && doc)
        doc.addEventListener(
          'visibilitychange',
          () => {
            if (doc.visibilityState === 'visible') refetchObserved()
          },
          { signal },
        )
      if (options.refetchOn?.reconnect && typeof globalThis.addEventListener === 'function')
        globalThis.addEventListener('online', refetchObserved, { signal })
      lifetime.addEventListener('abort', detach, { once: true, signal })
      batch(() => {
        attached.set(true)
        for (const entry of entries.values()) {
          scheduleStale(entry)
          scheduleGc(entry)
        }
      })
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      for (const controller of writeControllers) controller.abort()
      listeners?.abort()
      listeners = null
      for (const entry of entries.values()) forget(entry)
      entries.clear()
      attached.set(false)
    },
  }
}
