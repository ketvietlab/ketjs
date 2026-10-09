---
title: "Choose your route through KetJS"
description: "Understand the packages, set up your tools, and see how the projects in this course fit together."
stage: "Start here"
duration: 15
lab: "Browser + terminal"
order: 1
---

Start here; no earlier course lesson is required.

## What you will build

Start with a counter, grow it into an interactive todo list, and publish a small static website. Then build the todo backend: a checked module, company-scoped data, validated functions, HTTP endpoints, and background work. Finish with deployment tests and an operational plan.

You need basic JavaScript, HTML, and terminal familiarity. TypeScript knowledge helps, but every code sample names its file and explains the framework-specific part. Work through the steps in order on your first pass. You can return directly to any lesson afterward.

## Understand the packages

| Package | Role in your project |
| --- | --- |
| `@ketvietlab/ketjs-view` | TSX rendering, signals, form contracts, DOM updates and islands |
| `@ketvietlab/ketjs-view-tools` | The `ket-view` development server, static generation and asset pipeline |
| `@ketvietlab/create-view` | The standalone View project generator |
| `@ketvietlab/ketjs` | Modules, models, functions, permissions, HTTP, SQLite and durable jobs |
| `@ketvietlab/ketjs-postgres` | A PostgreSQL adapter for the server framework |

A standalone static website does not need the server framework. The browser exercises use the actual ketjs-view runtime. Backend lessons use Node on your computer, where SQLite files and worker processes behave as they do in a normal KetJS application.

## Prepare a workspace

Install Node 24 or newer. Check the Node version in the same terminal you will use for the labs:

```bash
# Run from: your-projects
node --version
npm --version
```

Keep two directories: `learn-view` for the website, and `learn_api` for the backend. Commands show which directory to run from. Do not run a server command inside the View project.

## Choose how to practice

[Open the playground](/playground/) for quick TSX experiments. For the complete local examples, download the [View lab](/learn/downloads/learn-view.zip) and [backend lab](/learn/downloads/learn-api.zip), extract them, and follow their README. These are completed reference projects; the lessons also explain how to start from the generators.

The backend lab includes `npm run learn -- list`, lesson text, and selected executable checkpoints. It does not install a global command or require a cloud account. A passed checkpoint covers its named behavior, not every requirement in the course.

## Read the preview contract

This course targets **KetJS 0.4.0 preview**. Pin that version while following the examples. The project is under active review and APIs can change before 1.0. Treat deployment exercises as evaluation environments. Keep generated lockfiles so another learner can reproduce your setup.

## Checkpoint

Explain which package builds static HTML and which package opens the backend database. Confirm your terminal runs Node 24 or newer.

## Practice on your own

Write down one feature you want to add to the capstone. Identify whether it needs only a browser, a backend, or both.

## Reference

For the complete API contract, read [Quick Start](/docs/quick-start/).
