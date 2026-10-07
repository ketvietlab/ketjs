---
title: Configuration
description: Configure workspace selection, deployment boundaries and runtime settings.
group: Getting started
order: 2
---

## Configuration has two owners

The workspace declares application composition: module roots, selected deployments and their contracts. The runtime environment supplies deployment-specific operational values. Avoid making module behavior depend on undeclared process state.

## Select a workspace and deployment

Inspection and production commands consume emitted JavaScript. The CLI discovers `dist/ket.workspace.js`, `ket.workspace.js`, then `workspace.js`. Pass `--workspace FILE` to choose explicitly and `--deployment NAME` when the workspace contains multiple deployments.

```bash
# Run from: example-app
npm run build
npx ket check --workspace dist/ket.workspace.js
npx ket manifest --deployment notes --workspace dist/ket.workspace.js
```

Use the deployment name in your workspace, not a module name. Read [Application composition](/docs/workspaces/) for the declaration and [CLI reference](/docs/cli-config/) for environment variables and commands.

## Configure a module catalogue

Workspaces can discover modules from declared module paths. `KET_MODULE_PATH` uses the platform path separator; repeat `--module-path DIR` for additional roots. Only the selected dependency closure executes. Read [Module discovery](/docs/module-discovery/) before choosing production artifact paths.

## Configure runtime services

Choose the database adapter, session/tenant policy, queues, storage and transports for the actual deployment. Optional PostgreSQL support requires its adapter and peer driver. [Deployment](/docs/deployment/) explains build artifacts and startup; [Sessions and tenant isolation](/docs/sessions-tenants/) explains identity and tenant hooks.

## Static-site configuration

View-only sites use `ket-view.config.ts`, with pages, assets, styles and explicit island entries. They do not need a core workspace or database. Continue with [Static sites](/docs/view-static-sites/).
