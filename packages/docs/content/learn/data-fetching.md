---
title: "Fetch data without render side effects"
description: "Build a searchable list with loading, empty, error and retry states, request cancellation and safe hydration."
stage: "Build the frontend"
duration: 45
lab: "Local View project"
order: 9
---

Before you start: complete [Understand effects and reactive dependencies](/learn/effects/).

## Run the complete example

The [View project download](/learn/downloads/learn-view.zip) includes `/data/`, its `task-search` island and `public/data/todos.json`. Install it as described in [Create your first View project](/learn/first-project/), start its development server and open `/data/`. This example makes a real same-origin HTTP request to a static JSON fixture, so it needs no backend account or database.

The public online playground deliberately blocks outgoing requests. Run this exercise in the downloaded project. Later, [Connect an island to the API](/learn/connect-ui/) replaces the fixture URL with the local backend.

## Decide when the request belongs

For public content known during generation, load it in build-time code and pass its projection into a pure page. For request-specific data, load it in the server handler with the current identity and permissions, then pass serializable initial props. For a browser interaction, start work in an event handler or in an effect owned by `mount`.

A view should never call `fetch`. It can be rendered more than once, and may run on the server. Its job is to read the current signals and describe the current UI.

## Validate the network boundary

A TypeScript cast does not validate JSON. Check the HTTP status and the shape you need before treating it as application data:

```ts
// File: learn-view/src/data/todos.ts
export type Todo = { id: string; title: string; done: boolean }

export async function fetchTodos(endpoint: string, signal: AbortSignal): Promise<Todo[]> {
  const response = await fetch(endpoint, { signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Could not load tasks (${response.status}).`)
  const data: unknown = await response.json()
  if (!Array.isArray(data) || !data.every(row => row && typeof row === 'object' &&
    typeof row.id === 'string' && typeof row.title === 'string' && typeof row.done === 'boolean')) {
    throw new Error('The server returned an unexpected task list.')
  }
  return data as Todo[]
}

```

An HTTP 404 or 500 does not reject `fetch` by itself. Calling `response.json()` can also fail if a proxy returns HTML or malformed JSON. Both paths must reach the error state.

## Own the request lifecycle

```tsx
// File: learn-view/src/islands/task-search.tsx
import { effect, signal, each, type IslandFactory } from '@ketvietlab/ketjs-view'
import { fetchTodos, type Todo } from '../data/todos.ts'

type Props = { endpoint: string; initial?: Todo[] }
type State = { phase: 'idle' | 'loading' | 'ready' | 'error'; rows: Todo[]; error: string }

const taskSearch: IslandFactory<Props> = props => {
  const query = signal('')
  const reload = signal(0)
  const state = signal<State>({ phase: props.initial ? 'ready' : 'idle', rows: props.initial ?? [], error: '' })
  return {
    view: () => <section>
      <h1>Load tasks from JSON</h1>
      <label for="task-query">Search title</label>
      <input id="task-query" value={query()} onInput={(event: Event) => query.set((event.target as HTMLInputElement).value)} />
      <button type="button" onClick={() => reload.set(n => n + 1)}>Refresh tasks</button>
      <div aria-live="polite" aria-busy={state().phase === 'loading' ? 'true' : 'false'}>
        {state().phase === 'idle' ? <p>Ready to load tasks in your browser.</p> : null}
        {state().phase === 'loading' ? <p>Loading tasks…</p> : null}
        {state().phase === 'error' ? <p role="alert">{state().error} Try Refresh tasks.</p> : null}
        {state().phase === 'ready' && state().rows.length === 0 ? <p>No matching tasks.</p> : null}
        <ul>{each(state().rows, row => row.id, row => <li>{row.title} — {row.done ? 'Done' : 'Open'}</li>)}</ul>
      </div>
    </section>,
    mount({ lifetime }) {
      let first = true
      const stop = effect(() => {
        const term = query().trim().toLowerCase()
        const refresh = reload()
        // Server-provided data already represents the initial request.
        if (first && props.initial && !term && refresh === 0) { first = false; return }
        first = false
        const request = new AbortController()
        let current = true
        state.set({ phase: 'loading', rows: [], error: '' })
        const timer = setTimeout(() => {
          void fetchTodos(props.endpoint, request.signal).then(rows => {
            if (current) state.set({ phase: 'ready', rows: rows.filter(row => row.title.toLowerCase().includes(term)), error: '' })
          }).catch(error => {
            if (current && !request.signal.aborted) state.set({ phase: 'error', rows: [], error: error instanceof Error ? error.message : 'Could not load tasks.' })
          })
        }, 250)
        // Runs before the next request and when the island is disposed.
        return () => { current = false; clearTimeout(timer); request.abort() }
      })
      lifetime.addEventListener('abort', stop, { once: true })
    },
  }
}
export default taskSearch

```

Only `query()` and `reload()` subscribe the effect. It reads them synchronously, before scheduling work. The 250 ms timer debounces typing. On the next query or island removal, cleanup clears that timer, aborts the request and sets `current = false`.

Aborting saves work when the transport supports it. The `current` flag also prevents a response or JSON parsing step that finishes late from publishing stale state. The catch branch ignores cancellation so typing quickly does not produce an error banner. An actual failure displays an error and leaves Refresh available.

The fixture is intentionally small: it downloads the whole list and filters titles in the browser. It is not server-side search or pagination. For a large dataset, define a validated backend search contract and pass the captured query to that endpoint instead.

## Keep hydration deterministic

Without `initial`, the server and first browser render both show the idle message. `mount` then starts the first request. With an initial array from the server, the first browser render uses the exact same array and the first effect skips the duplicate request. An empty initial array is valid data, not a reason to fetch again.

Refresh explicitly starts another request. This example clears old rows while loading; keeping them visible would be a different UI policy and must label them as stale. No cache, request deduplication, optimistic updates or automatic retries are implied by `effect`.

## Verify each state

1. Open `/data/` and observe the three fixture tasks.
2. Search for a title that does not exist: the result is an empty-state message.
3. Type rapidly with network throttling: only the latest search result may appear.
4. Temporarily rename the JSON file: Refresh must show an HTTP error, not an empty list. Restore it and retry.
5. Replace the JSON with an object instead of an array: expect the shape-validation error. Restore the fixture.
6. Navigate away while a request is pending: no old response may update the disposed island.

## Checkpoint

You can identify the pure view, the two request dependencies, per-request cleanup, island cleanup, and the stale-response guard. Loading, error, empty and populated states are distinguishable.

## Practice on your own

Add a server-provided initial list and verify that mounting does not issue an unnecessary request. Then add a separate mutation event handler: preserve its input until the server confirms success, and refresh the read model afterwards.

## Reference

Read [Effects and data fetching](/docs/view-effects-data/) and [Connect an island to the API](/learn/connect-ui/).
