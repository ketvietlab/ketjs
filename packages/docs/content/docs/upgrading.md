---
title: Upgrading KetJS
description: Audit compatibility, physical schemas, queries, and tenant sessions before changing a KetJS version.
group: Project evolution
order: 2
---

Treat a KetJS version change as an application and datastore upgrade. Pin an exact released version or
commit, read the changed contracts, and rehearse the deployment against a recent production copy before
moving the application lock.

## Current package line

The current coordinated release is `{{VERSION}}`. Use the same exact version for the KetJS packages your
application needs. KetSuite and its design system have their own release process.

The current patch fixes hydration namespaces and keyed entry movement without changing public APIs or
application data schemas. Rebuild and deploy matching server and client bundles together. Check SVG
updates, HTML content inside `foreignObject`, and reordered entries whose templates start or end with
dynamic holes. See [Rendering](/docs/rendering/) for the adopted-node contract.

The 0.5.0 line adds an independent [Authentication starter](/docs/auth-starter/) and explicit
companyless sessions. Existing deployments keep the company-required default. No account-model or
credential migration happens automatically: KetSuite retains its own models, permission policy and
stored hashes. Adopt the generated auth module only as an application-owned composition choice.

Session contexts must select a readable company and, when branches are restricted, a readable branch.
Invalid stored contexts are now destroyed, and gateway assertions apply the active session manager's
policy. Reconcile real memberships in your live identity resolver rather than relying on invalid
company/branch combinations. See [Sessions and tenants](/docs/sessions-tenants/).

For the new starter behind TLS termination, preserve and validate the public Host header, enable secure
cookies and configure `KET_AUTH_TRUSTED_PROXIES` with the edge's actual IPs. Forwarded addresses are ignored
by default; an unconfigured proxy shares a peer rate window. Existing deployments keep their own network
and rate policy. Follow the starter's deployment guide before exposing its login routes.

The 0.4.0 line adds nested form contracts, immutable edit sessions, native control binding and
transactional save receipts. Existing `createForm` consumers remain supported; adopting
`createFormSession` is explicit. Follow [Form validation](/docs/form-validation/),
[Forms and edit sessions](/docs/view-forms/) and [Transactional form actions](/docs/form-actions/)
when migrating an editor. Keep domain permissions, ownership and revision checks in the server
handler, and use primitive field selectors to isolate unchanged field views.

The 0.3.0 line introduced typed HTTP function bindings, explicit result cardinality and OpenAPI export.
When publishing an existing function through HTTP, declare its `returns` shape and the route's public
projection. Review [HTTP contracts and OpenAPI](/docs/openapi/) before exposing an endpoint.
[Spec](/spec/) can render the resulting contract without changing the API implementation.

Server-rendered islands must be hydrated by the same ketjs-view version and JSX build that rendered
them, so deploy the server and client bundles of a view upgrade together. Read the remaining
compatibility checks before upgrading an existing datastore.

## Changes in the next release

These changes are merged after `{{VERSION}}` and ship in the next KetJS release; the release that
includes them gives this section its version. Most turn a default that failed open, or a declaration
that composed and then misbehaved, into a refusal. Upgrade a staging copy first and read every
`contract_warning` that `ket check` prints.

