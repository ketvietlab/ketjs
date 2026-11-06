// Render-count benchmark for @ketvietlab/ketjs-view/mirror against hand-written
// readers and TanStack Query core. Node + countingHost: it counts work, it does not
// time a browser DOM. Run from this directory: node run.ts
import { batch, countingHost, each, html, mount, signal } from '../../packages/ketjs-view/src/index.ts'
import type { TemplateResult } from '../../packages/ketjs-view/src/index.ts'
import { QueryClient, QueryObserver, keepPreviousData } from '@tanstack/query-core'
import { createMirror } from '../../packages/ketjs-view/src/mirror.ts'
import type { Mirror, MirrorStatus as Status } from '../../packages/ketjs-view/src/mirror.ts'

type Item = { id: number; name: string; qty: number }
const N = Number(process.env.ROWS ?? 1000)
const REPEAT = Number(process.env.REPEAT ?? 7)
const MID = N >> 1
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function parseItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) throw new TypeError('items: expected an array')
  for (const row of raw)
    if (typeof row?.id !== 'number' || typeof row.name !== 'string' || typeof row.qty !== 'number')
      throw new TypeError('items: invalid row')
  return raw as Item[]
}

// Every response is a fresh JSON parse, as it would be over HTTP.
function createServer(n: number) {
  const rows: Item[] = Array.from({ length: n }, (_, i) => ({ id: i, name: `item ${i}`, qty: i }))
  let held: Array<() => void> | null = null
  const api = {
    fetches: 0,
    rename(id: number, name: string) {
      rows[id] = { ...(rows[id] as Item), name }
    },
    hold() {
      held = []
    },
    async release(order: number[]) {
      const queue = held ?? []
      held = null
      for (const i of order) {
        queue[i]?.()
        await tick()
      }
    },
    list(filter: string, signal?: AbortSignal): Promise<unknown> {
      api.fetches++
      const body = JSON.stringify(rows.filter((r) => filter === 'all' || r.id % 2 === 0))
      return new Promise((resolve, reject) => {
        const answer = () =>
          signal?.aborted ? reject(new DOMException('aborted', 'AbortError')) : resolve(JSON.parse(body))
        if (held) held.push(answer)
        else setImmediate(answer)
      })
    },
    async renameRemote(id: number, name: string) {
      await new Promise((resolve) => setImmediate(resolve))
      api.rename(id, name)
      return { ok: true }
    },
  }
  return api
}
type Server = ReturnType<typeof createServer>

type Reader = {
  data(): Item[] | undefined
  status(): Status
  fetching(): boolean
  setFilter(filter: string): void
  refetch(): Promise<void>
  rename(id: number, name: string): Promise<void>
  idle(): boolean
  dispose(): void
}

// Separate signals, no batch, no abort: the pattern a first draft usually has.
function naiveReader(server: Server): Reader {
  const filter = signal('all')
  const data = signal<Item[] | undefined>(undefined)
  const loading = signal(false)
  const error = signal<unknown>(null)
  let inflight = 0
  const load = async () => {
    loading.set(true)
    inflight++
    try {
      data.set(parseItems(await server.list(filter.peek())))
      error.set(null)
    } catch (e) {
      error.set(e)
    } finally {
      loading.set(false)
      inflight--
    }
  }
  void load()
  return {
    data,
    status: () => (error() ? 'failed' : loading() && !data() ? 'loading' : 'ready'),
    fetching: loading,
    setFilter: (f) => {
      filter.set(f)
      void load()
    },
    refetch: load,
    rename: async (id, name) => {
      await server.renameRemote(id, name)
      await load()
    },
    idle: () => inflight === 0,
    dispose: () => {},
  }
}

// The documented pattern (view-effects-data.md): abort, current-request guard, batch.
function carefulReader(server: Server): Reader {
  const filter = signal('all')
  const data = signal<Item[] | undefined>(undefined)
  const loading = signal(false)
  const error = signal<unknown>(null)
  let controller: AbortController | null = null
  let inflight = 0
  const load = async () => {
    controller?.abort()
    const current = (controller = new AbortController())
    loading.set(true)
    inflight++
    try {
      const rows = parseItems(await server.list(filter.peek(), current.signal))
      if (current !== controller) return
      batch(() => {
        data.set(rows)
        error.set(null)
        loading.set(false)
      })
    } catch (e) {
      if (current !== controller) return
      batch(() => {
        error.set(e)
        loading.set(false)
      })
    } finally {
      inflight--
    }
  }
  void load()
  return {
    data,
    status: () => (error() ? 'failed' : loading() && !data() ? 'loading' : 'ready'),
    fetching: loading,
    setFilter: (f) => {
      filter.set(f)
      void load()
    },
    refetch: load,
    rename: async (id, name) => {
      const before = data.peek()
      data.set(before?.map((r) => (r.id === id ? { ...r, name } : r)))
      try {
        await server.renameRemote(id, name)
      } catch {
        data.set(before)
      }
      await load()
    },
    idle: () => inflight === 0,
    dispose: () => controller?.abort(),
  }
}

