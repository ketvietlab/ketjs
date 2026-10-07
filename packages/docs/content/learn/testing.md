---
title: "Test the deployment you actually ship"
description: "Exercise real HTTP, scoped data and workers with isolated deployment fixtures and targeted checkpoints."
stage: "Verify and operate"
duration: 40
lab: "Node terminal"
order: 29
---

Before you start: complete [Expose reports and agent capabilities](/learn/reports-agents/), or make sure you can pass its checkpoint.

## Start at a meaningful boundary

A handler test can be useful, but an API workflow also depends on routing, identity, parsing and transport. `createTestDeployment` boots an isolated application so the test can exercise those layers together and clean up afterward.

The backend lab's API checkpoint is:

```ts
// File: learn_api/test/deployment.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { deployment } from '../ket.workspace.ts'

test('learn_api: real HTTP CRUD, validation and method contracts', async () => {
  const e2e = await createTestDeployment(deployment, { worker: false, client: { company: 'test' } })
  try {
    const created = await e2e.client.request('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '  Learn KetJS  ' }) })
    assert.equal(created.status, 201)
    const todo = await created.json() as { id: string; title: string; done: boolean }
    assert.equal(todo.title, 'Learn KetJS')
    assert.equal(todo.done, false)
    const listed = await e2e.client.request('/api/todos')
    assert.deepEqual(await listed.json(), [todo])
    const done = await e2e.client.request(`/api/todos/${todo.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) })
    assert.equal(done.status, 200)
    assert.equal((await done.json() as { done: boolean }).done, true)
    const invalid = await e2e.client.request('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '' }) })
    assert.equal(invalid.status, 400)
    const wrongMethod = await e2e.client.request('/api/todos', { method: 'DELETE' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get('Allow'), 'GET, POST')
  } finally { await e2e.close() }
})
```

## Run a focused checkpoint

```bash
# Run from: learn_api
npm run learn -- check api
npm run learn -- check isolation
npm run learn -- check jobs
```

Each command selects one explicit test file after compiling this lab. `api` covers the HTTP workflow, `isolation` covers company visibility/update denial, and `jobs` covers durable execution. A green result does not imply that every possible authentication integration or database provider was tested.

## Distinguish actions from fixtures

Use `lab.client` for the business behavior under test. Fixture channels exist for setup and invariant inspection; they should not replace the public boundary you intend to verify. Otherwise a test may bypass the very permission or route behavior it claims to exercise.

Always close the deployment in `finally`, including when an assertion fails. Use a disposable database path and avoid external accounts or production state.

## Prove that a test detects a defect

Temporarily remove title trimming from the create function. The API test should fail because it expects the normalized title. Restore the implementation. Repeat with the job's final state update. This small mutation experiment checks that the assertion is tied to behavior rather than merely executing lines.

## Add the next test from a risk

Add a malformed JSON test because body parsing is part of your API contract. Add a denied-user test when you implement real sessions/grants. Add a live PostgreSQL test when adopting that adapter. Do not run unrelated deployments' suites simply because they live in the same repository.

## Checkpoint

The three named checkpoints pass; an intentional implementation defect makes the relevant checkpoint fail; cleanup still occurs.

## Practice on your own

Add one missing-record or malformed-body assertion. Name the behavior it protects and demonstrate a mutation that would fail it.

## Reference

For the complete API contract, read [Testing](/docs/testing/).
