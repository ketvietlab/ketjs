---
title: Functions and effects
description: Define KetJS operations with checked signatures, explicit effects, permissions, dry-run, and idempotency.
group: Request execution
order: 2
---

A server function is a named business operation. Its input, output, data reach, external effects,
exposure, and safety properties are declared beside its handler and composed into the manifest.

KetJS accepts a `Record<string, FnSpec>` and does not require one source file per registry. A module
with many functions can keep named handlers in files grouped by capability and assemble them in one
`functions/index.ts`; the compact examples below show the runtime contract, not a required layout.

The generic `/_ket/fn` transport is not an automatic public API. `ServeSpec.resolveAudience` and `allowFor`
classify callers before dispatch; an application facade should expose selected operations through owned HTTP
routes. Idempotent calls are scoped by namespace and include a canonical request digest, so the same caller key
cannot silently replay a result for a different body. See [HTTP contracts and OpenAPI](/ketjs/openapi/).

## Declare a function

```ts
// File: src/modules/sales/index.ts
import { defineModule } from '@ketvietlab/ketjs'

export const sales = defineModule({
  name: 'sales',
  models: {
    Order: {
      scope: 'company',
      fields: { id: 'id', number: 'text', total: 'decimal', status: 'text' },
    },
  },
  functions: {
    createOrder: {
      input: {
        id: 'id',
        number: 'text',
        total: 'decimal',
      },
      output: {
        id: 'id',
        number: 'text',
        total: 'decimal',
        status: 'text',
      },
      effects: ['write:sales.Order'],
      idempotent: true,
      dryRun: true,
      agent: true,
      handler: async (ctx, input) => {
        const changes = ctx
          .change('sales.Order', input)
          .cast(['id', 'number', 'total'])
          .required(['id', 'number', 'total'])
          .put('status', 'draft')

        await ctx.db.commit(changes)
        return changes.changes
      },
    },
  },
})
```

The composed key is `sales.createOrder`. A function name starts with a letter and uses letters, digits,
`_` and `-`, with `.` between segments (`screen.list`); anything else, a space included, is
`E_FUNCTION_NAME`, because the name is part of `/_ket/fn/...` and of every permission key.

## Signatures

`input` and `output` use the same type vocabulary as model fields. Unknown input keys, missing
required inputs, and incompatible values fail before the handler runs. Optional keys end in `?`.

Over HTTP, a signature failure returns status `422`, code `E_INVALID_INPUT`, and the shared
`issues`/`fieldErrors` validation shape. Use a [form schema](/ketjs/form-validation/) for presentation
constraints such as length, ranges, choices, and cross-field rules; function signatures remain the transport
type contract.

Output projection keeps only declared fields. Declare output whenever callers, permissions tooling,
or agents need to know field-level reach. A function without `output` may return a value, but the
permission inventory marks its response shape as unprojected.

`output` names the fields of a row; `returns` says how many rows the function hands back:

| `returns` | The handler returns |
| --- | --- |
| `one` | One object. |
| `optional` | One object, or `null`/`undefined` (callers receive `null`). |
| `many` | An array of objects. |
| `none` | Anything; the value is discarded and callers receive `null`. |

