---
title: "Connect an island to the API"
description: "Manage pending, success and error states around a real request while preserving user input."
stage: "Build the API"
duration: 40
lab: "Browser + local API"
order: 21
---

Before you start: complete [Document and inspect API contracts](/learn/api-contracts/), or make sure you can pass its checkpoint.

Before connecting the backend, complete [Data fetching](/learn/data-fetching/). It supplies a runnable loader with HTTP/JSON validation, cancellation, race protection and explicit UI states. Change its endpoint from `/data/todos.json` to `/api/todos` once both run behind the same local origin. The local API list response uses the same array contract.

## Establish the origin first

The online playground does not contact a backend on the learner's machine. Run this exercise locally. Serve the UI and API through one origin, or deliberately configure a development proxy. A browser origin includes scheme, hostname and port; `localhost:3700` and `localhost:3711` are different origins.

For a first integration, keep the UI's request function independent of rendering. The code below belongs inside an island factory and is called by a browser event handler:

```tsx
// File: learn-view/src/islands/api-todo.tsx
// Inside the island factory; import signal from @ketvietlab/ketjs-view.
const pending = signal(false)
const error = signal('')
async function createTask(title: string) {
  if (pending()) return
  pending.set(true)
  error.set('')
  try {
    const response = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!response.ok) throw new Error(`Task was not saved (${response.status}).`)
    return await response.json()
  } catch (cause) {
    error.set(cause instanceof Error ? cause.message : 'Task was not saved.')
    return null
  } finally {
    pending.set(false)
  }
}
```

## Make server state authoritative

Clear the title draft only after a successful response. Insert the server-returned record, including its generated ID, into the task list. Disable duplicate submissions while pending. If the server rejects a title, keep the user's draft and display the returned validation details when available.

Do not send a company identifier as trusted authority from a hidden input. The deployed server must obtain identity and permissions from its configured authentication contract. For the lab's development header, configure it only in your local development setup.

## Load data after the correct boundary

If the page already contains an SSR projection, use that as deterministic initial props. Start browser-only refresh work in `mount`, and abort outstanding requests when the island lifetime ends. If this is a purely client-rendered local example, show an explicit loading state and then an empty or populated result.

## Test failure paths

Stop the API and submit a task. The draft must remain. Restart the API and retry. Return a validation error, a 404 and an unexpected server error. Give the user an actionable message while keeping stack traces out of the interface.

This lesson is an integration exercise: the standalone downloaded View project remains usable independently, and the API project remains headless. Connecting them requires choosing the local serving/proxy boundary described above.

## Checkpoint

A successful request uses the server ID; failed requests preserve input; pending state prevents accidental duplicate submissions.

## Practice on your own

Add request cancellation when the island is disposed. Compare a pessimistic update with an optimistic update and describe the rollback state the latter needs.

## Reference

For the complete API contract, read [Rendering](/docs/rendering/).
