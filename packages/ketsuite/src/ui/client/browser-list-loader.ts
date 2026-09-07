import type { BrowserScreenPlan, Row } from '@ketvietlab/ketjs'
import { browserResourceMap, type BrowserListState } from '../browser-list.tsx'
import type { TableSelection } from '../table.tsx'

export type BrowserListMode = 'csr-two-stage' | 'csr-planned'

export type BrowserPrimaryPayload = {
  rows: Row[]
  total: number
  status?: string
}

export type BrowserListBootstrap = {
  mode: BrowserListMode
  plan: BrowserScreenPlan
  baseEndpoint: string
  contextKey: string
  concurrency?: number
  initial: BrowserPrimaryPayload & {
    resources?: Record<string, Row[]>
    errors?: Record<string, string>
  }
  emptyTitle?: string
  emptyMessage?: string
  loadingLabel?: string
  locale?: string
  rowBase?: string
  rowQuery?: string
  selection?: TableSelection
  selectAllLabel?: string
  selectRowLabel?: string
}

type FetchResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type BrowserFetch = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  },
) => Promise<FetchResponse>

type Cached = { expiresAt: number; rows: Row[] }
const contextCache = new Map<string, Cached>()
const CONTEXT_CACHE_LIMIT = 256

const cachedRows = (key: string, now: number): Row[] | undefined => {
  const cached = contextCache.get(key)
  if (!cached) return undefined
  if (cached.expiresAt <= now) {
    contextCache.delete(key)
    return undefined
  }
  return cached.rows
}

const cacheRows = (key: string, rows: Row[], expiresAt: number, now: number): void => {
  for (const [heldKey, cached] of contextCache) {
    if (cached.expiresAt <= now) contextCache.delete(heldKey)
  }
  contextCache.delete(key)
  while (contextCache.size >= CONTEXT_CACHE_LIMIT) {
    const oldest = contextCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    contextCache.delete(oldest)
  }
  contextCache.set(key, { expiresAt, rows })
}

export const browserLoadError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const responseRows = async (
  fetcher: BrowserFetch,
  resource: BrowserScreenPlan['resources'][string],
  ids: string[],
  signal: AbortSignal,
): Promise<Row[]> => {
  if (!resource.endpoint) throw new Error(`${resource.id} has no joined-resource endpoint`)
  const input = resource.batch ? { [resource.batch.input]: ids } : {}
  const response = await fetcher(resource.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  const envelope = (await response.json()) as {
    ok?: boolean
    value?: unknown
    code?: string
    message?: string
  }
  if (!response.ok || envelope.ok !== true) {
    throw new Error(envelope.message ?? envelope.code ?? `HTTP ${response.status}`)
  }
  const value = envelope.value
  if (!Array.isArray(value)) throw new Error(`${resource.id} did not return rows`)
  return value as Row[]
}

const runBounded = async (jobs: Array<() => Promise<void>>, concurrency: number): Promise<void> => {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const at = next++
      await jobs[at]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()))
}

export const browserListInitialState = (bootstrap: BrowserListBootstrap): BrowserListState => {
  const rows = bootstrap.initial.resources ?? {}
  const errors = bootstrap.initial.errors ?? {}
  return {
    rows: bootstrap.initial.rows,
    resources: Object.fromEntries(
      Object.entries(rows).map(([id, resourceRows]) => [
        id,
        browserResourceMap(resourceRows, bootstrap.plan.resources[id]?.key ?? 'id'),
      ]),
    ),
    loading: [],
    errors: { ...errors },
    total: bootstrap.initial.total,
    requiredReady:
      bootstrap.mode === 'csr-planned' &&
      Object.values(bootstrap.plan.resources)
        .filter(({ phase }) => phase === 'essential')
        .every(({ id }) => Object.hasOwn(rows, id) && !Object.hasOwn(errors, id)),
    phase: bootstrap.mode === 'csr-planned' ? 'primary' : 'shell',
  }
}

/**
 * Request orchestrator independent of the DOM so cancellation, batching and stale
 * suppression remain directly testable.
 */
export class BrowserListLoader {
  #generation = 0
  #abort: AbortController | null = null
  #state: BrowserListState
  readonly bootstrap: BrowserListBootstrap
  readonly publish: (state: BrowserListState) => void
  readonly fetcher: BrowserFetch
  readonly now: () => number

  constructor(
    bootstrap: BrowserListBootstrap,
    publish: (state: BrowserListState) => void,
    fetcher: BrowserFetch,
    now: () => number = Date.now,
  ) {
    this.bootstrap = bootstrap
    this.publish = publish
    this.fetcher = fetcher
    this.now = now
    this.#state = this.initialState()
  }

