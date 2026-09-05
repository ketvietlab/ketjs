---
title: Durable jobs and workers
description: Declare, enqueue, execute, retry, inspect, and operate KetJS background jobs.
---

KetJS jobs are durable rows in the application database. Enqueueing may share a transaction with
business data, and a separate worker process claims jobs with leases. Redis is not required.

## Declare a job

```ts
// File: src/modules/sales/index.ts
import { defineJob, defineModule } from '@ketvietlab/ketjs'

export const sales = defineModule({
  name: 'sales',
  jobs: {
    sendConfirmation: defineJob({
      queue: 'mail',
      input: { orderId: 'id' },
      effects: ['read:sales.Order', 'transport:send'],
      idempotent: true,
      maxAttempts: 8,
      timeoutMs: 30_000,
      handler: async (ctx, { orderId }) => {
        const order = await loadOrder(ctx, String(orderId))
        await ctx.transport.send({
          idempotencyKey: `sales.confirmation:${order.id}`,
          from: { address: 'orders@example.com', name: 'Orders' },
          to: [{ address: order.email }],
          subject: `Order ${order.number}`,
          text: `Your order ${order.number} is confirmed.`,
        })
      },
    }),
  },
})
```

`idempotent: true` is mandatory because delivery is at least once. The queue defaults to `default`;
declare operationally meaningful queues when workloads need different concurrency.

The job context extends the normal function context with:

- `job`: execution ID, key, queue, current attempt, and maximum attempts;
- `signal`: aborted on timeout or shutdown;
- `storage`: tenant-namespaced storage wrapped by declared effects;
- `transport`: configured outbound transport wrapped by declared effects.

## Enqueue atomically

The producer declares the enqueue effect:

```ts
// File: src/modules/export/jobs.ts
functions: {
  confirmOrder: {
    input: { orderId: 'id' },
    effects: [
      'write:sales.Order',
      'enqueue:sales.sendConfirmation',
    ],
    handler: (ctx, { orderId }) =>
      ctx.tx(async (tx) => {
        await tx.db.update(
          'sales.Order',
          { id: orderId },
          { status: 'confirmed' },
        )
        return tx.jobs.enqueue(
          'sales.sendConfirmation',
          { orderId },
          { uniqueKey: `confirmation:${orderId}` },
        )
      }),
  },
}
```

If the transaction rolls back, neither the business update nor the durable job remains. PostgreSQL
publishes its wake-up notification on the same transaction connection and only after commit.

## Scheduling, priority, and uniqueness

`jobs.enqueue()` accepts:

```ts
// File: src/modules/export/jobs.ts
await ctx.jobs.enqueue('billing.issueInvoice', { orderId }, {
  runAt: new Date(Date.now() + 5 * 60_000),
  priority: 10,
  uniqueKey: `invoice:${orderId}`,
})
```

- Lower priority numbers run first.
- `runAt` schedules future availability.
- `uniqueKey` coalesces active jobs with the same job name and key.

Queue uniqueness prevents duplicate active delivery; it does not replace business idempotency. A key
is released after a terminal state, and an at-least-once worker may still retry a handler whose result
was committed externally before acknowledgement.

## Run a job on a schedule

A job may declare when it runs on its own. The schedule is part of the manifest, so `ket manifest`
prints it, `ket diff` compares it, and `ket check` rejects one that does not parse.

```ts
// File: src/modules/hotel/jobs.ts
import { defineJob } from '@ketvietlab/ketjs'

export const jobs = {
  catchUp: defineJob({
    idempotent: true,
    schedule: { every: '15m' },
    handler: async (ctx) => { /* reconcile whatever a webhook may have dropped */ },
  }),
  nightAudit: defineJob({
    idempotent: true,
    schedule: { dailyAt: '03:00', timezone: 'Asia/Ho_Chi_Minh' },
    crossCompany: true,
    handler: async (ctx) => { /* see below */ },
  }),
}
```

`every` takes a count and one of `s m h d`, no shorter than ten seconds. `dailyAt` takes 24-hour
`HH:MM` in `timezone`, defaulting to `KET_TIMEZONE` — a wall clock is the only way to say "after the
shop closes", and it is the reason a timezone has to be named rather than assumed from the server.

A scheduled job takes no arguments, because nobody is there to supply them; a required input is a
composition error rather than a validation failure at three in the morning.

### Once per tenant, with no company

A schedule fires once per tenant database and the job runs with **no company scope**. The framework
knows which tenants exist; it does not know what a company is. A job with per-company work declares
`crossCompany` to see them and hands each one its own job:

```ts
// File: src/modules/hotel/jobs.ts
handler: async (ctx) => {
  for (const company of await ctx.db.select('company.Company')) {
    await ctx.jobs.enqueue('hotel.closeDay', {}, { company: String(company.id) })
  }
}
```

