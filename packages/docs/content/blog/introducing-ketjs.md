---
title: Why KetJS starts with an application contract
description: How explicit modules, checked composition and deployment manifests help keep business applications understandable as their features grow.
date: "2026-08-12"
order: 1
---
A small application can fit in a few routes and database tables. The difficult part arrives later: a second company needs a slightly different workflow, another module extends a model, and a background worker must follow the same permissions and data rules as HTTP requests. The application still runs, but nobody can easily explain what it contains or which component owns a behavior.

KetJS approaches that problem through an explicit application contract. A module describes its contribution, a deployment selects modules, and composition produces a manifest of the resulting system. That choice is the starting point for understanding the framework, rather than a promise that every project needs its architecture.

This article describes **KetJS 0.2.0 Preview**, currently in active review. The contracts can change before 1.0; evaluate them in a disposable project before committing important workloads.

## The problem is ownership, not folder count

Imagine an order-management application with sales, inventory and accounting. A sales order reserves stock and eventually creates an invoice. It is tempting to put shared helpers in a utilities directory and let every module import whatever it needs. That works until inventory changes its internal schema or accounting adds a mandatory approval step.

The important questions are more specific than “where should this file go?” Who owns the stock model? Which operation may change it? What does a consumer depend on? Where may another module add a presentation component without replacing the entire screen?

KetJS modules declare models, functions, effects, permissions, routes and presentation contracts. Local names become qualified during composition: a model named `Warehouse` in the `inventory` module becomes `inventory.Warehouse`. Qualified identity makes a contribution traceable to its owner and prevents unrelated modules from silently sharing an accidental name.

Folders still matter for navigation, but they do not substitute for those contracts. An application can have tidy folders and unclear boundaries at the same time.

## A declaration does not install a feature at runtime

`defineModule()` is a declaration with no side effects. A deployment explicitly selects the modules that belong to a running application. KetJS does not maintain a mutable module installation catalogue or a runtime feature enable/disable lifecycle.

That distinction matters operationally. A deployment's module set is a property of its composition, not a switch that an HTTP request can flip. If two deployments ship different capabilities, they have different declared compositions. If they access a shared datastore, their compatibility must be checked as part of that arrangement.

The [module documentation](/docs/modules/) explains the declaration surface. [Workspaces and deployments](/docs/workspaces/) describes how a workspace names the applications and their HTTP or worker roles. Read them together: a module is a contribution, while a deployment is the unit that actually runs.

## The manifest makes the result inspectable

A manifest describes the composed application: its models, operations, routes and other published contracts. Composition checks are useful because failures appear before a user encounters the affected path. Unknown declaration fields and invalid references should not become mysterious behavior several requests later.

The manifest does not prove that a business rule is correct. A function that computes the wrong tax can still have valid declarations. What it offers is a stable description against which runtime behavior, migration planning and application review can work.

For a reviewer, the practical question becomes: “What changed in the composed system?” A new operation may require a permission classification, a new model may alter the schema, and a route may expose an existing function through a new transport. Those are concrete changes to inspect, not only files to skim.

## Extend published boundaries instead of patching internals

Module dependencies and extension contracts let an application build on an owner's contribution. Model extensions, presentation joints and fills serve different purposes, but share a principle: the owner establishes the boundary that consumers may use.

Suppose inventory publishes a place for additional warehouse information. A shipping module can contribute there instead of copying the whole warehouse screen. That reduces the amount of owner implementation a consumer must understand and maintain. It does not eliminate compatibility work; an extension still depends on the contract it consumes.

Avoid treating every internal helper as a public API. If a customization requires reaching through several private structures, the missing piece may be an owner-defined contract. Naming that gap is more useful than hiding the dependency in a clever import.

## When this approach earns its cost

Explicit composition is most valuable when a project has several business domains, multiple application compositions, or meaningful permission and data boundaries. It creates some declaration work up front in exchange for a system that can describe itself more clearly later.

For a small static website, the standalone [ketjs-view toolchain](/docs/view-static-sites/) may be all that is needed. Using the view package does not require turning content into a server application. For a backend, the module and deployment contracts become relevant because they govern executable business operations.

Try the architecture with one complete workflow: create an order, validate it, reserve a resource and inspect the composed application. If the contracts help your team explain ownership and review changes, they are doing useful work. If your project only needs a simpler boundary, acknowledge that rather than adopting unused machinery.

Continue with [database correctness](/blog/database-correctness/), where the application contract becomes a concrete write to persistent data. For a guided implementation, begin the [learning path](/learn/).
