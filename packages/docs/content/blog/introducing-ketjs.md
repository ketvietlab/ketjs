---
title: Introducing KetJS
description: One application contract, composable modules, and a view layer that starts with HTML.
date: "2026-10-07"
---
## A framework that fits together

KetJS starts with an explicit module contract. A deployment selects its modules, and composition checks their dependencies, models, functions, routes, permissions, and presentation contracts.

The result is one manifest that describes what the application actually ships. Extension points belong to their owners; consumers extend published contracts rather than patching arbitrary internals.

## Start with HTML

The view layer renders on the server and adds interaction through explicit islands. Signals update the relevant DOM regions. Static sites use the same view primitives and the `ket-view` development and build tools.

This website is one of those static sites: Markdown supplies the content, ketjs-view renders its pages, and the standard static build produces deployable HTML, CSS, and JavaScript.

## Keep operations close to the data

Changesets, validation, declared effects, and permissions define the boundary of a business operation. Jobs can be enqueued in the same transaction as business data and processed by a worker backed by SQLite or PostgreSQL.

## A preview, built in the open

KetJS 0.1.41 is preview software. APIs and deployment contracts can change before 1.0. Explore the [quick start](/docs/quick-start/), inspect the [source](https://github.com/ketvietlab/ketjs), and experiment with the contracts.
