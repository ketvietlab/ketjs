# Module discovery

Ket can compose modules imported by the workspace and modules selected by name
from one or more filesystem roots. The filesystem convention is deliberately
similar to Odoo's `addons_path`; the deployment semantics are not.

Discovery answers **where executable modules are available**. The workspace still
decides **which modules the deployment ships**, and each database independently
decides **which shipped apps are installed**.

```text
module roots → catalogue → selected names + dependency closure
             → resolved AppSpec → composeWorkspace → manifest → runtime install state
```

Only the first three stages are new. Composition, migrations, HTTP and workers
continue to receive ordinary `KetModule` objects.

## Module root layout

A module root contains one direct child directory per module. Ket does not scan
arbitrarily deep directory trees.

```text
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

A directory without `ket.module.json` is ignored. This permits README files,
build tooling and unrelated directories to live beside modules.

### `ket.module.json`

The descriptor is intentionally small:

```json
{
  "name": "sale_discount",
  "entry": "./dist/index.js"
}
```

| field | required | meaning |
|---|---:|---|
| `name` | yes | Stable snake_case module identity. It must match the executable export. |
| `entry` | yes | Executable entry relative to the module directory. |
| `$schema` | no | Editor metadata. Ket accepts it but does not use it at runtime. |

Unknown keys are errors. Business metadata such as version, dependencies, models,
functions and install policy stays in `defineModule()` so the descriptor never
becomes a second manifest.

The entry must default-export a normal module:

```ts
import { defineModule } from 'ketjs'

export default defineModule({
  name: 'sale_discount',
  version: '1.0.0',
  depends: ['product'],
  extend: {
    'product.Product': { discountRate: 'decimal?' },
  },
})
```

Custom module JavaScript is trusted server code, just like a module imported by
the workspace. Discovery is not a sandbox. Themes still have to export
`defineTheme()` and remain subject to the theme contract.

## Workspace declaration

New workspaces should default-export `defineWorkspace()`:

```ts
import { defineApp, defineWorkspace } from 'ketjs'
import { product, uom } from 'ketsuite'

export default defineWorkspace({
  modulePaths: [
    new URL('./custom-addons/', import.meta.url),
    '/opt/company/vendor-addons',
  ],
  apps: [
    defineApp({
      name: 'backoffice',
      modules: [uom, product, 'sale_discount'],
      headless: true,
    }),
  ],
})
```

Imported `KetModule` objects and string references may appear in the same module
list. Existing workspaces that export `apps` and use only imported objects remain
valid:

```ts
export const modulePaths = ['./custom-addons']
export const apps = [backoffice]
```

Relative string roots are resolved relative to the loaded workspace artifact, not
the shell's current directory. A `URL` is used as-is. This matters in production:
if `dist/ket.workspace.js` contains `new URL('./custom-addons/', import.meta.url)`,
the deployed modules must be under `dist/custom-addons/`. For independently built
modules, an absolute deployment root is usually clearer.

## CLI and environment paths

The CLI can supplement paths declared by the workspace:

```bash
ket check \
  --workspace dist/ket.workspace.js \
  --module-path /opt/company-addons \
  --module-path /opt/vendor-addons
