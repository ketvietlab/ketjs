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
1. `dependencies` stays **empty**, and the driver is an **optional peer
   dependency** — not an `optionalDependency`. Measured: npm installs
   `optionalDependencies` by default and only skips them when installation *fails*,
   so the first attempt at this fence silently shipped the driver to everyone.
   `peerDependenciesMeta.optional` is the one form npm will not pull in on its own.
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

## D12 — The adapter contract is asynchronous, and transactions are scoped
**What happened:** the day-one contract was synchronous, because `node:sqlite` is.
Postgres over a socket is not, and no amount of API design makes it so. The contract
moved to async: SQLite resolves immediately and pays nothing measurable, while the
harder case becomes expressible at all.

**The second correction was subtler.** `tx(fn)` originally gave the callback no
handle, so the body would have run on whatever pooled connection came next rather
than the one that issued BEGIN — a transaction that silently is not one. It now
passes an adapter scoped to a reserved connection. SQLite could never have surfaced
this bug, which is the argument for building the second adapter earlier rather than
later.

**Cost:** every `ctx.db` call and every handler is now async, and the test suite
had to follow. Paid once, at the cheapest possible moment.

## D22 — Translations belong to the module that owns the strings
**Chosen:** a module declares `messages` per locale; the composer prefixes every key
with the module name and merges them. Same rule as models, joints and sections — a
module declares what it contributes and nothing reaches in from outside.

Prefixing is what stops the collision that rots a flat global catalogue: two modules
may both own a "title" without either knowing the other exists.

**Bound to `_`, after gettext.** It appears often enough in markup that a longer
name would cost more than it explains. In KTL it is a **filter**, not a function in
scope — `{{ 'website.page.title' | _ }}` — because scope holds data only, and a theme
that could call functions would be a theme that could run code (D3).

**Missing translations never break a build.** They fall back to the default locale,
then to the key itself, which is visible and greppable rather than blank.
`missingMessages()` reports the gaps for whoever is filling them in. A build that
fails because one Danish string is absent is a build nobody translates into Danish.

**Plural rules come from `Intl.PluralRules`,** not from a hand-written table.
Vietnamese has one form, English has two, and neither is our business to encode.

**The pseudo-locale earns its place.** `qps` returns every string longer and
bracketed, so a layout tuned to short Vietnamese shows its seams before a real
translation exists. It found two things immediately: app titles, summaries and
categories were not translatable at all, and `label()` was asking `has()` — which is
about *this* locale — when it needed `resolves()`, which is about whether a
translation exists anywhere. Using the wrong one made the pseudo-locale silently stop
expanding, which is the one thing it is for.

**Module metadata translates by convention, not by new syntax.** `title`, `summary`
and `category` stay plain strings so a module reads without a catalogue; a module
that wants them translated adds `app.title` and friends to its own messages. No
module has to change, and the pseudo-locale shows which ones have not been done.

## D21 — Apps install at build, switch on at run
KetSuite needs what Odoo has: a list of apps, installed or not, with install and
remove. Odoo gets it by letting each database hold a different set of modules — the
exact thing D16 refused, because it is why a fleet upgrade there is N unknown
migrations instead of one known one.

**The split:** a deployment decides at BUILD time which modules exist, and every
database it serves has the same schema. A database decides at RUN time which of them
are ON. Installing changes behaviour — which functions answer, which sections may be
placed, which fills appear — and never the shape of the database. Verified: the table
list is byte-identical before and after installing and removing an app.

**Uninstalling deletes nothing.** The columns stay, the rows stay, re-installing
finds the data where it was. Odoo drops columns on uninstall and people lose data to
a misclick. Refusing that is the same rule as D7, applied one level up.

**The cost, stated:** a database carries columns for apps it does not use. Nullable
columns are nearly free, and this is precisely the price that buys a fleet where the
upgrade diff runs once.

**What "installed" gates:** `restrictManifest` filters behaviour — functions,
sections, islands, joints, fills, regions — and never models, because rows outlive an
install. A call into a switched-off app answers `E_APP_NOT_INSTALLED` naming the app,
not "no such function", which would send the reader hunting for a typo.

**One thing this surfaced:** a theme is written against what the *deployment* ships,
not against what one database has on. So the strict check — a template naming an
island nobody provides — belongs to the full manifest, where it is a build error,
while a restricted manifest renders nothing instead. A page saved while an app was
installed still names its sections afterwards; those sections are skipped and come
back with their data when the app returns. Uninstalling must not take the theme down.

## D20 — Sections: placement by data, not by code
**Chosen:** a page's body is an ordered list of section placements, each with
settings validated against a schema the providing module declared. A joint is placed
by code; a section is placed by data.

**This is where pillar 3 stops being a slogan.** An agent composing a page writes
JSON that is checked against the sections that actually exist, before anything is
stored, and gets back a list of what is wrong and where — a bad section type, a
missing required setting, a setting of the wrong shape. A list, not an exception,
because a list is what an agent can act on.

