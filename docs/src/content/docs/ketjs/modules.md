---
title: Modules and manifest
description: Build composable KetJS modules and understand the single manifest derived from them.
---

A module is KetJS's unit of ownership and composition. It declares a capability's data, operations,
presentation contracts, background work, assets, and messages in one object. `defineModule()` has no
side effects; composition is explicit and deterministic.

## Define a module

```ts
import { defineModule, from } from 'ketjs'

export const inventory = defineModule({
  name: 'inventory',
  version: '1.0.0',
  app: true,
  title: 'Inventory',
  summary: 'Stock levels and replenishment',
  category: 'Operations',
  install: 'manual',
  models: {
    Warehouse: {
      scope: 'company',
      fields: { id: 'id', name: 'text', active: 'bool' },
    },
  },
  functions: {
    listWarehouses: {
      output: { id: 'id', name: 'text', active: 'bool' },
      effects: ['read:inventory.Warehouse'],
      handler: (ctx) => ctx.db.all(from(ctx.table('inventory.Warehouse'))),
    },
  },
})
```

Local keys are qualified during composition. `Warehouse` becomes `inventory.Warehouse`, and
`listWarehouses` becomes `inventory.listWarehouses`.

## Module declaration surface

| Concern | Module fields |
| --- | --- |
| Identity and lifecycle | `name`, `version`, `depends`, `app`, `title`, `summary`, `category`, `install`, `removable` |
| Data | `models`, `extend`, `relations`, `views` |
| Operations | `functions`, `jobs`, `routes` |
| Navigation and language | `menus`, `messages` |
| Presentation contracts | `joints`, `fills`, `omits`, `sections`, `islands` |
| Theme resources | `templates`, `tokens`, `requires`, `provides` |
| Static resources | `assets`, `styles` |

Unknown keys fail with `E_MODULE_UNKNOWN_KEY`. Module names must be snake_case and stable; renaming a
module creates a new identity and leaves the old installed state as an orphan.

## Dependencies and extensions

Modules extend contracts through declared dependencies:

```ts
export const stockForecast = defineModule({
  name: 'stock_forecast',
  depends: ['inventory'],
  extend: {
    'inventory.Warehouse': {
      forecastHorizonDays: 'int?',
    },
  },
  fills: {
    'inventory:warehouse.detail.footer':
      '<p>Forecast horizon: {{ warehouse.forecastHorizonDays }}</p>',
  },
})
```

The extension field must be optional because existing rows predate the extending module. A module may
extend a model or fill a joint only when it depends on the owner. Duplicate fields, missing
dependencies, and unpublished joints are composition errors.

This rule is the boundary between an extension and a patch: the owner deliberately publishes what
other modules may change.

## Joints, fills, and omissions

A joint is a named presentation extension point:

```ts
const inventory = defineModule({
  name: 'inventory',
  joints: {
    'warehouse.detail.footer': {
      props: { warehouse: 'json' },
      multiple: true,
    },
  },
})
```

Another module fills the qualified key `inventory:warehouse.detail.footer`. A dependent module may
also declare `omits: ['inventory:warehouse.detail.footer']` to remove the joint from the rendered
output. An omission is structural, not a CSS hide; omitted content is not emitted into HTML.

## Install policy

`install` controls how a module may become enabled in one database:

| Value | Behavior |
| --- | --- |
| `manual` | Default. Enabled only when an operator or bootstrap set asks for it. |
| `auto` | Enabled after its dependencies are enabled, unless the deployment sets `KET_AUTO_INSTALL=0`. |
| `never` | Cannot be installed directly; it arrives only as a dependency of another installed module. |

Set `removable: false` for infrastructure an operator must not switch off, such as the interface used
to manage modules. Removing a module keeps its tables, columns, and rows. Reinstalling restores its
behavior over the preserved data.

## Compose the manifest

```ts
import { compose } from 'ketjs'

const manifest = compose([inventory, stockForecast])
```

Composition topologically orders modules and produces one manifest:

| Manifest section | Runtime use | Composition checks |
| --- | --- | --- |
| `modules`, `order` | Dependency and lifecycle inventory | Missing dependencies and cycles |
| `models`, `relations` | Schema, queries, generated types | Duplicate models, fields, bad relations |
| `functions`, `jobs` | HTTP, workers, permissions, agents | Signatures, effects, queue declarations |
| `joints`, `fills`, `regions` | Extension and theme contracts | Ownership and unpublished targets |
| `routes`, `menus` | Request dispatch and navigation | Duplicate paths/IDs and dependency ownership |
| `islands`, `sections`, `styles` | Interactive and static presentation | Duplicate providers and asset boundaries |
| `messages`, `tokens` | Translation and CSS variables | Deterministic merge and provenance |

Every contributed field records its source module in `by`. That provenance powers migration errors,
upgrade diffs, generated types, and agent capability inspection.

## Runtime restriction

Composition includes everything the deployment ships. Runtime module state belongs to a database:

```ts
import { createAppRegistry, restrictManifest } from 'ketjs'

const registry = await createAppRegistry(manifest, adapter)
await registry.install('inventory')

const live = restrictManifest(manifest, await registry.enabled())
```

The restricted manifest drops behavior from disabled modules while retaining the deployment schema.
In a multi-tenant application, compute this per tenant; reusing one tenant's live manifest for another
would cross the isolation boundary.

## Manifest inspection

Use the CLI instead of adding a second registry:

```bash
ket check --workspace dist/ket.workspace.js
ket manifest --app backoffice --workspace dist/ket.workspace.js
ket snapshot --app backoffice --workspace dist/ket.workspace.js
ket diff --against .ket/manifest.backoffice.json --workspace dist/ket.workspace.js
ket types --app backoffice --workspace dist/ket.workspace.js
```

`snapshot` and `diff` surface breaking contract changes. `types` derives declarations from exactly the
same manifest used by the runtime.

## Themes are restricted modules

Use `defineTheme()` for installable presentation packages. Themes may declare templates, fills,
tokens, assets, and styles, but cannot declare models, model extensions, functions, jobs, routes, or
islands. See [Themes and KTL](/ketjs/themes/).

## Recommended module layout

Small capabilities may live in one file. Larger modules remain easier to review when each concern has
one file and `index.ts` only assembles the declaration:

```text
inventory/
├── index.ts
├── models.ts
├── relations.ts
├── functions.ts
├── jobs.ts
├── menus.ts
├── messages.ts
├── views.ts
└── assets/
```

Do not create side-channel registries in these files. Everything the module contributes must remain
visible in `defineModule()`.
