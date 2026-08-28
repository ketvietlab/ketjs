---
title: Queries and changesets
description: Read and write KetJS data with immutable queries, validated changesets, and transactions.
---

KetJS exposes data access only through an operation context. Queries are immutable values that can be
inspected before execution; changesets cast and validate untrusted input before persistence.

## Build a query

```ts
// File: src/modules/order/functions.ts
import { asc, desc, eq, from, gte, like } from '@ketvietlab/ketjs'

const Orders = ctx.table('sales.Order')

const query = from(Orders)
  .select(Orders.id, Orders.number, Orders.total)
  .where(eq(Orders.active, true), gte(Orders.total, 100))
  .where(like(Orders.number, 'SO%'))
  .orderBy(desc(Orders.total), asc(Orders.number))
  .limit(50)
  .offset(0)

const rows = await ctx.db.all(query)
```

Each builder call returns a new `Query`; the previous value is unchanged. Additional `where()` calls
combine with `AND`, which allows several modules or helpers to narrow a query without mutating shared
state.

## Expression helpers

Import expression helpers from `@ketvietlab/ketjs`:

| Helper | SQL intent |
| --- | --- |
| `eq`, `ne` | Equality and inequality. |
| `gt`, `lt`, `gte`, `lte` | Ordered comparisons. |
| `like` | Pattern comparison. |
| `inArray` | Membership; an empty array becomes an always-false expression. |
| `isNull`, `isNotNull` | Null checks. |
| `and`, `or`, `not` | Boolean composition. |
| `asc`, `desc` | Sort direction. |

Column handles must come from `ctx.table()` or `table(manifest, model)`. Plain strings are rejected.
Values are always parameterized rather than interpolated into SQL.

## Execute reads and deletes

```ts
// File: src/modules/order/functions.ts
const one = await ctx.db.one(from(Orders).where(eq(Orders.id, orderId)))
const count = await ctx.db.count(from(Orders).where(eq(Orders.active, true)))
const all = await ctx.db.all(from(Orders).preload('customer', 'lines'))
```

Use a delete query when its condition benefits from the query builder:

```ts
// File: src/modules/order/functions.ts
import { deleteFrom, eq } from '@ketvietlab/ketjs'

await ctx.db.del(deleteFrom(Orders).where(eq(Orders.id, orderId)))
```

A delete query has a write effect. The context checks every model touched by an expression or preload
against the current function or job's declarations before the adapter executes SQL.

Convenience methods remain available for simple operations:

```ts
// File: src/modules/order/functions.ts
await ctx.db.select('sales.Order', { active: true })
await ctx.db.insert('sales.Order', row)
await ctx.db.update('sales.Order', { id }, patch)
```

Update filters and patch keys are validated against the manifest. Updates require a non-empty filter,
and scope columns cannot be moved through a patch.

Prefer query values for complex reads and deletes because their complete reach is inspectable.

## Group and aggregate

Build a grouped query from the same immutable value and execute it with `ctx.db.group()`:

```ts
// File: src/modules/order/functions.ts
const summary = await ctx.db.group(
  from(Orders)
    .where(eq(Orders.active, true))
    .groupBy({ col: Orders.confirmedAt, interval: 'month', timezone: 'Asia/Ho_Chi_Minh' })
    .aggregate({ fn: 'sum', col: Orders.total, as: 'total' })
    .orderGroupsBy({ by: 'key', dir: 'asc' }),
)
```

Each result has `key`, `count`, and `aggregates`. Supported aggregates are `count`,
`countDistinct`, `sum`, `avg`, `min`, and `max`. Group queries use the same declared-effect and row
scope checks as ordinary reads. Date buckets accept `day`, ISO `week`, `month`, `quarter`, and `year`;
SQLite and PostgreSQL produce the same stable local-calendar keys.

`{ fn: 'count', as: 'rows' }` renders `COUNT(*)`. Add `col` to count only non-null values, for example
`{ fn: 'count', col: Orders.total, as: 'priced' }`. Row and group ordering is explicit and portable:
ascending puts nulls last, while descending puts nulls first on both adapters.

For decimal fields, SQLite predicates and ordering compare exact normalized parts instead of coercing
through `REAL`. Group keys and `countDistinct` use numeric equivalence, so `1.0` and `1.00` belong to
one canonical `1` group. Decimal `sum`, `min`, and `max` use exact string/`BigInt` aggregates. KetJS
canonicalizes computed decimal group keys and aggregates on both adapters; ordinary selected fields
still decode byte for byte as stored.

Decimal `avg` on SQLite fails with `E_DECIMAL_AVG_SQLITE`: an exact average can be a non-terminating
rational, so KetJS will not silently choose a scale or binary float. Request `sum` and `count` over the
same nullable decimal column, then divide with the domain's explicit rounding rule, or use PostgreSQL.
These guarantees apply to KetJS queries; raw SQLite SQL keeps SQLite's native type/coercion rules.

Column handles from `table()`/`ctx.table()` carry required runtime `base` metadata, which selects exact
decimal SQL. Legacy `{ model, name }` objects without that metadata are rejected rather than falling
back to SQLite coercion.

## Declarative list search

