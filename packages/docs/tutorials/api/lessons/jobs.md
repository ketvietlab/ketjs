---
title: "Run durable background work"
description: "Enqueue work transactionally, run a real worker, and design handlers that tolerate retries."
stage: "Go beyond requests"
duration: 45
lab: "Node terminal"
order: 26
---

Before you start: complete [Build navigation and translated messages](/learn/menus-i18n/), or make sure you can pass its checkpoint.

## Start with an observable job

The reference lab's `finishTodo` job sets a task's `done` field to true. It is intentionally small: you can see its result without configuring an email or cloud provider. Its handler declares a write effect and `idempotent: true`; setting the final state again has the same result.

The `scheduleCompletion` function verifies that the task is visible, marks it pending and enqueues the job in one transaction. The job's input is just the task ID. Company context is captured by the queue rather than being guessed from arbitrary browser input.

## Run the worker checkpoint

```bash
# Run from: learn_api
npm run learn -- check jobs
```

The checkpoint creates a task through the real function transport, queues completion, drains a test worker and reads the completed task back. It also checks that another company still sees no task.

## Run the process roles yourself

In the first terminal, start the API with `npm run learn -- serve`. In a second terminal, start the worker:

```bash
# Run from: learn_api
npm run learn -- worker
```

Both commands use the same file-backed lab database. An in-memory SQLite connection would give separate processes separate databases. The deployment declares the `learning` queue with concurrency one.

Call the scheduling operation using the function transport in a test or an explicitly owned development facade. Production applications should expose only their intended operations, with authenticated identity and grants.

## Reason about retries

A job may run again after a failure or an uncertain acknowledgement. `uniqueKey` prevents duplicate active work; it does not prove an external action happened exactly once. If you later send email, use the provider's idempotency mechanism and retain a business-level record of the outcome.

Respect the job abort signal for work that can be cancelled. Keep timeouts and maximum attempts meaningful. A permanently invalid payload should not spend days retrying without an observable failure.

## Extend to schedules

Scheduled jobs use the declaration's schedule contract. A scheduled sweep has no company by default; cross-company maintenance needs an explicit design. Decide what should happen to missed ticks after downtime instead of assuming every missed interval is replayed.

## Checkpoint

The jobs checkpoint passes and you can explain why HTTP and worker roles need a shared file-backed datastore.

## Practice on your own

Make a scratch handler fail once, observe a retry, and verify the task ends in one correct final state. Then describe how an external email would need a stronger idempotency contract.

## Reference

For the complete API contract, read [Jobs](/docs/jobs/).
