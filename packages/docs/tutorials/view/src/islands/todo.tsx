// File: src/islands/todo.tsx
import { signal, each } from '@ketvietlab/ketjs-view'

export default function Todo(_props: Record<string, unknown>) {
  const tasks = signal([{ id: 1, title: 'Learn signals', done: false }])
  const draft = signal('')
  let nextId = 2
  function add(event: Event) {
    event.preventDefault()
    if (!draft().trim()) return
    tasks.set((rows) => [...rows, { id: nextId++, title: draft().trim(), done: false }])
    draft.set('')
  }
  return () => (
    <section>
      <h1>Your first todo app</h1>
      <form onSubmit={add}>
        <label for="task-title">Task title</label>
        <input
          id="task-title"
          value={draft()}
          onInput={(e: Event) => draft.set((e.target as HTMLInputElement).value)}
        />
        <button type="submit">Add task</button>
      </form>
      <ul>
        {each(
          tasks(),
          (task) => task.id,
          (task) => (
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() =>
                    tasks.set((rows) =>
                      rows.map((row) => (row.id === task.id ? { ...row, done: !row.done } : row)),
                    )
                  }
                />{' '}
                {task.title}
              </label>
            </li>
          ),
        )}
      </ul>
      <p>
        {tasks().filter((task) => !task.done).length} tasks remaining. Reloading resets this in-memory
        example.
      </p>
    </section>
  )
}
