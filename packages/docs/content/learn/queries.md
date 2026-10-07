---
title: "Read and order data with queries"
description: "Use checked table handles, explicit projections and predictable ordering to build your task list."
stage: "Work with data"
duration: 30
lab: "Node terminal"
order: 16
---

Before you start: complete [Model tasks and company scope](/learn/models/), or make sure you can pass its checkpoint.

## Follow the list function

The reference lab declares `effects: ['read:learn_api.Todo']`. Inside its handler:

```ts
// File: learn_api/modules/learn_api.ts
// Inside the list handler; import from and asc from @ketvietlab/ketjs.
const Todo = ctx.table('learn_api.Todo')
return ctx.db.all(
  from(Todo).select(Todo.id, Todo.title, Todo.done).orderBy(asc(Todo.title)),
)
```

`ctx.table()` returns checked column handles. Use those handles in expressions instead of interpolating column names or request strings into SQL. The query is a value; `ctx.db.all()` executes it under the current function's effects and row scope.

## Add a filter

Import `eq` and add `.where(eq(Todo.done, false))` to return unfinished tasks. Create one done task and one unfinished task, then compare the output. Keep a separate all-tasks operation if other callers need the unfiltered list; silently changing a shared function's meaning affects every caller.

## Make output deliberate

The projection selects the three fields the UI needs. A future internal field should not automatically become a public API response. Ordering is explicit, so the same dataset produces a predictable list. For real pagination, include a stable tie-breaker when titles can repeat.

Use `ctx.db.one()` for a lookup that may return no row and handle that absence explicitly. An empty list is a successful list result; a missing record may become a 404 at the HTTP facade.

## Verify the scope boundary

Create a task using company `alpha`, then list using `beta`. The second company should see an empty result. Do not add an ad hoc company predicate to every application query and assume that replaces the framework scope contract.

## Avoid premature optimization

First measure a representative query with realistic row counts and its intended index. Limit selected data and page large lists. A fast empty-table query says little about a production list with relations and filters.

## Checkpoint

The list returns only its projected fields, has deliberate ordering, and respects company scope.

## Practice on your own

Add an unfinished-only function with its own name and read effect. Test an empty dataset, repeated titles, and two companies.

## Reference

For the complete API contract, read [Data](/docs/data/).
