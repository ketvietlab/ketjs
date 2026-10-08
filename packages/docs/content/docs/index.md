---
title: Documentation
description: Find KetJS contracts by responsibility, from module composition and request execution to data, rendering and runtime operations.
group: Set up KetJS
order: 0
---

## Find your entry point

These guides target KetJS **0.2.0**, the current preview release. The project is in active review: use it for evaluation and feedback, expect API and data-format changes before 1.0, and avoid production workloads for now.

For step-by-step projects, follow [Learn KetJS](/learn/). These Docs explain the contracts behind those projects and provide a reference when you are building your own application. To run a first application, read:

1. [Installation and quick start](/docs/quick-start/) — scaffold and run a working SQLite application.
2. [Directory structure](/docs/project-structure/) — locate module declarations, workspace configuration and emitted artifacts.
3. [Configuration](/docs/configuration/) — select the workspace, deployment and runtime services.

## Browse by KetJS responsibility

The navigation follows how a KetJS application is assembled and executed. Each guide has one home: composition defines what runs; request and data contracts define its behavior; identity controls access; rendering produces the interface; runtime services handle work beyond that interface. Verification and deployment follow those contracts. API lookup and project changes are available at the end.

### Set up KetJS

Create a runnable project and understand its files and settings.

[Quick start](/docs/quick-start/) → [Directory structure](/docs/project-structure/) → [Configuration](/docs/configuration/).

### Application composition

Define a module, select a deployment's modules in a workspace, then learn how named modules resolve from filesystem roots.

[Modules and manifest](/docs/modules/) → [Workspaces and deployments](/docs/workspaces/) → [Module discovery](/docs/module-discovery/).

### Request execution

Follow a request through its context, server functions and HTTP boundary. Validate form input and describe the public HTTP contract.

[Request lifecycle](/docs/request-lifecycle/) → [Functions and effects](/docs/functions/) → [HTTP routes and responses](/docs/http/) → [Form validation](/docs/form-validation/) → [HTTP contracts and OpenAPI](/docs/openapi/).

### Data contracts

Declare models and scopes, prepare the schema with the selected adapter, then read and change data through validated operations.

[Models and scopes](/docs/models/) → [Migrations and adapters](/docs/migrations/) → [Queries and changesets](/docs/data/).

### Identity and access

Resolve sessions and tenant context before deciding which operations the current identity may execute. Read this group alongside data scopes when building a tenant application.

[Sessions and tenants](/docs/sessions-tenants/) → [Authorization](/docs/authorization/).

### ketjs-view and KTL

Understand pure rendering and island lifecycles, then choose browser data loading, a static site or server theme templates. Menus, localization and reports build on those output contracts.

[Rendering and islands](/docs/rendering/) → [Effects and data fetching](/docs/view-effects-data/) → [Static sites with ketjs-view](/docs/view-static-sites/) → [Themes and KTL](/docs/themes/) → [Menus and localization](/docs/menus-i18n/) → [Reports and PDF](/docs/reports/).

### Runtime services

Run durable work outside the request, connect storage and transports, and record operational events. These services belong to the selected deployment.

[Durable jobs and workers](/docs/jobs/) → [Storage, transport, and streams](/docs/integrations/) → [Operational logging](/docs/logging/).

### Verify and deploy

Test the actual deployment, interpret workload-specific measurements, then build and operate its HTTP and worker processes.

[Testing](/docs/testing/) → [Benchmarks](/docs/benchmarks/) → [Deployment](/docs/deployment/).

### API and tooling

Look up an exported API, CLI command or configuration field once you know which contract you need.

[Public API](/docs/api/) → [CLI and configuration](/docs/cli-config/).

### Project evolution

Check the current package boundaries and upgrade requirements. Review design decisions and unresolved questions before contributing or publishing framework packages.

[Release notes](/docs/release-notes/) → [Upgrading KetJS](/docs/upgrading/) → [Architecture decisions](/docs/architecture-decisions/) → [Open questions](/docs/open-questions/) → [Contributing](/docs/contributing/) → [Publishing packages](/docs/releasing/).

## Follow a task

| Goal | Reading path |
| --- | --- |
| A fullstack application | [Modules](/docs/modules/) → [Workspaces](/docs/workspaces/) → [Server functions](/docs/functions/) → [HTTP routes](/docs/http/) |
| A data workflow | [Models](/docs/models/) → [Migrations](/docs/migrations/) → [Query builder](/docs/data/) |
| An interactive view | [Rendering and islands](/docs/rendering/) → [Effects and data fetching](/docs/view-effects-data/) → [Form validation](/docs/form-validation/) |
| A static or client-rendered site | [Rendering and islands](/docs/rendering/) → [Static sites with ketjs-view](/docs/view-static-sites/) → [Runnable example](/examples/static-site/) |
| A secure tenant application | [Sessions and tenants](/docs/sessions-tenants/) → [Authorization](/docs/authorization/) → [Model scopes](/docs/models/) |
| Background and integration work | [Jobs and workers](/docs/jobs/) → [Storage, transports and streams](/docs/integrations/) |

## Framework and ecosystem

This site documents KetJS. KetSuite, its design system, Flow and product clients use the framework but have their own source, releases and documentation. See [Release notes](/docs/release-notes/) for the package boundaries.

Use [Learn KetJS](/learn/) for guided exercises, the [Playground](/playground/) for browser experiments, and the [Blog](/blog/) for explanations of the engineering choices behind these contracts.
