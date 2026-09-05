---
title: Models and scopes
description: Declare KetJS models, field types, indexes, relations, extensions, and row isolation.
---

Models are schema declarations owned by modules. They contain no active-record methods and perform no
implicit I/O. The composed manifest derives tables, field provenance, query handles, migrations, and
generated declarations from the same model definitions.

## Declare a model

```ts
// File: src/modules/sales/index.ts
import { defineModule } from '@ketvietlab/ketjs'

export const sales = defineModule({
  name: 'sales',
  models: {
    Order: {
      scope: 'company',
      fields: {
        id: 'id',
        number: 'text',
        customerId: 'ref:crm.Customer',
        orderedOn: 'date',
        confirmedAt: 'datetime?',
        total: 'decimal',
        active: 'bool',
        metadata: 'json?',
      },
      indexes: {
        number_per_company: {
          fields: ['companyId', 'number'],
          unique: true,
        },
        customer: { fields: ['customerId'] },
      },
    },
  },
})
```

`sales.Order` maps to a physical table derived by `tableNameFor()`. Application code should use the
qualified model name, not depend on the physical naming convention.

## Server-maintained timestamps

Set `timestamps: true` on a model to add optional `createdAt` and `updatedAt` datetime fields:

```ts
// File: src/modules/order/models.ts
Order: {
  scope: 'company',
  timestamps: true,
  fields: { id: 'id', number: 'text' },
}
```

Every insert stamps both fields and every update stamps `updatedAt`. Values supplied by callers are
ignored on every write path. The fields are optional so adding timestamps is a non-destructive
migration: existing rows remain null instead of receiving invented history.

## Field types

Append `?` to make a field optional.

| Type | TypeScript value | Storage intent |
| --- | --- | --- |
| `id` | `string` | Primary identifier. |
| `text` | `string` | General text. |
| `int` | `number` | Finite integer. |
| `float` | `number` | Binary floating-point value. |
| `decimal` | `string` | Exact decimal, unchanged across the round trip; use for money and quantities. |
| `bool` | `boolean` | Boolean value. |
| `json` | `unknown` | JSON-compatible data. |
| `date` | `string` | Calendar date in `YYYY-MM-DD`, without timezone. |
| `datetime` | `string` | Instant as ISO-8601 UTC text; normalised on write, identical on SQLite and Postgres. |
| `ref:module.Model` | `string` | Identifier referencing another model contract. |

One decimal value is limited to 4096 characters, including its sign and decimal point. Function input,
changesets, direct context writes and filters enforce the same boundary; SQLite UDFs repeat it before
regex or `BigInt` work as defense against rows written outside KetJS. Exponent-form strings are not part
of the public decimal syntax, though finite JavaScript numbers are expanded to plain text on write.

SQLite stores decimals as text because numeric affinity cannot preserve arbitrary decimal text.
PostgreSQL uses `NUMERIC`. KetJS decodes both adapters to exact strings; SQLite predicates, ordering,
group equivalence, `countDistinct`, `sum`, `min`, and `max` operate on normalized decimal text without
coercing through `REAL`. Computed group and aggregate values use canonical spellings on both adapters.
Ascending order puts nulls last and descending order puts them first. SQLite decimal
`avg` is refused until the caller chooses a rounding rule. Application arithmetic remains an explicit
caller choice.

`date` rejects impossible dates such as `2025-02-30`. Use `datetime` when an instant and timezone are
part of the domain value.

## Classify what the field holds

A field is a type string, or an object when it has something to declare beyond its type. The two forms
compose to exactly the same field.

```ts
// File: src/modules/user/models.ts
export const models = {
  User: {
    scope: 'shared',
    fields: {
      id: 'id',
      name: { type: 'text', personal: true },
      email: { type: 'text?', personal: true },
      passwordHash: { type: 'text?', sensitive: true },
      lang: 'text?',
    },
  },
}
```

| Key | Means | Enforced by |
| --- | --- | --- |
| `personal` | Holds personal data about an identifiable person | recorded and enumerable; no automatic behaviour |
| `sensitive` | Must never leave the system | masked in write records; withheld from the agent descriptor |

