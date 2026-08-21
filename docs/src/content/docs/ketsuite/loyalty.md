---
title: Loyalty
description: KetSuite Loyalty modules, invariants, integrations, and test evidence.
---

# Loyalty

KetSuite Loyalty is split by responsibility while keeping one public business contract:

- `loyalty` owns programs, rules, rewards, wallets/cards, the immutable ledger, reservations, tiers,
  earn groups and memberships.
- `loyalty_sale` adapts quotations and Sales Orders to the Loyalty order snapshot and materializes
  reward lines.
- `loyalty_pos` adapts POS orders, payment, refunds and reward lines.
- `loyalty_backend` provides one Loyalty application for configuration, reporting, Sale/POS actions
  and the read-only customer summary.

All four modules ship Vietnamese and English catalogues from their first revision. Business values
such as a program name or reward description remain user data and are not translated implicitly.

## Accounting and concurrency invariants

- A wallet balance changes only through an immutable ledger entry. Earn, redeem, adjustment,
  expiry and reversal remain distinct operations.
- `sourceKey` is unique inside a company, so retrying a command cannot duplicate a ledger effect.
- A draft Sale/POS order reserves points. Removing the reward or cancelling a draft releases the
  reservation; confirmation/payment settles it.
- Cancellation and refunds append reversal entries instead of deleting history.
- Reservation uses a transaction and compare-and-set update. Competing requests cannot reserve
  more than the available balance.
- Tier spend uses a rolling window (12 months by default). Earn groups are evaluated by priority and
  stable id order.
- The redeem cap is based on eligible untaxed product lines after commercial discounts and before
  Loyalty reward lines.

Sale and POS lines carry `lineKind=product|shipping|reward` plus Loyalty application, reward and
point-cost metadata. POS accounting uses the signed line subtotal, so a negative reward line reduces
revenue rather than creating an unbalanced entry.

## Public function boundary

The stable functions are:

- `loyalty.program.list/get/save/archive`
- `loyalty.evaluateOrder`
- `loyalty.applyCode`
- `loyalty.applyReward/removeReward`
- `loyalty.wallet.get/adjust`
- `loyalty.membership.refresh/getSummary`
- `loyalty.order.finalize/reverse`

Sale and POS adapters expose the same actions with an `orderId` input. The portal derives its partner
from the signed-in session and never accepts a caller-supplied actor.

## Validation

Acceptance tests boot the real app on a temporary port with an isolated SQLite database and storage.
Setup uses named fixture calls; all behavior under test crosses HTTP with the real session cookie and
company context. The suite drains the durable worker for wallet expiry and membership refresh.

A separate live PostgreSQL test races two connections against one wallet and verifies one reservation
winner, non-negative balance and idempotent finalization. The repository gate also runs build,
TypeScript, i18n parity, zero-dependency audit, UI audit and type proofs.

Visual evidence is generated from seeded application data, not mocks. The inventory and embedded
images are in [the Loyalty screen manifest](../evidence/loyalty/).

## Deliberate non-scope

Website checkout is not enabled in this PR. `/my/loyalty` is read-only. No the domain contract history importer is
provided; state begins in KetSuite and future backfills must be idempotent and support dry-run.