```

`--module-path` is repeatable. `KET_MODULE_PATH` accepts several roots separated by
the platform path delimiter—`:` on POSIX and `;` on Windows:

```bash
KET_MODULE_PATH=/opt/company-addons:/opt/vendor-addons ket serve
```

Configured workspace roots are considered first, followed by environment roots
and CLI roots. This order does **not** implement override precedence: if two roots
provide the same name, resolution fails regardless of order.

Inspect the effective result with:

```bash
ket modules --workspace dist/ket.workspace.js
```

The command prints canonical roots and, for every shipped module, its version,
kind, consuming apps and executable source. Modules imported directly by the
workspace show `workspace` as their source.

## Selection and dependencies

Scanning a descriptor makes a module discoverable; it does not ship or execute it.
Given:

```ts
modules: ['sale_discount']
```

and:

```ts
defineModule({
  name: 'sale_discount',
  depends: ['discount_core'],
})
```

Ket loads `sale_discount`, finds `discount_core` in the catalogue and includes both
in the resolved deployment. The result is topologically sorted before composition.
A dependency may also be an imported module object in the same app.

| state | descriptor read | code executed | included in manifest |
|---|---:|---:|---:|
| Present in a root, not selected or depended on | yes | no | no |
| Selected by the workspace | yes | yes | yes |
| Transitive dependency of a selected module | yes | yes | yes |
| Shipped but switched off in a database | already built | already built | yes, behaviour restricted at runtime |

This preserves Ket's build-time schema rule: files appearing in a root do not
silently change a database schema.

## Build and deployment contract

Production accepts `.js`, `.mjs` and `.cjs` entries only. Build custom TypeScript
before starting Ket and deploy `ket.module.json` beside the emitted artifact.
Development through `npm run dev`/`tsx` also permits `.ts`, `.tsx`, `.mts` and
`.cts` entries because that loader explicitly transforms source.

A custom module should be packaged so all of its runtime imports resolve from its
deployed location. A module outside the application directory normally needs its
own installed dependencies, a workspace/package-manager link, or a bundled entry;
Node resolves bare ESM imports from the importing module's directory, not from the
shell's current directory.

Assets and templates should remain module-relative:

```ts
export default defineModule({
  name: 'sale_discount',
  assets: new URL('../assets/', import.meta.url),
  styles: ['discount.css'],
})
```

The descriptor is for discovery only; asset serving and install-state filtering
continue to use the composed module contract.

## Validation and path safety

Before importing selected code, Ket enforces these boundaries:

- roots are canonicalized with `realpath`; repeating the same physical root is a no-op;
- symlinked module directories are supported;
- an entry's real path must remain inside its module directory;
- duplicate module names across roots are rejected rather than shadowed;
- the descriptor name must equal the default export's `name`;
- the export must have the normalized `KetModule` shape;
- duplicate inline module names are rejected before dependency sorting;
- missing dependencies and dependency cycles remain composition errors.

An invalid descriptor or missing entry invalidates the catalogue even when that
module is not selected. Invalid executable code is not imported until the module
is selected.

## Error reference

| code | cause |
|---|---|
| `E_MODULE_PATH` | Empty or invalid root declaration. |
| `E_MODULE_PATH_PROTOCOL` | A non-file URL was used. |
| `E_MODULE_PATH_MISSING` | Configured root does not exist. |
| `E_MODULE_PATH_NOT_DIRECTORY` | Configured root is not a directory. |
| `E_MODULE_DESCRIPTOR` | Descriptor cannot be read or parsed. |
| `E_MODULE_DESCRIPTOR_KEY` | Descriptor contains unsupported fields. |
| `E_MODULE_DESCRIPTOR_NAME` | Descriptor name is not valid snake_case. |
| `E_MODULE_DESCRIPTOR_ENTRY` | Descriptor entry is absent or empty. |
| `E_MODULE_ENTRY_MISSING` | Entry path does not exist. |
| `E_MODULE_ENTRY_NOT_FILE` | Entry resolves to a directory or other non-file. |
| `E_MODULE_ENTRY_ESCAPE` | Entry resolves outside its module directory. |
| `E_MODULE_ENTRY_EXTENSION` | Production was given source or an unsupported artifact. |
| `E_MODULE_EXPORT` | Default export is not a normalized `KetModule`. |
| `E_MODULE_IDENTITY_MISMATCH` | Descriptor and executable export use different names. |
| `E_MODULE_NAME_CLASH` | Roots or inline declarations provide the same identity twice. |
| `E_MODULE_DUPLICATE_REF` | An app names the same path module more than once. |
| `E_MISSING_DEPENDENCY` | A selected module needs a name no root/import provides. |
| `E_DEPENDENCY_CYCLE` | The resolved dependency graph contains a cycle. |
| `E_APP_THEME_KIND` | `theme` selected an ordinary module rather than a theme. |

All errors are `KetError` values with machine-readable `code`, message and, where
useful, a remediation hint.

## Programmatic resolution

Tools embedding Ket can call the same boundary used by the CLI:

```ts
import { composeWorkspace, resolveWorkspace } from 'ketjs'

const resolved = await resolveWorkspace(workspace, {
  baseUrl: new URL('./ket.workspace.js', import.meta.url),
  extraModulePaths: ['/opt/one-off-addons'],
  allowSource: false,
})

const manifest = composeWorkspace(resolved.apps)
```

`resolved.apps` is the object-only `AppSpec[]` expected by boot and worker APIs.
`resolved.modulePaths` and `resolved.modules` provide provenance for diagnostics and
operator tooling.
