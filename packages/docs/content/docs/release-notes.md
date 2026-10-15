---
title: Release notes
description: The coordinated KetJS {{VERSION}} patch release, hydration namespaces and reliable keyed moves.
group: Project evolution
order: 1
---

<span id="current-release"></span>

## Current release

Coordinated package version: **{{VERSION}}**.

KetJS releases five packages together: View, View Tools, Create View, the core framework and the optional PostgreSQL adapter. Keep the framework packages used by an application on the same version.

KetSuite, its design system, Flow and website clients are maintained and released from the KetSuite source. They are consumers of the framework rather than packages built in this repository.

## What {{VERSION}} fixes

- **Hydrated SVG updates.** Dynamic holes retain their SVG namespace, including nested templates and keyed entries. Content inside `foreignObject` uses the HTML namespace, and its mixed-case tag no longer causes a hydration mismatch. See [Rendering](/docs/rendering/).
- **Reliable keyed moves.** Both hydrated and client-rendered entries move the current content of top-level holes with their anchors. Reordering no longer restores removed server content or leaves current content behind.
- **Minimal first reorder.** Adopted list entries retain their actual positions, so the first reconciliation moves only entries whose position changed.

This patch keeps public APIs and application data schemas unchanged. Deploy matching server and client bundles together; see [Upgrading KetJS](/docs/upgrading/).

Use [npm](https://www.npmjs.com/package/@ketvietlab/ketjs) and the [{{VERSION}} GitHub release](https://github.com/ketvietlab/ketjs/releases/tag/v{{VERSION}}) for the coordinated packages and release status.

<span id="current-release-0-5-0"></span>
<span id="what-0-5-0-adds"></span>

## Previous release: 0.5.0

- **Independent session-auth starter.** `ket new NAME --auth=session` generates application-owned User, Role, Grant and Assignment models, hidden/stdin provisioning, native login/logout/me routes and owner-filtered sample operations. There is no KetSuite dependency or default password. Bare `--auth` preserves the project name and directory options. See [Authentication starter](/docs/auth-starter/).
- **Explicit companyless identities.** `sessions.requireCompany: false` separates authentication from company scope. The default remains company-required; the opt-in does not grant access to company data. Cookie issuance, reads, updates and gateway assertions share company/branch membership validation. See [Sessions and tenants](/docs/sessions-tenants/).
- **Credential and proxy contracts.** The starter preserves UTF-8 credentials across stdin chunks, uses bounded scrypt verification, shares origin host/port checks through TLS termination and supports explicit trusted proxy IPs for per-client login limits. Grants use one combined query, and initial authenticated reads avoid unnecessary session-context revision updates. Existing KetSuite credential helpers and account models remain unchanged.
- **Executable release evidence.** One root `VERSION` drives package, scaffold, docs and learning-lab mirrors. `CHANGE_LOG` records the version commit, reason and verified docs/lab/download evidence; CI rejects missing or stale evidence. See [Publishing packages](/docs/releasing/).

<span id="current-release-0-4-0"></span>
<span id="what-0-4-0-adds"></span>

## Previous release: 0.4.0

- **Shared nested form contracts.** Declare objects, arrays and records, explicit null/empty handling, bounded collections and stable keyed issue paths. The same browser-safe validation contract runs on the client and server. See [Form validation](/docs/form-validation/).
- **Edit sessions and native binding.** `createFormSession` retains immutable drafts and baselines, tracks revision and dirty state, prevents concurrent submits and preserves the intent for an unknown-outcome retry. `attachForm` binds native controls and accessible errors. Existing `createForm` consumers remain supported. See [Forms and edit sessions](/docs/view-forms/).
- **Atomic form actions.** `defineFormAction` commits domain writes and the accepted receipt together. Refusals roll back, declared public projections filter outcomes, and notifications publish after commit. Permissions, ownership and revision checks remain in domain handlers. See [Transactional form actions](/docs/form-actions/).
- **Measured adapter performance.** The adapter indexes controls, groups issues once, avoids unchanged DOM assignments and caches baseline validation. In the recorded 500-field synthetic workload, one invalid edit fell from a 64.05 ms median to 2.35 ms. Full draft validation still scales with form size; these are dispatch-to-DOM-settlement measurements, not paint or INP. See [Benchmarks](/docs/benchmarks/) for the pinned RHF/Formik comparison and limitations.

<span id="current-release-0-3-0"></span>
<span id="what-0-3-0-adds"></span>

## Previous release: 0.3.0

- **HTTP function bindings.** Publish server functions as ordinary HTTP operations using `httpRoutes()`, with input mapping and explicit public output projections. Validation, permissions and idempotency remain in `ctx.call`. See [HTTP contracts and OpenAPI](/docs/openapi/).
- **Declared result cardinality.** Function contracts describe one result, many results or no result, so the runtime and generated response schemas agree.
- **OpenAPI export.** Export the composed deployment with `httpOpenApiDocument()` or `ket openapi`. See [CLI and configuration](/docs/cli-config/).
- **Spec in new projects.** `ket new` scaffolds `npm run openapi` and `npm run api:docs`, using the separately released `@ketvietlab/ketspec@0.1.41`. See [Spec](/spec/) for the static reference and try-it console.

The 0.3.0 history is recorded in its [GitHub release](https://github.com/ketvietlab/ketjs/releases/tag/v0.3.0).

## Previous release: 0.2.0

- **Faster server rendering.** The JSX runtime caches element shapes, and the server writer compiles each template once. See [Benchmarks](/docs/benchmarks/).
- **Opt-in JSX compiler.** `defineConfig({ compileJsx: true })` compiles static JSX subtrees into `html` templates for pages and islands together. See [Compile JSX](/ketjs/view-static-sites/#compile-jsx).
- **Island-local hydration recovery.** A hydration mismatch now re-renders only its island on the client, and the islands after it still hydrate. `ket-view dev` keeps mismatches loud. See [Rendering](/docs/rendering/).
- **View Tools and starter.** `definePages()` collections, Open Graph `property` metadata, safely serialized JSON-LD, external head scripts and TSX starter files.

Server markup must be hydrated by the same ketjs-view version and the same JSX build that rendered it, so deploy server and client together.

## Preview stability

The current `{{VERSION}}` release is preview software. Read the [upgrade guide](/docs/upgrading/) before updating existing application code or datastores. A shared package version does not guarantee that an application upgrade needs no migration.

## Track changes

Published tags and release descriptions are on [GitHub Releases](https://github.com/ketvietlab/ketjs/releases). Guides state the minimum framework version needed for new contracts; future source-only contracts are labelled separately.

Start a new application with [Installation](/docs/quick-start/). Release maintainers should use [Publishing packages](/docs/releasing/).
