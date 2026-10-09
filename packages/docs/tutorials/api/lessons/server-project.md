---
title: "Start the local backend lab"
description: "Scaffold a real Node application, run the learning CLI, and inspect the completed Todo API reference."
stage: "Compose the backend"
duration: 25
lab: "Node terminal"
order: 12
---

Before you start: complete [Generate pages from content](/learn/content-routing/), or make sure you can pass its checkpoint.

## Create a server project

Open another terminal and create a sibling to the View project:

```bash
# Run from: your-projects
npx -y @ketvietlab/ketjs@0.4.0 new learn_api
cd learn_api
npm install
npm run build
```

The generator creates a workspace, a module, development scripts and a deployment test. Keep the scaffold while working through the next lessons. The completed [backend lab download](/learn/downloads/learn-api.zip) adds a Todo API and a learning CLI; extract it into a different directory if you want to compare your implementation.

## Use the learning CLI

Inside the downloaded reference lab:

```bash
# Run from: learn_api
npm ci
npm run learn -- doctor
npm run learn -- list
npm run learn -- lesson server-project
npm run learn -- check api
```

`doctor` checks prerequisites. `list` prints the course's terminal lessons. `lesson` reads the bundled lesson text. `check` builds this project and runs only the selected executable checkpoint. Available checkpoints are printed by `help`; a lesson without an automated checkpoint still has a manual acceptance checklist.

The CLI is a project script. It does not publish an npm package, replace `ket`, or provision cloud resources. It calls the same tools you can run directly, and a failing checkpoint exits with a nonzero status.

## Run the API locally

Use the development command in a dedicated terminal:

```bash
# Run from: learn_api
npm run learn -- serve
```

The lab binds to `127.0.0.1:3711`. The starter development identity uses the `X-Ket-Company` header so you can experiment with company scope locally. This convenience is not a production authentication design.

```bash
# Run from: learn_api
curl -H 'X-Ket-Company: lab' http://127.0.0.1:3711/api/todos
```

The completed project initially returns an empty array. If you created the untouched scaffold instead, its original route is `/`; the next lessons build the Todo endpoints. Keep that distinction clear when comparing results.

## Checkpoint

Run doctor, understand the difference between scaffold and completed lab, and get a response from the local reference API.

## Practice on your own

Run the API checkpoint, then deliberately stop the server and identify which command starts a development server versus which starts an isolated test deployment.

## Reference

For the complete API contract, read [Quick Start](/docs/quick-start/).
