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
| `datetime` | `Date` in generated types | Instant represented through ISO-compatible values at boundaries. |
| `ref:module.Model` | `string` | Identifier referencing another model contract. |

SQLite stores decimals as text because numeric affinity cannot preserve arbitrary decimal text.
PostgreSQL uses `NUMERIC`. KetJS decodes both adapters to numbers for application arithmetic while
ensuring the persisted representation does not reintroduce binary float error.

`date` rejects impossible dates such as `2025-02-30`. Use `datetime` when an instant and timezone are
part of the domain value.

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
  branches?: string[] | null  // branches visible to reads; null means all readable branches
}
```

If `companies` is absent, reads default to `company`. Writes are refused when the write company or
branch is outside the corresponding readable set. Scope columns are stamped on insert and immutable
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
ket types --app backoffice --workspace dist/ket.workspace.js
```

The output under `.ket/types.<app>.d.ts` includes the composed fields and contribution provenance.
Run it after composition changes; do not maintain a parallel handwritten model registry.
