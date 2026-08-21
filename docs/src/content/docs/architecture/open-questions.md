---
title: Open questions
description: Known gaps, unsettled design questions, and weak spots in the current implementation.
---

# Open questions

Honest list of what is not settled or not built.

## Not built
- **Client-side bundling.** Deliberately optional; unbundled ESM is the dev path.
  No production bundler exists yet.
- **Image processing.** Product media is connected to generic attachments, but
  resize, transforms, focal points, CDN publication and document previews remain
  separate features. The product bridge deliberately stores none of those as fake
  URL or blob columns.

## Not built
- **Streams under a database-per-tenant layout.** Whose database a stream belongs to
  is unanswered, so the pooled server defaults to an in-memory store.

## Not settled
- **Does a theme get its own routes?** Currently regions only; Shopify-style JSON
  templates with merchant-editable section order are sketched in the agent
  composition schema but not wired to rendering.
- **How much may `unsafe_patch` do?** The manifest slot and diff surfacing exist;
  no runtime patching is implemented. Deciding this too generously is the failure
  mode that produced the domain contract's upgrade debt.
- **Streams poll.** `tail()` polls the log every 10ms. Correct and durable, but a
  notify path (`LISTEN/NOTIFY` on Postgres, an emitter on SQLite) should replace it.
- **Editor support for KTL.** No language server, so a theme author gets no
  completion or type errors inside templates. This is the DX cost of D3 and it is real.

## Known weak spots in what *is* built
- The KTL parser accepts a small expression grammar with no operator precedence
  beyond comparison and filters. Adding arithmetic later needs a real precedence climb.
