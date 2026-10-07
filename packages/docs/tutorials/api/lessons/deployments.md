---
title: "Understand workspaces and deployment roles"
description: "Select a complete application composition and distinguish HTTP, worker and datastore responsibilities."
stage: "Compose the backend"
duration: 30
lab: "Node terminal"
order: 14
---

Before you start: complete [Compose a module and inspect its manifest](/learn/modules/), or make sure you can pass its checkpoint.

## Read the application boundary

A module contributes capabilities. A deployment selects the complete set of modules that run together. A workspace lists those deployments. The lab exports a `deployments` array from `ket.workspace.ts`; the CLI resolves the emitted JavaScript after the TypeScript build.

Open the lab workspace. `modules: [learn_api]` selects the module. `headless: true` means this deployment serves its API without selecting a theme. `serve.routes` adds its HTTP facade. The worker role later consumes jobs from the same composition.

## Inspect selection

```bash
# Run from: learn_api
npm run build
npx ket workspace --workspace dist/ket.workspace.js
npx ket manifest --deployment learn_api --workspace dist/ket.workspace.js
```

Use `--deployment` when a workspace contains more than one application. A feature name is not a deployment selection. Before running tests, identify the actual application composition those tests need.

## Separate processes from contracts

The HTTP process receives requests; the worker process claims background jobs. They can share a datastore while having different process roles. Both must load the same relevant module declarations, otherwise one role may enqueue a job that the other cannot execute.

A shared datastore across multiple deployments uses a checked union schema. Removing a model from one deployment does not prove no other deployment needs it. Treat composition and datastore selection as release decisions.

## Follow environment configuration

Keep secrets and host-specific locations out of module source. Use the documented runtime configuration for ports, database locations, signing keys and storage. Inspect the printed runtime banner when a process starts so you know which deployment and datastore you actually opened.

For the lab, use a private local data directory and never point a learning exercise at production credentials. A reset exercise should only recreate its disposable lab data.

## Checkpoint

Identify the lab deployment, module list, HTTP role and datastore. Explain why a worker needs the same job definitions as the producer.

## Practice on your own

Draw the HTTP and worker processes sharing a lab datastore. Mark which source file selects the modules and which settings vary by environment.

## Reference

For the complete API contract, read [Workspaces](/docs/workspaces/).
