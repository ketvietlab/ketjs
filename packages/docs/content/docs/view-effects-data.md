---
title: Effects and data fetching
description: Understand reactive effect execution, async cleanup, SSR data boundaries and race-safe browser requests in ketjs-view.
group: ketjs-view and KTL
order: 2
---

## State, derived values, views and effects

Use `signal` for mutable state, `computed` for synchronous derived values, a pure view for markup, and `effect` to synchronize tracked state with an external resource. The renderer already reacts to signals read by a mounted view; do not wrap a view in a second effect just to make it reactive.

`effect()` from `@ketvietlab/ketjs-view` is a browser/reactive primitive. The server framework's function `effects` declarations describe reads, writes and other capabilities; they are a different contract. See [Functions and effects](/docs/functions/) for that backend concept.

## Execution and dependency tracking

```ts
// File: src/ui/effect-example.ts
import { signal, effect, batch } from '@ketvietlab/ketjs-view'

const enabled = signal(true)
const query = signal('')
const stop = effect(() => {
  if (!enabled()) return
  const current = query()
  console.log('Current query:', current)
  return () => console.log('Release previous query:', current)
})
batch(() => { query.set('todo'); query.set('tasks') })
enabled.set(false)
query.set('not observed while disabled')
stop()
```

- The callback runs immediately when the effect is created.
- Reads during its synchronous execution establish dependencies. Each rerun replaces the previous dependency set; conditional reads are tracked only while that branch runs.
- A signal write normally flushes synchronously. `batch` coalesces its writes, and computed values settle before ordinary effects observe the graph.
- A write equal to the current value according to `Object.is` does not notify. Mutating an existing object in place is not a signal update; publish a new value when state changes.
- `.peek()` reads without subscribing. Use it intentionally when a snapshot must not become a trigger.
- A returned cleanup runs before the next execution and on `stop()`. The disposer is safe to call again.
- A thrown synchronous callback error propagates; an effect is not an error boundary. Handle expected network and storage failures in the owning runtime.

Do not unconditionally read and write the same signal in an effect. Prefer a computed value for derivations; otherwise define an explicit condition that stops a feedback cycle. Dispose a computed value as well when its owner ends.

## Browser ownership and server rendering

Island factories and their `view` may run on the server, during static generation and during browser hydration. Keep the initial output deterministic. Browser-only work belongs in `mount({ root, lifetime })`, which runs after the existing HTML has been adopted. A controller's `dispose()` or the aborting `lifetime` releases resources. `mount` does not consume a returned cleanup function.

Create browser effects in `mount` and register their returned disposer with the island lifetime. Do not create an effect in `view`: rerenders would accumulate subscriptions. Do not read localStorage, access the DOM or start browser requests from the server/shared view.

| Data needed | Owner | What reaches the view |
| --- | --- | --- |
| Public Markdown or catalog data known at build time | Static page-generation module | Build-time projection |
| Request-specific, authorized records | Server handler / application function | Serializable initial props |
| Refresh after hydration | Island mount or an owned effect | Loading/result/error signals |
| Search, filter or reload driven by signals | Synchronous effect starting a cancellable request | Latest accepted response |
| Create, update or delete after a user action | Event handler calling a server endpoint | Pending state, result and validation errors |

`ketjs-view` does not make an `async` JSX component a data loader. Fetch or query before producing the initial projection, or render a deterministic initial state and load after mounting. A static page cannot securely embed per-user data at build time. Keep secrets and database clients in server/build-only code; never include them in browser props or bundles.

## A cancellable reactive request

This factory uses a same-origin JSON endpoint whose response contract is `{ id, title, done }[]`. It composes the validated `fetchTodos` helper from the [complete data-loading lesson](/learn/data-fetching/).

