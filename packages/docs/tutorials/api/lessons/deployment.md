---
title: "Prepare an evaluation deployment and upgrade"
description: "Build an immutable artifact, separate migrations and process roles, and plan an upgrade while KetJS is in preview."
stage: "Verify and operate"
duration: 45
lab: "Node terminal"
order: 32
---

Before you start: complete [Observe behavior and measure performance](/learn/observability/), or make sure you can pass its checkpoint.

## Freeze the artifact

Build the workspace and record the exact dependency versions and lockfile. Production commands execute emitted JavaScript. A deployment should not discover a different set of modules merely because someone installed another package on the machine.

```bash
# Run from: learn_api
npm ci
npm run build
npx ket check --workspace dist/ket.workspace.js
npx ket manifest --deployment learn_api --workspace dist/ket.workspace.js
```

Run the named lab checkpoints before handing off the artifact. They are the baseline for this learning application, not a universal production certification.

## Separate the responsibilities

Plan an explicit schema migration/verification step, an HTTP process, and a worker process. Configure a stable signing secret when using sessions, a durable datastore location, storage and transport providers, and the intended host/port. Keep secrets in the environment or a secret store.

For the static View website, deploy the generated `dist` directory to your static host. For the backend, choose an environment that supports the application's Node runtime and datastore. The website being hosted on Cloudflare does not require the backend to use the Workers runtime.

## Define operational acceptance

Check startup, graceful shutdown, a real API request, a worker execution and a restart. Confirm that data persists where expected and that a process cannot start with a silently different composition. Decide which health signals distinguish an alive process from an application that can actually serve its dependencies.

## Plan an upgrade before performing it

Read release notes, compare manifests, review database compatibility, and rebuild under the target version. Test the behavior your deployment uses. Keep rollback artifacts and decide whether the schema change permits rolling back the application independently.

KetJS 0.2.0 is preview software under active review. Use this exercise for evaluation and learning; APIs may change before 1.0. Do not infer production readiness from a successful local lab.

## Write the handoff

Record the selected deployment, artifact version, migration status, scoped checks, runtime configuration names and known limitations. Distinguish “build passed,” “tests passed,” and “deployed successfully.” They are different claims with different evidence.

## Checkpoint

Produce a written evaluation deployment plan with build, migration, HTTP, worker, verification and rollback steps.

## Practice on your own

Choose one hypothetical breaking change to a function input. Plan the client/server rollout order and the tests required to preserve existing callers.

## Reference

For the complete API contract, read [Deployment](/docs/deployment/).
