---
title: Functions and effects
description: Define KetJS operations with checked signatures, explicit effects, permissions, dry-run, and idempotency.
---

A server function is a named business operation. Its input, output, data reach, external effects,
exposure, and safety properties are declared beside its handler and composed into the manifest.

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

The composed key is `sales.createOrder`.

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

## Function context

The handler receives a `Ctx` containing:

- `fnKey`, `manifest`, `actor`, `scope`, and `dryRun` metadata;
- `table()` and `change()` factories bound to the composed manifest;
- checked `db` read and write methods;
- `tx()` for atomic work;
- `jobs.enqueue()` for transactional durable work;
- `writes`, the intended mutation log used by dry-run.

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
# Run from: /path/to/ketjs
printf '%s' '{"login":"admin","password":"..."}' | \
  ket provision user.provisionAdmin --input -
```

`provision` does not make the function HTTP- or agent-callable.

## Dry-run and idempotency

Declare `dryRun: true` only when the operation can safely preview all writes. A caller requesting
dry-run on another function receives `E_NO_DRY_RUN`.

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
# Run from: /path/to/ketjs
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
