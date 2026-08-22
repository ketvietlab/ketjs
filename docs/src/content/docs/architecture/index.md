---
title: Design records
description: Use accepted architecture decisions and open questions without mistaking them for task-oriented guides.
---

This section records why KetJS and KetSuite behave the way they do. It supplements the task-oriented
[KetJS](/ketjs/) and [KetSuite](/ketsuite/) guides; it is not the recommended starting point for
building a feature.

## Choose the right record

| Need | Read | Expected use |
| --- | --- | --- |
| Understand an accepted invariant or its trade-off | [Architecture decisions](/architecture/decisions/) | Preserve it, or write a superseding decision that explains why it changes. |
| Check whether a design area is deliberately unfinished | [Open questions](/architecture/open-questions/) | Keep the uncertainty explicit instead of treating a proposal as a contract. |
| Reproduce a performance claim | [Performance benchmarks](/operations/benchmarks/) | Run the documented workload and compare like-for-like evidence. |
| Implement a framework capability | [KetJS framework guide](/ketjs/) | Follow the public contracts and task sequence. |
| Implement application behavior | [KetSuite developer guide](/ketsuite/) | Follow module ownership, security, interface, and test guidance. |

## When to update a record

Update a decision when a change modifies a cross-cutting invariant, dependency boundary, runtime
contract, or durable data strategy. Update an open question when implementation resolves it or new
evidence changes the available options. Feature-specific usage still belongs in the owning KetJS or
KetSuite guide so readers do not need to reconstruct behavior from historical decisions.
