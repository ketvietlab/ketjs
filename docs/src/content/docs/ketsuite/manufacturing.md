---
title: Manufacturing
description: Public manufacturing domain, stock integration, lifecycle, and extension boundary.
---

The public Manufacturing modules provide the smallest complete production workflow that can be used
without deployment-specific code. They cover bills of materials, work centers, operations,
manufacturing orders, component reservations, work orders, component consumption, and finished or
byproduct receipts.

## Module boundary

`manufacturing` owns domain models and functions. It has no dependency on backend routes or screens.
`manufacturing_backend` owns the trusted staff interface and depends on `manufacturing`. This follows
the same domain/backend boundary as Stock and Product; it is not a free-versus-paid split.

Both modules are public. Deployments that only need APIs, workers, or a custom interface can compose
`manufacturing` alone. Deployments that want the standard admin pages compose both modules.

Advanced policies remain deployment extensions. Examples include controlled BOM approval and
effectivity, count-to-weight conversion revisions, skill-based operator assignment, exclusive
operator claims, offline command replay, evidence ledgers, and enhanced lot genealogy. Such an
extension should depend on the public module instead of replacing its models or copying its stock
logic.

## Core records

| Record | Responsibility |
| --- | --- |
| `Bom`, `BomLine`, `Byproduct` | Define the expected inputs and outputs for a reference quantity. |
| `WorkCenter`, `Operation` | Define the ordered work and where it is performed. |
| `Production` | Own the manufacturing-order lifecycle and stock picking references. |
| `ProductionMove` | Classify linked stock moves as component, finished, or byproduct. |
| `WorkOrder` | Track operation execution independently from inventory completion. |

Quantities on BOM lines, operations, and byproducts are copied or scaled into the production order
at confirmation. Later edits to a BOM do not mutate an already confirmed order.

## Lifecycle and stock contract

A production order moves through `draft`, `confirmed`, `in_progress`, `to_close`, and `done`.
Cancellation is available before completion. Confirmation creates the raw-material and output
pickings, creates their moves, and attempts to reserve components. A shortage is reported explicitly;
completion fails closed until every component is allocated.

Work orders must be complete before the production order can close. Completion transfers component
stock into the production location and finished or byproduct stock into the destination location.
Tracked products require valid lot or serial output commands. Multiple output lots are supported for
one finished move.

Stock is the authority for locations, lots, moves, reservations, quants, routing, and transfer
completion. Manufacturing calls the exported Stock function specifications so a deployment extension
keeps the same transaction and effect contracts.

## Public extension surface

The package entry point exports `manufacturingFunctionSpecs` and `stockFunctionSpecs`. An extension
can wrap a public function to add approval, evidence, assignment, or compliance checks, then delegate
the inventory mutation to the public handler. The wrapper must include the delegated function's
effects in its own declared effects.

Prefer additive models and optional fields on public records. Keep the standard lifecycle valid when
the extension is absent, and add integration tests that compose the public and extension modules
together. This preserves a usable public application while allowing private deployments to enforce
stricter policies.

## Standard backend

The public backend contributes Manufacturing navigation and pages for orders, BOMs, and work centers.
Its user-facing labels and validation messages are available in Vietnamese and English. The backend
uses public functions only, so replacing the interface does not require replacing the domain module.
