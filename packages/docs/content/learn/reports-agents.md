---
title: "Expose reports and agent capabilities"
description: "Reuse explicit business projections for printable output and machine-readable operations."
stage: "Go beyond requests"
duration: 40
lab: "Local server extension"
order: 28
---

Before you start: complete [Handle files, outbound services and streams](/learn/storage-streams/), or make sure you can pass its checkpoint.

## Start with a projection

A printable task summary should not receive the entire application context. Define a server operation that returns only the title, completion state and fields needed by the document. Use the same permission and scope rules as other reads.

## Declare a report beside its owner

The Todo module owns the meaning of the document, so its report declaration belongs beside that capability. The declaration names a target model, source operation, filename, paper settings and a constrained report template.

Follow the report reference to create the smallest document: one heading and the projected task title. Render a preview first, then a PDF. Add long text and a second page only after checking that the basic document remains deterministic.

Do not put domain knowledge into the portable PDF engine or create a separate module solely to print one existing model. A central report UI may manage versions and operator customizations while the business module retains the default semantic declaration.

## Inspect agent capabilities

```bash
# Run from: learn_api
npm run build
npx ket agent --deployment learn_api --workspace dist/ket.workspace.js
```

Find the discoverable list operation. Compare its declared input, output and effects with the function implementation. A useful agent operation has a clear purpose and bounded reach; a generic “run arbitrary code” operation would bypass the contracts the framework is meant to make explicit.

## Keep grants and review in the loop

Agent discovery does not imply that every caller may invoke the operation. Audience and permission checks still apply. For mutations, consider dry-run and idempotency only when you can define and test their semantics. Keep sensitive data out of broad report DTOs and machine-readable descriptors.

## Verify the two surfaces

For the report, check missing records, denied access, long titles and page overflow. For the capability, call the real operation under allowed and denied identities. A correctly generated descriptor does not prove the handler enforces its data boundary.

## Checkpoint

Identify one report projection and inspect the lab agent descriptor. Explain why both still need the original server permissions.

## Practice on your own

Design a read-only “unfinished task summary” operation for both a report and an agent. Keep its output independent of UI markup.

## Reference

For the complete API contract, read [Reports](/docs/reports/).
