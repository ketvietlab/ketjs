---
title: How to evaluate a preview framework without betting your product on it
description: A practical KetJS evaluation plan covering a complete workflow, failure tests, deployment boundaries, reproducible upgrades and useful project feedback.
date: "2026-10-06"
order: 8
---
Trying a framework should answer a concrete engineering question. A successful counter demo establishes that interaction works; it does not establish that your team can maintain an application with permissions, database migrations and background jobs.

KetJS **0.2.0 is Preview software in active review**. APIs and deployment contracts may change before 1.0, and the project is not ready for production workloads. That makes a bounded evaluation project more useful than an early commitment of important business data.

The objective is to discover whether the framework's boundaries fit your application and to produce specific evidence where they do not.

## Pick one vertical workflow

Choose a small feature that crosses the boundaries you care about. A task tracker can include an authorized list, a validated create operation, a completion action and a background summary. An order workflow can include decimal amounts and a transaction.

Do not begin by reproducing your entire existing system. That creates too many unexplained failures and makes it difficult to distinguish a framework gap from an unfinished feature. One complete workflow is more informative than ten disconnected screens.

Define acceptance criteria before writing code. For example: company A cannot read company B's tasks; invalid input creates no row; a failed transaction leaves no partial changes; removing a browser island prevents pending requests from updating it. Those are observable behaviors, not impressions about developer experience.

## Use the browser for browser concepts

The [playground](/playground/) is a place to edit TSX and observe signals, DOM updates and form interaction with the real ketjs-view runtime. It helps make a dependency or rendering concept visible without requiring a server setup.

It is not a hosted KetJS backend with a production database. Server, database and job exercises belong in a local Node project, where the runtime and operational behavior can be inspected directly. The [learning path](/learn/) separates those environments and provides local tutorial projects for the backend work.

This distinction prevents a convenient demo from quietly teaching a different execution model. When learning a transaction, use a database transaction. When learning browser cleanup, remove the actual island. A mock may explain a shape, but it should not be mistaken for the behavior under evaluation.

## Make the local environment reproducible

Use the documented runtime requirements and pin package versions with a lockfile. Record which tutorial or fixture you started from and which commands produce its build, database and worker behavior.

Keep evaluation data disposable. A small seed dataset is useful because another engineer can repeat a failure and verify a fix. Private production data makes the experiment harder to share and creates an unnecessary dependency on the application's current schema.

Declare the intended deployment composition. A module name alone is not a deployment boundary; an HTTP process and a worker must belong to a deliberate application composition. If your target environment has different runtime APIs from local Node, list those differences before claiming that local success proves deployability.

## Review the contracts as carefully as the screen

Inspect the composed models, operations, routes and permissions. Can a reviewer identify who owns a model and which function changes it? Can an extension use a published boundary without copying owner internals?

For the data layer, examine scope, exact decimal behavior where relevant and a migration plan against an existing database. For the browser, examine island identity and lifecycle cleanup. For jobs, examine transactional enqueueing and repeated delivery.

These questions reveal the framework's real value proposition: whether explicit contracts make changes understandable. If declarations exist but developers still depend on private structures, the evaluation should identify that missing contract rather than celebrating the quantity of metadata.

## Add failures to the demonstration

A credible walkthrough includes at least one rejected request and one interrupted operation. Show an unauthorized read, invalid input, a rolled-back transaction or a worker retry.

For browser data loading, force a slow response to arrive after a newer one. For tenant isolation, use two populated contexts rather than an empty second database. For jobs, simulate the gap between an accepted external action and a missing completion acknowledgement.

Select focused tests for the changed behavior and its directly affected dependencies. A giant test run can consume time without proving the one boundary under investigation. State what was tested and what was not: a scoped pass is useful evidence, but it is not a complete production qualification.

## Measure performance after the behavior is correct

Use the [benchmark guide](/blog/reading-benchmarks/) to choose an appropriate fixture. Measure a representative database workload, an HTTP operation or browser interaction rather than copying a chart into your acceptance criteria.

Record the environment and settings alongside the result. If a test requires a durability setting your product cannot accept, it is not the deployment result you need. If a query is slow because an index is missing, changing HTTP frameworks may not address the problem.

Also observe debugging cost. Can your team identify a rejected effect, inspect a failed job and explain why a row is out of scope? Operational clarity is a practical part of evaluating a framework, even when it has no neat throughput unit.

## Practice one upgrade before deciding

Read [release notes](/docs/release-notes/) and [the upgrade guide](/docs/upgrading/) before changing the pinned version. Rebuild the evaluation, inspect relevant migration changes and rerun its focused acceptance checks.

Keep a record of changed contracts and any manual adaptation. Preview software may require those adaptations; the useful question is whether the project communicates them clearly enough for your team to manage.

Avoid claiming that a passing compile proves an upgrade preserved business behavior. A field can retain its TypeScript type while its validation, scope or execution semantics change. The evaluation's behavioral checks are what connect the old and new versions.

## Turn findings into actionable feedback

A useful issue names the version, deployment composition, minimal reproduction, expected result and observed result. Include a small fixture or command sequence that another contributor can run without your private infrastructure.

Distinguish a missing contract from a bug in an existing one. “This operation violates its documented scope” is different from “we need a supported extension point for this screen.” Both can be valuable, but they require different design work.

At the end, make a bounded decision: continue experimenting, wait for a missing capability, or choose a more established approach for the current product. A well-run evaluation succeeds when it gives your team that answer honestly, even if the answer is to wait.
