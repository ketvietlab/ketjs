---
title: Permission bundles and scoped roles RFC
description: Accepted contract for explicit function classification, permission bundles, managed roles, scoped assignments, and compatibility migration.
---

# Permission bundles and scoped roles RFC

Status: **implemented framework; product rollout remains application-owned**. The generic declaration,
compiler, scoped resolver, managed-role persistence, audit, policy seam, and administration workflow landed
under USR-006 through USR-011. Applications still own exact bundle contents, role templates, migration
evidence, pilot selection, and production activation.

The design keeps the existing qualified function key as the smallest enforcement unit. Bundles make
those keys reviewable and reusable; job-role templates compose bundles; assignments decide where a role
applies. An external identity provider authenticates a subject but never supplies an application role,
company, branch, bundle, or permission.

## Vocabulary and ownership

| Term | Meaning | Owner |
| --- | --- | --- |
| Function capability | One qualified `fnKey` enforced by `ctx.call()` | Function-owning module |
| Function classification | Exact risk, bundle membership, owner, and policy metadata for one function revision | Function-owning module |
| Permission bundle | Stable semantic set of classified functions and included bundles | Module or reviewed package catalogue |
| Job-role template | Versioned product role composed from public bundle keys | Product deployment |
| Role | Tenant row created from a managed template or maintained as custom | Tenant authorization data |
| Scoped assignment | User-to-role edge for tenant, company, or branch scope | Tenant authorization data |
| Domain policy | Record-specific threshold, maker-checker, lifecycle, or separation-of-duty rule | Domain function |

Risk is review metadata, not an authorization decision. A role grants bundles; compiled function grants
remain the runtime allow-list. A policy can still reject a permitted function for a specific record.

## Risk classes

Every classified function has exactly one of these stable risk classes:

| Risk | Contract |
| --- | --- |
| `read` | Reads ordinary data already constrained by the active scope |
| `operate` | Creates or changes ordinary workflow data |
| `approve` | Confirms, posts, settles, refunds, reverses, or performs another hard-to-reverse transition |
| `configure` | Changes policy or master data that affects other users |
| `sensitive` | Reads or moves PII, finance, audit, credential metadata, or exports |
| `security` | Changes users, identities, roles, grants, assignments, scope, sessions, or break-glass state |

`approve`, `configure`, `sensitive`, and `security` classifications require an owner and a policy marker.
The marker identifies the authority that must audit or make a record-level decision; it does not create a
role deny rule.

## Manifest declaration

The proposed manifest extension is declarative and contains no handler. Exact field names may only change
through a superseding RFC before implementation.

```ts
// File: examples/permission-bundles/sale.ts
export const permissions = {
  posture: 'permission-bearing',
  owner: 'sale',
  bundles: {
    'sale.view': {
      labels: { en: 'View sales', vi: 'Xem bán hàng' },
      includes: [],
    },
    'sale.operate': {
      labels: { en: 'Operate sales', vi: 'Thao tác bán hàng' },
      includes: ['sale.view'],
    },
    'sale.confirm': {
      labels: { en: 'Confirm sales orders', vi: 'Xác nhận đơn bán' },
      includes: ['sale.view'],
    },
  },
  functions: {
    'sale.listOrders': {
      risk: 'read',
      bundles: ['sale.view'],
      owner: 'sale',
    },
    'sale.saveOrder': {
      risk: 'operate',
      bundles: ['sale.operate'],
      owner: 'sale',
    },
    'sale.confirmOrder': {
      risk: 'approve',
      bundles: ['sale.confirm'],
      owner: 'sale',
      policy: 'sale.order-confirmation',
    },
  },
  exemptions: {},
} as const
```

Bundle keys use `{module}.{capability}` and describe a bounded business capability. `manager`, `all`,
and wildcard capability names are invalid. Adding a function never changes an existing bundle unless the
same review explicitly adds that exact function key to the declaration.