function mirrorReader(server: Server, mirror: Mirror): Reader {
  const filter = signal('all')
  const reading = mirror.read({
    key: () => ['items', { filter: filter() }] as const,
    load: ([, q], { signal }) => server.list(q.filter, signal),
    parse: parseItems,
    tags: () => ['items'],
    keepPrevious: true,
  })
  const write = mirror.write({
    run: (input: { id: number; name: string }) => server.renameRemote(input.id, input.name),
    invalidates: () => ['items'],
    optimistic: (cache, input) =>
      cache.update<Item[]>(['items', { filter: filter.peek() }], (rows) =>
        (rows ?? []).map((r) => (r.id === input.id ? { ...r, name: input.name } : r)),
      ),
  })
  let busy = 0
  return {
    data: reading.data,
    status: reading.status,
    fetching: reading.fetching,
    setFilter: (f) => filter.set(f),
    refetch: reading.refetch,
    rename: async (id, name) => {
      busy++
      await write.run({ id, name })
      await reading.settled()
      busy--
    },
    idle: () => busy === 0 && !reading.fetching.peek(),
    dispose: reading.dispose,
  }
}

function tanstackReader(server: Server, client: QueryClient): Reader {
  const filter = signal('all')
  const options = (f: string) => ({
    queryKey: ['items', { filter: f }],
    queryFn: ({ signal }: { signal: AbortSignal }) => server.list(f, signal).then(parseItems),
    placeholderData: keepPreviousData,
  })
  const observer = new QueryObserver<Item[]>(client, options('all'))
  const data = signal<Item[] | undefined>(undefined)
  const status = signal<Status>('idle')
  const fetching = signal(false)
  const apply = (r: { data: Item[] | undefined; status: string; isFetching: boolean }) =>
    batch(() => {
      data.set(r.data)
      status.set(r.status === 'pending' ? 'loading' : r.status === 'error' ? 'failed' : 'ready')
      fetching.set(r.isFetching)
    })
  const unsubscribe = observer.subscribe(apply)
  return {
    data,
    status,
    fetching,
    setFilter: (f) => {
      filter.set(f)
      observer.setOptions(options(f))
    },
    refetch: () => observer.refetch().then(() => undefined),
    rename: async (id, name) => {
      const key = ['items', { filter: filter.peek() }]
      await client.cancelQueries({ queryKey: key })
      const before = client.getQueryData<Item[]>(key)
      client.setQueryData<Item[]>(key, (rows) => rows?.map((r) => (r.id === id ? { ...r, name } : r)))
      try {
        await server.renameRemote(id, name)
      } catch {
        client.setQueryData(key, before)
      }
      await client.invalidateQueries({ queryKey: ['items'] })
    },
    idle: () => client.isFetching() === 0,
    dispose: unsubscribe,
  }
}

type Counters = { views: number; lists: number; rows: number }

function view(reader: Reader, counters: Counters, memo: boolean) {
  // Memo returns the same template for the same item object, so the renderer's
  // per-value Object.is check skips the row. It only pays off when unchanged rows
  // keep their identity, which is what structural sharing provides.
  const cache = new WeakMap<Item, TemplateResult>()
  const row = (item: Item) => {
    const hit = memo ? cache.get(item) : undefined
    if (hit) return hit
    counters.rows++
    const result = html`<li data-id=${item.id}><span>${item.name}</span><b>${item.qty}</b></li>`
    if (memo) cache.set(item, result)
    return result
  }
  const header = () => {
    counters.views++
    return html`<header>${reader.status() === 'failed' ? 'Failed' : reader.fetching() ? 'Refreshing' : 'Up to date'}</header>`
  }
  const list = () => {
    counters.views++
    counters.lists++
    const items = reader.data()
    return items === undefined ? html`<p>Loading</p>` : html`<ul>${each(items, (it) => it.id, row)}</ul>`
  }
  // One effect for the whole section, or one per region so a status flag does not re-run the list.
  const whole = () => {
    counters.views++
    counters.lists++
    const items = reader.data()
    const status = reader.status() === 'failed' ? 'Failed' : reader.fetching() ? 'Refreshing' : 'Up to date'
    return html`<section><header>${status}</header>${
      items === undefined ? html`<p>Loading</p>` : html`<ul>${each(items, (it) => it.id, row)}</ul>`
    }</section>`
  }
  return { whole, header, list }
}

