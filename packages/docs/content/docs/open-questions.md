---
title: Open questions
description: Known gaps, unsettled design questions, and weak spots in the current implementation.
group: Project evolution
order: 4
---

# Open questions

Known gaps in the current framework and its extension boundaries. Static asset and island bundling are implemented by `ketjs-view-tools`; they are not an outstanding feature.

## Not built
- **Image processing.** Storage keeps the bytes it is given. Resizing, transforms, focal points and
  document previews are not framework features; an application that needs them runs them as jobs.
- **Installing packaged modules.** Using modules from an npm package means installing it, then importing
  its modules or adding its root to `modulePaths`, and listing them in `modules` by hand.
  [Plan: installing modules](/docs/module-installation-plan/) proposes `ket install`.

## Not settled
- **Does a theme get its own routes?** Currently regions only; Shopify-style JSON
  templates with merchant-editable section order are sketched in the agent
  composition schema but not wired to rendering.
- **Should a module be able to patch another module's declarations?** Nothing does today: a module
  changes another only through `extend`, `fills` and `omits`, all checked against `depends`, and the
  manifest has no patch slot. Allowing more too generously is the failure mode that produced the domain
  contract's upgrade debt.
- **Cross-process stream durability and latency.** Stores already wake local readers and can use adapter notifications. `tail()` retains a recovery poll (5 seconds for a notifying store, 250ms otherwise). A production workload still needs to measure recovery latency and database load; see [Streams](/docs/integrations/).
- **Editor support for KTL.** No language server, so a theme author gets no
  completion or type errors inside templates. This is the DX cost of D3 and it is real.

## Known weak spots in what *is* built
- The KTL parser accepts a small expression grammar with no operator precedence
  beyond comparison and filters. Adding arithmetic later needs a real precedence climb.