The same declaration may be embedded in its module or supplied through `deployment.permissions.modules`.
Deployment catalogues are intended for reviewed package/product baselines such as KetSuite and private
verticals. They may only name modules actually composed by that deployment, cannot override an embedded
declaration, and remain subject to every exact-key, ownership, graph, and coverage rule above.

A module may include a bundle owned by a declared dependency. It may not classify another module's
function or include an undeclared/private dependency. Compilation operates on the composed deployment,
not a development-only union.

### Function coverage

The compiler applies these rules to every composed function:

1. A public, non-anonymous, grantable function must have exactly one classification owned by its module
   and at least one bundle.
2. An internal, anonymous, provision-only, or deliberately non-grantable function must have an exact
   exemption with a stable reason and replacement authority.
3. A function cannot be both classified and exempt.
4. Unknown function keys, bundle keys, owners, policies, or risk values fail compilation.
5. Removing or renaming a function leaves a stale reference and fails compilation; it never becomes a
   dormant grant that may revive later.
6. Module posture is required but cannot exempt its functions from function-level coverage.

Supported posture values are `permission-bearing`, `projection/bridge`, `session/device`, and
`internal/headless`. Posture records how the surface participates in authorization; it does not grant or
skip anything.

Provision functions must be internal, explicitly marked `provision`, and exempt as bootstrap-only.
Anonymous functions must name their cryptographic, customer-realm, or public authority. Internal functions
must name the trusted route, worker, joint, or service boundary that calls them.

### Required CI coverage

The stable `permission coverage` check runs on every pull request to a protected production branch. It
compiles the generic permission contract and the complete public KetSuite production catalogue; it is not
path-filtered by module or test group. A pull request cannot merge when a production function is missing an
exact bundle classification or exemption, when a declaration is stale, or when the bundle graph is invalid.

Application repositories must expose the same stable check for their composed production deployments and
make it a required branch check. Deferred deployments remain outside the active catalogue until their
documented re-entry gate, but shared modules used by active deployments remain covered.

### Bundle graph

The compiler builds one directed graph per composed deployment. It rejects:

- cycles, including cycles that cross modules;
- duplicate includes;
- missing bundles or functions;
- references outside the module dependency closure;
- bundles with no direct function and no include;
- deployment templates that reference unavailable bundles.

Compilation produces sorted function keys, a source digest, and an explanation path for each effective
function. Runtime code consumes this immutable compiled result; it does not infer classifications from
function names.

## Job-role templates

A product deployment may publish versioned templates that reference only bundles available in that exact
deployment:

```ts
// File: examples/permission-bundles/commerce-role-templates.ts
export const roleTemplates = {
  'commerce.sales-representative': {
    version: 1,
    labels: { en: 'Sales Representative', vi: 'Nhân viên bán hàng' },
    bundles: ['partner.view', 'product.view', 'pricing.view', 'sale.view', 'sale.operate'],
  },
} as const
```

Template keys are globally stable and versions are positive integers. A new version owns only the grant
sources produced by that template. It cannot overwrite tenant custom grant sources. Standard templates
never set `superuser`.

KetJS owns the generic declaration, validation, compilation, and migration primitives. Product repositories
own deployment templates and may keep private bundle declarations in their private modules.

## Persistence contract

Implementation extends the current flat tables without changing their meaning during the compatibility
window.

| Record | Required contract |
| --- | --- |
| `Role` | `mode = managed | custom`, nullable `templateKey`, `templateVersion`, and template digest |
| `GrantSource` | `(roleId, fnKey, sourceKind, sourceKey, sourceVersion)` provenance edge |
| `Grant` | Materialized unique `(roleId, fnKey)` union used by the existing resolver |
| `Assignment` | Existing user/role edge plus normalized scope fields and `scopeKey` |
| `AuthorizationRevision` | Monotonic tenant/user revision available for future cache invalidation |
| `SecurityAudit` | Append-only before/after digest, actor, target, scope, source, reason, and revision |

