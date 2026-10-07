---
title: Database correctness before convenience
description: Why model scope, exact decimals, validated changesets and explicit transactions matter more than a convenient CRUD wrapper.
date: "2026-08-21"
order: 2
---
The most expensive database bugs often look harmless at first. An amount is converted to a JavaScript number, a row is created in the wrong company, or two related writes are committed separately. Each operation succeeds, yet the business state is wrong.

KetJS puts model scope, validation and transactional operations into the application contract. The goal is to make the rules of a write visible and enforceable, not simply to shorten SQL. This article uses an order-and-payment workflow to explain the decisions worth reviewing in **KetJS 0.2.0 Preview**.

## Declare what the data belongs to

Every KetJS model chooses a scope: `shared`, `company`, or `company+branch`. There is no default, because accidentally sharing company data is a serious error.

“Shared” has a precise boundary: shared across companies inside one tenant database. It does not mean globally shared across every tenant. A catalogue might belong there, while invoices normally belong to a company. A stock movement may need the additional operational branch boundary.

Choosing scope is a domain decision. Ask who owns the record and who should see it, then use [model scopes](/docs/models/) to express that decision. Scope columns are applied centrally and are immutable after insertion; changing an invoice's owner is not an ordinary patch to a field.

Also distinguish the read set from the write target. A reporting user might read multiple companies while a new invoice must be created for exactly one company. A single “current company” variable cannot express both needs safely.

## Treat validation as part of the operation

A form can help a user correct an invalid amount before submission. That does not make the request trustworthy. The same operation may also be called by an API, a worker or a test.

A changeset carries intended changes and their validation. It gives the domain operation a place to require fields, normalize accepted input and reject invalid state before persistence. The useful question is not only whether an input is syntactically a decimal, but whether this particular invoice may be changed at this point in its workflow.

Keep transport concerns outside that decision. An HTTP route translates a request and a response; a domain function owns the business operation. This allows the same rule to apply when the caller changes. See [queries and changesets](/docs/data/) and [functions and effects](/docs/functions/) for the exact APIs.

## Money needs an explicit arithmetic contract

A decimal field is not an invitation to convert values to floating-point numbers. KetJS handles decimals as exact values and defines adapter behavior for comparisons and aggregates.

For example, numerically equal values such as `1.0` and `1.00` must group together even when their stored text differs. An average can produce a non-terminating rational, so an unrounded decimal average fails rather than silently selecting a scale. A query requesting a finite average must declare its scale and supported rounding rule.

Those guarantees apply to KetJS queries. Raw SQLite SQL still follows SQLite's native coercion behavior. Mixing the two paths without understanding their arithmetic semantics can undo the consistency an application expects.

For a payment workflow, write tests around the important cases: equal values with different representations, a rounding tie, a negative adjustment and a sum larger than a convenient floating-point example. The happy path of `10 + 20` is not evidence that money handling is correct.

## A transaction describes one business outcome

Suppose confirming an order updates its status and reserves stock. If the status update commits but the reservation fails, the application has published a state it cannot fulfill.

Put related database changes inside one transaction when they represent one business outcome. On failure, the database should contain neither half. Test that rollback by deliberately making the second step fail and checking both records afterward.

A transaction does not make an external email or payment provider part of the database commit. If confirmation must trigger later work, enqueue a durable job in the same transaction. The [jobs article](/blog/durable-jobs/) explains why atomic enqueueing solves one gap while idempotency is still needed for external delivery.

## Migration planning is a deployment concern

A model declaration describes the desired schema; an existing database contains a physical schema and real data. Moving between them needs a plan.

KetJS derives schema information and supports migration planning and physical verification. Its non-destructive default is useful precisely because renaming or dropping a column can destroy information that a declaration alone cannot recover. Read the generated plan rather than assuming a schema change is safe because the code compiles.

For an evaluation, make a small database with representative rows, change a model and inspect the migration. Check what happens to existing values and indexes. For multiple tenant databases, the operational problem also includes knowing which tenants have reached which schema state; see [migrations and adapters](/docs/migrations/).

## Measure the path you actually use

A raw adapter point lookup is useful performance evidence, but it is not an invoice confirmation. The latter may include permissions, validation, several reads and a transaction. Measure each layer when investigating a bottleneck.

SQLite and PostgreSQL also have different deployment characteristics. Passing the same functional tests does not mean their durability settings, contention or connection behavior are interchangeable. Choose fixtures that reflect the intended workload instead of selecting a database from one throughput chart.

A successful evaluation is a database that remains correct after invalid input, a failed second write and a repeated request. Speed matters after that outcome is understood. Continue with [tenant isolation](/blog/tenant-isolation/) to examine who is allowed to perform those operations and where their data lives.
