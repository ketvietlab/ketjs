---
title: Modules and manifest
description: Build composable KetJS modules and understand the immutable manifest derived from a deployment.
---

A module is KetJS's unit of ownership and composition. It declares a capability's data, operations,
presentation contracts, background work, assets, and messages in one object. `defineModule()` has no
side effects; a `DeploymentSpec` explicitly selects which modules exist in a running system.

## Define a module

```ts
// File: src/modules/inventory/index.ts
import { defineModule, from } from '@ketvietlab/ketjs'

export const inventory = defineModule({
  name: 'inventory',
  version: '1.0.0',
  title: 'Inventory',
  summary: 'Stock levels and replenishment',
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

## Declaration surface

| Concern | Module fields |
| --- | --- |
| Identity | `name`, `version`, `depends`, `title`, `summary`, `category` |
| Data | `models`, `extend`, `relations`, `views` |
| Operations | `functions`, `jobs`, `routes` |
| Navigation and language | `menus`, `messages` |
| Presentation contracts | `joints`, `fills`, `omits`, `sections`, `islands` |
| Theme resources | `templates`, `tokens`, `requires`, `provides` |
| Printable documents | `reports` |
| Static resources | `assets`, `styles` |

Unknown keys fail with `E_MODULE_UNKNOWN_KEY`. Module names must be snake_case and stable. KetJS has
no module install state, module group catalogue, or runtime enable/disable lifecycle.

## Dependencies and extensions

```ts
// File: src/modules/stock_forecast/index.ts
export const stockForecast = defineModule({
  name: 'stock_forecast',
  depends: ['inventory'],
  extend: {
    'inventory.Warehouse': { forecastHorizonDays: 'int?' },
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

## Compose the manifest

```ts
// File: src/deployment.ts
import { compose } from '@ketvietlab/ketjs'
import { inventory } from './modules/inventory/index.ts'
import { stockForecast } from './modules/stock_forecast/index.ts'

const manifest = compose([inventory, stockForecast])
```

Composition topologically orders modules and produces one immutable manifest:

| Manifest section | Runtime use | Composition checks |
| --- | --- | --- |
| `modules`, `order` | Dependency and version inventory | Missing dependencies and cycles |
| `models`, `relations` | Schema, queries, generated types | Duplicate models, fields, bad relations |
| `functions`, `jobs` | HTTP, workers, permissions, agents | Signatures, effects, queue declarations |
| `joints`, `fills`, `regions` | Extension and theme contracts | Ownership and unpublished targets |
| `routes`, `menus` | Request dispatch and navigation | Duplicate paths and IDs |
| `islands`, `sections`, `styles` | Interactive and static presentation | Duplicate providers and asset boundaries |
| `messages`, `tokens` | Translation and CSS variables | Deterministic merge and provenance |
| `reports` | Printable documents | Target and read-only source exist; IDs are unique |

Every contributed field records its source module in `by`. The same manifest drives schema migration,
HTTP routes, worker jobs, generated types, themes, permissions, and agent inspection.

## Deployment semantics

The authored module list is the runtime contract:

```ts
// File: src/deployment.ts
import { defineDeployment } from '@ketvietlab/ketjs'

export const business = defineDeployment({
  name: 'business',
  modules: [inventory, stockForecast],
  headless: true,
})
```

Both modules are composed, both schemas are migrated, and both behaviors run for every tenant of this
deployment. To produce a different product shape, declare another deployment with a different module
list and release it as a separate artifact. A runtime database never changes the composition.

## Manifest inspection

```bash
# Run from: /path/to/example-deployment
ket check --workspace dist/ket.workspace.js
ket manifest --deployment business --workspace dist/ket.workspace.js
ket snapshot --deployment business --workspace dist/ket.workspace.js
ket diff --against .ket/manifest.business.json --workspace dist/ket.workspace.js
ket types --deployment business --workspace dist/ket.workspace.js
```

Continue with [Workspaces and deployments](/ketjs/workspaces/) for HTTP, worker, datastore, and
multi-deployment composition.