`defineListSearch()` declares explicit allowlists for searchable, filterable, groupable, and sortable
fields. `parseListState()` and `encodeListState()` make the URL canonical state, while
`compileListFilter()` turns the validated filter tree into parameterized expressions.

Custom filters support nested `and`/`or` groups. Default limits are four levels, 25 rules, three group
levels, and ten open group paths. Unknown URL presets, groups, and sorts are dropped with warnings;
server compilation independently rejects invalid fields or operators with `E_LIST_FILTER`.

Preset filters in the same declared group combine with `OR`; different preset groups, search text,
and custom filter trees combine with `AND`. Case-insensitive contains searches escape SQL wildcard
characters. Datetime calendar-day filters accept an IANA timezone and compile to UTC half-open ranges,
including days shortened or lengthened by daylight-saving transitions.

## Build a changeset

```ts
// File: src/modules/order/functions.ts
const changes = ctx
  .change('sales.Order', input)
  .cast(['id', 'number', 'customerId', 'orderedOn', 'total'])
  .required(['id', 'number', 'customerId', 'orderedOn'])
  .validate('total', (value) => Number(value) >= 0 || 'must not be negative')
  .put('active', true)

if (!changes.valid) return { ok: false, errors: changes.errors }

await ctx.db.commit(changes)
```

Only fields named in `cast()` can enter `changes`. Other input keys appear in `changes.dropped` and
are never written. This allow-list is KetJS's mass-assignment boundary.

`put()` sets a server-controlled value after casting. Do not cast a field and then assume the client
could not control it.

## Insert and update changesets

Pass a base row for updates:

```ts
// File: src/modules/order/functions.ts
const current = await ctx.db.one(from(Orders).where(eq(Orders.id, input.id)))
if (!current) return { ok: false, code: 'not_found' }

const changes = ctx
  .change('sales.Order', input, current)
  .cast(['number', 'orderedOn', 'total'])

await ctx.db.commit(changes, { id: current.id })
```

The changeset records only real differences from `base`. Without a base row, its action is `insert`;
with a base row, its action is `update`. Committing an invalid changeset throws
`E_INVALID_CHANGESET` with its structured field errors.

## Casting behavior

Changesets derive casts from the manifest:

- `int` and `float` accept finite numeric strings when conversion is unambiguous.
- `decimal` accepts finite numbers or plain decimal strings and normalizes exponent notation for
  storage. It always reads back as the exact string the column holds, so `12.50` stays `12.50` and a
  value past the range of a JS number keeps every digit. Coerce where you compute — `Number(row.total)`
  — and write the result back as a number if that is easier; the write renders it. Reading never
  rounds, which is what makes `{ ...row, note }` safe on a table that holds money.
- `bool` accepts booleans, `0`/`1`, and the strings `"false"`/`"true"`.
- `date` requires a valid `YYYY-MM-DD` calendar date.
- `datetime` accepts a `Date` or a parseable date-time string, and stores it as ISO-8601 UTC. An offset
  is normalised on the way in, so the same instant is the same text in SQLite and in Postgres — and so
  the stored text sorts chronologically, which is what a range query compares. It reads back as that
  text, never as a `Date`; `date` likewise stays `YYYY-MM-DD` on both.
- `json` accepts objects, including arrays; scalar strings are rejected.

Inspect `changeset.toJSON()` when returning validation data to a UI or agent.

## Atomic operations

Use `insertIfAbsent()` when a declared unique index should settle a race:

```ts
// File: src/modules/order/functions.ts
const result = await ctx.db.insertIfAbsent('sales.Sequence', {
  id: sequenceId,
  key: 'order',
  next: 1,
})

if (!('dryRun' in result) && !result.inserted) {
  // Another transaction already created the unique row.
}
```

Use `compareAndSet()` for optimistic concurrency:

```ts
// File: src/modules/order/functions.ts
const result = await ctx.db.compareAndSet(
  'sales.Order',
  { id: orderId },
  { revision: expectedRevision },
  { revision: expectedRevision + 1, status: 'confirmed' },
)
```

The returned `matched` flag distinguishes a successful update from stale state.

## Transactions

Run related writes through `ctx.tx()`:

```ts
// File: src/modules/order/functions.ts
await ctx.tx(async (tx) => {
  await tx.db.commit(orderChanges)
  await tx.db.commit(lineChanges)
  await tx.jobs.enqueue('sales.confirmOrder', { orderId })
})
```

The callback receives a context bound to one adapter transaction. On PostgreSQL, KetJS reserves a
connection so `BEGIN`, the body, and `COMMIT` cannot land on different pool connections.

Jobs enqueued through the transaction commit atomically with business rows. A rollback removes both
the writes and the job notification.

Nested adapter transactions are not supported. Keep the transaction boundary at the business
operation level.

## Dry-run

Functions declaring `dryRun: true` may be called with dry-run enabled. Context write methods report
the intended mutation in `ctx.writes` without committing it:

```ts
// File: src/modules/order/functions.ts
const preview = await client.call('sales.createOrder', input, { dryRun: true })
console.log(preview.writes)
```

Validation and declared-effect checks still run. Dry-run is a preview of the real operation, not a
permission bypass.