`GrantSource` allows a managed template and tenant customization to contribute the same function without
one deleting the other. A `Grant` exists while at least one valid source exists. Legacy rows are backfilled
with `sourceKind = legacy-direct`; custom rows use `custom`; compiled templates use `managed-template`.

### Assignment scope

`scopeKind` is one of `tenant`, `company`, or `branch`:

| Kind | `companyId` | `branchId` | Normalized `scopeKey` |
| --- | --- | --- | --- |
| `tenant` | null | null | `tenant` |
| `company` | required | null | `company:{companyId}` |
| `branch` | required | required | `branch:{companyId}:{branchId}` |

The unique key is `(userId, roleId, scopeKey)`. The normalized non-null key avoids different PostgreSQL
and SQLite null-uniqueness behavior. A branch must belong to the stated company. Assignment requires live
company and branch membership at write time and again at every request boundary.

Tenant scope applies only inside companies where the user has a live membership. Company scope matches
only that company. Branch scope matches only that company and branch. Matching assignments are additive;
specific scope neither overrides nor denies a broader assignment.

The active company and branch come from the reconciled server session. Body, query, header, or identity
provider claims cannot select additional scope. Missing, inactive, cross-company, or ambiguous scope fails
closed.

## Effective permission explanation

The resolver continues to return a sorted function set (or the existing unrestricted marker for an audited
break-glass superuser). A separate explanation projection supports audit and UI:

```jsonc
// File: examples/permission-bundles/effective-explanation.jsonc
{
  "revision": 42,
  "context": { "companyId": "company-a", "branchId": "branch-1" },
  "functions": [
    {
      "key": "sale.confirmOrder",
      "risk": "approve",
      "paths": [
        {
          "assignmentId": "assignment-1",
          "scopeKey": "company:company-a",
          "roleId": "role-1",
          "roleMode": "managed",
          "templateKey": "commerce.sales-manager",
          "templateVersion": 2,
          "bundlePath": ["sale.confirm"]
        }
      ]
    }
  ]
}
```

The projection never returns credentials, raw external subjects, hidden record values, or denial detail
that would reveal another scope. UI visibility is a consumer of this result, never an enforcement boundary.

## Generic API contract

Names below define responsibilities; the implementation task may group read projections but cannot weaken
their invariants.

| Operation | Contract |
| --- | --- |
| `compilePermissionBundles` | Validate deployment graph and produce immutable catalog/digest |
| `permissionBundleCatalogue` | Return the immutable composed catalog used by administration tooling |
| `authorizationState` | Return the tenant authorization revision used by CAS workflows |
| `previewRoleTemplate` | Return source-aware added/removed/high-risk function diff without writes |
| `applyRoleTemplate` | CAS template version/digest and update only managed grant sources in one transaction |
| `saveRole`, `grantFunction`, `revokeFunction` | Maintain custom roles and sources through the compatibility API |
| `cloneManagedRole` | Copy effective grants into a custom role and sever the managed link explicitly |
| `assignScopedRole` | Validate live membership and insert the normalized scoped edge idempotently |
| `unassignScopedRole` | Remove one exact scoped edge and bump authorization revision |
| `resolveEffectivePermissions` | Re-read user, membership, assignment, role, sources, and compiled catalog |
| `effectiveAccess` | Return sanitized provenance paths and health issues for the active context |
| `setBreakGlass` | Activate or revoke audited, owner-bound, expiring superuser access |
| `listAuthorizationAudit` | Return a bounded audit projection without raw metadata or secrets |
| `recordAuthorizationAudit` | Append the security event inside the mutation transaction |

Every mutation takes an idempotency key, actor, reason, and expected authorization or role revision.
Conflicting reuse fails. Revocation is visible on the next request. Future caching is permitted only when
the cache key includes the live authorization revision and invalidation is proven across processes.

