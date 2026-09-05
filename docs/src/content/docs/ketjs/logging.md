---
title: Operational logging
description: Drivers, the event catalogue, redaction, and how KetJS records what a deployment is doing.
---

KetJS writes structured operational records: what a request did, how long a function took, which
call was refused, why a job was discarded. Records leave the process immediately and the
application can never read them back.

## Logging is not an audit trail

These are two different systems, and building either with the other's machinery is expensive to
undo later.

| | Audit trail | Operational log |
| --- | --- | --- |
| Lives in | the tenant's database | stderr, a file, or a collector |
| Lifetime | permanent, append-only | days |
| Readable by the application | yes | no |
| Part of a domain contract | yes | no |
| A transaction rolls back | the row goes with it | the record still goes out |

The last row is the sharp edge. A record written inside `ctx.tx()` that later rolls back is still
emitted, because the attempt was real and knowing that it failed is the whole point. An audit row
must disappear with the data it describes. KetSuite already has an audit trail — `pos.AuditEvent` —
and this is not it.

## Configuration

```text
# File: .env
KET_LOG=auto            # auto | console | pretty | file | null
KET_LOG_LEVEL=info      # debug | info | warn | error
KET_LOG_STREAM=stderr   # stderr | stdout
KET_LOG_DIR=.ket/log    # KET_LOG=file only
KET_LOG_BUFFER=10000    # records a batching driver may hold
```

`auto` writes readable columns when stderr is a terminal and NDJSON when it is not, so a developer
and a container get the right thing without configuring it.

Every value is validated when the process boots. A misspelt driver fails immediately with
`E_LOG_CONFIG` rather than at the first record.

### stderr, not stdout

`ket manifest`, `ket agent` and `ket permissions --json` write their answer to stdout. A log line
interleaved into that answer breaks `ket manifest | jq` for everything downstream, so stdout
belongs to the program's output and logging is a side channel. A container runtime collects both.

## Drivers

A driver is a sink. The framework ships the ones that need nothing but Node:

| Driver | Use |
| --- | --- |
| `consoleLog()` | NDJSON, one record per line. The production default |
| `prettyLog()` | Aligned columns for a person. The development default |
| `fileLog({ dir })` | Appends and rotates. For a host without a collector |
| `memoryLog()` | Keeps records for a test to assert on |
| `nullLog()` | Discards everything |

Anything needing a client library belongs to the deployment, behind `serve.openLog` — the same
fence that keeps database drivers out of the framework. Return a fresh driver per call: a process
running both roles opens the sink once for HTTP and once for the worker, and closes each with its
own role, so a memoised instance is closed by whichever shuts down first.

```ts
// File: src/deployment.ts
import { bufferedLog, consoleLog, defineDeployment, isolatedLog, multiLog } from '@ketvietlab/ketjs'

export const app = defineDeployment({
  name: 'app',
  modules: [],
  serve: {
    openLog: () =>
      multiLog([
        // Always keep a sink that cannot fail on the network.
        consoleLog(),
        isolatedLog(bufferedLog(myCollector())),
      ]),
  },
})
```

### Composing behaviour

Drivers stay primitive; behaviour is composed.

| Combinator | Effect |
| --- | --- |
| `multiLog(drivers)` | Fan out. One driver throwing never stops the others |
| `leveledLog(driver, min)` | Drop anything below `min` |
| `bufferedLog(driver, options)` | Batch, with a bound on memory |
| `isolatedLog(driver, fallback)` | Swallow a driver's failures and report once |
| `redactLog(driver)` | Applied by the runtime; not optional |

The runtime wraps whatever `openLog` returns in `redactLog` and `isolatedLog` before anything uses
it, so a sink that throws cannot break the work it describes. That guarantee is structural rather
than a convention: a record is emitted after a function has already committed and after an
idempotency key has been marked done, so a sink allowed to throw there would report a failure for
work that succeeded.