type Variant = {
  name: string
  memo: boolean
  split?: boolean
  shared(): { value: unknown; dispose(): void }
  make(server: Server, shared: unknown): Reader
}
const mirrorShared = (structuralSharing: boolean) => () => {
  const mirror = createMirror({ scope: () => 'tenant-1', structuralSharing })
  const lifetime = new AbortController()
  mirror.attach(lifetime.signal)
  return {
    value: mirror,
    dispose: () => {
      lifetime.abort()
      mirror.dispose()
    },
  }
}
const queryShared = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false, staleTime: 0, refetchOnWindowFocus: false },
    },
  })
  return { value: client, dispose: () => client.clear() }
}
const none = () => ({ value: null, dispose: () => {} })
const variants: Variant[] = [
  { name: 'naive', memo: false, shared: none, make: (s) => naiveReader(s) },
  { name: 'careful', memo: false, shared: none, make: (s) => carefulReader(s) },
  { name: 'careful + memo', memo: true, shared: none, make: (s) => carefulReader(s) },
  {
    name: 'mirror, no sharing',
    memo: false,
    shared: mirrorShared(false),
    make: (s, m) => mirrorReader(s, m as Mirror),
  },
  { name: 'mirror', memo: false, shared: mirrorShared(true), make: (s, m) => mirrorReader(s, m as Mirror) },
  {
    name: 'mirror + memo',
    memo: true,
    shared: mirrorShared(true),
    make: (s, m) => mirrorReader(s, m as Mirror),
  },
  { name: 'tanstack', memo: false, shared: queryShared, make: (s, c) => tanstackReader(s, c as QueryClient) },
  {
    name: 'tanstack + memo',
    memo: true,
    shared: queryShared,
    make: (s, c) => tanstackReader(s, c as QueryClient),
  },
  { name: 'careful+memo+split', memo: true, split: true, shared: none, make: (s) => carefulReader(s) },
  {
    name: 'mirror+memo+split',
    memo: true,
    split: true,
    shared: mirrorShared(true),
    make: (s, m) => mirrorReader(s, m as Mirror),
  },
  {
    name: 'tanstack+memo+split',
    memo: true,
    split: true,
    shared: queryShared,
    make: (s, c) => tanstackReader(s, c as QueryClient),
  },
]

type Env = { server: Server; readers: Reader[]; texts: () => string[] }
type Scenario = {
  name: string
  views?: number
  measureSetup?: boolean
  act(env: Env): Promise<void>
  check(env: Env): boolean
}

const settle = async (readers: Reader[]) => {
  for (let i = 0; i < 200; i++) {
    await tick()
    if (readers.every((r) => r.idle())) {
      await tick()
      await tick()
      return
    }
  }
  throw new Error('did not settle')
}
const liCount = (text: string) => (text.match(/<li /g) ?? []).length

const scenarios: Scenario[] = [
  {
    name: 'initial load',
    measureSetup: true,
    act: async () => {},
    check: (env) => liCount(env.texts()[0] as string) === N,
  },
  {
    name: 'refetch x10, unchanged',
    act: async (env) => {
      for (let i = 0; i < 10; i++) {
        await env.readers[0]?.refetch()
        await settle(env.readers)
      }
    },
    check: (env) => liCount(env.texts()[0] as string) === N,
  },
  {
    name: 'refetch, 1 row changed',
    act: async (env) => {
      env.server.rename(MID, 'changed')
      await env.readers[0]?.refetch()
      await settle(env.readers)
    },
    check: (env) => (env.texts()[0] as string).includes('>changed<'),
  },
  {
    name: 'filter all > even > all',
    act: async (env) => {
      env.readers[0]?.setFilter('even')
      await settle(env.readers)
      env.readers[0]?.setFilter('all')
      await settle(env.readers)
    },
    check: (env) => liCount(env.texts()[0] as string) === N,
  },
  {
    name: 'rename 1 row',
    act: async (env) => {
      await env.readers[0]?.rename(7, 'renamed')
      await settle(env.readers)
    },
    check: (env) => (env.texts()[0] as string).includes('>renamed<'),
  },
  {
    name: 'two views, same key',
    views: 2,
    measureSetup: true,
    act: async () => {},
    check: (env) => env.texts().every((t) => liCount(t) === N),
  },
  {
    name: 'race: even answers last',
    act: async (env) => {
      env.server.hold()
      env.readers[0]?.setFilter('even')
      await tick()
      env.readers[0]?.setFilter('all')
      await tick()
      await env.server.release([1, 0])
      await settle(env.readers)
    },
    check: (env) => liCount(env.texts()[0] as string) === N,
  },
]

