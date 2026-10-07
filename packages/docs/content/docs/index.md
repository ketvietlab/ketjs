---
title: Documentation
description: Build your first KetJS application, understand its architecture, then find the contract you need.
group: Getting started
order: 0
---

## Start here

These guides target KetJS **0.1.41**, the current preview release. The project is in active review: use it for evaluation and feedback, expect API and data-format changes before 1.0, and avoid production workloads for now. New to the framework? Follow these in order:

1. [Installation and quick start](/docs/quick-start/) — scaffold and run a working SQLite application.
2. [Configuration](/docs/configuration/) — select the workspace, deployment and runtime services.
3. [Directory structure](/docs/project-structure/) — understand ownership and production artifacts.
4. [Application composition](/docs/workspaces/) — select modules and check one composed manifest.
5. [Request lifecycle](/docs/request-lifecycle/) — see how context, behavior and rendering connect.

## Choose what you are building

| Goal | Reading path |
| --- | --- |
| A fullstack application | [Modules](/docs/modules/) → [Server functions](/docs/functions/) → [HTTP routes](/docs/http/) |
| A data workflow | [Models](/docs/models/) → [Migrations](/docs/migrations/) → [Query builder](/docs/data/) |
| A web experience | [Rendering and islands](/docs/rendering/) → [Themes](/docs/themes/) → [Form validation](/docs/form-validation/) |
| A static or client-rendered site | [Static sites with ketjs-view](/docs/view-static-sites/) → [Runnable example](/examples/static-site/) |
| A secure tenant application | [Authorization](/docs/authorization/) → [Sessions and tenants](/docs/sessions-tenants/) |
| Background and integration work | [Jobs and workers](/docs/jobs/) → [Storage, transports and streams](/docs/integrations/) |

## Verify and ship

Use [Testing](/docs/testing/) to verify the actual deployment. [Deployment](/docs/deployment/) explains build artifacts and startup. Updating an existing application? Begin with the [Upgrade guide](/docs/upgrading/).

## Find a specific contract

[Public API](/docs/api/) and [CLI reference](/docs/cli-config/) are lookup guides. [Design decisions](/docs/architecture-decisions/) and [Open questions](/docs/open-questions/) explain framework choices. [Benchmarks](/docs/benchmarks/) records measured performance and its limits.

## Framework or ecosystem?

This site documents KetJS. KetSuite, its design system, Flow and product clients use the framework but have their own source, releases and documentation. See [Release notes](/docs/release-notes/) for the 0.1.41 package split.

For a guided introduction, use [Learn KetJS](/learn/). Contributors should read [Contributing](/docs/contributing/) before working on the framework.
