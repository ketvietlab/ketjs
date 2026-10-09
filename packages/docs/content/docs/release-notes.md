---
title: Release notes
description: The coordinated KetJS 0.3.0 release, HTTP contracts, OpenAPI export and Spec integration.
group: Project evolution
order: 1
---

## Current release: 0.3.0

KetJS releases five packages together: View, View Tools, Create View, the core framework and the optional PostgreSQL adapter. Keep the framework packages used by an application on the same version.

KetSuite, its design system, Flow and website clients are maintained and released from the KetSuite source. They are consumers of the framework rather than packages built in this repository.

## What 0.3.0 adds

- **HTTP function bindings.** Publish server functions as ordinary HTTP operations using `httpRoutes()`, with input mapping and explicit public output projections. Validation, permissions and idempotency remain in `ctx.call`. See [HTTP contracts and OpenAPI](/docs/openapi/).
- **Declared result cardinality.** Function contracts describe one result, many results or no result, so the runtime and generated response schemas agree.
- **OpenAPI export.** Export the composed deployment with `httpOpenApiDocument()` or `ket openapi`. See [CLI and configuration](/docs/cli-config/).
- **Spec in new projects.** `ket new` scaffolds `npm run openapi` and `npm run api:docs`, using the separately released `@ketvietlab/ketspec@0.1.41`. See [Spec](/spec/) for the static reference and try-it console.

This release is available on [npm](https://www.npmjs.com/package/@ketvietlab/ketjs) and in the [0.3.0 GitHub release](https://github.com/ketvietlab/ketjs/releases/tag/v0.3.0).

## Previous release: 0.2.0

- **Faster server rendering.** The JSX runtime caches element shapes, and the server writer compiles each template once. See [Benchmarks](/docs/benchmarks/).
- **Opt-in JSX compiler.** `defineConfig({ compileJsx: true })` compiles static JSX subtrees into `html` templates for pages and islands together. See [Compile JSX](/ketjs/view-static-sites/#compile-jsx).
- **Island-local hydration recovery.** A hydration mismatch now re-renders only its island on the client, and the islands after it still hydrate. `ket-view dev` keeps mismatches loud. See [Rendering](/docs/rendering/).
- **View Tools and starter.** `definePages()` collections, Open Graph `property` metadata, safely serialized JSON-LD, external head scripts and TSX starter files.

Server markup must be hydrated by the same ketjs-view version and the same JSX build that rendered it, so deploy server and client together.

## Preview stability

The `0.3` line is preview software. Read the [upgrade guide](/docs/upgrading/) before updating existing application code or datastores. A shared package version does not guarantee that an application upgrade needs no migration.

## Track changes

Published tags and release descriptions are on [GitHub Releases](https://github.com/ketvietlab/ketjs/releases). The source repository's current work can include contracts that are not published yet; source-only contracts are labelled in the guides.

Start a new application with [Installation](/docs/quick-start/). Release maintainers should use [Publishing packages](/docs/releasing/).