Once declared, `returns` is enforced when the handler finishes: a mismatch fails with `E_OUTPUT_NOT_SHAPED` before
any field is projected. `none` cannot be combined with `output` fields, and an unknown value fails composition
with `E_FUNCTION_RETURNS`. Changing a declared `returns` is a breaking change (`RETURNS_CHANGED`) in the manifest
diff. Undeclared, nothing is checked, so existing functions keep their behaviour.
[HTTP function bindings](/ketjs/openapi/#function-bindings) require it.

Signatures validate the transport contract. Use changesets for domain validation and mass-assignment
control inside the handler.

## Declared effects

The effect vocabulary is explicit:

| Effect | Permission granted to the operation |
| --- | --- |
| `read:module.Model` | Select, count, or preload the model. |
| `write:module.Model` | Insert, update, delete, or commit changesets for the model. |
| `enqueue:module.job` | Enqueue the named durable job. |
| `storage:read` | Read, inspect, list, or sign blob objects from a job. |
| `storage:write` | Write blob objects from a job. |
| `storage:remove` | Remove blob objects from a job. |
| `transport:send` | Send through the configured outbound transport from a job. |

The context checks database query reach before execution. A condition that refers to another model
and every relation preload therefore require their own read effects.

Moving work into a job does not widen authority: the producer needs `enqueue:*`, and the job declares
the exact effects its handler uses.

An effect may name a model or job of the declaring module, of any module its `depends` reach
transitively, or of a module it lists in `optional`. Composition checks this for functions and jobs:

| The effect names | Result |
| --- | --- |
| A model or job of a reachable module | Allowed |
| A model or job of an `optional` module the deployment does not include | Allowed; there is nothing to reach |
| A model or job that does not exist in a module the deployment includes | Error: `E_FN_EFFECT` or `E_JOB_EFFECT` |
| A module that is neither reachable nor `optional` | Error for a job and for any enqueue; a function's `read:` or `write:` is a `contract_warning` until 1.0, then an error |

Use `optional` for a soft integration — a CRM screen that also shows sales orders when the sales module
is installed — and decide at run time whether to use it:

```ts
// File: src/modules/crm/index.ts
export const crm = defineModule({
  name: 'crm',
  depends: ['party'],
  optional: ['sale'],
  functions: {
    caseContext: {
      input: { partyId: 'id' },
      effects: ['read:party.Party', 'read:sale.Order'],
      handler: async (ctx, input) => {
        const orders = ctx.manifest.models['sale.Order'] ? await ctx.db.select('sale.Order', { partyId: input.partyId }) : []
        return { orders }
      },
    },
  },
})
```

`optional` does not order composition and cannot replace `depends` for a module whose models this one
extends or whose joints it fills. Warnings are kept on `manifest.diagnostics`, printed by `ket check`
(which fails on them with `--strict`) and logged as `contract_warning` on every boot.

## Function context

The handler receives a `Ctx` containing:

- `fnKey`, `manifest`, `actor`, `scope`, and `dryRun` metadata;
- `table()` and `change()` factories bound to the composed manifest;
- checked `db` read and write methods;
- `tx()` for atomic work;
- `jobs.enqueue()` for transactional durable work;
- `writes`, the intended write log (`insert`, `update`, `delete`, `enqueue`) used by dry-run.

There is no module-scope database client. Keeping access on `ctx` makes an operation without identity,
scope, or effects unrepresentable through the normal API.

## HTTP exposure

Functions default to authenticated HTTP exposure:

```ts
// File: src/modules/order/functions.ts
functions: {
  publicCatalogue: {
    anonymous: true,
    exposure: 'http',
    effects: ['read:catalog.Product'],
    handler: listPublicProducts,
  },
  verifyPassword: {
    anonymous: true,
    exposure: 'internal',
    effects: ['read:user.User'],
    handler: verifyPassword,
  },
}
```

- `anonymous` defaults to `false`.
- `exposure` defaults to `http`.
- `internal` functions are unavailable through `/_ket/fn/*` and absent from agent surfaces, but
  trusted application routes and in-process code may call them.

Use an internal function when a dedicated route must own rate limiting, origin checks, cookie
handling, or response shaping.

To publish a function as a REST-style operation with its own method, path, and OpenAPI contract,
bind it with [`httpRoutes()`](/ketjs/openapi/#function-bindings) instead of writing a route by hand.

### The generic transport

`POST /_ket/fn/<module>.<function>` calls an `http` function with a JSON object body. It applies the
same boundaries as a binding:

| Check | Refusal |
| --- | --- |
| The function is `internal` | `400 E_FUNCTION_INTERNAL` |
| A binding fills one of its inputs from identity (`bind`) | `403 E_FUNCTION_BOUND`; call the binding instead |
| A session cookie authenticates the request and `Origin` or `Sec-Fetch-Site` names another origin | `403 E_HTTP_CSRF` |
| A session cookie authenticates the request and the body is not `application/json` | `415 E_HTTP_CONTENT_TYPE` |
| The caller's allow-list does not include the function, whether or not it exists | `403 E_FN_NOT_PERMITTED` |
| The function does not exist and the caller is unrestricted | `404 E_UNKNOWN_FUNCTION`, without listing other names |

A program that holds a session cookie and sends neither `Origin` nor `Sec-Fetch-Site` is not a browser,
so it is accepted with a JSON body. A successful answer is `{ ok, value, dryRun }`, plus `replayed`
when an idempotency key replays a stored result. The write log is returned only by a dry run, because
a real call's log can hold columns the declared output leaves out. Every answer carries `x-request-id`
and `x-ket-build`, and the call is logged as `fn_call`, `fn_error` or `fn_denied`.

Outside development (`KET_DEV` unset), error bodies carry `hint: null` and `at: null`; the code and
message remain.

A domain handler may throw `KetError` with code `E_CONFLICT` (or the existing `conflict` spelling)
when current state prevents an operation. The generic function transport returns HTTP `409` and keeps
the error code and message. Throw inside `ctx.tx` to roll back earlier writes in the same operation.
Other domain error codes still default to `400`; use an HTTP binding's explicit error map for a
domain-specific status. Permission, missing-function, payload-size and defect responses are unchanged.

## Provisioning functions

One-shot bootstrap operations must be explicitly internal and opt in with `provision: true`:

```ts
// File: src/modules/order/functions.ts
provisionAdmin: {
  exposure: 'internal',
  provision: true,
  input: { login: 'text', password: 'text' },
  effects: ['write:user.User'],
  handler: provisionAdmin,
}
```

The CLI reads secret input from stdin so credentials do not enter shell history:

```bash
# Run from: /path/to/example-app
printf '%s' '{"login":"admin","password":"..."}' | \
  ket provision user.provisionAdmin --input -
```

`provision` does not make the function HTTP- or agent-callable.

## Dry-run and idempotency

A dry run executes the handler and discards what it would change: row writes, enqueued jobs and
notifications. The result reports them in `writes`, for example `{ op: 'enqueue', job: 'sales.mail' }`,
and `ctx.jobs.enqueue()` returns `{ id: '', existing: false, dryRun: true }`.

Dry runs are opt-in. Declare `dryRun: true` only when the handler causes no other side effect while
`ctx.dryRun` is true: it must not call a provider, send mail, or write to storage. A caller requesting a
dry run of any other function receives `E_NO_DRY_RUN` before the handler runs, and the agent
descriptor reports `dryRunnable: false` for it.

Declare `idempotent: true` when repeated calls can be keyed:

```ts
// File: src/modules/order/functions.ts
const first = await client.call('sales.createOrder', input, {
  idempotencyKey: 'order:external-4815',
})

const replay = await client.call('sales.createOrder', input, {
  idempotencyKey: 'order:external-4815',
})
```

KetJS claims the key before work begins and stores the completed result in the database. A later call
returns the first result with `replayed: true`; a concurrent call receives
`E_IDEMPOTENCY_IN_FLIGHT`. Passing a key to a non-idempotent function fails with `E_NOT_IDEMPOTENT`.

Keys are isolated by function, actor, company and branch scope. KetJS also fingerprints the validated
input: reusing a key with different arguments receives `E_IDEMPOTENCY_CONFLICT` instead of replaying an
unrelated result or executing a second operation.

The application still chooses a stable business key. Random retry keys defeat deduplication.

A claim is held while the call runs. A call that fails releases its key, so the caller can retry with
the same key. A process that dies mid-call cannot release it, so a claim still unfinished after five
minutes counts as abandoned and the next call with that key takes it over and runs the function again.
An operation that can run longer than five minutes is not protected by the key alone: enqueue it as a
job, or have the handler check the business record it is about to create before creating it.

## Company reach

Company-scoped operations read the current company by default. Set `crossCompany: true` only for an
operation intentionally designed for consolidation or shared reporting:

```ts
// File: src/modules/order/functions.ts
salesByCompany: {
  crossCompany: true,
  effects: ['read:sales.Order'],
  handler: reportSalesByCompany,
}
```

This declaration appears in the manifest, upgrade diff, agent descriptor, and permission report.
Without it, a function cannot widen its reads to several legal entities.

## Permissions and agents

Applications may resolve the function keys a signed-in user may call through `serve.permissions`.
Authorization is action-based: granting `sales.listOrders` does not grant another function just
because both read `sales.Order`.

Inspect reach before creating a role:

```bash
# Run from: /path/to/example-app
ket permissions --grant sales.listOrders,sales.createOrder
ket permissions --module sales
ket permissions --role sales_manager
```

Set `agent: true` to include a safe HTTP function in the agent descriptor. Inspect the result with
`ket agent`. Agent access still follows normal input, permission, effect, dry-run, and idempotency
boundaries.

## Calling functions

Application routes use `ServeContext.call()` so tenant, session, permissions, actor, and scope travel
with the request. Tests use `TestClient.call()`. Low-level integration code may use `callFn()`, but it
must supply the adapter, manifest, actor, scope, and allow-list itself.

Prefer the highest-level call boundary available. Calling handlers directly skips the framework
contracts the function declaration exists to enforce.