`bufferedLog` drops the *newest* record when it is full, because in a cascade the first failure is
the cause and the tail is repetition. A slice of the bound is reserved for error-level records so a
flood of `info` cannot bury the errors explaining it, and whatever was dropped is announced as a
`log_dropped` record. A silent gap is worse than a gap: it cannot be told apart from quiet.

## The event catalogue

An event name is a contract. Dashboards and alerts key on it, so renaming one breaks an alert
silently — the same care applies as to renaming a permission.

| Event | Level | Meaning |
| --- | --- | --- |
| `boot` | info | A process composed its manifest and opened its sink |
| `shutdown` | info | A process finished closing |
| `http_request` | info | One served request, with its route pattern and status |
| `unhandled` | error | An exception escaped the request handler, with its stack |
| `fn_call` | info | A server function returned |
| `fn_error` | warn / error | A server function failed |
| `fn_denied` | warn | A caller invoked a function it may not call |
| `policy_denied` | warn | A record-level domain policy refused an operation |
| `job_started` | info | A worker claimed a job |
| `job_completed` | info | A job finished |
| `job_retrying` | warn | A job failed and will be attempted again |
| `job_discarded` | error | A job exhausted its attempts |
| `job_cancelled` | warn | A job's lease was lost or it was cancelled |
| `job_ignored_abort` | error | A handler kept working after it was aborted |
| `rate_limited` | warn | A caller exceeded a declared ceiling and was refused |
| `rate_pruned` | info | Stale rate counters were removed from a tenant |
| `schedule_fired` | info | A due schedule enqueued its job, with the tick and how many were skipped |
| `schedule_error` | error | A tenant's schedule sweep failed; other tenants continue |
| `worker_tick_error` | error | A worker poll pass threw |
| `queue_notifier_unavailable` | warn | LISTEN/NOTIFY could not be subscribed; polling remains the guarantee |
| `log_dropped` | warn | Records were discarded, with how many and why |
| `log_driver_failed` | error | A sink threw; its records are being lost |

A module's own events must be namespaced `module.event`, the same shape a domain policy key has.

`fn_error` is a warning when the failure is a `KetError` and an error otherwise: a `KetError` is a
contract this system named and expected to reject, while anything else escaped a `try` nobody
wrote. Only the second kind carries a stack, and only the second kind should wake somebody up.

## What a record contains

```text
# File: example record
{"at":"2026-09-04T09:12:44.118Z","level":"info","event":"fn_call","deployment":"commerce",
 "process":"http","tenant":"acme","trace":"a3f9c21e8b4d5607","fn":"sale.confirmOrder",
 "actor":"5f1c…","company":"acme","durationMs":41}
```

`dryRun` and `replayed` appear when they are true. They matter: a preview is not an execution and
an idempotent replay is not a second one, and a dashboard that cannot tell the difference will
count one order twice.

### Route patterns, not paths

`http_request` records `/reports/{report}/{id}`, never `/reports/sales/8f3a?email=…`. A raw path
carries record identifiers and a query string, which is the ordinary way customer data reaches a
log aggregator. An unmatched path is recorded as `(unmatched)` for the same reason — the status
already says what happened.

### Correlation and actors are hashed

`ctx.correlationId` is request metadata, not a secret store, and the framework never exports it
raw. `trace` and `actor` are HMAC-SHA256 of the value keyed by `KET_SECRET`, truncated to 64 bits.

The key is the deployment secret for two reasons. A correlation id is often a client-chosen command
key, so a bare digest of `order-42` is recovered by guessing — acceptable inside one tenant's own
database, not acceptable in an aggregator shared by every tenant. And `KET_SECRET` is already
required to be identical on every pod, so a web process and a worker process derive the same trace
for the same request. Without a secret the framework falls back to a namespaced digest and says so
in the `boot` record's `traceKeyed` field.

To find one actor's records, hash the identifier the same way and search for the result.

