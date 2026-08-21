---
title: Sessions and tenants
description: Configure signed sessions, company and branch scope, permissions, and one-database-per-tenant isolation.
---

Sessions answer who a request represents; scope answers which company and branch its operations may
read and write; tenants answer which database contains that identity and data. KetJS keeps these
contracts separate because deployments resolve them in different orders.

## Development identity shim

Without `serve.sessions`, the runtime reads company context from headers:

```text
X-Ket-Company
X-Ket-Companies
X-Ket-Current-Branch
X-Ket-Branch
```

This allows early development and tests but is not authentication. Production applications should
configure sessions and resolve current account state.

## Enable sessions

```ts
const app = defineApp({
  name: 'backoffice',
  modules: [users, sales],
  headless: true,
  serve: {
    sessions: {
      idleTtlMs: 7 * 24 * 60 * 60_000,
      absoluteTtlMs: 30 * 24 * 60 * 60_000,
      anonymous: null,
    },
    resolveSession: async ({ adapter, record }) => {
      return loadCurrentMemberships(adapter, record.userId)
    },
  },
})
```

Set a stable signing key in every environment:

```bash
KET_SECRET='a-long-random-deployment-secret' ket serve
```

If the secret is absent, KetJS generates an ephemeral value and reports it in the banner. That is
acceptable for an isolated test, not a multi-pod deployment or restart-stable login.

## Start and end sessions

A login route verifies credentials through an internal function, then uses the request's session
manager:

```ts
const sessions = await ctx.sessionsOf(url, request)
if (!sessions) return json({ ok: false }, { status: 500 })

const { cookie } = await sessions.start({
  userId: user.id,
  companies: user.companyIds,
  company: user.defaultCompanyId,
  branches: user.branchIds,
  branch: user.defaultBranchId,
  securityVersion: user.securityVersion,
})

return withHeaders(json({ ok: true }), {
  'set-cookie': cookie,
})
```

Logout calls `sessions.end(request)` and returns `sessions.clearCookie()`. Administrative changes can
invalidate all sessions for a user with `endUser()` or every session except the current one with
`endUserExcept()`.

The cookie is signed, `HttpOnly`, `SameSite=Lax`, path-wide, and secure outside local plain HTTP.
Sessions have an idle deadline refreshed during use plus an absolute, non-refreshable deadline.

## Revalidate live identity

Session rows are snapshots. Use `resolveSession` to verify that the account is still active and update
company/branch memberships before scope and permissions are calculated:

```ts
resolveSession: async ({ adapter, record }) => {
  const current = await loadIdentity(adapter, record.userId)
  if (!current || current.disabled) return null

  return {
    companies: current.companyIds,
    company: current.companyIds.includes(record.company)
      ? record.company
      : current.companyIds[0],
    branches: current.branchIds,
    branch: current.branchIds.includes(record.branch ?? '')
      ? record.branch
      : current.branchIds[0] ?? null,
    securityVersion: current.securityVersion,
  }
}
```

Return `null` to reject the session. KetJS updates context atomically by session revision so concurrent
company switching cannot silently overwrite newer state.

## Resolve function permissions

```ts
serve: {
  permissions: async (ctx, userId) => {
    return loadGrantedFunctionKeys(ctx, userId)
  },
}
```

Returning an array restricts every function call for that request, including calls made by routes.
Returning `null` means no restriction. Prefer an explicit role resolver in production rather than
omitting the callback accidentally.

Permissions grant operations, not tables. Use `ket permissions --role NAME` to inspect the resulting
read, write, enqueue, cross-company, and output reach.

## Session stores

`createSessions()` supports:

- `memorySessionStore()` for isolated processes and tests;
- `dbSessionStore(adapter)` for restart-stable sessions in one database;
- a custom `SessionStore` for a shared identity datastore.

With subdomain tenancy, the host identifies the tenant before the cookie is read, so sessions can live
inside each tenant database. If one domain serves every tenant and the session itself chooses the
tenant, provide a shared session store; otherwise resolving the database would require reading a
session from the database that has not yet been selected.

## One database per tenant

Configure `serve.tenants` when each customer has an independent datastore:

```ts
const app = defineApp({
  name: 'erp',
  modules: [core, sales],
  headless: true,
  serve: {
    tenants: {
      resolve: (_url, request) => {
        const host = request.headers.host?.split(':')[0] ?? ''
        return host.endsWith('.erp.example') ? host.slice(0, -'.erp.example'.length) : null
      },
      list: () => tenantCatalogue.listKeys(),
      open: (key, config) => openTenantDatabase(key, config),
      max: 20,
      idleMs: 60_000,
    },
  },
})
```

`resolve()` returning `null` produces `E_UNKNOWN_TENANT`; KetJS never falls back to a default customer.
The bounded adapter pool leases one tenant for the duration of a callback and prevents connections
from escaping their lease. An adapter counts as busy while `open()` is pending, so a concurrent request
cannot evict or close a connection that the first request is still establishing.

## Per-tenant live state

Each tenant database owns its module install state. On every request KetJS resolves:

```mermaid
sequenceDiagram
  participant Request
  participant Resolver as Tenant resolver
  participant Pool as Adapter pool
  participant Registry as App registry
  participant Runtime as Live runtime
  Request->>Resolver: Resolve host or header
  Resolver->>Pool: Lease tenant database
  Pool->>Registry: Load module install state
  Registry->>Runtime: Restrict deployment manifest
  Runtime-->>Request: Tenant services and scope
```

The runtime caches restricted manifests and compiled themes by tenant plus enabled-module set. When an
operator installs or removes a module, the cache key changes and the next request sees the new live
state.

Never hold a tenant adapter, `live` manifest, session manager, or storage object in a process-global
variable.

## Anonymous scope

Public storefronts may configure `sessions.anonymous` with a deliberately limited scope. A missing
session otherwise has no scope. Anonymous functions and routes still require explicit declarations;
anonymous scope is not unrestricted access.

## Operational checklist

- Configure one stable `KET_SECRET` across pods.
- Keep password verification in an internal function behind a dedicated login route.
- Revalidate disabled users, memberships, and security versions.
- Rotate or invalidate sessions after security-sensitive changes.
- Keep tenant resolution deterministic and reject unknown hosts.
- Bound tenant database connections with `max` and `idleMs`.
- Run fleet migrations before serving new code.
- Test at least two tenants and two companies to detect accidental cache or scope reuse.

See [Testing](/ketjs/testing/) for cookie-aware clients and tenant-isolated fixtures.