**And where pillar 4 pays off:** the theme owns how a section looks, the data owns
which sections exist and in what order, and neither writes the other's half. The
same declaration serves both — no second schema to drift.

**A module is one file per concern.** `index.ts` assembles; models, joints,
sections, views, functions and tokens each live in their own file. The alternative
is the giant `models.py` that every mature Odoo module turns into.

**Writing a real module found a real gap:** `parentId: 'ref:MenuItem'` declared
required is a contradiction — the first row can never satisfy it — and nothing
caught it until SQLite refused the insert. The composer now rejects a required
self-reference at build time. This is the argument for writing a vertical rather
than more framework.

## D19 — Monorepo, so the fences become shapes
**Chosen:** four packages — `ketjs-view`, `ketjs`, `ketjs-postgres`, `ketsuite` —
in one repository under npm workspaces.

**Each boundary earns its place:**
- `ketjs-view` is browser-safe and depends on nothing, so a client that never
  touches the server half can install it alone.
- `ketjs-postgres` exists *because of* D4a. The driver is no longer "allowed in one
  file" — it lives in the one package that declares it, and every other package is
  structurally unable to reach it.
- `ketsuite` may only import `ketjs`'s public entry. If the suite needs something
  deeper, so does every third-party module, and it should be exported rather than
  smuggled. This is the rule that keeps the framework honest, and it is now checked
  rather than promised.

**One cycle had to be cut first:** `view/island.ts` imported `KetError` from the
kernel, while the theme layer imported the view. A single line, and the only thing
that would have made the two packages mutually dependent. The view layer now carries
its own errors, which is better layering regardless of packaging.

**Verified by trying to break it:** a suite file importing `ketjs/src/kernel/...` is
rejected; a core file importing `postgres` is rejected.

## D18 — A theme places behaviour; it never writes it
**Chosen:** interactivity lives in islands — a module's `html` view, trusted code —
and a theme places one with `{% island "name" %}`, a tag that cannot carry code.
`defineTheme` refuses an `islands` key outright.

**Why not let KTL run on the client instead:** the moment a theme runs in the
browser, either it gets a way to invoke behaviour — reopening the door D3 closed —
or KTL grows into a real programming language. Neither is worth it. Keeping KTL
string-only forever is what keeps a stranger's theme safe to install.

**The joint was already the seam.** Nothing new was needed to connect the two
halves: a theme names a place, a module fills it. Placing an island nobody provides
is a build error, exactly like filling a joint nobody publishes.

**Only islands hydrate.** The rest of the page stays inert markup, which is the
point of rendering a theme to a string at all.

**An API note worth keeping:** `hydrateIslands` first took the mount function as a
parameter, and its first caller passed the one that BUILDS instead of the one that
ADOPTS — so an island quietly rendered a second copy of itself beside the server's.
The parameter is gone. An API that makes the wrong choice expressible will
eventually have it chosen.

## D17 — A framework table appears only when something uses it
Asked why the framework owns tables at all, the honest audit found that
`createKetServer` created `ket_stream` at boot — so an app that never streamed still
found a stream table in its database. Now every framework table is created on first
use: migrating an app yields `ket_migration` and the app's own tables and nothing
else, `ket_stream` appears on the first stream, `ket_idem` on the first idempotency
key, `ket_job` on the first enqueue.

The same audit found two gaps in idempotency, both the kind that only bite during an
incident:
- A caller that died between claiming a key and finishing it blocked that key
  **forever**. A claim older than `staleMs` (default 5 minutes) is now treated as
  abandoned and taken over. The trade is stated rather than hidden: too short and a
  slow call runs twice, too long and a stuck key blocks retries.
- Records never expired, so the table grew without bound — the quiet way a
  correctness feature turns into an operational problem. `sweep()` drops records
  past the window in which a client could still retry.

## D15 — SSR marks only what it cannot describe
**Chosen:** the server walks the same parsed template the client does and emits one
comment marker per hole — nothing else. Everything but a hole has a length the
template already knows, so the hydration walk can count nodes instead of reading
markers for them.

**Hydration adopts, it does not rebuild:** verified in a real browser, hydrating
twenty server-rendered rows creates **zero** nodes and keeps the same node objects,
and the first update afterwards also creates zero.

**A mismatch throws.** A hydration that half-works is worse than one that fails,
because the failure is then silent and permanent. `E_HYDRATION_MISMATCH` names the
node it expected and the one it found, so the caller can fall back to a clean client
render.

## D16 — One manifest, many databases; never many manifests
**Chosen:** a database per tenant, all migrating to the same target schema, each
recording the schema it is actually on.

**Why not Odoo's version:** Odoo lets every database install a different module set,
so there is no single schema to reason about and a fleet upgrade is N unknown
migrations. That is the root of the upgrade failures, not a detail of them. Giving
up per-tenant module sets buys a fleet where the upgrade diff runs **once**.

