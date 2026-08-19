# Open questions

Honest list of what is not settled or not built.

## Not built
- **SSR + hydration for the islands runtime.** The renderer targets an abstract
  host, so a string host and a DOM host both exist in principle — but walking a
  server-rendered DOM and re-attaching the holes is not written. Predicted to be
  the single most time-consuming remaining piece.
- **Postgres adapter.** The adapter contract is fixed; the ~2.5k-line wire-protocol
  driver is not written. This is where rule 1 is most likely to be broken under pressure.
- **Auth.** Decided to be core (session, identity, permission check) because the
  agent pillar needs a permission boundary. Not implemented.
- **i18n and storage primitives.** Decided core, not implemented.
- **Client-side bundling.** Deliberately optional; unbundled ESM is the dev path.
  No production bundler exists yet.

## Deferred on purpose
- **Relations / preload.** Decided (D11) to defer until the query layer has run
  against real data. Leaning: declare relations in the manifest as another kind of
  joint, load them through an explicit `preload`, and forbid relating to a model
  whose module you do not depend on.

## Not settled
- **Does a theme get its own routes?** Currently regions only; Shopify-style JSON
  templates with merchant-editable section order are sketched in the agent
  composition schema but not wired to rendering.
- **How much may `unsafe_patch` do?** The manifest slot and diff surfacing exist;
  no runtime patching is implemented. Deciding this too generously is the failure
  mode that produced Odoo's upgrade debt.
- **Streams poll.** `tail()` polls the log every 10ms. Correct and durable, but a
  notify path (`LISTEN/NOTIFY` on Postgres, an emitter on SQLite) should replace it.
- **Editor support for KTL.** No language server, so a theme author gets no
  completion or type errors inside templates. This is the DX cost of D3 and it is real.

## Known weak spots in what *is* built
- `Instance.nextSibling()` walks the parent's children array; on a real DOM host this
  must use `node.nextSibling` instead. The counting host is exercised by tests, the
  DOM host is not.
- Idempotency keys live in a process-local `Map`. They belong in the log table so
  they survive a restart and work across instances.
- The KTL parser accepts a small expression grammar with no operator precedence
  beyond comparison and filters. Adding arithmetic later needs a real precedence climb.
