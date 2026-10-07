---
title: "Separate tenants, companies and sessions"
description: "Understand the identity layers and prove that company-scoped records stay isolated."
stage: "Protect the application"
duration: 40
lab: "Node terminal"
order: 22
---

Before you start: complete [Connect an island to the API](/learn/connect-ui/), or make sure you can pass its checkpoint.

## Name each boundary

A tenant selects an application data boundary, commonly a datastore. A company is a row scope within the selected context. A session identifies an authenticated browser interaction. They are related, but none is a synonym for the others.

The learning lab uses a single tenant and two company identities. This is sufficient to test company scope, but it does not prove multi-tenant routing or a production login flow.

## Run the isolation checkpoint

```bash
# Run from: learn_api
npm run learn -- check isolation
```

The test creates a task as `alpha`, reads as `beta`, and attempts an update as `beta`. The second company must see no row and must not change the first company's task. Read the test to see how `client.with({ company: 'beta' })` creates another test identity without changing the original client.

## Repeat manually

Start the local API, POST a task with `X-Ket-Company: alpha`, and list using `X-Ket-Company: beta`. Then PATCH the first ID as beta. The facade should treat it as not found. An ID being globally unique does not make possession of that ID a permission grant.

## Plan a real session flow

Follow the session contract to verify credentials, issue a session and resolve current memberships. Use a stable signing secret in an evaluation deployment where sessions should survive restart. End the session through the configured sign-out contract.

The dev-header identity is intentionally not that implementation. Do not deploy the lab's convenience identity as authentication. A login form alone also does not establish a server identity: its result must be linked to the request/session resolution contract.

## Plan multi-tenant tests separately

A multi-tenant application needs at least two tenant datastores in its test setup. Verify tenant selection before migrations, sessions, storage and jobs. Test a tenant switch with the same record ID in both tenants so accidental routing cannot hide behind unique IDs.

## Checkpoint

The company isolation checkpoint passes, and you can explain which additional checks a multi-tenant session deployment requires.

## Practice on your own

Write acceptance cases for logout, expired membership, company switching and a missing tenant. Mark which need HTTP tests and which need datastore fixtures.

## Reference

For the complete API contract, read [Sessions Tenants](/docs/sessions-tenants/).
