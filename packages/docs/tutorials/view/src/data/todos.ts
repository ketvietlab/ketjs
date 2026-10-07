export type Todo = { id: string; title: string; done: boolean }

export async function fetchTodos(endpoint: string, signal: AbortSignal): Promise<Todo[]> {
  const response = await fetch(endpoint, { signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Could not load tasks (${response.status}).`)
  const data: unknown = await response.json()
  if (
    !Array.isArray(data) ||
    !data.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        typeof row.id === 'string' &&
        typeof row.title === 'string' &&
        typeof row.done === 'boolean',
    )
  ) {
    throw new Error('The server returned an unexpected task list.')
  }
  return data as Todo[]
}
