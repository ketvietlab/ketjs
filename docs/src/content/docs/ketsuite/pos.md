---
title: Point of Sale
description: Retail transaction, shift, offline, receipt, and operational-audit contracts in KétSuite.
---

The `pos` module owns the company-scoped retail facts shared by every POS client: configurations,
shifts, orders, order lines, tenders, returns, exchanges, cash movements, immutable receipts, and the
operational audit timeline. `pos_channel` exposes the device-facing contract; `pos_backend` provides
trusted administration screens. Deployment-specific device enrollment, payment providers, and receipt
delivery remain outside the upstream module.

## Operational audit

`pos.AuditEvent` is an append-only timeline for commands that change money, stock, or shift control.
Each event has a retry-stable ID derived from the domain command, a subject and action, actor/device
identity when available, a bounded reason, explicit related record, details, and occurrence time. A
command replay uses `insertIfAbsent`; it never produces a second event and never edits the first event.

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

`pos.listAuditEvents` reads only the active company scope. It accepts optional `subjectType`,
`subjectId`, and `action` filters, returns newest events first, and clamps `limit` to 1–200 records.
This bounded query is the source for administration timelines and exports; generic mutation of audit
rows is not part of the public function contract.

## Retry and transaction boundary

An audit event is written in the same command context as its business mutation. Finalization writes the
event inside the transaction that binds the immutable receipt and marks the order paid. Return and
exchange events use the same atomic transaction that creates their linked orders. Callers therefore
must treat a successful command without its expected event as an operational incident rather than
reconstructing history from the current row state.

The audit timeline is evidence, not the financial ledger. Posted accounting moves, stock movements,
receipts, payment-provider attempts, and device grants remain authoritative in their owning models.