**The pool is the part that bites in production:** a database per tenant multiplies
connections by tenant against a cluster with a hard ceiling. So the pool caps how
many databases stay open, evicts least-recently-used, and refuses to evict one a
request still holds — it fails loudly instead of quietly serving the wrong tenant.

**Resolution happens in exactly one place.** `ctx` was already the only thing that
touches data, so a request cannot reach the wrong tenant by forgetting to thread
something through. Verified: two tenants, same product id, no bleed, and an
unresolvable request gets `E_UNKNOWN_TENANT` rather than a default.

**One failure does not stop the fleet.** `migrateFleet` reports which databases
moved and which did not; a half-migrated fleet you cannot see is worse than one you
can.

## D14 — One log was the wrong abstraction; split by heat, not by shape
**Retracted:** the claim that folding streams, jobs, the outbox and idempotency into
a single append-only table was somewhere fullstack "gives some back". They were
grouped by *shape* — all append-only — while differing completely in how hot they
run and how long they live. The hottest rows in the system shared a table and an
index with the coldest.

**Measured before changing anything:** 2 database round trips per stream chunk
(`SELECT MAX(seq)` then `INSERT`), which is 6 000 writes/second for 100 streams at
30 tokens/second — hopeless against synchronous replication. `tail()` polling every
10 ms cost 30 000 selects/second at 100 readers, purely to discover nothing had
changed. Nothing was ever deleted.

**What changed:**
1. A stream has exactly one producer, so the sequence belongs to the writer. It is
   recovered once at open and never read again.
2. Chunks are batched (50 ms / 32 chunks). "Resumable" means no gap and no
   duplicate, not one transaction per token.
3. Readers on the same instance are woken by the writer; the poll fell from 10 ms
   to 250 ms and exists only as the cross-instance fallback.
4. Finished streams are swept after a grace period. Previously nothing expired.
5. Three tables instead of one: `ket_stream`, `ket_job`, `ket_idem`.
6. Postgres claims jobs with `FOR UPDATE SKIP LOCKED`; twenty concurrent workers,
   twenty distinct jobs, verified against a live server.

**Result:** 2.0 → 0.034 database round trips per chunk, a 59× reduction; 6 000
writes/second becomes 102. `since()` went from three queries to one.

**What did not change:** streams still have to be durable somewhere. An in-memory
buffer loses the stream on restart, which is the exact failure the feature exists to
prevent, and a reader reconnecting to a second instance would find nothing. The
answer was never "take it out of the database" — it was that the database must not
be the default for the hottest rows, and that when it is used the writes must be
batched, notified and expired.

## D13 — Idempotency records live in the log, not in memory
A process-local `Map` loses every record on restart and is invisible to a second
instance, which makes the guarantee false exactly when it matters. Records now sit
in `ket_log` under `idem:<fn>:<key>` at seq 0, claimed with
`INSERT ... ON CONFLICT DO NOTHING` so the primary key settles the race rather than a
check-then-insert. A key that is claimed but unfinished returns
`E_IDEMPOTENCY_IN_FLIGHT` instead of quietly running the work twice.

## D11 — SQL layer: Ecto's architecture, Drizzle's surface, no ORM
**Chosen:** hand-written, not a dependency. A query is an **immutable value**, built
by a chainable typed builder and rendered per dialect. Casting and validation live in
**changesets**, separate from persistence. `ctx` is the Repo — the only thing that
touches the database.

**Why a value and not a SQL string:** this is the decisive point, and it is forced by
pillars 3 and 5 rather than being a matter of taste. A query you can inspect can be
checked against a function's declared `effects` *before it runs*, handed to an agent
as data, and rendered for SQLite and Postgres from one shape. A tagged SQL literal
gives up all three.

```ts
const q = from(P).where(eq(P.active, true)).orderBy(desc(P.priceCents)).limit(20)
q.touches            // ['catalog.Product'] -> effect check happens here
q.toSQL('postgres')  // { text, params } -- values always parameterised
```

**Why changesets rather than reaching for a validation library:**
1. Casting rules come from the manifest, so field types are declared once, not twice.
2. Errors are structured data; an agent cannot act on a thrown string.
3. `changes` is a real diff against the existing row — exactly what dry-run reports.
4. `cast()` is an explicit allow-list, so mass assignment is not possible by default.

**Deliberately absent — this is what "no ORM" means here:** identity map, lazy
loading, dirty tracking on objects, Active Record, automatic association loading,
unit of work. Rows are plain objects. Nothing loads itself, so N+1 cannot happen by
accident.

**Deferred:** relations. `ref:module.Model` exists in the type system and is unused.
The hard part is specific to Ket: module B must be able to relate A's model to B's
own, because that is the lego pillar, and Ecto never faces this. Deferred on purpose
until the query shape has run against real data.

## D10 — Name
`Ket`, from *kết* — to join. npm `ketjs` is free; `ket` is held by a dead 2022
package. Flagged: `ket` is UK slang for ketamine and bra-ket notation in physics.
