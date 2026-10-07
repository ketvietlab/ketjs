---
title: "Keep related writes atomic"
description: "Use one transaction context for business changes and queued work, and design a rollback experiment."
stage: "Work with data"
duration: 35
lab: "Node terminal"
order: 18
---

Before you start: complete [Validate writes with functions and changesets](/learn/changesets/), or make sure you can pass its checkpoint.

## Choose an invariant

Suppose a task is marked pending and then scheduled for background completion. The application must not commit the pending change while losing the corresponding job. The reference lab's `scheduleCompletion` function wraps both actions in `ctx.tx`.

```ts
// File: learn_api/modules/learn_api.ts
// Inside scheduleCompletion.handler.
return ctx.tx(async tx => {
  const Todo = tx.table('learn_api.Todo')
  const current = await tx.db.one(from(Todo).where(eq(Todo.id, String(input.id))))
  if (!current) return null
  await tx.db.update('learn_api.Todo', { id: input.id }, { done: false })
  return tx.jobs.enqueue('learn_api.finishTodo', { id: input.id }, {
    uniqueKey: `finish:${input.id}`,
  })
})
```

## Keep every operation on the transaction context

Use `tx.db` and `tx.jobs` inside the callback. Accidentally reaching back to an unrelated connection or outer context can split the invariant across transactions. Declare the read, write and enqueue effects on the producing function.

The unique key coalesces active duplicate work. It does not replace business idempotency: a completed job may be submitted again later, and a worker may retry a handler.

## Run a rollback experiment

In a disposable copy, create a completed task. Add a temporary `throw new Error('rollback exercise')` after the update and before the enqueue. Invoke the function and confirm it fails. Read the task again: it should still be completed. Then remove the throw and run the jobs checkpoint.

Do not use an outbound email request as part of this first experiment. A database rollback cannot unsend a message. Queue external work atomically, and make the eventual handler safe to retry.

## Avoid a read-then-write race

A transaction gives a boundary, but it does not mean every business decision is automatically concurrency-safe. For counters or stock reservations, use the documented atomic operation or an appropriate condition rather than calculating from a stale value in application memory.

Keep transactions short. Do not hold a database transaction open while waiting for a person, a slow network call or a browser interaction.

## Checkpoint

Explain the pending-task/job invariant and demonstrate that an injected failure rolls back the business change.

## Practice on your own

Write the expected state for failure before the update, between update and enqueue, and after a successful commit. Separate database state from external side effects.

## Reference

For the complete API contract, read [Data](/docs/data/).