  initialState(): BrowserListState {
    return browserListInitialState(this.bootstrap)
  }

  get state(): BrowserListState {
    return this.#state
  }

  #set(patch: Partial<BrowserListState>, generation = this.#generation): void {
    if (generation !== this.#generation) return
    this.#state = { ...this.#state, ...patch }
    this.publish(this.#state)
  }

  async start(): Promise<void> {
    const generation = ++this.#generation
    this.#abort?.abort()
    this.#abort = new AbortController()
    this.#state = this.initialState()
    this.publish(this.#state)

    if (this.bootstrap.mode === 'csr-two-stage') {
      const response = await this.fetcher(this.bootstrap.baseEndpoint, {
        headers: { accept: 'application/json' },
        signal: this.#abort.signal,
      })
      const body = (await response.json()) as BrowserPrimaryPayload & { message?: string }
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`)
      if (generation !== this.#generation) return
      this.#set(
        {
          rows: body.rows,
          total: body.total,
          resources: {},
          errors: {},
          requiredReady: false,
          phase: 'primary',
        },
        generation,
      )
    }

    if (this.bootstrap.mode === 'csr-planned' && !this.#state.requiredReady)
      throw new Error('required browser resources failed')

    const phases =
      this.bootstrap.mode === 'csr-planned' ? new Set(['deferred']) : new Set(['essential', 'deferred'])
    await this.#loadResources(phases, generation, this.#abort.signal)
    if (!this.#state.requiredReady) throw new Error('required browser resources failed')
    this.#set({ loading: [], phase: 'complete' }, generation)
  }

  async #loadResources(phases: ReadonlySet<string>, generation: number, signal: AbortSignal): Promise<void> {
    const resources = Object.values(this.bootstrap.plan.resources).filter(
      (resource) => resource.id !== this.bootstrap.plan.screen.primary && phases.has(resource.phase),
    )
    const tracksRequired = this.bootstrap.mode === 'csr-two-stage'
    const requiredIds = new Set(resources.filter(({ phase }) => phase === 'essential').map(({ id }) => id))
    const ids = [...new Set(this.#state.rows.map((row) => String(row[this.bootstrap.plan.screen.rowKey])))]
    if (!resources.length || !ids.length) {
      if (tracksRequired) this.#set({ requiredReady: true }, generation)
      return
    }
    this.#set({ loading: resources.map(({ id }) => id) }, generation)
    const requests = new Map<string, Promise<Row[]>>()

    const jobs = resources.map((resource) => async () => {
      const cacheKey = `${this.bootstrap.contextKey}:${resource.id}:${JSON.stringify(ids)}`
      const cached = resource.cache?.scope === 'context' ? cachedRows(cacheKey, this.now()) : undefined
      try {
        let rows: Row[]
        if (cached) rows = cached
        else {
          const size = resource.batch?.max ?? ids.length
          const chunks: string[][] = []
          for (let at = 0; at < ids.length; at += size) chunks.push(ids.slice(at, at + size))
          rows = []
          for (const chunk of chunks) {
            const requestKey = `${resource.endpoint ?? ''}:${JSON.stringify(chunk)}`
            let request = requests.get(requestKey)
            if (!request) {
              request = responseRows(this.fetcher, resource, chunk, signal)
              requests.set(requestKey, request)
            }
            rows.push(...(await request))
          }
          if (resource.cache?.scope === 'context' && resource.cache.ttlMs > 0) {
            const now = this.now()
            cacheRows(cacheKey, rows, now + resource.cache.ttlMs, now)
          }
        }
        if (generation !== this.#generation) return
        const loading = this.#state.loading.filter((id) => id !== resource.id)
        this.#set(
          {
            resources: {
              ...this.#state.resources,
              [resource.id]: browserResourceMap(rows, resource.key),
            },
            loading,
            ...(tracksRequired
              ? {
                  requiredReady: [...requiredIds].every(
                    (id) => !loading.includes(id) && !(id in this.#state.errors),
                  ),
                }
              : {}),
          },
          generation,
        )
      } catch (error) {
        if (signal.aborted || generation !== this.#generation) return
        const loading = this.#state.loading.filter((id) => id !== resource.id)
        const errors = { ...this.#state.errors, [resource.id]: browserLoadError(error) }
        this.#set(
          {
            errors,
            loading,
            ...(tracksRequired
              ? {
                  requiredReady: [...requiredIds].every((id) => !loading.includes(id) && !(id in errors)),
                }
              : {}),
          },
          generation,
        )
      }
    })
    await runBounded(jobs, Math.max(1, Math.min(16, this.bootstrap.concurrency ?? 4)))
  }

  dispose(): void {
    this.#generation++
    this.#abort?.abort()
    this.#abort = null
  }
}
