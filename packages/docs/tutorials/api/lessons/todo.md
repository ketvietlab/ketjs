---
title: "Grow the counter into a todo list"
description: "Handle form submission, derive counts, and preserve item identity with keyed lists."
stage: "Build the frontend"
duration: 40
lab: "Browser playground"
order: 5
---

Before you start: complete [Build a counter with signals](/learn/counter/), or make sure you can pass its checkpoint.

## Build the smallest useful workflow

Choose **Todo · keyed lists** in the [playground](/playground/). Add two tasks, mark one complete, and observe the remaining count. State exists only for the current preview instance; persistence comes later.

The local reference project adds this island in `src/islands/todo.tsx`:

```tsx
// File: learn-view/src/islands/todo.tsx
import { signal, each } from '@ketvietlab/ketjs-view'

export default function Todo(_props: Record<string, unknown>) {
  const tasks = signal([{ id: 1, title: 'Learn signals', done: false }])
  const draft = signal('')
  let nextId = 2
  function add(event: Event) {
    event.preventDefault()
    if (!draft().trim()) return
    tasks.set(rows => [...rows, { id: nextId++, title: draft().trim(), done: false }])
    draft.set('')
  }
  return () => <section>
    <h1>Your first todo app</h1>
    <form onSubmit={add}>
      <label for="task-title">Task title</label>
      <input id="task-title" value={draft()} onInput={(e: Event) => draft.set((e.target as HTMLInputElement).value)} />
      <button type="submit">Add task</button>
    </form>
    <ul>{each(tasks(), task => task.id, task => <li>
      <label><input type="checkbox" checked={task.done} onChange={() => tasks.set(rows => rows.map(row => row.id === task.id ? { ...row, done: !row.done } : row))} /> {task.title}</label>
    </li>)}</ul>
    <p>{tasks().filter(task => !task.done).length} tasks remaining. Reloading resets this in-memory example.</p>
  </section>
}
```

## Understand the three state decisions

`tasks` is the array signal. Every change returns a new array, making the update explicit. `draft` is the input signal. `nextId` is an instance-local counter; this educational UI does not need a database-generated ID yet.

`each(tasks(), task => task.id, ...)` identifies each rendered record by a stable ID. A task title can change and two tasks can share a title, so neither title nor the entire task content is a suitable identity key. Array positions also change when items move.

## Add a page for the island

Register `todo: 'src/islands/todo.tsx'` in the config's `islands` map. Then create:

```tsx
// File: learn-view/src/pages/todo.tsx
import { definePage, island } from '@ketvietlab/ketjs-view-tools'
import todo from '../islands/todo.tsx'
export default definePage({
 head: { title: 'Todo lab | learn-view', description: 'Add and complete tasks with signals and keyed lists.', lang: 'en' },
 view: () => <><header class="site-header"><a href="/">learn-view</a><nav><a href="/todo/">Todo</a><a href="/about/">About</a></nav></header><main>{island('todo', todo, {}, { key: [] })}</main></>,
})
```

## Test the interactions deliberately

Submit with Enter as well as the button. Submit whitespace and confirm that it adds nothing. Mark a task complete, add another, and ensure the first task's state stays attached to its ID. The remaining count is derived from the array; storing a second mutable count would create a synchronization problem.

## Know what this example does not persist

Reloading the page recreates the initial task. That is expected for this lesson. Later, the backend becomes the source of saved tasks, and a browser island owns pending/error state around API calls.

## Checkpoint

Whitespace is ignored, Enter submits, completion updates the count, and stable IDs keep each row attached to its data.

## Practice on your own

Add “Remove completed.” Use a new filtered array and verify that an unfinished task keeps its checkbox state and identity.

## Reference

For the complete API contract, read [Rendering](/docs/rendering/).