Stable error categories are:

- `E_PERMISSION_CATALOG_INVALID`
- `E_PERMISSION_BUNDLE_UNKNOWN`
- `E_PERMISSION_BUNDLE_CYCLE`
- `E_PERMISSION_FUNCTION_UNCLASSIFIED`
- `E_PERMISSION_FUNCTION_STALE`
- `E_ROLE_TEMPLATE_STALE`
- `E_ROLE_TEMPLATE_CONFLICT`
- `E_ASSIGNMENT_SCOPE_INVALID`
- `E_ASSIGNMENT_MEMBERSHIP_REQUIRED`
- `E_AUTHORIZATION_REVISION_CONFLICT`

Public responses translate these categories without revealing whether a record exists in another scope.

## Concurrency and transactions

Role-template apply, custom grant mutation, scoped assign/unassign, and rollback are transactions. The
transaction locks or compare-and-sets the role/authorization revision, updates sources and materialized
grants, appends audit, then increments the revision. A losing writer returns a stable conflict and may
re-preview; it never partially applies.

PostgreSQL evidence must cover two adapters concurrently assigning the same scope, assign versus revoke,
template upgrade versus custom grant, and two template upgrades. Database uniqueness and CAS decide the
winner. SQLite covers contract and local behavior but is not concurrency evidence.

## Compatibility and migration

Migration is additive and shadow-first:

1. Add nullable role provenance, `GrantSource`, assignment scope fields, revision, and required indexes.
2. Backfill existing grants as `legacy-direct` and assignments as tenant scope without changing the
   effective function set.
3. Compile the exact deployment catalog and reject unknown or stale keys.
4. Produce a deterministic tenant dry-run with current/candidate sets and classifications: `unchanged`,
   `added`, `removed`, `high-risk-added`, `unresolved`, and `custom`.
5. Require explicit approval for every high-risk addition and manual handling for ambiguous/custom input.
6. Apply one tenant wave behind a kill switch, preserving a rollback snapshot of role, source, grant, and
   assignment rows.

SQLite uses a table rebuild when adding non-null/check constraints; PostgreSQL adds nullable columns,
backfills, validates constraints, and then marks them non-null. Both adapters use the same normalized
`scopeKey` and source digest. Schema down-migration is not the tenant rollback mechanism: rollback restores
the captured authorization rows in a new transaction and records a new audit revision.

Replacing the legacy unique `(userId, roleId)` index with `(userId, roleId, scopeKey)` is an explicit index
transition in KetJS migration tooling. The migration requires destructive-operation acknowledgement because it
drops a uniqueness constraint, although it preserves every role, grant, and assignment row. Product rollout
must backfill `scopeKey = tenant` and verify duplicates before enabling scoped administration for a tenant.

Legacy `Role`, `Grant`, and unscoped `Assignment` calls remain meaningful during the compatibility window.
They create or read `legacy-direct` sources and tenant scope. Application migration must prove no unintended
permission increase before switching administration UI to bundles/templates.

## Security invariants and implementation gate

Implementation is incomplete until automated evidence proves all of the following:

- active user, external identity link, company/branch membership, scope, role, bundle, grant, and deployment
  availability are revalidated at the request boundary;
- forged company, branch, role, bundle, or permission input and identity-provider claims do not elevate;
- user, assignment, source/grant, and membership revoke takes effect on the next HTTP and Channel request;
- unknown bundle/function, stale template, cycle, duplicate include, and ambiguous scope fail closed;
- no standard template produces superuser and break-glass has owner, reason, expiry, and audit;
- denial errors and explanations do not disclose records or identities from another scope;
- PostgreSQL concurrency cases converge without partial grants or missing audit.

This RFC deliberately leaves product role contents, tenant pilot selection, and rollout approval in the
application repository. It also leaves record-level maker-checker and thresholds with each domain owner.
