---
title: Open questions
description: Known gaps, unsettled design questions, and weak spots in the current implementation.
group: Project evolution
order: 4
---

# Open questions

Known gaps in the current framework and its extension boundaries. Static asset and island bundling are implemented by `ketjs-view-tools`; they are not an outstanding feature.

## Not built
- **Image processing.** Product media is connected to generic attachments, but
  resize, transforms, focal points, CDN publication and document previews remain
  separate features. The product bridge deliberately stores none of those as fake
  URL or blob columns.

- **Streams under a database-per-tenant layout.** Whose database a stream belongs to
  is unanswered, so the pooled server defaults to an in-memory store. HTTP access is
  now closed by default and an explicit resolver can authorize and namespace a topic,
  but that resolver does not choose a durable per-tenant backing store.

## Not settled
- **Does a theme get its own routes?** Currently regions only; Shopify-style JSON
  templates with merchant-editable section order are sketched in the agent
  composition schema but not wired to rendering.
- **How much may `unsafe_patch` do?** The manifest slot and diff surfacing exist;
  no runtime patching is implemented. Deciding this too generously is the failure
  mode that produced the domain contract's upgrade debt.
- **Cross-process stream durability and latency.** Stores already wake local readers and can use adapter notifications. `tail()` retains a recovery poll (5 seconds for a notifying store, 250ms otherwise). A production workload still needs to measure recovery latency and database load; see [Streams](/docs/integrations/).
- **Editor support for KTL.** No language server, so a theme author gets no
  completion or type errors inside templates. This is the DX cost of D3 and it is real.

## Known weak spots in what *is* built
- The KTL parser accepts a small expression grammar with no operator precedence
  beyond comparison and filters. Adding arithmetic later needs a real precedence climb.
