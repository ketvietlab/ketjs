---
title: Module development
description: Add KetSuite domain, backend, and bridge modules without breaking ownership boundaries.
---

Start a KetSuite feature by identifying its owner. The directory and module name are durable
identities: models and functions become qualified names such as `partner.Partner` and
`partner.savePartner`, and installed state records the module name.

## Recommended domain layout

```text
# File: packages/ketsuite/src/modules/example
packages/ketsuite/src/modules/example/
├── index.ts          # assembly only
├── models.ts         # storage contract and scopes
├── functions.ts      # commands and queries
├── relations.ts      # cross-model relation metadata
├── jobs.ts           # durable asynchronous work, when needed
├── reports.ts        # printable document contracts, when needed
├── messages.ts       # vi/en domain messages
└── types.ts          # stable constants and TypeScript types
```

Small modules may combine files, but `index.ts` should remain readable as the complete declaration:

```ts
// File: packages/ketsuite/src/modules/example/index.ts
import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'

export default defineModule({
  name: 'example',
  version: '0.1.0',
  depends: ['partner'],
  title: 'Example',
  summary: 'Example business capability.',
  category: 'Operations',
  models,
  functions,
  messages: {
    vi: { 'app.title': 'Ví dụ' },
    en: { 'app.title': 'Example' },
  },
})
```

Register the exported module in `packages/ketsuite/src/index.ts`, then add it to every deployment that
must run it. The deployment's `modules` list is the only runtime composition list.

## Model scopes are domain design

Choose scope before writing queries:

- `shared` is tenant-wide identity or reference data. KetSuite partners and companies are examples.
- `company` belongs to the active legal entity. KetJS adds and enforces the company boundary.
- `branch` belongs to an operating branch and is filtered by the active branch context.

Do not add manual `companyId` filters as a substitute for a model scope. They are easier to omit and
do not participate in framework enforcement. A shared identity may have a company-scoped companion
model: `partner.Partner` is shared while `partner.CompanyTerms` carries per-company values.

Read [Models and scopes](/ketjs/models/) before changing a model used by more than one vertical.

## Functions own business behavior

A domain function declares input, output, effects, and idempotency before its handler:

```ts
// File: packages/ketsuite/src/modules/example/index.ts
import { defineFn } from '@ketvietlab/ketjs'

export const functions = {
  saveExample: defineFn({
    input: { id: 'id', partnerId: 'id', note: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'write:example.Entry'],
    idempotent: true,
    handler: async (ctx, args) => {
      // Validate domain invariants, build a changeset, then commit.
      return { ok: true, id: args.id }
    },
  }),
}
```

Return stable field issues for expected validation failures. Reserve thrown errors for unexpected
failures or conflicts that the caller cannot correct as ordinary form input. Use `ctx.change(...).cast(...)`
for typed writes and `ctx.tx()` when one invariant spans several writes. Declared effects must describe
every model, queue, storage service, or transport used by the handler.

Backend routes call these functions through `ctx.call()`. They do not copy validation or update tables
directly. See [Functions and effects](/ketjs/functions/) and [Form validation](/ketjs/form-validation/).

## Bridge modules compose domains

Use a bridge when a feature depends on two owners. For example, accounting terms for a partner belong
to `account_partner`; loyalty evaluation at sale confirmation belongs to `loyalty_sale`.

```ts
// File: packages/ketsuite/src/modules/example_sale/index.ts
export default defineModule({
  name: 'example_sale',
  version: '0.1.0',
  depends: ['example', 'sale'],
  models,
  functions,
})
```

A bridge may publish new functions or extend an explicit contract. It must not deep-import another
module's private handler. If transactional composition needs a function spec, expose that exact stable
surface from `@ketvietlab/ketsuite` and test the export.

The package root currently exposes `pricingFunctionSpecs.priceFor` and
`accountFunctionSpecs.quoteLine` for private verticals that need canonical product pricing and tax
quotes while preserving one transaction. Consumers must declare every effect from the composed spec
and treat its input and output as the public contract; internal Pricing and Account helpers remain
private.

## Messages and public exports

Ship Vietnamese and English messages together for code paths visible in either locale. Keep message
keys owned by the declaring module and translate at the HTTP or screen boundary.

The package root is curated, not a barrel for every source file. Export reusable constants, types, and
extension contracts deliberately. Backend-only helpers belong in `@ketvietlab/ketsuite/backend`; neutral
UI components belong in `@ketvietlab/ketsuite/ui`.

## Definition of done

- The owner and dependency graph remain obvious from module names.
- Models have an intentional scope and indexed invariants where concurrency matters.
- Functions declare complete effects and stable validation errors.
- Multi-write commands are transactional and retry-safe where advertised.
- Vietnamese and English messages cover new user-visible output.
- Focused integration and HTTP tests cover success, rejection, and scope isolation.
- Public exports are added only for a real extension consumer.
