---
title: "Compose a module and inspect its manifest"
description: "Declare one capability with a model and functions, then inspect the checked composition."
stage: "Compose the backend"
duration: 30
lab: "Node terminal"
order: 13
---

Before you start: complete [Start the local backend lab](/learn/server-project/), or make sure you can pass its checkpoint.

## Give one module one capability

The backend lab has a module named `learn_api`. Its model key is `learn_api.Todo`, and its operations are `learn_api.list`, `learn_api.create` and `learn_api.complete`. Those names are public contracts inside the composed application.

Open `modules/learn_api.ts` in the downloaded lab. Follow its sections in order: models describe data, functions describe behavior, and messages hold translated text. The module does not open a database or listen on a port when imported.

## Inspect before serving

```bash
# Run from: learn_api
npm run build
npx ket check --workspace dist/ket.workspace.js
npx ket manifest --deployment learn_api --workspace dist/ket.workspace.js
npx ket modules --workspace dist/ket.workspace.js
```

Find the Todo fields and the three functions in the manifest output. Inspect each function's effects. This is the composed contract used by the application, not an independently maintained document.

## Try a composition error

In a scratch copy, give a second module the same module name and include both in the deployment. Run `ket check`. Read the error, then undo the change. Repeat with an unresolved declared dependency. These failures should occur while composing the application, before a request reaches a handler.

When one module extends or references another module's contribution, declare the dependency explicitly. A file import and a manifest dependency are different things: the former loads code; the latter records the relationship the framework checks.

## Explore module discovery

The small lab imports its module directly. Larger workspaces may resolve modules from declared roots. Use `ket modules` to see the resolved sources and learn the root configuration before relying on filesystem discovery. Do not scan an arbitrary installed directory and treat every file as enabled functionality.

## Make a small extension

Add a translated message for the task list title and run check again. Then compare the manifest before and after. The goal is to see how a small source contribution changes the application contract.

## Checkpoint

The manifest contains your module once, with the expected Todo model and function effects. An intentional composition conflict fails check.

## Practice on your own

Sketch a second module for reminders. Identify which contributions it owns and which dependency it would declare on the Todo module.

## Reference

For the complete API contract, read [Modules](/docs/modules/).