```tsx
// File: src/islands/task-list.tsx
import { effect, signal, type IslandFactory } from '@ketvietlab/ketjs-view'
import { fetchTodos, type Todo } from '../data/todos.ts'

type TaskListProps = {
  endpoint: string
  initial?: Todo[]
}

const taskList: IslandFactory<TaskListProps> = (props) => {
  const reloadVersion = signal(0)
  const rows = signal<Todo[]>(props.initial ?? []) // Use SSR data for the first render.
  const pending = signal(false)
  const errorMessage = signal('')

  return {
    // Rendering only reads state; it never starts a request.
    view: () => (
      <section>
        <button
          type="button"
          onClick={() => reloadVersion.set((version) => version + 1)}
        >
          Refresh
        </button>

        {pending() ? <p role="status">Loading…</p> : null}
        {errorMessage() ? <p role="alert">{errorMessage()}</p> : null}

        <ul>
          {rows().map((row) => (
            <li>{row.title}</li>
          ))}
        </ul>
      </section>
    ),

    mount({ lifetime }) {
      let isFirstRun = true

      // Start browser work after hydration. Keep this callback synchronous.
      const stopLoading = effect(() => {
        const version = reloadVersion() // This read makes Refresh trigger the effect.
        const hasInitialData = props.initial !== undefined // An empty array is valid data.
        const canUseInitialData = isFirstRun && hasInitialData && version === 0
        isFirstRun = false

        if (canUseInitialData) {
          return // The server already loaded this result; skip a duplicate request.
        }

        const request = new AbortController()
        let isCurrentRequest = true

        pending.set(true)
        errorMessage.set('')

        async function loadTasks() {
          try {
            const result = await fetchTodos(props.endpoint, request.signal)

            if (!isCurrentRequest) {
              return // A newer refresh or disposal has invalidated this response.
            }

            rows.set(result)
          } catch (cause) {
            if (!isCurrentRequest || request.signal.aborted) {
              return // Cancellation is expected; do not show it as a network error.
            }

            const message = cause instanceof Error ? cause.message : 'Unable to load tasks.'
            errorMessage.set(message)
          } finally {
            if (isCurrentRequest) {
              pending.set(false) // An old request must not clear a newer loading state.
            }
          }
        }

        void loadTasks() // Start async work without making the effect callback async.

        // Runs before the next effect execution and when stopLoading() is called.
        return () => {
          isCurrentRequest = false // Guard against work that finishes after cancellation.
          request.abort() // Cancel supported network work.
        }
      })

      // Removing the island stops its effect and cleans up the active request.
      lifetime.addEventListener('abort', stopLoading, { once: true })
    },
  }
}

export default taskList
```

The effect tracks `reloadVersion`; the result and status signals do not trigger requests. Its synchronous callback starts `loadTasks()` and returns cleanup immediately. The asynchronous function publishes only while its request is current. This example retains previous rows while refreshing; the learning project demonstrates clearing results and showing a distinct empty state.

## Why not an async effect callback?

An async function returns a Promise, not the cleanup callback expected by `effect`. Signal reads after `await` also occur outside the synchronous tracking window. Capture dependencies first, start asynchronous work inside a synchronous callback, and return cleanup there. Cancelling a request is expected control flow, not a user-facing failure.

`AbortController` stops supported network work. The additional current-request guard protects state if a response or later async transformation finishes after cancellation. For debounced search, clear the pending timer in the same cleanup. For one load per mount without reactive parameters, call an async loader directly from `mount` with its lifetime as the fetch abort signal; an effect is unnecessary.

## Network and mutation contracts

`fetch` resolves for HTTP error responses: inspect `response.ok` before decoding. Validate JSON at the boundary; a TypeScript assertion does not validate untrusted payloads. Distinguish loading, a valid empty collection, an authorization failure and a server error. Do not expose server stack traces in the UI.

Use event handlers for explicit POST/PATCH/DELETE actions. Disable duplicate submission while pending and preserve input until the server acknowledges success. Refresh or update the read model afterwards. Aborting a mutation request does not guarantee that the server rolled back an operation it already received; use the backend's transactional and idempotency contracts when required.

Prefer a same-origin API. A different port or hostname is a different origin and needs a deliberate proxy/CORS arrangement; `mode: 'no-cors'` does not make JSON readable. `credentials: 'same-origin'` sends same-origin cookies. Cross-origin cookies require explicit browser/server configuration. In every case, server authentication, permissions, tenant scoping and CSRF protection remain authoritative; browser state is not an authorization boundary.

## Initial data, caching and hydration

Use exactly the server-provided projection for the first client view. An empty array is still a valid initial result. The example skips a duplicate initial request and exposes explicit Refresh. If the product needs revalidation immediately after hydration, make that a deliberate policy and keep the initial markup consistent.

Signals and effects do not provide a shared request cache, deduplication, pagination, retry policy, optimistic rollback or Suspense. Own those policies explicitly or use a compatible data library at the runtime boundary. Dispose subscriptions and pending requests when the owning island ends.

## Test the ownership boundary

Verify the initial server render starts no browser work. Test a successful result, empty data, invalid JSON, HTTP errors and retry. Resolve two requests out of order and assert only the current one changes UI. Remove the island while a request is pending and verify it cannot update the disposed instance. For a complete runnable example, follow [Reactive effects](/learn/effects/) and [Data fetching](/learn/data-fetching/).
