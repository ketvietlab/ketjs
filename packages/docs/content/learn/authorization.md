---
title: "Grant operations and bound their effects"
description: "Distinguish caller permissions from declared capabilities and test denial at the server boundary."
stage: "Protect the application"
duration: 35
lab: "Node terminal"
order: 23
---

Before you start: complete [Separate tenants, companies and sessions](/learn/sessions-tenants/), or make sure you can pass its checkpoint.

## Ask two different questions

A grant answers “may this caller invoke this operation?” An effect declaration answers “what may this operation touch while it runs?” A read-only user may be allowed to call `learn_api.list`; the function itself should still declare only its required read effect.

Hiding a Complete button does not revoke permission. An HTTP client can call an endpoint without using your interface, so permission enforcement belongs to server dispatch and domain contracts.

## Inspect the inventory

```bash
# Run from: learn_api
npm run build
npx ket permissions --deployment learn_api --workspace dist/ket.workspace.js
npx ket permissions --json --all --workspace dist/ket.workspace.js
```

Find the create, complete and schedule operations. Compare their data/effect reach. The queue producer needs an enqueue effect; the job handler needs its own data effect. Neither gets unrelated capabilities by sharing a module.

## Design two roles

Write a reader role that can list tasks and an editor role that can create and complete them. Configure authenticated grants using the session/identity integration for your application. The tutorial's dev identity and isolated test harness are development tools, not a shipped role management system.

Exercise both roles through HTTP: reader list succeeds, reader create is denied, and editor create succeeds. Check that a denied operation leaves the database unchanged. A frontend-only test is insufficient for this boundary.

## Break an effect deliberately

In a disposable copy, remove `write:learn_api.Todo` from the create function and invoke it. The attempted write should fail. Restore the declaration and rerun the API checkpoint. Do not resolve the error by granting broad access to every model.

## Review agent exposure

The list function is marked for agent discovery. That makes it discoverable through the relevant capability contract; it does not replace audience rules or grants. Expose only operations that have useful input/output contracts and review their side effects just as you would an HTTP operation.

## Checkpoint

Explain a denied caller versus a disallowed effect, and verify that either failure leaves business data unchanged.

## Practice on your own

Add a role matrix for list/create/complete/schedule. Include anonymous, reader and editor callers and identify the expected server outcome for every cell.

## Reference

For the complete API contract, read [Authorization](/docs/authorization/).