`company` on `enqueue` is refused unless the enqueuing operation declares `crossCompany`, because
only that declaration let it see more than one company in the first place — and the declaration is
in the manifest where an upgrade diff can show it.

### Exactly once, without electing a leader

Every replica sweeps. Each schedule keeps one row per tenant holding the last tick anybody enqueued,
and a tick is claimed by moving that row forward with a compare-and-set: whoever's update changes a
row won, and the others get nothing. The queue's `uniqueKey` is not enough on its own, because it
holds only while a job is live and is released the moment one completes.

The claim happens **before** the enqueue, so a crash between the two loses a tick rather than running
it twice.

### Missed ticks are skipped, not replayed

A schedule seen for the first time does not fire for the tick it was installed inside — a nightly job
firing the moment it is deployed is a surprise at the worst moment. After downtime, the next sweep
jumps to the current tick and runs once: three days off produce one run, not three. The
`schedule_fired` record carries how many ticks were passed over, so the gap is visible rather than
silent, and a job that needs to know what it missed can read its own ledger.

### Cost

The sweep is one small statement per scheduled job per tenant, every `worker.scheduleSweepMs`
(default 30s). A deployment with many tenants and a minute of tolerance should raise it.

## Configure the worker

Every shipped queue must be configured on the deployment:

```ts
// File: src/deployment.ts
const deployment = defineDeployment({
  name: 'erp',
  modules: [sales],
  headless: true,
  serve: {},
  worker: {
    queues: {
      mail: 4,
      maintenance: 1,
    },
    pollMinMs: 50,
    pollMaxMs: 2_000,
    tenantRefreshMs: 30_000,
    leaseMs: 30_000,
    shutdownGraceMs: 15_000,
  },
})
```

Run separate production roles:

```bash
# Run from: /path/to/example-app
ket serve --deployment erp --workspace dist/ket.workspace.js
ket worker --deployment erp --workspace dist/ket.workspace.js
```

In development:

```bash
# Run from: /path/to/ketjs
ket dev --all --deployment erp --workspace dist/ket.workspace.js
```

## Delivery model

Job states are `available`, `scheduled`, `executing`, `retryable`, `completed`, `discarded`, and
`cancelled`.

```mermaid
%% File: docs/src/content/docs/ketjs/jobs.md
stateDiagram-v2
  direction LR
  [*] --> available
  scheduled --> available: due
  retryable --> available: due or operator retry
  available --> executing: claim and lease
  executing --> completed: success
  executing --> retryable: failure, attempts remain
  executing --> retryable: lease expires
  executing --> discarded: maximum attempts
  available --> cancelled
  scheduled --> cancelled
  retryable --> cancelled
```

Workers:

1. claim due jobs in priority and schedule order;
2. assign a worker ID and lease deadline;
3. heartbeat long-running work;
4. complete successful work;
5. retry failures with preserved error history;
6. discard after `maxAttempts`;
7. rescue expired leases after a worker crash.

PostgreSQL `LISTEN/NOTIFY` shortens wake-up latency. Polling and database leases remain the guarantee,
so lost notifications do not lose jobs.

## Timeouts and cancellation

Observe `ctx.signal` in provider calls and long loops:

```ts
// File: src/modules/export/jobs.ts
await ctx.transport.send(message, { signal: ctx.signal })

for (const item of items) {
  ctx.signal.throwIfAborted()
  await processItem(item)
}
```

`timeoutMs` aborts the signal; it cannot forcibly roll back an arbitrary external side effect. Use
idempotency keys and provider APIs that accept abort signals.

## Operator commands

```bash
# Run from: /path/to/ketjs
ket jobs list --state retryable --queue mail --limit 50
ket jobs retry JOB_ID
ket jobs cancel JOB_ID
ket jobs prune
```

Tenant applications require `--tenant NAME`. `retry` makes retryable or discarded work available now
while preserving attempt history. `cancel` applies to nonterminal work. `prune` uses the built-in
retention policy for terminal rows.

## Testing jobs

`createTestDeployment()` opens a worker handle for deployments with worker configuration but does not leave a polling
loop running. Drain explicitly where the scenario expects asynchronous work to settle:

```ts
// File: src/modules/export/jobs.ts
await e2e.client.call('sales.confirmOrder', { orderId: 'o1' })
const completed = await e2e.drainJobs()
assert.equal(completed, 1)
```

Use `worker: false` when the test intentionally verifies queued state without executing jobs.

## Job design rules

- Make handlers safe when invoked more than once.
- Derive external provider idempotency keys from stable business identity.
- Keep input small; store large payloads in models or storage and enqueue references.
- Declare every data, enqueue, storage, and transport effect.
- Check the abort signal during long work.
- Separate queues only when their concurrency or operational priority differs.
- Monitor retryable, discarded, executing, and lease-age counts.
- Keep HTTP and worker deployments on the same application artifact and manifest version.
