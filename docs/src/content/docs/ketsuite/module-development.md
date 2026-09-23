---
title: Module development
description: Add KetSuite domain, backend, and bridge modules without breaking ownership boundaries.
---

Start a KetSuite feature by identifying its owner. The directory and module name are durable
identities: models and functions become qualified names such as `partner.Partner` and
`partner.savePartner`, and installed state records the module name.

## Module source roots

The organization rules below apply to public KetSuite modules and private deployment modules. Their
source roots differ; `functions/`, `screens/`, and `index.ts` are relative to the owning module's
source root, not necessarily its package directory.

| Repository layout | Module source root |
| --- | --- |
| Public KetJS repository | `packages/ketsuite/src/modules/<module>/` |
| Private KetSuite deployment layout | `apps/ketsuite/modules/<module>/src/` |

Do not add another `src/` inside a public module or remove the private module's `src/`. The public
build emits the package source tree, while the private deployment build copies each emitted module
source tree into its descriptor's `dist/` entry. Preserve those entry points and use the owning
repository's import extensions: `.ts`/`.tsx` here, `.js` in the private deployment source.

## Required domain layout

```text
# File: packages/ketsuite/src/modules/example
packages/ketsuite/src/modules/example/
├── index.ts          # assembly only
├── models.ts         # storage contract and scopes
├── functions/
│   ├── index.ts      # duplicate-checked registry assembly only
│   ├── entry.ts      # named handlers and descriptors for one capability
│   └── ...
├── relations.ts      # cross-model relation metadata
├── jobs.ts           # durable asynchronous work, when needed
├── reports.ts        # printable document contracts, when needed
├── messages.ts       # vi/en domain messages
└── types.ts          # stable constants and TypeScript types
```

Each capability file owns its named handlers and function descriptors. The module's `index.ts`
remains readable as the complete declaration, even for small modules:

```ts
// File: packages/ketsuite/src/modules/example/index.ts
import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions/index.ts'
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
// File: packages/ketsuite/src/modules/example/functions/entry.ts
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'

export async function saveExampleHandler(ctx: Ctx, args: Record<string, unknown>) {
  // Validate domain invariants, build a changeset, then commit.
  return { ok: true, id: args.id }
}

export const entryFunctions: Record<string, FnSpec> = {
  saveExample: defineFn({
    input: { id: 'id', partnerId: 'id', note: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'write:example.Entry'],
    idempotent: true,
    handler: saveExampleHandler,
  }),
}
```

The registry only assembles capability groups. Check each key before adding it: spreading objects
first loses evidence of overwritten keys, so a check on the finished object is too late.

```ts
// File: packages/ketsuite/src/modules/example/functions/index.ts
import type { FnSpec } from '@ketvietlab/ketjs'
import { entryFunctions } from './entry.ts'

export const functions: Record<string, FnSpec> = {}
for (const group of [entryFunctions]) {
  for (const [key, spec] of Object.entries(group)) {
    if (Object.hasOwn(functions, key)) throw new Error(`Duplicate example function: ${key}`)
    functions[key] = spec
  }
}
```

Return stable field issues for expected validation failures. Reserve thrown errors for unexpected
failures or conflicts that the caller cannot correct as ordinary form input. Use `ctx.change(...).cast(...)`
for typed writes and `ctx.tx()` when one invariant spans several writes. Declared effects must describe
every model, queue, storage service, or transport used by the handler.

Backend routes call these functions through `ctx.call()`. They do not copy validation or update tables
directly. See [Functions and effects](/ketjs/functions/) and [Form validation](/ketjs/form-validation/).

### Shared logic and migration

Do not introduce an `operations.ts` layer just to forward each function to a same-named operation.
A named handler is the use-case boundary; logic used only there can stay beside it. Extract a
specifically named policy, query, or domain service when multiple handlers/jobs need it, an invariant
needs independent tests, or a substantial domain workflow deserves a distinct service. Existing
`operations.ts` files can contain real shared behavior: preserve that behavior, its transaction
boundary, and public exports when moving it to a specifically named service.

Do not call another handler directly for internal reuse. Functions and jobs share domain services.
The documented public function-spec contracts described below are a narrow exception for composing
domains in one transaction, not permission to deep-import an arbitrary handler.

**Any edit to an existing KetSuite module `functions.ts` must migrate the entire file in the same
change.** Split it by capability, name each handler, assemble at `functions/index.ts`, and remove
forwarding-only operation layers. Do not add a new monolithic registry or leave the untouched portion
of the old file for a later agent. Preserve all descriptor fields, including `anonymous`, `exposure`,
`provision`, `input`, `output`, `effects`, `crossCompany`, `idempotent`, `dryRun`, and `agent`, as well
as function keys and permission coverage.

Update module/package exports, callers, jobs, tests, and source-based audits that refer to the old
paths in the same change. A source audit must inspect the new owners without weakening its semantic
assertions. Focused checks must establish that manifest keys, permissions, public extension contracts,
and transaction behavior remain unchanged except for intentional behavior changes covered by tests.

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

These explicitly published specs may be called as `spec.handler(ctx, args)` by a composing domain
use-case using the same context or transaction. The caller owns its authorization, must preserve
scope, and must declare all of the composed spec's effects. This does not replace `ctx.call()` at a
user-facing HTTP boundary. Never replace an in-transaction call with a separate request or duplicate
another domain's implementation merely to satisfy file-organization rules.

To retire a function-spec extension, first publish a compatible domain service, retain the old
export while consumers migrate, and cover scope and transaction/rollback behavior. Release the public
API before private deployments update their pin and switch consumers. A file-only refactor must not
silently remove an existing extension contract.

## Messages and public exports

Ship Vietnamese and English messages together for code paths visible in either locale. Keep message
keys owned by the declaring module and translate at the HTTP or screen boundary.

The package root is curated, not a barrel for every source file. Export reusable constants, types, and
extension contracts deliberately. Backend-only helpers belong in `@ketvietlab/ketsuite/backend`; neutral
UI components belong in `@ketvietlab/ketsuite/ui`.

## Definition of done

- The owner and dependency graph remain obvious from module names.
- Named handlers and descriptors are grouped by capability, with duplicate-checked registry assembly.
- A touched legacy `functions.ts` is fully migrated, including import/export and source-audit updates.
- Models have an intentional scope and indexed invariants where concurrency matters.
- Functions declare complete effects and stable validation errors.
- Multi-write commands are transactional and retry-safe where advertised.
- Vietnamese and English messages cover new user-visible output.
- Focused integration and HTTP tests cover success, rejection, and scope isolation.
- Public exports are added only for a real extension consumer.
- Existing descriptor fields and public extension contracts survive organizational refactors.
- Routed business screens follow the [screen organization rules](/ketsuite/backend-development/#screen-organization).