| Area | What changes | What to do |
| --- | --- | --- |
| Development identity | Only `KET_DEV=1` takes the company from `X-Ket-Company` and allows every function. Without it, a deployment with no authentication resolves only the default company and serves only anonymous functions. | Set `KET_DEV=1` for local work; `ket dev` and the test harness do. Production gets sessions or a resolver. |
| Signing in | Sessions or `resolveIdentity` without `serve.permissions` refuse to boot (`E_PERMISSIONS_REQUIRED`). Outside `KET_DEV=1`, sessions need `KET_SECRET` or `sessions.secret` (`E_SESSION_SECRET_REQUIRED`) and the cookie is always `Secure`. A changed security version destroys the session. | Write `permissions`, returning `null` where every function is intended. Set a stable secret. |
| `/_ket/fn` | A session call must be same-origin JSON (`E_HTTP_CSRF`, `E_HTTP_CONTENT_TYPE`). A function with an identity `bind` is served only by its binding (`E_FUNCTION_BOUND`). A call returns `{ ok, value, dryRun }`; the write log comes only from `dryRun: true`, which also discards enqueued jobs. Outside `KET_DEV`, error bodies have no hint or source location. | Send `content-type: application/json` from the page origin. Read `value`, not `writes`. |
| Write log | `WriteRecord` gains `op: 'delete'` and `{ op: 'enqueue', job }`, so TypeScript no longer lets code read `model` from any record. | Narrow on `op` first: `write.op === 'enqueue' ? write.job : write.model`. |
| Responses | `text()`, `bytes()` and `streamed()` refuse markup types, including XML, and every response carries `X-Content-Type-Options: nosniff`. | Return HTML with `page()` or `fragment()`, or trusted markup such as an XML sitemap with `raw()`. |
| Function effects | A model effect may name the module, its transitive `depends` or a module in the new `optional` key. Outside that, a function gets a warning (an error from 1.0); a job or `enqueue` gets an error. A model missing from an included module is an error. | Add the module to `depends` or `optional`, or fix the name. |
| Composition checks | Refused: a scoped model declaring `companyId` or `branchId` (`E_SCOPE_FIELD_RESERVED`), a field that is not a plain identifier (`E_FIELD_NAME`), a malformed function name (`E_FUNCTION_NAME`), a menu cycle (`E_MENU_CYCLE`), two deployments with one name (`E_DEPLOYMENT_DUPLICATE`), an unreadable `compatible` range (`E_MODULE_COMPATIBILITY_RANGE`). `compatible` now reads caret and tilde ranges as npm does, so `^1.5.0` no longer accepts `1.2.0`. | Fix the declaration the error names. |
| Theme views | A view cannot expose a sensitive field (`E_VIEW_SENSITIVE_FIELD`) or a model outside `depends` (`E_VIEW_NOT_DEPENDED`). A view over another module's model is widened only by fields its own module contributed to that model. | Remove the field from the view or depend on its module. |
| Data values | `datetime` accepts a `Date` or ISO-8601 text; text without an offset is wall-clock time in `KET_TIMEZONE` (default `UTC`), not the server zone. `int` must be decimal digits within the safe-integer range. Direct `ctx.db` writes refuse impossible dates. A comparison operator or sort direction outside the fixed set throws `E_INVALID_OPERATOR` or `E_INVALID_ORDER`. | Set `KET_TIMEZONE` and send ISO instants. Check imports that wrote free-form dates. |
| Rendering | A bound URL attribute with `javascript:`, `vbscript:` or a non-media `data:` URL renders as `unsafe:…`. Binding `srcdoc` or a string inline handler is refused. The KTL `json` filter escapes `<`, `>`, `&`, U+2028 and U+2029. A hole inside `<style>` or `<script>` has no hydration markers. | Bind handlers as functions with `on:click`. Pass trusted CSS or script through `trustedMarkup()`. |
| Shared datastores | Deployments sharing one database migrate to the union of their recorded schemas instead of dropping each other's tables; a model scoped differently by two deployments is refused (`E_DATASTORE_SCOPE_CLASH`). | Migrate the deployment with the most models first so the union starts complete. |
| Jobs | A job `uniqueKey` is unique per company. The migration creates the new index before dropping the old one. | None; check that no code relied on a key shared across companies. |
| Ordering and digests | Names are compared with the `en` collation, so module order and permission digests no longer depend on `LANG`. Under an unset, `C` or `POSIX` locale nothing changes. | Re-record a permission digest computed under another locale. |
| Labels and categories | A permission bundle or role template needs only an `en` label; other locales are optional. A module without a category is `Other`, a theme `Theme`. | Give a category explicitly if the old default was shown. |
| Tokens | Two unrelated modules giving one token different values are reported as `E_TOKEN_CONFLICT`. | Make one depend on the other, or agree on the value. |
| Upgrade diff | `diffManifests` reports permission widening as `risky`: a function made anonymous, moved to HTTP or agents, given wider effects, and wider bundles or role templates. | Review new risky findings in the upgrade gate. |
| Storage | `namespacedStorage` refuses a namespace containing `/` (`E_STORAGE_NAMESPACE`). | Use one segment per tenant. |
| Shutdown | `close()` ends event streams and drops connections still busy after `serve.shutdownGraceMs` (10 seconds by default). | Set it below the platform's kill timeout. |
| Handlers | Function and job handlers belong to the manifest that composed them, so two deployments in one process no longer replace each other's. `registerFunctions` and `registerJobs` are deprecated no-ops. | Remove the calls; `compose()` binds the handlers. |
| Signals | A flush runs every scheduled effect even when one throws, then rethrows that error or an `AggregateError`. More than 100 runs in one flush report a signal cycle. | Fix an effect that writes a signal it reads. |
| Manifest and scaffold | `manifest.ket` is the real framework version. `ket new` pins the exact version and installs one `ketjs-view`. `_resetIdempotency` is deprecated for removal in 1.0. | Remove calls to `_resetIdempotency`. |