### Fields are scalars

```ts
// File: src/modules/sales/functions.ts
ctx.log.info('sales.order_confirmed', { orderId: order.id, lines: order.lines.length })
```

`LogFields` accepts `string | number | boolean | null` and nothing else, so
`ctx.log.info('saved', { input })` does not compile. That is the point: passing a whole payload is
the usual way customer data reaches an aggregator. Values arriving from JavaScript callers or from
`catch (e)` are sanitized at runtime as well — non-scalars are replaced, keys that look like
secrets are masked, and long strings are clipped.

## Logging from a function

`ctx.log` already carries the deployment, tenant, function, hashed correlation, hashed actor and
company, so a call site cannot forget its context:

```ts
// File: src/modules/stock/functions.ts
handler: async (ctx, args) => {
  const picking = await reserve(ctx, args)
  ctx.log.info('stock.reserved', { pickingId: picking.id, lines: picking.lines })
  return picking
}
```

Context is bound, never ambient. There is no `AsyncLocalStorage` here: `ctx` exists so that "the
call forgot its context" cannot be written down, and a module-scope logger picking up its tenant
from ambient state is the pattern that rule rejects. Everything in KetJS is already handed a `ctx`,
so ambient propagation would buy nothing and cost the invariant.

Logging is deliberately **not** an effect. Effects exist to make a side effect that would corrupt
data impossible to perform undeclared; a forgotten log corrupts nothing, and requiring every
function to declare `log:write` would add noise to every manifest without discriminating anything.
A module cannot choose a destination — only the deployment can, through `serve.openLog` — so a
module can never turn a log call into undeclared network egress.

## Recording a policy denial

```ts
// File: src/modules/sale/functions.ts
await enforcePolicy({
  policy: 'sale.order-approval',
  allowed: approver !== order.createdBy,
  denialCode: 'E_SALE_SELF_APPROVAL',
  targetDigest: digest(order.id),
  log: ctx.log,
})
```

`log` and `audit` are separate and both are worth having: `audit` writes durable evidence into the
tenant's own data, and `log` makes the denial visible to whoever is watching the deployment.

## Testing

`createTestDeployment` captures every record instead of printing it, so a suite stays readable and
a security contract can assert that a denial was *observable* — a denial nobody can see is a denial
nobody can alert on:

```ts
// File: test/permissions.test.ts
const app = await createTestDeployment(spec, { worker: false })
await assert.rejects(() => app.fixture.call('sale.confirm', {}, { allow: [] }))

const denied = app.records.first('fn_denied')
assert.equal(denied?.fn, 'sale.confirm')
```

`app.records` is a `memoryLog()`; `of(event)` returns every matching record and `clear()` resets
between phases of a test.

## Shipping records to Loki

In Kubernetes, prefer stderr and a node-level collector over pushing from the application:

```text
# File: deployment env
KET_LOG=console
```

A collector reads the container's log file, so records survive a pod that crashed — an in-process
pusher loses its buffer exactly when the process dies, which is when the records matter most — and
a collector outage cannot reach the request path.

Loki indexes labels, and the number of streams is the product of their cardinalities. Promote only
`deployment`, `process` and `level`. Keep `tenant` in the line: a deployment that provisions tenants
has an unbounded set of them, and that is the label that ends a Loki cluster. `trace`, `fn` and
`actor` belong in structured metadata for the same reason.

```text
# File: LogQL
{service_name="commerce", level="error"} | json | event="unhandled"
sum by (fn) (count_over_time({process="http"} | json | event="fn_denied" [24h]))
quantile_over_time(0.95, {process="http"} | json | unwrap durationMs [5m]) by (fn)
```

## What this does not do

There is no query API and no `ket logs`: reading records back is an aggregator's job. There are no
metrics and no spans — `durationMs` on every record answers most of what a span is opened for. And
nothing here writes to the application database, because that is what the audit trail is for.
