---
title: Server state with Mirror
description: Cache API answers in the browser with ketjs-view signals, including shared requests, stale-while-revalidate, tag invalidation, optimistic writes, pages and a server snapshot.
group: ketjs-view and KTL
order: 3
---

`@ketvietlab/ketjs-view/mirror` keeps what an API answered: keyed, shared between readers and refreshed
in the background. The browser holds a mirror of server state, never the truth. Mirror performs no I/O
of its own: every load and write is a function you pass in, so it works with any HTTP, GraphQL or SDK
transport, whether or not the server is KetJS. It is available from ketjs-view 0.8.0.

Use it where a browser runtime owns reads: a client-rendered app on an API, or an island that loads
and changes data after hydration. A server-rendered page that reads its data on the server does not
need it.

## Create and attach

Create one mirror per browser runtime and attach it to that runtime's lifetime. Before `attach()`,
Mirror loads nothing on its own, sets no timers and adds no listeners. Only an explicit `prefetch()` or
`refetch()` loads, so creating reads during a server render stays pure. When the lifetime aborts, loads
in flight are aborted and the mirror can be attached again.

```ts
// File: src/client/mirror.ts
import { createMirror } from '@ketvietlab/ketjs-view/mirror'
import { session } from './session.ts'

export const mirror = createMirror({
  // Cached answers belong to one user and organization. A new value drops all of them.
  scope: () => `${session.userId()}:${session.organizationId()}`,
  staleMs: 30_000,
})

export function startMirror(lifetime: AbortSignal): void {
  mirror.attach(lifetime)
}
```

`scope` is the isolation boundary. When it changes, every entry is dropped and loads in flight are
aborted. `keepPrevious` never shows another scope's data, and `restore()` refuses a snapshot taken
in another scope. Set it whenever answers depend on who is asking.

## Read

```ts
// File: src/client/orders.ts
import { signal } from '@ketvietlab/ketjs-view'
import { mirror } from './mirror.ts'
import { parseOrders } from './order-contract.ts'

export const status = signal('open')

export const orders = mirror.read({
  key: () => ['orders', { status: status() }] as const,
  load: ([, filter], { signal }) =>
    fetch(`/api/orders?status=${encodeURIComponent(filter.status)}`, { signal }).then((response) => {
      if (!response.ok) throw new Error(`orders: HTTP ${response.status}`)
      return response.json()
    }),
  parse: parseOrders,
  tags: () => ['orders'],
  keepPrevious: true,
})
```

- **`key`** is a JSON array whose first element names the resource. It is reactive: when it changes,
  the reading follows the new key. A `null` key disables the read. Object properties are sorted, so
  `{ a, b }` and `{ b, a }` are the same entry. A `Date`, a function or a class instance is rejected.
- **`load`** receives the key and an `AbortSignal`. It runs on a later microtask, outside any effect,
  so signals it reads do not subscribe the reading.
- **`parse`** is required. A response is untrusted input: a throw makes the load `failed` and is never
  cached.
- **Readers of one key share one entry and one request.** `refetch()` and invalidation supersede a load
  in flight, and the latest load wins.

| Member | Meaning |
| --- | --- |
| `data()` | The parsed answer, or `undefined` before the first one. |
| `status()` | `idle` (no key, or not attached yet), `loading` (no answer yet), `ready`, or `failed`. A failed refetch keeps the previous `data()`. |
| `fetching()` | A load for the current key is in flight, including a background refetch. |
| `stale()` | The answer is older than `staleMs` or was invalidated. |
| `previous()` | `data()` belongs to the previous key (`keepPrevious`). |
| `error()`, `updatedAt()` | The last failure and the time of the last answer. |
| `refetch()`, `settled()`, `dispose()` | Load again, wait for the load in flight, stop observing. |

Dispose a reading with the island or view that owns it. An entry nobody observes is dropped after `gcMs`.
An [island store](/docs/view-stores/) can own readings, so they are disposed with it.

## Render a reading

```ts
// File: src/client/order-list.ts
import { each, html } from '@ketvietlab/ketjs-view'
import { orders } from './orders.ts'

export const orderStatus = () =>
  html`<p role="status">${orders.status() === 'failed' ? 'Could not refresh orders' : orders.fetching() ? 'Refreshing…' : ''}</p>`

export const orderList = () => {
  const list = orders.data()
  if (list === undefined) return html`<p>Loading orders…</p>`
  return html`<ul>${each(list, (order) => order.id, (order) => html`<li>${order.number}</li>`)}</ul>`
}
```

Mount `orderStatus` and `orderList` separately. A view re-runs when any signal it reads changes, so a
list that also reads `fetching()` runs twice for every background refetch. Kept apart, an unchanged
answer runs the list zero times. Structural sharing keeps unchanged rows by reference, so the
`data()` write is a no-op when nothing changed.

## Write

