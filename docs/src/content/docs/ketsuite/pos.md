---
title: Point of Sale
description: Retail transaction, shift, offline, receipt, and operational-audit contracts in KétSuite.
---

The `pos` module owns the company-scoped retail facts shared by every POS client: configurations,
shifts, orders, order lines, tenders, returns, exchanges, cash movements, immutable receipts, and the
operational audit timeline. `pos_channel` exposes the device-facing contract; `pos_backend` provides
trusted administration screens. Deployment-specific device enrollment, payment providers, and receipt
delivery remain outside the upstream module.

## Payment settlement kinds

A payment method defaults to `settlementKind: 'liquidity'` and therefore requires a cash or bank
journal. `stored_value` is the second core kind: it requires a general journal whose default account
is a liability and can never be marked as cash. Finalizing a sale debits that liability and settles
the invoice receivable; finalizing a return credits the liability and settles the credit note. POS
still owns the tender and receipt, Account owns the posted movement and reconciliation, and Loyalty
or another instrument authority owns the customer balance. A POS client must reserve that balance
before adding the tender and finalize or release the reservation from its composing transaction.

Payment-method names and receipt lines remain safe display data. Raw gift-card codes, wallet tokens
and token hashes do not belong to POS records, references, receipts or audit details.

## Operational audit

`pos.AuditEvent` is an append-only timeline for commands that change money, stock, or shift control.
Each event has a retry-stable ID derived from the domain command, a subject and action, actor/device
identity when available, a bounded reason, explicit related record, details, and occurrence time. A
command replay uses `insertIfAbsent`; it never produces a second event and never edits the first event.

The function runtime carries an ephemeral `correlationId` separately from validated business input. POS channel
commands set it to the durable idempotency/command key; offline replay uses the same command metadata. The audit
helper stores only a namespaced SHA-256 `correlationHash`, plus hashed actor, subject, related, session, and device
identities. The framework never persists the raw correlation value. Domain code must apply the same rule before
persisting `ctx.correlationId`; it is request metadata, not a secret-storage facility.

The upstream module records:

- shift creation, opening, closing control, close sealing, recount, and variance approval;
- cash-in/cash-out movements and their linked reversals;
- manager price or discount adjustments with previous and resulting values;
- manual tender voids with reason and applied amount;
- sale/return finalization and the linked receipt, accounting move, and stock picking;
- return creation, exchange creation, and draft-order cancellation.

Payment-provider reconciliation, device grant/revoke, receipt delivery, and manual repair events are
deployment-owned. Those modules must keep their own immutable evidence and may project it beside this
timeline; they must not write fabricated upstream POS events.

`pos.listAuditEvents` reads only the active company scope. Audit rows carry immutable `configId` and
`sessionId` dimensions captured with the command, rather than reconstructing scope from mutable
records later. The query accepts optional subject, action, configuration, session, and half-open
`from`/`to` filters, returns newest events first, and clamps `limit` to 1–200 records. This bounded
query is the source for administration timelines and exports; generic mutation of audit rows is not
part of the public function contract.

## Operations report

`pos.operationsReport` is a company-scoped operational projection over a required inclusive civil-date
range of at most 31 days. Midnight boundaries use the company's locked accounting timezone (default
`Asia/Ho_Chi_Minh`), not UTC. An optional `configId` narrows every source at the database layer.
Orders, tenders, cash movements, and audit actions are grouped and summed by the adapters, so the
report does not load an unbounded transaction set into application memory. The result contains:

- gross sales, returns, net sales, and transaction counts per currency;
- tender totals by state, kind, and currency;
- cash-in, cash-out, and net movement in company currency;
- shift open/close and variance-control counts;
- cancellation, manual-void, cash-reversal, and pending-variance exception counts;
- a newest-first audit sample whose requested size is clamped to 1–200 and whose `truncated` flag
  tells an administration export to request a narrower window. This sample emits only hashed event/subject/
  actor/related/session/device identities and omits raw IDs and arbitrary `details`.
- core audit-event and exception counters, trace coverage ratio, and a stable `core_trace_gap` warning when
  post-migration correlation evidence is incomplete.

`pos.Order.finalizedAt` assigns revenue and returns to the civil day when the transaction became
immutable, rather than the day its draft was created. `pos.Payment` and `pos.CashMovement` persist
their immutable configuration and session dimensions at creation for this projection. The new
dimensions are optional at the schema level so an existing deployment can add them without a
blocking manual migration; every new command writes them. The report exposes `scopeCoverage`
counters for legacy rows missing a dimension or finalization timestamp instead of silently claiming
a configuration-filtered report is complete. A missing correlation hash is also explicit coverage debt; scoped
legacy rows without a config dimension count as trace gaps instead of disappearing. Financial totals still come from orders, tenders, and
cash movements; the audit timeline supplies command and exception counts, not ledger amounts.

## PostgreSQL concurrency evidence

The live PostgreSQL suite rebuilds a fresh POS schema and drives conflicting commands through the
public function runtime. It verifies that concurrent order creation allocates one gapless,
session-local sequence; duplicate shift opening converges on one opened revision; competing cart
updates allow only one expected-revision winner; and concurrent tender/finalization attempts persist
one payment, one posted accounting move, and one stock picking. A separate race submits two partial
returns against the same sold quantity and proves that only one reservation succeeds, leaving the
remaining returnable quantity intact.

These checks are database-level release evidence for the upstream POS transaction boundary. They do
not cover deployment-owned provider callbacks, offline batch ingestion, or loyalty wallets; each
owning module must supply its own PostgreSQL concurrency evidence for those paths.

## Retry and transaction boundary

An audit event is written in the same command context as its business mutation. Finalization writes the
event inside the transaction that binds the immutable receipt and marks the order paid. Return and
exchange events use the same atomic transaction that creates their linked orders. Callers therefore
must treat a successful command without its expected event as an operational incident rather than
reconstructing history from the current row state.

The audit timeline is evidence, not the financial ledger. Posted accounting moves, stock movements,
receipts, payment-provider attempts, and device grants remain authoritative in their owning models.
