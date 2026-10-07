---
title: "Validate writes with functions and changesets"
description: "Create tasks through a named operation with checked input, declared effects and controlled writable fields."
stage: "Work with data"
duration: 40
lab: "Node terminal"
order: 17
---

Before you start: complete [Read and order data with queries](/learn/queries/), or make sure you can pass its checkpoint.

## Put the write behind an operation

The reference project uses `learn_api.create`. The function input accepts a title, declares a write effect, normalizes the title, and constructs a changeset. Open the implementation and follow these lines:

```ts
// File: learn_api/modules/learn_api.ts
// Inside create.handler; randomUUID is imported from node:crypto.
const changes = ctx.change('learn_api.Todo', { title: String(input.title).trim() })
  .cast(['title'])
  .required(['title'])
  .validate('title', value => String(value).length <= 120 || 'Use 120 characters or fewer')
  .put('id', randomUUID())
  .put('done', false)
await ctx.db.commit(changes)
return changes.changes
```

## Separate the checks

The function signature rejects unsupported input shapes before the handler. The changeset chooses writable fields and applies business validation. Server-owned ID and initial completion state are added with `put`, rather than accepting arbitrary fields from a client.

The effect declaration is another boundary: this handler may write the Todo model. It does not gain unrestricted database access merely because it runs on the server. Permissions decide who can call the operation; effects bound what that operation can do.

## Exercise success and failure

Start the completed lab and send a title with surrounding spaces:

```bash
# Run from: learn_api
curl -i http://127.0.0.1:3711/api/todos   -H 'X-Ket-Company: lab' -H 'Content-Type: application/json'   --data '{"title":"  Learn changesets  "}'
```

Expect a created task whose title has been trimmed and whose `done` value is false. Repeat with an empty title and a title longer than 120 characters. Neither should create a row. Inspect both the status and structured error; domain changeset failures and signature/form transport failures are distinct contracts.

## Update without replacing the record

`learn_api.complete` first reads the scoped current record, then casts only `done` and commits with `{ id: current.id }`. It returns null if the record is not visible. This prevents an update from silently becoming an insert or exposing another company's row.

## Explore replay and dry-run deliberately

KetJS supports declared idempotency and dry-run behavior. Add those only when the operation's semantics support them, then test repeated keys, changed payloads and effects. Marking an operation does not make an external side effect reversible automatically.

## Checkpoint

Valid writes are normalized, invalid writes leave no row, and update callers cannot replace server-owned fields.

## Practice on your own

Try supplying an extra `done` property to create. Explain which boundary rejects it. Add a test for a 121-character title.

## Reference

For the complete API contract, read [Functions](/docs/functions/).
