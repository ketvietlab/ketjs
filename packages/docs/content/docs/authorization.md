---
title: Authorization
description: Grant operations, enforce declared effects and keep tenant data isolated.
group: Identity and access
order: 2
---

## Permission grants name operations

KetJS grants callable functions, rather than granting a table and assuming every operation on it is safe. A permission check and an effect declaration solve separate problems: the grant decides whether the caller may invoke an operation; effects bound what that operation can access.

## Resolve grants per request

A deployment that signs users in declares `serve.permissions`. It receives the user id and the request,
and returns the function keys that user may call, or `null` for every function:

```ts
// File: src/app.ts
serve: {
  sessions: { secret: process.env.KET_SECRET },
  permissions: async (ctx, userId, url, req) => {
    const { functions } = (await ctx.callUnchecked('access.grantsOf', { userId }, url, req)) as {
      functions: string[]
    }
    return functions
  },
}
```

| Caller | Functions it may call |
| --- | --- |
| No identity | Functions declared `anonymous: true` |
| Signed in, callback returns an array | Those functions plus the anonymous ones |
| Signed in, callback returns `null` | Every `http` function |
| Deployment authenticates but declares no callback | Boot fails with `E_PERMISSIONS_REQUIRED` |
| No authentication configured and `KET_DEV=1` | Every function, as the development identity |
| No authentication configured, outside development | Anonymous functions only |

A refused call answers `403 E_FN_NOT_PERMITTED` before its input is validated, whether or not the
function exists. A role is an application model: store grants as function keys, resolve them in the
callback, and inspect what a grant set reaches with `ket permissions --grant` or `--role`.

## Declare and inspect behavior

Define input/output contracts and effects with the function. Use the same domain function from HTTP handlers, jobs and agent capabilities when their context permits it. Read [Server functions](/docs/functions/) for declarations, callable clients, dry-run and idempotency.

```bash
# Run from: example-app
npx ket permissions --workspace dist/ket.workspace.js
npx ket permissions --json --all --workspace dist/ket.workspace.js
```

The inventory describes the composed deployment. Grant sets must be evaluated against the application being deployed, not against an unrelated module catalogue.

## Identity and tenant isolation

Resolve the viewer from the request identity contract. Externally supplied identities and KetJS sessions have different ownership and sign-out behavior. Bind sessions and runtime state to the selected tenant. Read [Sessions and tenant isolation](/docs/sessions-tenants/) before configuring those hooks.

## Presentation is not an authorization boundary

Hiding a button does not grant or revoke access. Server behavior remains responsible for permissions and scope. Shared views must not perform privileged reads, and a browser island must not reconstruct domain validation or bypass the function contract.

Use [deployment tests](/docs/testing/) to exercise allowed and denied behavior, separate tenants and real HTTP flows. Use [HTTP contracts](/docs/openapi/) to expose the transport contract without creating a second permissions model.
