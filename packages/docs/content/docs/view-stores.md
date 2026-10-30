---
title: Island state with stores
description: Keep one island's state in a store that is read-only from outside, written through batched actions, with async tasks and browser wiring that start only after mount.
group: ketjs-view and KTL
order: 4
---

`@ketvietlab/ketjs-view/store` groups the state of one island instance:

- its signals and derived values;
- the actions that write them;
- its async work;
- the browser wiring it needs after mount.

Outside the store, its state is read-only. Every write goes through an action, so a handler cannot change state behind the store's back. It is available from ketjs-view 0.8.0.

A few signals in the island closure remain the simplest choice. Reach for a store when an island grows many signals written from many handlers, hand-written loading and error pairs, or requests that must be cancelled when it ends.

## Define a store

```ts
// File: src/client/members-store.ts
import type { Mirror } from '@ketvietlab/ketjs-view/mirror'
import { defineStore } from '@ketvietlab/ketjs-view/store'
import { parseMembers } from './member-contract.ts'

export const createMembersStore = defineStore(
  'members',
  (input: { organizationId: string; query: string }, deps: { mirror: Mirror }, use) => {
    const query = use.state(input.query)
    const selected = use.state<readonly string[]>([])
    const members = use.own(
      deps.mirror.read({
        key: () => ['members', { organizationId: input.organizationId, query: query() }] as const,
        load: ([, filter], { signal }) =>
          fetch(`/api/members?q=${encodeURIComponent(filter.query)}`, { signal }).then((response) => {
            if (!response.ok) throw new Error(`members: HTTP ${response.status}`)
            return response.json()
          }),
        parse: parseMembers,
        tags: () => ['members'],
        keepPrevious: true,
      }),
    )
    const exportCsv = use.task((ids: readonly string[], signal) =>
      fetch('/api/members/export', { method: 'POST', body: JSON.stringify(ids), signal }).then((response) => {
        if (!response.ok) throw new Error(`export: HTTP ${response.status}`)
        return response.blob()
      }),
    )
    use.connect((lifetime) => {
      addEventListener('members:changed', () => deps.mirror.invalidate('members'), { signal: lifetime })
    })
    return {
      query,
      selected,
      members,
      exportCsv,
      count: use.derived(() => selected().length),
      search: use.action((next: string) => {
        query.set(next)
        selected.set([])
      }),
      toggle: use.action((id: string) =>
        selected.set((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id])),
      ),
    }
  },
)
```

`defineStore(id, setup)` returns a factory. Call it once per island instance:

- **`input`** carries the island's serializable props.
- **`deps`** carries services such as a Mirror or an API client. It may be omitted when the setup does not use it.

The setup declares members with `use`, and the store exposes what the setup returns.

| `use` member | Meaning |
| --- | --- |
| `state(initial)` | A signal the store can write. The store exposes it read-only, both at runtime and in its type. |
| `derived(fn)` | A computed value, disposed with the store. |
| `action(fn)` | A write that runs in one `batch()`, without tracking: the effect that calls it does not subscribe to what it reads. Nested actions stay one batch. After dispose an action does nothing and returns `undefined`. |
| `task(run, { concurrency })` | Async work that goes through no cache, such as an upload, an export or a computation. |
| `connect(fn)` | Browser wiring: listeners, timers, subscriptions. It runs on every `attach()`, never during a server render, and may return a cleanup. |
| `own(child)` | Dispose a child with the store: a Mirror reading or writer, a form session, a nested store. |

`state`, `derived`, `action`, `task` and `connect` are available only while the setup runs. `own` works at any time, and after dispose it disposes the child at once.

### Writes and freezing

Plain objects and arrays are frozen in place when they are written to `state`. To change one, write a new value.

Freezing skips subtrees that are already frozen. A new list that reuses the old rows therefore costs only its new nodes, and the rows keep their identity, which keyed rendering and Mirror's structural sharing rely on. Class instances, `Map`, `Date` and DOM objects are held as they are.

### Tasks

`task.run(input)` never throws. It resolves to an outcome:

- `done` with the value;
- `failed` with the error, which also sets `error()`;
- `rejected` when an `exclusive` task, the default, is already running;
- `superseded` when a newer run of a `latest` task aborted this one;
- `aborted` when the lifetime ended or the store was disposed.

`pending()` is true while a run is in flight. Pass the `AbortSignal` to the request, so an abort actually stops it.

Server answers belong in Mirror, not in a task: a task has no cache, no deduplication and no invalidation.

## Use it in an island

```ts
// File: src/client/members-island.ts
import type { IslandFactory } from '@ketvietlab/ketjs-view'
import { createMirror } from '@ketvietlab/ketjs-view/mirror'
import { createMembersStore } from './members-store.ts'
import { membersView } from './members-view.ts'

export const members: IslandFactory<{ organizationId: string; query: string }> = (props) => {
  const mirror = createMirror()
  const store = createMembersStore(props, { mirror })
  return {
    view: () => membersView(store),
    mount: ({ lifetime }) => {
      mirror.attach(lifetime)
      store.attach(lifetime)
    },
    dispose: () => {
      store.dispose()
      mirror.dispose()
    },
  }
}
```

The factory runs during the server render as well. There the store is created, nothing connects, and the Mirror reading stays `idle`. Render that state as loading markup, or restore a [Mirror snapshot](/docs/view-mirror/#hand-off-a-server-render) before the store is created.

In the browser, `mount` attaches both. When the island is removed, KetJS aborts `lifetime`, which ends `connect()` wiring and tasks in flight, and then calls `dispose()`.

This mirror lives and dies with the island. To share answers between islands, pass one browser mirror in `deps` instead, with a `scope`.

| Store member | Meaning |
| --- | --- |
| `id` | The name given to `defineStore`, for diagnostics. |
| `attach(lifetime)` | Run `connect()` wiring until the lifetime aborts. A store can be attached again after that. It throws while attached or after dispose. |
| `dispose()` | Ends the wiring, aborts tasks, then disposes derived values and owned children in reverse order. |
| `snapshot()` | A JSON copy of the top-level state members, for tests and diagnostics. |

`id`, `attach`, `dispose` and `snapshot` are reserved. A setup that returns them throws.

## Test without a DOM

```ts
// File: test/members-store.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMirror } from '@ketvietlab/ketjs-view/mirror'
import { createMembersStore } from '../src/client/members-store.ts'

test('a new search clears the selection', () => {
  const store = createMembersStore({ organizationId: 'o1', query: '' }, { mirror: createMirror() })
  store.toggle('m1')
  store.search('an')
  assert.deepEqual(store.snapshot(), { query: 'an', selected: [] })
  store.dispose()
})
```

The mirror is not attached, so nothing is fetched. Attach both to an `AbortController` signal to test connected behavior, and give `deps` a fake API to settle requests in any order.

## What a store does not do

- **It is never global.** A module-level store would be shared by every request a server renders. Create one per island instance. Share state between islands through the URL, events or a browser mirror passed in `deps`.
- **It does not cache server answers.** That is [Mirror](/docs/view-mirror/)'s job; a store owns readings.
- **It does not sync with the URL.** That needs history and fragment navigation, and is a separate design.
- **It replaces no form session.** Own a form session instead.
- **It has no middleware or time-travel devtools.**