**`sensitive` is enforced, not advisory.** A write record travels further than it looks: it is returned
to the caller, shown by a dry-run, and stored verbatim in the durable idempotency row that answers a
retry. A sensitive value is replaced with `[sensitive]` before the record is kept, and the field is left
out of `ket agent` entirely — the descriptor is the agent's map of what it may do, and a value it must
never write does not belong on that map.

**`personal` is recorded, not restricted.** The application still has to serve the person the data is
about, so nothing is hidden. What the declaration buys is the ability to answer a question that is
otherwise unanswerable: which columns are in scope when somebody asks for their data to be exported or
erased. Automatic export and erasure need one more thing — which person a given row belongs to — and
that is a relationship, not a field property; it is not built.

### Classifying a field is never a migration

Classification describes the data, not its storage, so it is deliberately absent from the schema
snapshot. Tagging a column plans no `ALTER` and needs no downtime. It does appear in `ket diff`: a field
that gains or loses either flag is reported as risky, because dropping `sensitive` silently starts
letting values through and dropping `personal` silently ends an obligation.

The vocabulary is closed. An unrecognised key is a composition error rather than a flag that quietly does
nothing, which is how a field ends up believed to be protected when it is not.

### Reading the inventory

```bash
# Run from: your application
npx ket classification
npx ket classification --json
```

It prints every classified field with the module that contributed it — and every model that classifies
nothing at all. That last list is the point: an inventory of only the fields somebody remembered to tag
is the one thing worse than no inventory, because it looks complete.

## Records that must not change

A model may declare that its rows are written once:

```ts
// File: src/modules/pos/models.ts
AuditEvent: {
  scope: 'company',
  append: true,
  fields: { id: 'id', action: 'text', occurredAt: 'datetime' },
}
```

`ctx.db.update`, `ctx.db.del`, `ctx.db.compareAndSet` and an updating changeset are all refused with
`E_APPEND_ONLY`. Those are four doors into one room, so the refusal lives on the two write paths the
others route through rather than being repeated.

Insert still works, and `insertIfAbsent` is how a replay is answered: a retried command derives the
same id, lands on the row it already wrote, and changes nothing.

This is for a record whose value **is** that it did not change afterwards — an audit timeline, a
posted ledger entry, a delivered receipt. Both audit models in KetSuite already promised exactly this
in a comment, and nothing held them to it. A promise a reviewer has to remember is one a refactor
eventually breaks.

Declaring it plans no migration: append-only describes what may happen to a row, not how it is
stored, so the schema snapshot ignores it. `ket diff` does not: a model that gains or loses the flag
is reported as risky, because losing it means a record that could not be edited suddenly can be.

### Audit identity and digests

Two helpers, for the parts every timeline has to get right and neither of which is about what an
event means:

```ts
// File: src/modules/pos/functions.ts
import { auditHash, auditId } from '@ketvietlab/ketjs'

await ctx.db.insertIfAbsent('pos.AuditEvent', {
  id: auditId('pos', ['shift.close', shiftId, ctx.correlationId ?? '']),
  actorHash: auditHash('pos', 'actor', ctx.actor),
})
```

`auditId` derives an identity from the command, so a retry is recognisably the same command rather
than a second event. `auditHash` produces a digest that stands for an identity without carrying it,
namespaced by the owning module so two timelines cannot be joined by accident and a digest from one
cannot be tested against a guess made in another.

`auditHash` is pseudonymisation, not secrecy: a low-entropy value stays guessable by anyone who can
run the same hash. It keeps a value out of a row, not out of reach.

What an event *means* — its subject, action, and which configuration or session it happened in —
stays the module's. A framework that modelled that would be modelling somebody's compliance regime.

## Scope is mandatory

Every model selects one isolation scope:

| Scope | Meaning | Typical data |
| --- | --- | --- |
| `shared` | Visible across companies inside one tenant database. | Products, currencies, public catalogues. |
| `company` | Each row belongs to one legal entity. | Orders, invoices, ledgers. |
| `company+branch` | Rows belong to one company and operational branch. | Stock moves, branch-specific sessions. |

