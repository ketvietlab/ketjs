---
title: Public API
description: Supported KetJS, theme, testing, view, and PostgreSQL package entrypoints.
---

KetJS is currently unreleased and reports version `0.0.0`. Public names may change until a stable release.
Import only from documented package entrypoints; deep imports into `dist/` or `src/` are implementation
details.

## Package entrypoints

| Entrypoint | Runtime |
| --- | --- |
| `ketjs` | Framework composition, server, data, jobs, sessions, integrations, and selected view helpers. |
| `ketjs/theme` | Theme compilation and presentation helpers without the wider server API. |
| `ketjs/testing` | Isolated headless applications, test clients, cookie jars, and fixture types. |
| `ketjs-view` | Browser-safe signals, rendering, SSR, hydration, and islands. |
| `ketjs-view/jsx-runtime` | Automatic JSX runtime. |
| `ketjs-view/jsx-dev-runtime` | Automatic JSX development runtime. |
| `ketjs-postgres` | Optional PostgreSQL adapter. |

All packages require Node.js 24 or later for their supported server/tooling use. `ketjs-view` has no runtime
dependencies and its browser-facing entrypoint avoids Node APIs.

## `ketjs`

### Composition and application model

| API | Purpose |
| --- | --- |
| `defineModule`, `defineTheme` | Validate and preserve module/theme declarations. |
| `defineApp`, `defineWorkspace` | Declare deployable apps and the repository workspace. |
| `resolveWorkspace` | Resolve string module references from configured roots. |
| `compose`, `composeWorkspace` | Build checked manifests for one app or a workspace. |
| `explainWorkspace` | Render a workspace composition summary. |
| `createAppRegistry`, `restrictManifest` | Apply database-owned module install state to a deployment manifest. |
| `validateLayout`, `formatLayoutErrors` | Validate placement and extension relationships. |
| `diffManifests`, `formatDiff` | Compare manifest contracts. |
| `KetError`, `Diagnostics` | Structured framework errors and accumulated diagnostics. |

Primary types include `Manifest`, `Module`, `Theme`, `Model`, `AppDeclaration`, `AppSpec`,
`WorkspaceDeclaration`, `ResolvedWorkspace`, `Placement`, and `LayoutError`.

### Operations and HTTP

| API | Purpose |
| --- | --- |
| `defineFn`, `registerFunctions`, `callFn` | Declare, register, and execute effect-checked functions. |
| `project` | Apply output projection rules. |
| `defineJob`, `registerJobs` | Declare and register durable job handlers. |
| `createKetServer` | Create the low-level HTTP server from composed runtime services. |
| `bootRuntime`, `bootApp`, `serveApp` | Boot datastore/runtime services or a complete HTTP app. |
| `bootWorker`, `serveWorker` | Boot or continuously serve configured durable queues. |
| `page`, `fragment`, `document` | Create rendered response bodies. |
| `navigablePage`, `isNavigationRequest` | Negotiate a full document or lazy named navigation slots. |
| `NAVIGATION_HEADER`, `NAVIGATION_VERSION`, `NAVIGATION_TYPE` | Fragment navigation protocol constants. |
| `json`, `text`, `bytes`, `streamed`, `raw` | Create typed non-page response bodies. |
| `withHeaders` | Add headers without discarding a response body's type. |
| `multipart` | Parse bounded multipart input. |

Related types include `Fn`, `FnContext`, `CallResult`, `Effect`, `Job`, `JobContext`, `ServeSpec`,
`ServeContext`, `BootedApp`, `BootedRuntime`, `BootedWorker`, `Route`, `RouteParams`, `ResponseBody`, and
`RouteResult`.

### Sessions, streams, queues, and integration effects

| API | Purpose |
| --- | --- |
| `createSessions`, `memorySessionStore`, `dbSessionStore` | Create signed sessions over memory or database storage. |
| `parseCookies`, `SESSION_COOKIE` | Parse cookies and reference the framework session-cookie name. |
| `createStreams`, `memoryStreamStore`, `dbStreamStore` | Create resumable stream writers and backing stores. |
| `createQueue`, `queueFor`, `JOB_CHANNEL` | Manage durable job state and queue wake-up channels. |
| `createIdempotency` | Persist and replay idempotent operation results. |
| `effectTransport`, `memoryTransport`, `unavailableTransport` | Execute or test declared outbound messages. |
| `validateOutboundMessage` | Validate an outbound transport payload. |
| `storageFromConfig`, `localStorage`, `s3Storage` | Open configured storage implementations. |
| `namespacedStorage`, `effectStorage` | Scope object keys and record declared storage effects. |
| `signRequest`, `presignUrl`, `sha256` | S3 Signature Version 4 primitives. |

Use the higher-level runtime services when possible. Signing and queue primitives are public for custom
adapters and operational tooling, not a requirement for ordinary modules.

### Data and migration

