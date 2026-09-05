---
title: Operations reading map
description: Find the KetJS guides for deployment, migration, workers, storage, releases, and performance evidence.
---

Operational behavior is documented beside the framework contract that implements it. Use this page
as a reading map instead of searching an isolated runbook collection.

## Prepare a release

1. [CLI and configuration](/ketjs/cli-config/) defines workspace selection, runtime commands, and
   environment variables.
2. [Testing](/ketjs/testing/) defines the headless verification boundary.
3. [Deployment](/ketjs/deployment/) covers build artifacts, migration order, HTTP and worker roles,
   health checks, rollback, PostgreSQL, and S3.
4. [Publishing packages](/ketjs/releasing/) applies only when releasing the KetJS packages to npm.

## Operate stateful contracts

| Concern | Owning guide | Operational questions answered |
| --- | --- | --- |
| Schema changes and tenant fleets | [Migrations and adapters](/ketjs/migrations/) | Planning, destructive-change refusal, SQLite/PostgreSQL behavior, and rollout order. |
| Background work | [Durable jobs and workers](/ketjs/jobs/) | Delivery, leases, retries, cancellation, worker roles, and operator commands. |
| Sessions and tenant isolation | [Sessions and tenants](/ketjs/sessions-tenants/) | Session stores, live identity, database selection, and per-tenant state. |
| Blob storage and external I/O | [Storage, transport, and streams](/ketjs/integrations/) | Local/S3 storage, namespace isolation, bounded upload, outbound providers, and resumable streams. |
| HTTP process behavior | [HTTP routes and responses](/ketjs/http/) | Error contracts, streamed responses, cookies, headers, and graceful request boundaries. |

## Measure before optimizing

The [performance benchmark suite](/operations/benchmarks/) records commands, datasets, environments,
and known gaps for framework and selected KetSuite workloads. Module-specific evidence remains next
to the module, such as the [Loyalty benchmark](/ketsuite/benchmarks/loyalty/). A performance statement
without a reproducible workload is not an operational contract.

For the reasoning behind a cross-cutting runtime choice, use the
[design records](/architecture/) after reading the owning implementation guide.