There is no default. Accidentally treating company data as shared is a silent data leak, so omission
is a composition error.

KetJS adds and enforces scope columns centrally. A request scope separates reads from writes:

```ts
// File: src/modules/order/models.ts
type Scope = {
  company: string | null       // exactly one company receives new rows
  companies?: string[] | null // companies visible to reads
  branch?: string | null      // exactly one branch receives branch-scoped rows
  branches?: string[] | null  // branches visible to reads; null means all, [] means none
}
```

If `companies` is absent, reads default to `company`. Writes are refused when the write company or
branch is outside the corresponding readable set. For branch-scoped models, `branches: null` (or an
absent `branches`) allows every branch of the readable companies, while `branches: []` allows none.
Scope columns are stamped on insert and immutable
afterward: `ctx.db.update()` rejects patches containing `companyId`, or `branchId` on a
`company+branch` model.

## Indexes

Indexes have stable names local to the model:

```ts
// File: src/modules/order/models.ts
indexes: {
  reference: { fields: ['reference'], unique: true },
  customer_date: { fields: ['customerId', 'orderedOn'] },
}
```

Include scope columns in a unique index when uniqueness belongs inside a company or branch. KetJS
validates indexed fields while composing and uses stable index identities while planning migrations.
The derived schema also adds non-unique framework indexes for mandatory company/branch filters and
declared `hasMany` preload keys when no authored index already covers that prefix.

`ctx.db.insertIfAbsent()` relies on declared unique constraints to settle concurrent inserts.

## References and relations

A `ref:` field records the target contract. Relations name how queries preload related rows:

```ts
// File: src/modules/sales/index.ts
export const sales = defineModule({
  name: 'sales',
  depends: ['crm'],
  models: {
    Order: {
      scope: 'company',
      fields: {
        id: 'id',
        customerId: 'ref:crm.Customer',
        number: 'text',
      },
    },
    Line: {
      scope: 'company',
      fields: {
        id: 'id',
        orderId: 'ref:sales.Order',
        quantity: 'decimal',
      },
    },
  },
  relations: {
    'sales.Order': {
      customer: { belongsTo: 'crm.Customer', by: 'customerId' },
      lines: { hasMany: 'sales.Line', by: 'orderId' },
    },
    'sales.Line': {
      order: { belongsTo: 'sales.Order', by: 'orderId' },
    },
  },
})
```

Relations never lazy-load. A query receives related rows only when it explicitly calls
`.preload('customer', 'lines')`. KetJS fetches parents and related sets, avoiding an implicit query per
row. Large related sets are split into bounded parameter batches before they reach an adapter.

The function must declare read effects for every preloaded target. Effect checks run before the query,
even when the parent table is empty.

Composition also verifies that qualified model names remain unique after conversion to physical table
names. For example, `foo.BarBaz` and `foo_bar.Baz` are rejected because both would otherwise map to
`foo_bar_baz` and bypass model-level effect isolation.

## Extend another module's model

```ts
// File: src/modules/delivery/index.ts
export const delivery = defineModule({
  name: 'delivery',
  depends: ['sales'],
  extend: {
    'sales.Order': {
      promisedOn: 'date?',
      carrierReference: 'text?',
    },
  },
})
```

Cross-module fields must be optional. The manifest records `delivery` as their contributor. Removing
the module disables its behavior but preserves columns and data; removing the field from the deployed
code is a schema change handled by migration policy.

## Views for safe presentation

A view declares the only fields a theme may receive:

```ts
// File: src/modules/order/models.ts
views: {
  orderSummary: {
    of: 'sales.Order',
    fields: ['id', 'number', 'orderedOn', 'total'],
  },
}
```

`makeDrop()` and `makeDrops()` build null-prototype, immutable view models from these declarations.
They prevent a theme from reaching fields the owning module did not expose.

## Generated types

Generate app-specific declarations from the composed manifest:

```bash
# Run from: /path/to/example-app
ket types --deployment backoffice --workspace dist/ket.workspace.js
```

The output under `.ket/types.<app>.d.ts` includes the composed fields and contribution provenance.
Run it after composition changes; do not maintain a parallel handwritten model registry.