type Result = {
  views: number
  lists: number
  rows: number
  ops: number
  fetches: number
  correct: boolean
  cpuMs: number
}

async function runOnce(variant: Variant, scenario: Scenario): Promise<Result> {
  const server = createServer(N)
  const host = countingHost()
  const shared = variant.shared()
  const counters: Counters = { views: 0, lists: 0, rows: 0 }
  const containers = Array.from({ length: scenario.views ?? 1 }, () => host.root())
  const cpuStart = process.cpuUsage()
  const readers = containers.map(() => variant.make(server, shared.value))
  const lists = containers.map(() => host.root())
  const mounts = containers.flatMap((c, i) => {
    const parts = view(readers[i] as Reader, counters, variant.memo)
    return variant.split
      ? [mount(host, c, parts.header), mount(host, lists[i] as never, parts.list)]
      : [mount(host, c, parts.whole)]
  })
  await settle(readers)
  let cpu = process.cpuUsage(cpuStart)
  if (!scenario.measureSetup) {
    host.reset()
    counters.views = 0
    counters.lists = 0
    counters.rows = 0
    server.fetches = 0
  }
  const env: Env = {
    server,
    readers,
    texts: () => containers.map((c, i) => host.html(c) + (variant.split ? host.html(lists[i] as never) : '')),
  }
  const actStart = process.cpuUsage()
  await scenario.act(env)
  const actCpu = process.cpuUsage(actStart)
  if (!scenario.measureSetup) cpu = actCpu
  else cpu = { user: cpu.user + actCpu.user, system: cpu.system + actCpu.system }
  const ops = Object.values(host.ops).reduce((a, b) => a + b, 0)
  const correct = scenario.check(env)
  for (const m of mounts) m.dispose()
  for (const r of readers) r.dispose()
  shared.dispose()
  return { ...counters, ops, fetches: server.fetches, correct, cpuMs: (cpu.user + cpu.system) / 1000 }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number
const pad = (v: string | number, w: number) => String(v).padStart(w)

const rows: Array<Record<string, unknown>> = []
for (const scenario of scenarios) {
  console.log(`\n${scenario.name} (${N} rows)`)
  console.log(
    `${'variant'.padEnd(20)}${pad('views', 7)}${pad('lists', 7)}${pad('rows', 8)}${pad('dom ops', 9)}${pad('fetches', 9)}${pad('cpu ms', 9)}  correct`,
  )
  for (const variant of variants) {
    // One discarded run per cell so JIT warm-up does not favour later variants.
    await runOnce(variant, scenario)
    const runs: Result[] = []
    for (let i = 0; i < REPEAT; i++) runs.push(await runOnce(variant, scenario))
    const first = runs[0] as Result
    const stable = runs.every(
      (r) =>
        r.views === first.views &&
        r.rows === first.rows &&
        r.ops === first.ops &&
        r.fetches === first.fetches,
    )
    const cpuMs = median(runs.map((r) => r.cpuMs))
    console.log(
      `${variant.name.padEnd(20)}${pad(first.views, 7)}${pad(first.lists, 7)}${pad(first.rows, 8)}${pad(first.ops, 9)}${pad(first.fetches, 9)}${pad(cpuMs.toFixed(1), 9)}  ${runs.every((r) => r.correct) ? 'yes' : 'NO'}${stable ? '' : ' (counts varied)'}`,
    )
    rows.push({ scenario: scenario.name, variant: variant.name, ...first, cpuMs, stable })
  }
}
if (process.env.JSON_OUT) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(
    process.env.JSON_OUT,
    JSON.stringify({ rows: N, repeat: REPEAT, node: process.version, results: rows }, null, 2),
  )
}
