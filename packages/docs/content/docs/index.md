---
title: Documentation
description: Find KetJS contracts by responsibility, from module composition and request execution to data, rendering and runtime operations.
group: Set up KetJS
order: 0
---

## Find your entry point

:::note[KetJS 0.4.0 is in preview]
The project is in active review. Use it for evaluation and feedback, expect API and data-format changes before 1.0, and avoid production workloads for now.
:::

For step-by-step projects, follow [Learn KetJS](/learn/). These Docs explain the contracts behind those projects and provide a reference when you are building your own application. To run a first application, read:

1. [Installation and quick start](/docs/quick-start/) — scaffold and run a working SQLite application.
2. [Directory structure](/docs/project-structure/) — locate module declarations, workspace configuration and emitted artifacts.
3. [Configuration](/docs/configuration/) — select the workspace, deployment and runtime services.

For a browsable API reference and request console, use [Spec](/spec/). It turns your OpenAPI contract into a standalone static site.

## Browse by KetJS responsibility

Find the contract you need below. Each group follows one KetJS responsibility, with its guides listed in reading order. Start with composition, then follow a request through data, identity and rendering; verification and deployment bring those contracts together.

<div class="docs-topic-index">

<section class="docs-topic" aria-label="Set up KetJS">

### Set up KetJS

Create a runnable project and understand its files and settings.

1. [Quick start](/docs/quick-start/)
2. [Directory structure](/docs/project-structure/)
3. [Configuration](/docs/configuration/)

</section>

<section class="docs-topic" aria-label="Application composition">

### Application composition

Define a module, select a deployment's modules in a workspace, then learn how named modules resolve from filesystem roots.

1. [Modules and manifest](/docs/modules/)
2. [Workspaces and deployments](/docs/workspaces/)
3. [Module discovery](/docs/module-discovery/)

</section>

<section class="docs-topic" aria-label="Request execution">

### Request execution

Follow a request through its context, server functions and HTTP boundary. Validate form input, commit transactional edits and describe the public HTTP contract.

1. [Request lifecycle](/docs/request-lifecycle/)
2. [Functions and effects](/docs/functions/)
3. [HTTP routes and responses](/docs/http/)
4. [Form validation](/docs/form-validation/)
5. [Transactional form actions](/docs/form-actions/)
6. [HTTP contracts and OpenAPI](/docs/openapi/)

</section>

<section class="docs-topic" aria-label="Data contracts">

### Data contracts

Declare models and scopes, prepare the schema with the selected adapter, then read and change data through validated operations.

1. [Models and scopes](/docs/models/)
2. [Migrations and adapters](/docs/migrations/)
3. [Queries and changesets](/docs/data/)

</section>

<section class="docs-topic" aria-label="Identity and access">

### Identity and access

Resolve sessions and tenant context before deciding which operations the current identity may execute. Read this group alongside data scopes when building a tenant application.

1. [Sessions and tenants](/docs/sessions-tenants/)
2. [Authorization](/docs/authorization/)

</section>

<section class="docs-topic" aria-label="ketjs-view and KTL">

### ketjs-view and KTL

Understand pure rendering and island lifecycles, then add browser data loading and form sessions, or choose a static site or server theme templates. Menus, localization and reports build on those output contracts.

1. [Rendering and islands](/docs/rendering/)
2. [Effects and data fetching](/docs/view-effects-data/)
3. [Forms and edit sessions](/docs/view-forms/)
4. [Static sites with ketjs-view](/docs/view-static-sites/)
5. [Themes and KTL](/docs/themes/)
6. [Menus and localization](/docs/menus-i18n/)
7. [Reports and PDF](/docs/reports/)

</section>

<section class="docs-topic" aria-label="Runtime services">

### Runtime services

Run durable work outside the request, connect storage and transports, and record operational events. These services belong to the selected deployment.

1. [Durable jobs and workers](/docs/jobs/)
2. [Storage, transport, and streams](/docs/integrations/)
3. [Operational logging](/docs/logging/)

</section>

<section class="docs-topic" aria-label="Verify and deploy">

### Verify and deploy

Test the actual deployment, interpret workload-specific measurements, then build and operate its HTTP and worker processes.

1. [Testing](/docs/testing/)
2. [Benchmarks](/docs/benchmarks/)
3. [Deployment](/docs/deployment/)

</section>

<section class="docs-topic" aria-label="API and tooling">

### API and tooling

Look up an exported API, CLI command or configuration field once you know which contract you need.

1. [Public API](/docs/api/)
2. [CLI and configuration](/docs/cli-config/)

</section>

<section class="docs-topic" aria-label="Project evolution">

### Project evolution

Check the current package boundaries and upgrade requirements. Review design decisions and unresolved questions before contributing or publishing framework packages.

1. [Release notes](/docs/release-notes/)
2. [Upgrading KetJS](/docs/upgrading/)
3. [Architecture decisions](/docs/architecture-decisions/)
4. [Open questions](/docs/open-questions/)
5. [Contributing](/docs/contributing/)
6. [Publishing packages](/docs/releasing/)

</section>

</div>

## Follow a task

| Goal | Reading path |
| --- | --- |
| A fullstack application | [Modules](/docs/modules/) → [Workspaces](/docs/workspaces/) → [Server functions](/docs/functions/) → [HTTP routes](/docs/http/) |
| A data workflow | [Models](/docs/models/) → [Migrations](/docs/migrations/) → [Query builder](/docs/data/) |
| An interactive view | [Rendering and islands](/docs/rendering/) → [Effects and data fetching](/docs/view-effects-data/) → [Forms and edit sessions](/docs/view-forms/) |
| A static or client-rendered site | [Rendering and islands](/docs/rendering/) → [Static sites with ketjs-view](/docs/view-static-sites/) → [Runnable example](/examples/static-site/) |
| A secure tenant application | [Sessions and tenants](/docs/sessions-tenants/) → [Authorization](/docs/authorization/) → [Model scopes](/docs/models/) |
| Background and integration work | [Jobs and workers](/docs/jobs/) → [Storage, transports and streams](/docs/integrations/) |

## Framework and ecosystem

This site documents KetJS. KetSuite, its design system, Flow and product clients use the framework but have their own source, releases and documentation. See [Release notes](/docs/release-notes/) for the package boundaries.

Use [Learn KetJS](/learn/) for guided exercises, the [Playground](/playground/) for browser experiments, and the [Blog](/blog/) for explanations of the engineering choices behind these contracts.