| API | Purpose |
| --- | --- |
| `sqliteAdapter` | Built-in SQLite adapter. |
| `assertAdapter`, `ADAPTER_METHODS` | Validate a custom adapter contract. |
| `createAdapterPool` | Lease bounded per-key adapters, including tenant databases. |
| `from`, `deleteFrom`, `table`, `Query` | Build parameterized select, delete, and grouped queries. |
| `eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `like`, `ilike` | Comparison expressions. |
| `inArray`, `isNull`, `isNotNull`, `and`, `or`, `not` | Set, null, and boolean expressions. |
| `asc`, `desc` | Ordering expressions. |
| `defineListSearch`, `parseListState`, `encodeListState` | Declare allowlisted URL-driven list state. |
| `compileListFilter`, `validateListState` | Validate and compile nested list filters. |
| `dateBucket`, `localDateTimeToUtc`, `localDayRange` | Build timezone-aware bucket and UTC range values. |
| `changeset`, `Changeset` | Cast and validate create/update input. |
| `schemaFromManifest`, `planMigration`, `renderSql` | Derive and render schema migration plans. |
| `tableNameFor` | Resolve the physical table name for a manifest model. |
| `DestructiveMigrationError` | Identify a plan requiring explicit destructive permission. |
| `migrateOne`, `migrateFleet`, `formatFleet` | Apply or report one-database and tenant-fleet migrations. |

The `Adapter`, `Transaction`, `Scope`, `Dialect`, `Sql`, `Table`, `Expr`, `FieldError`, and `Validator`
types are exported from the same entrypoint.

### Presentation, menus, and capabilities

| API | Purpose |
| --- | --- |
| `buildMenu`, `activeApp` | Resolve visible menu trees and active application context. |
| `translator`, `missingMessages`, `formatMissing`, `PSEUDO_LOCALE` | Translate catalogs and audit missing messages. |
| `createTheme`, `compileKtl`, `loadTemplates`, `createJoints` | Compile and execute the theme boundary. |
| `makeDrop`, `makeDrops`, `sealScope` | Expose controlled view-model values to KTL. |
| `tokensToCss`, `scopedCss` | Convert design tokens into layered and scoped CSS. |
| `renderToString`, `hydrateRoot`, `mount`, `mountHydrated` | Selected `ketjs-view` rendering helpers. |
| `renderIsland`, `hydrateIslands`, `createIslandManager`, `ISLAND_TAG` | Server-render, hydrate, and reconcile named islands. |
| `reachOf`, `functionsOf`, `formatReach`, `formatInventory` | Inspect function and data/effect permission reach. |
| `agentTools`, `agentDescriptor`, `compositionSchema` | Describe the composed application for tooling and agents. |
| `generateDts` | Generate manifest-derived TypeScript declarations. |

## `ketjs/theme`

Use the narrow theme entrypoint in presentation packages:

```ts
import {
  compileKtl,
  createJoints,
  createTheme,
  loadTemplates,
  makeDrop,
  makeDrops,
  scopedCss,
  sealScope,
  tokensToCss,
} from 'ketjs/theme'
```

It also exports `LAYER_ORDER` and the `Compiled`, `Filter`, `Scope`, and `Joints` types.

## `ketjs/testing`

```ts
import {
  CookieJar,
  TestClient,
  TestHttpError,
  createTestApp,
} from 'ketjs/testing'
```

The entrypoint also exports `TestApp`, `CreateTestAppOptions`, `TestClientOptions`, `TestIdentity`,
`TestCallOptions`, `TestFixtures`, `TestFixtureCallOptions`, and `TestFixtureTenant`. See
[Testing](/ketjs/testing/) for the lifecycle and isolation contract.

## `ketjs-view`

| API | Purpose |
| --- | --- |
| `signal`, `computed`, `effect`, `batch` | Fine-grained reactive state and scheduling. |
| `html`, `each`, `when` | Tagged templates and conditional/list composition. |
| `createRoot`, `hydrateRoot` | Create or hydrate a rendering root. |
| `mount`, `mountHydrated` | Mount component-style view functions. |
| `renderToString`, `trustedMarkup`, `isMarkup` | Server rendering and explicit trusted markup. |
| `HydrationMismatch`, `HOLE_MARKER` | Hydration diagnostics and protocol marker. |
| `renderIsland`, `hydrateIslands`, `createIslandManager`, `ISLAND_TAG` | Island serialization, hydration, reconciliation, and disposal. |
| `countingHost`, `domHost`, `escapeHtml` | Host implementations and escaping primitive. |

The view entrypoint also exports `IslandDefinition`, `IslandFactory`, `IslandController`,
`IslandManager`, and their related prop/instance types.

TypeScript projects using automatic JSX can configure:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "ketjs-view"
  }
}
```

## `ketjs-postgres`

```ts
import { postgresAdapter, type PostgresOptions } from 'ketjs-postgres'
```

The app installs the optional `postgres` peer dependency and owns its connection configuration. The adapter
implements KetJS's public `Adapter` contract; core does not import a PostgreSQL driver.

## Compatibility policy

- Use ESM and Node.js 24 or later.
- Depend on package entrypoints, not file layout.
- Generate types from the exact composed app with `ket types`.
- Pin versions while KetJS remains pre-release.
- Review manifest and migration diffs when upgrading.
- Treat identifiers persisted in databases, queues, storage, and cookies as compatibility contracts even
  when TypeScript signatures still compile.
`ReportDef` and `ComposedReport` describe business-owned print declarations in the manifest.

## `ketjs/pdf`

| Export | Purpose |
| --- | --- |
| `compileReportTemplate` | Compile KTL in report-safe mode and return a typed document tree. |
| `parseReportMarkup` | Validate constrained report markup. |
| `renderReportHtml` | Produce a safe HTML preview from the document tree. |
| `renderPdf` | Render PDF bytes using an explicit TrueType font. |
| `interFontUrl` | Resolve the framework-vendored Inter Regular, SemiBold, or Bold asset. |