## Preflight

From the application built with the candidate framework:

```bash
# Run from: /path/to/example-app
ket check --workspace dist/ket.workspace.js
ket schema verify --deployment backoffice --workspace dist/ket.workspace.js
ket migrate --deployment backoffice --workspace dist/ket.workspace.js

# Tenant fleets
ket schema verify --deployment erp --all --workspace dist/ket.workspace.js
ket migrate --deployment erp --all --dry-run --workspace dist/ket.workspace.js
```

`schema verify` is read-only and checks the physical catalog as well as `ket_migration`. This matters for
databases migrated by older framework versions: a marker can claim that a field is required even when the
physical column is still nullable. A schema diff alone cannot discover that legacy drift.
For tenant fleets, implement the non-mutating `serve.tenants.exists(key, config)` hook before running the
preflight; verification refuses to call a potentially creating adapter factory without it.

Back up the datastore before DDL. Apply required-column backfills and other manual transitions in an
application-owned transaction, then use `confirmManualMigration()` to verify and record the result. Do not
edit the migration marker directly. The schema planner is deliberately data-independent, so adding a
required column to a table already present in the marker requires this manual path even when that table is
currently empty. Model fields do not carry SQL defaults that could make the transition automatic.

## Query compatibility

Review queries whose observable result depends on any of these contracts:

- Generated ascending order places nulls last; descending order places nulls first on SQLite and
  PostgreSQL. Audit nullable sorts combined with `LIMIT`, `OFFSET`, or cursor pagination.
- Decimal `avg` requires both a finite `scale` and `rounding: 'half-away-from-zero'`. Use `sum` and `count`
  and divide in the domain when another rounding policy is required.
- Column handles are opaque values from `table()` or `ctx.table()`. Replace hand-built or persisted
  `{ model, name }`/`{ model, name, base }` objects with handles resolved from the current manifest.

Run the same boundary fixtures against SQLite and PostgreSQL when the deployment supports both adapters.
Include nulls, equivalent decimal spellings, values beyond JavaScript's safe integer range, grouping,
aggregates, and pagination boundaries.

## Tenant session compatibility

Shared session stores bind every session to its tenant key. Legacy unbound rows fail closed and users must
sign in again. Keep the session signing secret, cookie policy, anonymous scope, tenant binding, and backing
store identity stable when a pooled tenant adapter is evicted and recreated; KetJS rejects policy drift
rather than silently changing authentication behavior.

`AdapterPool.close()` is terminal and idempotent. Create a new pool after shutdown; queued, concurrent,
or later acquisitions are rejected so no adapter can escape the deployment lifecycle.

## Rollout

1. Verify every physical datastore and review every reported difference.
2. Apply and confirm manual migrations before starting the new application code.
3. Run adapter-specific integration tests and nullable ordering regressions.
4. Start application processes with `KET_MIGRATE=0` when migrations are managed by the deployment step.
5. Monitor authentication failures, schema-verification output, and paginated list boundaries during the
   rollout.
