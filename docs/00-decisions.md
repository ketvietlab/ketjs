# Decisions

Each entry records what was chosen, why, and what it costs. Reversibility is stated
because two of these cannot be undone later.

## D1 — Extension points are published, not discovered
**Chosen:** a module declares `joints`; other modules may only fill those.
**Why:** Odoo composes brilliantly because any module can patch anything, and it
cannot be upgraded safely for exactly the same reason: with no public API, nothing
is safe to change. Its ecosystem is a debt taken on purpose that now cannot be repaid.
**Cost:** you will sometimes need a joint the author did not publish. The answer is
a PR, not a patch.
**Reversible:** no. Tightening later breaks every installed module. Loose-then-strict
is impossible; strict-then-loose is not.

## D2 — An escape hatch exists but must be declared
**Chosen:** `patches[]` in the manifest, surfaced by every upgrade diff.
**Why:** absolute prohibition gets routed around. A declared escape hatch keeps the
debt visible, which is the one thing Odoo lacks.

## D3 — Themes are third-party code
**Chosen:** a restricted template language (KTL) compiled to closures — no `eval`,
no `new Function`, no JavaScript in themes — plus a view-model layer.
**Why:** a theme is a stranger's code installed into someone else's app, and the app
owns a database. A tagged template literal is arbitrary JavaScript and would give a
theme `fetch`, `process.env` and the ORM.
**Cost:** ~3–4k lines of language and boundary work, and themes cannot express
arbitrary logic. That restriction is the product, not a limitation.
**Reversible:** no, same argument as D1.

## D4 — SQLite first, Postgres second, adapter shape fixed on day one
**Why:** `node:sqlite` ships with Node and proves the whole stack end to end, so the
riskiest work does not sit on the critical path.
**Reversible:** yes — that is why it was safe to decide without waiting.

### D4a — The SQL driver is the one accepted breach of rule 1
**Chosen:** take a dependency for the Postgres driver instead of hand-writing ~2.5k
lines of wire protocol. `postgres` (porsager) rather than `pg`: measured, it installs
**1 package with no transitive tree**, where `pg` installs **14**.

**Why the exception is affordable:** the adapter contract was fixed on day one, so the
dependency sits behind an interface the rest of the framework never sees. This is the
decision paying for itself.

**The fence — an exception without a boundary becomes the new default:**
1. `dependencies` stays **empty**. The driver is an `optionalDependency`, so
   `npm i ketjs` still installs nothing.
2. Exactly one file may import it: `src/data/postgres.ts`. Enforced by
   `tools/zero-dep-audit.ts`, not by good intentions.
3. The allowlist is a literal set in the audit. Adding a second name is a visible
   diff someone has to justify, which is the whole point.
4. SQLite remains the default adapter, so the zero-dependency path stays the one
   that is actually exercised by tests.

**Cost, stated plainly:** "zero dependencies" is now "zero required dependencies".
That is a weaker claim and the README says so rather than pretending otherwise.

## D5 — Reactivity at runtime, not compile time
**Chosen:** signals; the renderer diffs holes, never a tree.
**Why:** Svelte 5 abandoned compile-time dependency analysis for the same reason.
Runtime reactivity is what allows a template compiler with no JavaScript parser —
which is what makes D3 affordable at all.
**Measured:** 1 host operation to change one row of a thousand; 0 for a no-op
re-render; 2 moves for a swap.

## D6 — Node runs TypeScript; it does not check it
**Verified:** `const n: number = "a string"` executes without complaint, and `enum`
throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` — the engine is a stripper.
**Chosen:** source in `.ts` run natively by Node; `tsc --noEmit` for checking, as an
optional devDependency; `erasableSyntaxOnly` so nothing unrunnable creeps in.
**Cost:** no `enum`, no `namespace`, no parameter properties.

## D7 — Destructive migrations are generated but refused
**Why:** Odoo alters schema silently at install time, which is a root cause of its
upgrade failures. Here "never drop a field" stops being discipline someone has to
remember and becomes something the tool enforces.

## D8 — The agent's write surface is data, not code
**Chosen:** composition JSON validated against a schema; server functions exposed as
tools only when marked `agent: true`; dry-run and idempotency keys mandatory once a
database exists.
**Why:** an agent that writes React cannot be trusted against production. An agent
that writes schema-checked composition data can be trusted today.

## D9 — Umbrella layout
**Chosen:** many apps in one codebase; apps sharing a datastore get one union schema,
computed and checked at build.
**Why:** `depends` between modules was already `in_umbrella` by another name. The
classic umbrella failure is the shared database becoming invisible coupling — here
two apps disagreeing about a column is a build error.

## D10 — Name
`Ket`, from *kết* — to join. npm `ketjs` is free; `ket` is held by a dead 2022
package. Flagged: `ket` is UK slang for ketamine and bra-ket notation in physics.
