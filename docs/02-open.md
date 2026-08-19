# Open questions

Honest list of what is not settled or not built.

## Not built
- **Auth.** Decided to be core (session, identity, permission check) because the
  agent pillar needs a permission boundary. Not implemented.
- **i18n and storage primitives.** Decided core, not implemented.
- **Client-side bundling.** Deliberately optional; unbundled ESM is the dev path.
  No production bundler exists yet.

## Not built
- **Streams under a database-per-tenant layout.** Whose database a stream belongs to
  is unanswered, so the pooled server defaults to an in-memory store.

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
- Keyed reordering is 2.3× slower than lit-html: it still builds six N-sized
  structures the common update paths now skip. Measured, not guessed — see
  [03-benchmarks.md](03-benchmarks.md).
- The Postgres adapter is proven against a recording stand-in for the driver, not
  against a live server. Running it against a real cluster is the next real test.
- The KTL parser accepts a small expression grammar with no operator precedence
  beyond comparison and filters. Adding arithmetic later needs a real precedence climb.
