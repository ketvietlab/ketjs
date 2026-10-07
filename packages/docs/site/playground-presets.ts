// Each example exports an instance factory, just like an island's view factory.
export const presets = [
  {
    id: 'counter',
    label: 'Counter · signals',
    lesson: '/learn/counter/',
    code: `// File: src/islands/counter.tsx
import { signal } from '@ketvietlab/ketjs-view'

export default function Counter() {
  const count = signal(0)
  return () => <section>
    <h1>A reactive counter</h1>
    <p aria-live="polite">Count: {count()}</p>
    <button type="button" onClick={() => count.set(n => n + 1)}>Add one</button>
  </section>
}
`,
  },
  {
    id: 'todo',
    label: 'Todo · keyed lists',
    lesson: '/learn/todo/',
    code: `// File: src/islands/todo.tsx
import { signal, each } from '@ketvietlab/ketjs-view'

export default function Todo() {
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
`,
  },
  {
    id: 'website',
    label: 'Website · pure TSX',
    lesson: '/learn/static-website/',
    code: `// File: src/pages/index.tsx
export default function Website() {
  const features = ['Pure TSX views', 'Static generation', 'Islands for interaction']
  return () => <main>
    <p>BUILT WITH KETJS-VIEW</p>
    <h1>Ship a small website.</h1>
    <p>This view uses no signals or browser effects. The same TSX can render at build time.</p>
    <ul>{features.map(feature => <li>{feature}</li>)}</ul>
    <a href="https://ketjs.dev/learn/static-website/" target="_blank" rel="noopener noreferrer">Build the complete static project</a>
  </main>
}
`,
  },
  {
    id: 'validation',
    label: 'Form · shared validation',
    lesson: '/learn/forms/',
    code: `// File: src/islands/signup.tsx
import { signal, defineFormSchema, validateForm } from '@ketvietlab/ketjs-view'

export default function Signup() {
  const schema = defineFormSchema({ fields: { email: { type: 'text', required: true, trim: true, pattern: /^[^@]+@[^@]+$/ } }, unknown: 'reject' })
  const message = signal('Enter an email address.')
  return () => <form onSubmit={(event: Event) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const result = validateForm(schema, { email: new FormData(form).get('email') })
    message.set(result.valid ? 'Valid input. The server must validate it again.' : 'Please enter a valid email.')
  }}>
    <h1>Validate a form</h1>
    <label for="email">Email</label>
    <input id="email" name="email" type="text" />
    <button type="submit">Check input</button>
    <p role="status">{message()}</p>
  </form>
}
`,
  },
]
