---
title: Security and data scope
description: Preserve KetSuite staff, customer, permission, effect, company, and branch boundaries.
---

KetSuite has two distinct identity planes. Staff sessions authorize backend functions and company or
branch context. Customer sessions and tokens authorize Channel API capabilities within a customer realm.
Do not share credentials, cookies, or generic function transports between those planes.

## Staff request boundary

On each authenticated request, KetSuite rebuilds the user's session context from live rows. The cookie
contains the last selection, not authoritative company or branch membership. Revoking a grant or
archiving a company therefore takes effect on the next request across every process.

The app resolves function permissions through `user.permitted`:

- a superuser receives the unrestricted marker;
- another staff user receives the qualified function names granted through roles;
- `ctx.call()` applies that permission set together with declared effects and scope.

Never treat a hidden menu or missing button as authorization. Routes must call an authorized function,
and functions must declare effects for every resource they touch.

## Company and branch isolation

The request context carries the active `company` and `branch` plus the sets the user may access. KetJS
applies model scope to reads and writes:

| Model scope | KetSuite meaning | Typical use |
| --- | --- | --- |
| `shared` | Visible across companies within the tenant | Partner identity, company directory, security metadata |
| `company` | Restricted to the active company | Commercial terms, orders, accounting records |
| `branch` | Restricted to the active operating branch | Branch-local operational records |

Do not trust a `companyId` or `branchId` received from a form as authority to switch context. Context
changes go through user functions that validate active grants. Do not use unchecked SQL or a shared
adapter to bypass scoped tables in application code.

Test both directions of isolation: a permitted row is visible in its context, and the same identifier is
not visible or writable from an ungranted company or branch.

## Function exposure and effects

`defineFn()` is the security declaration for domain operations:

- `input` and `output` constrain transport data;
- `effects` constrain resources the handler may access;
- default exposure is the normal permission-controlled function surface;
- `exposure: 'internal'` keeps infrastructure operations off the public function transport;
- `agent: true` is a deliberate capability publication, not a harmless metadata flag;
- `idempotent: true` promises safe replay behavior and must match the implementation.

Prefer `ctx.call()` from a route. Every use of `ctx.callUnchecked()` needs a visible trust argument: the
Channel API uses it behind its own authentication, CSRF, realm, capability, and contract checks; staff
backend routes do not need that bypass.

## Customer Channel API

`channel_api` owns and reserves `/api/customer/v1/`, `/api/staff/v1/`, `/api/pos/v1/`,
`/api/integration/v1/`, and `/internal/v1/`. A contributor publishes inside a reserved prefix only
through the owner's route contract and a compatible dependency.

Customer browser sessions use an HTTP-only, `SameSite=Lax` cookie scoped to the customer API path.
Mutations validate same-origin and CSRF data. Native clients use Bearer access tokens and rotating
refresh tokens; stored values are digests. Realm resolution comes from the website host or the explicit
channel realm header, not from staff company context.

See [Channel API architecture](/ketsuite/channel-api/) for route construction and the generated
[Customer API reference](/ketsuite/channel-api-reference/) for the current external contract.

## Transactions and concurrency

Use `ctx.tx()` when a business invariant spans more than one write. Put uniqueness that must survive
concurrent requests in model indexes, then handle the losing writer deterministically. Application-only
"check then insert" logic is not a concurrency guarantee.

Idempotent mutations should accept stable identifiers or use KetJS idempotency namespaces at the
external boundary. The Channel API requires `Idempotency-Key` for operations whose route contract marks
them idempotent and rejects reuse with a different body.

## Review checklist

- Which identity plane calls this code: staff, customer, anonymous, worker, or internal service?
- Which company, branch, tenant, site, or realm selects the data?
- Are all resources present in `effects`, including reads used only for validation?
- Does the route use `ctx.call()` unless it owns an explicit replacement authorization boundary?
- Can two concurrent requests violate an invariant?
- Are secrets, tokens, and passwords absent from logs, URLs, screenshots, and committed fixtures?
- Do denial and cross-scope tests accompany the successful path?
