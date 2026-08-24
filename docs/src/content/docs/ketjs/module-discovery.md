---
title: Module discovery
description: Resolve selected KetJS modules from filesystem roots without making file presence executable.
---

KetJS can compose modules imported by the workspace and modules selected by name from filesystem
roots. The layout resembles module search paths, but discovering a descriptor does not select or
execute that module.

```text
# File: docs/src/content/docs/ketjs/module-discovery.md
module roots → descriptor catalogue → selected names + dependency closure
             → resolved deployments → immutable composition
```

## Root layout

A root contains one direct child per module:

```text
# File: custom-addons
custom-addons/
├── sale_discount/
│   ├── ket.module.json
│   ├── dist/
│   │   └── index.js
│   └── assets/
└── delivery_connector/
    ├── ket.module.json
    └── dist/
        └── index.js
```

Directories without `ket.module.json` are ignored. KetJS does not recursively search arbitrary
subdirectories for descriptors.

## Descriptor

`ket.module.json` intentionally contains only discovery metadata:

```jsonc
// File: custom-addons/sale_discount/ket.module.jsonc
{
  "name": "sale_discount",
  "entry": "./dist/index.js"
}
```

| Field | Required | Meaning |
| --- | ---: | --- |
| `name` | yes | Stable snake_case identity; must equal the executable module's name. |
| `entry` | yes | Entry artifact relative to the module directory. |
| `$schema` | no | Editor metadata, ignored by the runtime. |

Version, dependencies, models, and functions stay in `defineModule()`. Keeping them
out of the descriptor prevents a second manifest from drifting away from executable code.

The entry default-exports a normal module:

```ts
// File: src/modules/sale_discount/index.ts
import { defineModule } from '@ketvietlab/ketjs'

export default defineModule({
  name: 'sale_discount',
  version: '1.0.0',
  depends: ['pricing'],
  extend: {
    'pricing.PriceList': { discountRate: 'decimal?' },
  },
})
```

Discovered module code is trusted server code. Discovery is not a sandbox. A discovered theme remains
restricted because its entry must export `defineTheme()`.

## Configure roots

Declare roots relative to the workspace artifact or as absolute deployment paths:

```ts
// File: ket.workspace.ts
import { defineDeployment, defineWorkspace } from '@ketvietlab/ketjs'
import { pricing } from './modules/pricing.ts'

export default defineWorkspace({
  modulePaths: [
    new URL('./custom-addons/', import.meta.url),
    '/opt/company/vendor-addons',
  ],
  deployments: [
    defineDeployment({
      name: 'backoffice',
      modules: [pricing, 'sale_discount'],
      headless: true,
    }),
  ],
})
```

Imported module objects and string references may appear in the same deployment. String references do not
survive past resolution; runtime and composition receive ordinary `KetModule` objects.

Relative roots resolve from the loaded workspace artifact, not the current shell directory. If
`dist/ket.workspace.js` uses `new URL('./custom-addons/', import.meta.url)`, deploy the directory under
`dist/custom-addons/`.

## Environment and CLI roots

Supplement workspace roots at deployment time:

```bash
# Run from: /path/to/example-app
ket check \
  --workspace dist/ket.workspace.js \
  --module-path /opt/company-addons \
  --module-path /opt/vendor-addons
```

`--module-path` is repeatable. `KET_MODULE_PATH` uses the platform path separator:

```bash
# Run from: /path/to/example-app
KET_MODULE_PATH=/opt/company-addons:/opt/vendor-addons ket serve
```

Workspace roots are considered first, followed by environment and CLI roots. The order is not an
override mechanism: duplicate module names fail regardless of precedence.

Inspect the result with:

```bash
# Run from: /path/to/example-app
ket modules --workspace dist/ket.workspace.js
```

The command prints canonical roots plus each selected module's version, kind, consuming deployments, and
source path.

## Selection and dependency closure

Scanning creates a catalogue. Only selected modules and their transitive dependencies are imported:

| State | Descriptor read | Code executed | In manifest |
| --- | ---: | ---: | ---: |
| Present but not selected or required | yes | no | no |
| Selected by the workspace | yes | yes | yes |
| Dependency of a selected module | yes | yes | yes |

The descriptor catalogue itself must be structurally valid, but executable code is not imported until
selection requires it. A file merely appearing in a root never changes the schema.

## Production artifacts

Production entries must use `.js`, `.mjs`, or `.cjs`. Build custom TypeScript before serving and
deploy its descriptor beside the emitted code. The `tsx` development path may additionally resolve
`.ts`, `.tsx`, `.mts`, and `.cts` because that loader explicitly transforms source.

Keep runtime imports resolvable from the module's deployed directory. A module outside the project tree
usually needs its own dependencies, a package-manager link, or a bundled entry.

Assets stay module-relative:

```ts
// File: src/modules/sale_discount/index.ts
export default defineModule({
  name: 'sale_discount',
  assets: new URL('../assets/', import.meta.url),
  styles: ['discount.css'],
})
```

## Path safety and validation

Resolution enforces the following boundaries:

- roots are canonicalized; repeating one physical root is a no-op;
- an entry's real path must remain inside its module directory;
- duplicate module identities are rejected rather than shadowed;
- descriptor and executable export names must match;
- the export must have the normalized `KetModule` shape;
- source entries are refused in production;
- missing dependencies and cycles remain hard composition errors.

Common codes include `E_MODULE_PATH_MISSING`, `E_MODULE_DESCRIPTOR`,
`E_MODULE_ENTRY_ESCAPE`, `E_MODULE_ENTRY_EXTENSION`, `E_MODULE_EXPORT`,
`E_MODULE_IDENTITY_MISMATCH`, `E_MODULE_NAME_CLASH`, `E_MISSING_DEPENDENCY`, and
`E_DEPENDENCY_CYCLE`.

Every failure is a `KetError` with a machine-readable code, a human message, and a remediation hint
when KetJS can identify one.

## Programmatic resolution

```ts
// File: ket.workspace.ts
import { composeWorkspace, resolveWorkspace } from '@ketvietlab/ketjs'

const resolved = await resolveWorkspace(workspace, {
  baseUrl: new URL('./ket.workspace.js', import.meta.url),
  extraModulePaths: ['/opt/one-off-addons'],
  allowSource: false,
})

const composed = composeWorkspace(resolved.deployments)
```

`resolved.modulePaths` and `resolved.modules` preserve source provenance for diagnostics and operator
tooling.