```ts
// File: src/client/cancel-order.ts
import { mirror } from './mirror.ts'
import type { Order } from './order-contract.ts'

export const cancelOrder = mirror.write({
  run: (id: string, { signal, idempotencyKey }) =>
    fetch(`/api/orders/${id}/cancel`, {
      method: 'POST',
      signal,
      headers: { 'Idempotency-Key': idempotencyKey },
    }).then((response) => {
      if (!response.ok) throw new Error(`cancel: HTTP ${response.status}`)
      return response.json()
    }),
  invalidates: (id) => ['orders', `order:${id}`],
  optimistic: (cache, id) =>
    cache.update<Order[]>(['orders', { status: 'open' }], (list) => (list ?? []).filter((order) => order.id !== id)),
})

// const outcome = await cancelOrder.run(order.id)
```

- **`run()` never throws.** It resolves to an outcome:
  - `done` with the value;
  - `failed` with the error and whether a patch was rolled back;
  - `rejected` when an `exclusive` write is already pending (the default);
  - `aborted` when the writer or mirror was disposed.
- **`concurrency: 'queue'`** runs writes in order.
- **`idempotencyKey`** stays the same across the retries of one `run()` and changes on the next run.
  Send it so the server can recognise a repeated request.
- **`optimistic`** patches cached entries before the request and aborts their loads in flight, so an
  older answer cannot land on top. A failure rolls each patch back, unless something newer has already
  replaced it, including a server answer equal to the patch. An aborted write has an unknown outcome,
  even when the transport answers after the abort, so it resolves to `aborted` and the entries it
  patched are loaded again instead.
- **`invalidates`** returns tags after success. Observed entries with those tags reload, and the others
  become stale.

## Pages

```ts
// File: src/client/activity.ts
import { mirror } from './mirror.ts'
import { parseActivityPage } from './activity-contract.ts'

export const activity = mirror.pages({
  key: () => ['activity'] as const,
  load: (_key, cursor: string | null, { signal }) =>
    fetch(`/api/activity${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`, { signal }).then((response) => {
      if (!response.ok) throw new Error(`activity: HTTP ${response.status}`)
      return response.json()
    }),
  parse: parseActivityPage,
  next: (last) => last.nextCursor,
})

// activity.data() is the list of pages; activity.more(), activity.loadingMore(), activity.loadMore()
```

The first page loads with a `null` cursor, and `loadMore()` appends the next one.

A refetch reloads as many pages as are loaded, following `next()` again from the first. A failed
`loadMore()` keeps the loaded pages and sets `error()`. A key belongs either to `read()` or to
`pages()`, never both.

## Cache operations

| Operation | Use |
| --- | --- |
| `invalidate(tag)` or `invalidate((tags, key) => boolean)` | Mark matching entries stale; observed ones reload while attached. |
| `prefetch({ key, load, parse })` | Load a key now, attached or not: route preloading or a server render. |
| `seed(key, value)` | Store an answer you already hold. It is trusted and not parsed. |
| `peek(key)` | Read a cached value without observing it. |
| `snapshot()`, `restore(snapshot)` | Hand cached answers from a server render to the browser. |
| `dispose()` | Abort every load and write and drop every entry. |

## Hand off a server render

On the server, create a mirror per request, never at module level. Prefetch what the page shows and
pass the snapshot to the island as a prop:

```ts
// File: src/server/orders-page.ts
import { createMirror } from '@ketvietlab/ketjs-view/mirror'
import { loadOrders, parseOrders } from './orders.ts'

export async function ordersSnapshot(scope: string) {
  const mirror = createMirror({ scope: () => scope, staleMs: 30_000 })
  await mirror.prefetch({ key: ['orders', { status: 'open' }], load: () => loadOrders('open'), parse: parseOrders })
  const snapshot = mirror.snapshot()
  mirror.dispose()
  return snapshot
}
```

In the browser, `restore(snapshot)` before the first read. The reading that binds a restored entry
runs its own `parse` on it, so server data passes the same validation as a response, and invalid data
is loaded instead. Fresh restored data is not loaded again until `staleMs` passes.

## Defaults

| Option | Default | Note |
| --- | --- | --- |
| `scope` | one shared scope | Set it whenever answers depend on the user or tenant. |
| `staleMs` | `0` | Stale as soon as it lands: a new reader, focus or reconnect loads again. |
| `gcMs` | `300000` | An unobserved entry is kept for five minutes. |
| `retry` | none | `{ attempts, delayMs, when }`; `when` decides which errors are worth retrying. Writes take their own `retry`. |
| `refetchOn` | off | `{ focus, reconnect }` reload observed stale entries when the page becomes visible or the network returns. |
| `structuralSharing` | `true` | Turn it off for a very large answer that changes wholesale every time. |
| `pollMs` (per read) | off | Reload while observed and attached. |

## What Mirror does not do

- It does not normalise entities across keys. Invalidate by tag instead.
- It does not persist the cache between sessions.
- It does not suspend rendering. A view reads `status()` and `data()`.
- It does not freeze data. Treat answers as immutable and change cached values through `optimistic` or
  `seed`, so structural sharing stays correct.

`bench/mirror-comparison` in the repository counts renders, DOM operations and requests against
hand-written readers and TanStack Query core. With nothing changed, a refetch runs a separately mounted
list zero times. For the same markup, DOM operations equal those of the correct alternatives, because the
keyed renderer already writes only what changed. What a cache changes is how much JavaScript runs, how
many requests are sent, and whether an older answer can land last.
