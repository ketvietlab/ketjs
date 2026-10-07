---
title: Tenant isolation is more than a query filter
description: Separate tenant databases, company scope, request identity and operation permissions when designing a secure KetJS application.
date: "2026-08-31"
order: 3
---
Adding a tenant predicate to a query can be a useful safeguard. It cannot, by itself, answer who a request represents, which company receives a new record, or whether a user may run a dangerous operation.

KetJS separates these concerns into tenant resolution, identity, data scope and permissions. Understanding the distinctions is essential before connecting a multi-company application to real users. This article describes the current **0.2.0 Preview** contracts and a practical way to evaluate them.

## Start with four different questions

Consider a hosted accounting application. Two customers use it, and each customer has several legal entities. A user works for two entities but may approve payments in only one.

The application must answer four questions independently:

| Question | Boundary |
| --- | --- |
| Which customer's data is involved? | Tenant database selection |
| Who is making the request? | Request identity and session resolution |
| Which companies or branches are visible and writable? | Model scope |
| Which operation is allowed? | Function permissions and domain policy |

Combining these into one `tenantId` or one role string hides important decisions. A correct tenant database can still contain a company the current user should not read. A user who can read an invoice may still be prohibited from approving its payment.

## A tenant is not a company

KetJS's tenant model uses one database per tenant. Within that database, models can be shared across companies or scoped to a company and branch.

This means a `shared` model remains inside the tenant boundary. It is appropriate for information used by several companies of one customer, not a shortcut for a cross-customer global catalogue. If your application needs global data, design and review that separate ownership explicitly.

Database selection also affects background work and storage. A request and its worker must resolve the same intended tenant context; choosing the right row after choosing the wrong database is already too late. [Sessions and tenants](/docs/sessions-tenants/) documents the resolution contracts.

## Reads can be broader than writes

A finance user may compare balances across three companies. Creating a payment still needs one write company. KetJS scope separates those concepts: readable company sets are distinct from the company assigned to new rows.

Branch scope has similarly precise behavior. A readable branch set of `[]` allows none, while an absent set or `null` permits all branches of the readable companies. Confusing an empty set with an unrestricted set can turn a reasonable-looking fallback into a leak.

Scope columns are stamped on insertion and are immutable afterward. An ordinary update cannot move a company-scoped record into another company's ownership. If a business process transfers an asset between entities, represent that process through explicit domain operations rather than rewriting ownership metadata.

The [models reference](/docs/models/) gives the exact semantics. Read them before building a company switcher; a UI selection must correspond to an authorized scope, not merely a string in browser state.

## Authentication must reflect current authority

A signed session establishes a trustworthy session record. It does not mean the user's membership or permissions remain unchanged forever. Session resolution can load current account state so that removal from a company or a changed role affects subsequent requests.

KetJS also has a development identity shim that reads company context from headers when sessions are not configured. That is useful for early exercises and tests. It is not authentication, and should not be presented as a production login mechanism.

Do not let an untrusted client grant itself a company or capability by sending a convenient header. The authority that resolves identity and membership belongs at the deployment boundary. A worker or integration may use a different identity source from an interactive session, but still needs a deliberate contract.

## A visible button is not a permission check

Hiding “Approve payment” improves the interface for someone who cannot use it. It does not stop that person from calling an endpoint directly.

KetJS permission contracts classify qualified function keys and group bounded capabilities into bundles. High-risk operations need the relevant domain policy authority in addition to a capability grant. Deployment coverage checks can make missing classifications fail composition.

Avoid giant roles that promise to “manage everything.” A useful review describes an exact operation, its risk, its capability and any additional business conditions. The [authorization documentation](/docs/authorization/) explains that contract; apply it to domain functions, not only routes or menus.

## Test the denied path deliberately

Build a fixture with two tenants and two companies inside one tenant. Give them similar-looking records so that a test cannot accidentally pass by receiving an empty table.

Check that a user cannot read the other company's record by guessing its ID, cannot write outside the authorized set and cannot move a record by patching scope fields. Repeat the important checks through the HTTP path and the domain operation used by workers. Then test an identity whose membership was removed after session creation.

Keep errors and logs inside the same boundary: a rejected read should not reveal another customer's record contents in its message. Positive-path tests establish functionality; these denied cases establish isolation.

Next, read [HTML first and islands](/blog/html-first-islands/) for the browser boundary. It explains how to present authorized data without making the browser the authority that decides what a user may access.
