import { effect, signal, each, type IslandFactory } from '@ketvietlab/ketjs-view'
import { fetchTodos, type Todo } from '../data/todos.ts'

type Props = { endpoint: string; initial?: Todo[] }
type State = { phase: 'idle' | 'loading' | 'ready' | 'error'; rows: Todo[]; error: string }

const taskSearch: IslandFactory<Props> = (props) => {
  const query = signal('')
  const reload = signal(0)
  const state = signal<State>({
    phase: props.initial ? 'ready' : 'idle',
    rows: props.initial ?? [],
    error: '',
  })
  return {
    view: () => (
      <section>
        <h1>Load tasks from JSON</h1>
        <label for="task-query">Search title</label>
        <input
          id="task-query"
          value={query()}
          onInput={(event: Event) => query.set((event.target as HTMLInputElement).value)}
        />
        <button type="button" onClick={() => reload.set((n) => n + 1)}>
          Refresh tasks
        </button>
        <div aria-live="polite" aria-busy={state().phase === 'loading' ? 'true' : 'false'}>
          {state().phase === 'idle' ? <p>Ready to load tasks in your browser.</p> : null}
          {state().phase === 'loading' ? <p>Loading tasks…</p> : null}
          {state().phase === 'error' ? <p role="alert">{state().error} Try Refresh tasks.</p> : null}
          {state().phase === 'ready' && state().rows.length === 0 ? <p>No matching tasks.</p> : null}
          <ul>
            {each(
              state().rows,
              (row) => row.id,
              (row) => (
                <li>
                  {row.title} — {row.done ? 'Done' : 'Open'}
                </li>
              ),
            )}
          </ul>
        </div>
      </section>
    ),
    mount({ lifetime }) {
      let first = true
      const stop = effect(() => {
        const term = query().trim().toLowerCase()
        const refresh = reload()
        // Server-provided data already represents the initial request.
        if (first && props.initial && !term && refresh === 0) {
          first = false
          return
        }
        first = false
        const request = new AbortController()
        let current = true
        state.set({ phase: 'loading', rows: [], error: '' })
        const timer = setTimeout(() => {
          void fetchTodos(props.endpoint, request.signal)
            .then((rows) => {
              if (current)
                state.set({
                  phase: 'ready',
                  rows: rows.filter((row) => row.title.toLowerCase().includes(term)),
                  error: '',
                })
            })
            .catch((error) => {
              if (current && !request.signal.aborted)
                state.set({
                  phase: 'error',
                  rows: [],
                  error: error instanceof Error ? error.message : 'Could not load tasks.',
                })
            })
        }, 250)
        // Runs before the next request and when the island is disposed.
        return () => {
          current = false
          clearTimeout(timer)
          request.abort()
        }
      })
      lifetime.addEventListener('abort', stop, { once: true })
    },
  }
}
export default taskSearch
