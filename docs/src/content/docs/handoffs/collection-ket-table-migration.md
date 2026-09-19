---
title: Collection KetTable migration
description: Scope and compatibility boundaries for Product-format collection tables.
---

# Collection KetTable migration

Collection pages follow the application shell, navigation context, real query controls, tool actions,
and KetTable. The public server `KetTable` and interactive Product/Partner islands share one grid
renderer and stylesheet. Server cells retain existing links, native forms and decimal text; callbacks
are never serialized. Existing filter, sort, group, paging and optional-column URLs remain authoritative.
This migration covers 77 primary collection screens. Product and Partner retain their existing islands
and receive the shared operational layout ordering.

| Area | Primary collection screens |
| --- | --- |
| Product / Partner | Existing KetTable catalogues; shared operational layout order |
| CRM | Cases, activity planner, leaderboard, configuration catalogues |
| Flow | Projects, cross-project issues, project issues, all pages, all epics, sprints |
| HR | Employees, leaves |
| Company / User | Companies, users, roles |
| Address / Pricing / OAuth | Address catalogues, pricelists, providers, identities |
| Sales / Purchase | Quotations, sales orders, invoicing policies, RFQs, purchase orders, vendor pricelists |
| Stock | Warehouses, locations, picking types, stock routes, replenishment, lots, transfers |
| Accounting | Accounts, journals, journal entries, taxes, payment terms, payments, customer invoices, vendor bills, opening balances, period closes |
| Manufacturing | Orders, bills of materials, work centers |
| Website | Sites, pages, posts, revisions, taxonomies, media, menus, forms, submissions, members, domains, redirects, publications, health |
| Loyalty | Programs, wallets, ledger, memberships, tiers |
| Hospitality | Reservations, stays, folios, properties, rooms, room types, rate plans, housekeeping tasks, amenities, policies |
| Billing / POS | Charge rules, billing folio list, POS orders |

Forms, record detail child tables, hierarchy/tree views, dashboards, specialized reports, Kanban,
and card queues retain their existing representations. Shared helpers that also appear inside a
record detail opt into collection rendering only at the primary-list call site.

For complete catalogues without an existing filter, routes now provide a native GET `q` search over
explicit visible fields and preserve locale and other filter parameters. Existing paged routes keep
their query implementations. Table rows never perform data access, history mutation or browser work.

The application shell progressively enhances native server-table selection and keyboard row
navigation. Island-table selection retains its own controller; the shell only handles KetTable roots
marked `data-server="true"`. Captions, sort state, group expansion, external form names, empty states
and narrow-screen labels remain part of the public contract.

## Verification

Build, TypeScript checks, formatting, design inventory, governance, release audit and the 11 type-proof
assertions passed. The final broad run covered 383 suites: 2,288 tests passed, none failed, and one
existing test was skipped.

The broad run excluded ten live PostgreSQL suites because this task must not use a live database.
It also excluded the unrelated Flow test `a company with no civil date of its own still gets a coherent
one`, which failed with a login 404 in `boot()` and left its test server open in the first run. Therefore
the unqualified `npm run verify` result is not claimed as fully passing. All affected collection and
design-system tests passed in the final run.
