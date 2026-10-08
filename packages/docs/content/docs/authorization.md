---
title: Authorization
description: Grant operations, enforce declared effects and keep tenant data isolated.
group: Identity and access
order: 2
---

## Permission grants name operations

KetJS grants callable functions, rather than granting a table and assuming every operation on it is safe. A permission check and an effect declaration solve separate problems: the grant decides whether the caller may invoke an operation; effects bound what that operation can access.

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
