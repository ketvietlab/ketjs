---
title: "Observe behavior and measure performance"
description: "Use structured operational records and reproducible measurements to diagnose the application you built."
stage: "Verify and operate"
duration: 35
lab: "Node terminal"
order: 31
---

Before you start: complete [Evolve the schema and try PostgreSQL](/learn/migrations-postgres/), or make sure you can pass its checkpoint.

## Follow one request

Create a task through HTTP and find the corresponding operational record. Identify the operation, outcome and duration. Then send invalid input and compare the failure record. Logs should help explain an event without exposing secrets or unnecessary personal data.

KetJS exposes structured logging contracts and sinks. Choose a sink appropriate to the environment and send records to an aggregator when you need searching. There is no built-in `ket logs` query command; do not confuse emitting records with a log search service.

## Observe background work

Enqueue a completion job, run the worker and inspect start/completion or retry records. A queue length alone cannot explain why a particular job failed. Keep enough identity to correlate the job with the originating operation while respecting scope and data classification.

The test deployment captures operational records so a test can assert that a denial or failure was observable. Use that when observability is part of a contract, not to assert every incidental debug message.

## Measure a representative scenario

Choose a fixed Node version, machine, database state and concurrency. Warm the application consistently, execute repeated runs and record the workload. Separate raw query latency from an HTTP endpoint that includes parsing, identity and serialization.

For the Todo lab, compare list latency at 10, 1,000 and 10,000 rows with the same projection and ordering. Record whether the database is in memory or on disk. Run one workload at a time so competing measurements do not distort each other.

## Read benchmark charts critically

A benchmark number only describes its measured workload and environment. The framework benchmark page includes source conditions and limitations. Do not turn one result into a claim that every application is faster than every alternative.

When publishing your own result, retain a reproducible command and a concise summary. Keep temporary measurement artifacts out of the website source unless they are deliberately required as published evidence.

## Checkpoint

Find successful and failed operation records, and write a benchmark procedure with enough detail for another person to repeat it.

## Practice on your own

Introduce one slow query in a disposable dataset, measure it, add an appropriate index, and rerun the same workload. Explain the observed difference without generalizing beyond it.

## Reference

For the complete API contract, read [Logging](/docs/logging/).
