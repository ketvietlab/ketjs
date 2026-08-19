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

## D32 — Reads span a set of companies, writes go to exactly one
**Chosen:** Odoo's split, deliberately. `scope.companies` is what a read may see;
`scope.company` is what a new row is stamped with. The split is right because the
two questions genuinely differ: a report may span three legal entities, but an
invoice belongs to one.

**Absent, the set is just the company being written to.** Widening what a request
can see should take saying so — the default that looks convenient is the one that
leaks. Which is also why nothing existing had to change: 23 call sites already
passed `{ company, branches }` and kept working, with the narrow meaning.

**The guard that earns its place:** writing to a company you cannot read back is
*silent* corruption. The row lands, every later query filters it out, and nothing
anywhere says why. So `scope.company` must be in `scope.companies`, checked before
the first query runs, with the error naming both sides.

**A readable set and nothing to write to is its own error**, listing the companies
it does have — because the fix is to pick one, and the message may as well say
which ones are available.

**The convenience path had to part company with its `column = ?` map.** `db.select`
builds equality pairs, which cannot express a set, so it now appends an explicit
`IN` with its own placeholders. Two ways to read must not disagree about who you
are; both are tested, on SQLite and on live Postgres, where placeholder rendering
differs.

**`crossCompany` is unchanged and still means all of them.** It remains the
declared, descriptor-visible exception rather than the ambient one.

**Over HTTP:** `X-Ket-Company` names the write target, `X-Ket-Companies` widens the
read, and the active company is folded into the set without the caller having to
repeat it. Still headers, still not authentication — but the shape a session will
produce is now the shape that exists.

## D31 — Permissions are reported before they are enforced
**Chosen:** `ket permissions` first, the role model second. Deciding how roles
should be shaped is much easier while looking at what the functions already imply,
and the report costs a fraction of what guessing wrong would.

**The question that prompted it:** a user needs orders but must not have products.
In most systems answering that takes reading every module, because permission is
granted on a *table* and a table is used everywhere — grant read on
`product.template` in Odoo and you have granted it in the order form, the list
view, the export, XML-RPC, and every `search()` any module makes.

**Here the unit is the action, so the answer is arithmetic rather than
investigation.** A function cannot touch a model it did not declare — not through
a relation (D10, and the hole that let an undeclared preload through on an empty
table is closed), and not by calling another function, because `Ctx` has no way to
call one. So the reach of a set of functions is the union of their effects. There
is nothing to traverse, which is why the report is thirty lines and exact.

```
ket permissions --grant product.listTemplates

models reachable:
  product.Product   read   via product.listTemplates
  product.Template  read   via product.listTemplates
```

Every model names the function that granted it, because a surprise has to be
traceable to its cause.

**What the report immediately showed, which is the real value:** of KetSuite's 17
functions, **16 return an undeclared shape**. Model-level reach is exact;
field-level reach is not stated at all. So the honest answer to "may they see the
product name but not its cost" is currently *no, they see the whole row*.

`FnSpec.output` already exists and is already composed into the manifest — and is
read by nothing. Meanwhile the mechanism that would enforce it exists and runs:
view models (`views`) build a null-prototype frozen projection of exactly the
declared fields, which is the boundary that keeps a third-party theme from touching
anything else. The two have simply never been connected.

**Not enforced in this change, deliberately.** Making `output` mandatory is a
migration across every function; making it enforced-when-present is a decision
about defaults that is better made with the count in front of you. The report
flags every unprojected function so the field-level gap is *visible* rather than
remembered — which is the same move as the banner saying auto-install is off.

**Cost:** granting by function means more functions than Odoo has rules — two
audiences needing two slices of one model is two functions, not one function with a
flag. In exchange the reach is computable, which Odoo cannot do at all.

## D30 — A module contributes to the served surface, not just to the database
**The hole, stated as a measurement.** With `backend` uninstalled, `/admin` still
answered 200 and its stylesheet was still linked. "Enable at run" reached the
database and stopped there. The cause was that the app assembled the surface by
hand: it reached into `packages/ketsuite/src/modules/backend/design/` by filesystem
path, named two stylesheets, and declared four routes belonging to that module —
so it went on serving all of it after the module was switched off, and it also
walked straight past the rule the dependency audit enforces for imports.

**Chosen:** a module declares `assets`, `styles` and `routes`, compose aggregates
them, and `restrictManifest` drops them with the rest of the module's behaviour.

**Paths are data, handlers are factories.** `routes` is one factory per path, not
one factory returning many, because compose has to settle ownership — two modules
claiming a path is a build error naming both — while a handler needs the running
server, which does not exist at compose time. Dispatch then checks the *live*
manifest per request, so uninstalling stops a route answering without a restart,
and reinstalling brings it back the same way. `/_ket/` is refused to modules: it is
where health, the agent descriptor, streams and assets live.

**Stylesheets come out in dependency order**, which is the point of composing them
rather than gathering them: a module that extends another loads after it and can
override it. `ctx.styles()` returns every installed module's, so no module names
even its own file, let alone another's.

**Assets are namespaced `/_ket/asset/<module>/`**, so two modules may both ship
`tokens.css`, and an uninstalled one can be refused by name before any file system
call happens.

**A theme may ship assets and styles — that is most of what a theme is — but not
routes.** A route is code running on the server, which is the line themes exist on
the far side of.

**The static handler kept its own file reading.** An asset body cannot go through
the `Html` constructors from D29: a PNG is not markup and a string-typed body would
corrupt it. So `ServeOpts.assets` became a list of mounts, each either a fixed
directory or a resolver answering per request — the resolver is what lets a
module's files disappear when the module does. Traversal is refused in both encoded
and unencoded forms, tested.

**Measured, because "every module's schema in every tenant database" deserved a
number rather than a shrug:** 400 empty tables of twelve columns cost 17 MB in
Postgres 17, and adding a column to all 400 took 43 ms — a catalogue change, not a
table rewrite. That is the price of D7 per tenant database, and what it buys is
that switching a module on for a tenant is one UPDATE with no migration and no data
loss when it goes off again.

## D29 — HTML is a value, templates are files, and removal has a boundary too
**The premise was wrong in an interesting way.** "We cannot write HTML as strings"
sounded like KetJS had no template engine. It has two: `html\`\`` for first-party
screens, KTL for third-party themes — and that split is right, because the two
audiences differ in exactly one way that matters, whether their code may run. What
was actually string concatenation was narrower and worse placed: the document
shell, the thing every page passes through.

**A route's body was `string`, so escaped and hand-built were the same type.**
Nothing could tell them apart — not the compiler, not a reviewer reading a diff —
and the shell was concatenation because concatenation was allowed. `RouteResult` is
branded now with a type-only symbol, so an object literal is not assignable and the
only ways to make one are `page`, `fragment`, `json`, `text` and `raw`. `raw` is the
single hatch, and it is one word to grep for. The type-level claim is asserted in
tools/type-proof.ts, because a rule nothing checks is a rule that decays.

**Two bugs fell out of building it, both found by probing rather than by tests:**

1. `localeOf` split `Accept-Language` and handed the result to Intl. Node's own
   fetch sends `Accept-Language: *` by default, so **any client that did not set the
   header got a 500**. Every earlier check used curl, which does not send it. The
   locale is now resolved against the catalogues the deployment actually ships,
   which fixes the crash and closes the wider hole at once: the value reaches the
   `lang` attribute of every page, and one drawn from a fixed set carries nothing.
2. **`apps/**` was never in tsconfig.** The application entry point had never been
   type-checked. It is now, and it needed fixing when it was.

**Templates are .ktl files.** The file name is the template name, so an error can
name a place without a second map. Themes gained comments (`{# … #}`) at the same
time — a language a theme author cannot annotate is one they will annotate in the
markup — and KTL errors now carry the line.

**`{% render %}`, with no inheritance.** Shopify made the same call and the reason
holds here twice: a partial that sees only what it was passed is a partial you can
read on its own, and a theme is a stranger's code, so one that silently saw the page
scope would leak whatever the page was carrying. The callee's scope is a
null-prototype object holding the passed arguments and nothing else. A depth cap
turns a self-rendering template into an error naming the template and the line
rather than a stack overflow.

**`removable: false`, which the install policy had no answer for.** D28 drew the
boundary on the way in; there was none on the way out, and the backend — the screen
you would use to put something back — could be uninstalled. A deployment that lets
you remove that lets you remove your way out of ever fixing it. Default is true:
refusing removal is the exception and has to be argued for.

**Still open, and now visible:** a module cannot contribute assets, stylesheets or
routes. The app reaches into `packages/ketsuite/src/modules/backend/design/` by
filesystem path and names two stylesheets by hand, which is why uninstalling a
module leaves its routes mounted and its CSS linked. That is the next change, and
it is the same defect class as this one: the app assembling by hand what the
manifest should carry.

## D28 — The framework boots the app, and a module says whether it may arrive
**Chosen:** `ket serve` and `ket dev`, with the boot sequence as a function
(`bootApp`) rather than a script. What moved into the framework is everything that
was app-agnostic and would have been copied by the second app: opening a datastore,
migrating, registering functions, installing a bootstrap set, deciding who the
request is, mounting the theme, mounting `/_ket/health` and `/_ket/agent`, printing
a banner, shutting down on a signal. KetSuite's entry went from 162 lines to 4.

**What stayed with the app is what only the app knows**, and it arrives as data on
`defineApp`: which modules ship, which function turns a path into a page, which
extra routes it serves, where its assets are. The page resolver is a *name*
(`website.getPageByPath`), not a closure — so the framework never learns which
module provides pages, and a missing resolver is caught at boot rather than at the
first request that happens to hit it.

**The framework cannot open Postgres, and that is the fence working.** ketjs ships
SQLite, which it owns; the Postgres adapter is a separate package that depends on
ketjs, so a framework that reached for it would be a cycle. An app that wants it
hands `serve.openStore` in. The dependency audit is what keeps this true rather
than a comment — it failed this change twice and was right both times, once for
importing the driver and once for scaffold templates whose *string literals*
contained `from 'ketjs'`. The templates are files now, which makes "this is data,
not code" a shape instead of an exception.

**`install` replaced `autoInstall`, and gained the case that was missing.**
A boolean could say "come along by yourself" but not "never arrive by yourself":

- `'manual'` (default) — installed only when someone asks for it by name
- `'auto'` — installs itself once everything it depends on is installed
- `'never'` — refuses direct install entirely; it arrives only by being depended
  on, which is how machinery stays out of reach without also being hidden

That is the boundary the *module author* draws. Whether `'auto'` actually fires is
a separate decision belonging to the *deployment*: `KET_AUTO_INSTALL=0`, or
`ket dev --no-auto-install`, holds it back — which is what a developer wants when
they are changing one module and an app that installs itself is a surprise rather
than a service. Held back is not forbidden: installing by name still works. The
banner says when the switch is off, because a module that declared `'auto'` and did
not arrive should explain itself rather than look broken.

`autoInstall: true` still parses and still means `'auto'`; `defineModule`
normalises it away, so the manifest has one spelling.

**`ket new` writes an app that runs unedited** — verified by booting the output and
calling its route, not by reading it. It refuses to overwrite: a scaffold that can
eat work is not a scaffold.

**Cut:** hot module replacement. `ket dev` re-execs under `node --watch`, because a
file watcher of our own that disagreed with the runtime's would be worse than none.

## D27 — One command that starts the thing
There was a design entry point and a CLI that could check and migrate, but nothing
that *ran* KetSuite. `npm start` now opens a database, migrates to the manifest,
installs a starter set of apps if none are installed, and serves — storefront,
backend and API on one port.

**Configuration is a value, read once.** A misspelt variable is then a visible
default rather than an `undefined` that surfaces three layers down as something
else. `DATABASE_URL` is what switches SQLite for Postgres; the adapter contract
being fixed on day one is why nothing else changes.

**The storefront goes through `callFn` like everything else.** A path becomes a
page through `website.getPageByPath`, so the company filter and the app-installed
check apply to a public page exactly as they do to an API call. The front of the
site is not a second door with different rules — verified by two companies serving
different pages on the same path.

**`resolveScope` joins `resolveDatastore` and `resolveLocale`.** Building this
found that the HTTP layer had no way to say which company a request was: every
company-scoped function would have failed over HTTP. Resolution now happens in one
place for the same reason as the others — a handler that had to remember would
eventually forget, and forgetting means answering with another company's rows.

**The authentication gap is stated in the banner the server prints**, not buried in
a document. Until there is a session, the company comes from a header, which is
fine for development and not for production.

## D26 — Units of measure: Odoo's model, and the rounding it depends on
**Chosen:** Odoo's shape, deliberately. A category groups units that convert between
one another; exactly one is the reference; every other records `factor` — how many
of itself make one reference unit — and `rounding`, the precision it is meaningful
to. Conversion runs through the reference, both ways.

**Crossing a category is refused, not approximated.** There is no number of
kilograms in a litre, and a framework that guessed one would be worse than one that
stopped.

**Quantities are floats, as in Odoo, and that has teeth.** 0.1 + 0.2 is not 0.3, and
a figure that drifts by 1e-16 per movement eventually compares unequal to zero. The
defence is that every value crossing a boundary is rounded to its unit's precision,
and that comparisons go through `compareQty` and `isZero` — never `===`.

**Writing the tests found two bugs in the rounding, both of the quiet kind:**

1. `Math.round` sends .5 toward positive infinity, so `-0.5` becomes `-0`. A
   quantity half a unit *below* a threshold compared **equal** to it while half a
   unit above compared greater — an asymmetry in one direction only, which is
   exactly the sort that hides for months in a stock ledger. Now spelt out as
   half-away-from-zero.
2. Multiplying back by the precision reintroduced the error: three times 0.1 is
   0.30000000000000004, so `roundTo` returned a value it would not itself consider
   rounded. A test now asserts every result is stable under a second rounding.

**Product depends on uom**, as in Odoo: a template counts in a unit, optional so a
service needs none and so existing rows survive the module arriving.

**`decimal` is a separate type from `float`, and the difference is storage only.**
Odoo splits these and the split is right: a quantity or a price is stored as exact
decimal and computed as a binary float, with the rounding helpers standing between.
The first version here copied the arithmetic and missed the storage — quantities
went into `DOUBLE PRECISION`, where 0.1 comes back as 0.1000000000000000055 and
every trip through the database puts back the error the rounding just took out.

- Postgres: `NUMERIC`, unbounded, as Odoo uses.
- SQLite: `TEXT`. SQLite has no exact decimal at all — `NUMERIC` affinity silently
  becomes `REAL` — so text is the only storage that returns what it was given.
- Both adapters hand it back as a string; `ctx` converts, because it is the one
  place that knows the model and the row. Arithmetic stays on numbers, as in Odoo.

Tested both ways: awkward values round-trip unchanged through SQLite and through a
live Postgres, and the raw column is confirmed to hold `"0.1"` rather than a binary
approximation of it.

**Cut:** purchase units, and the reference-changing migration Odoo needs when a
category's reference moves. Both wait for a real case.

## D25 — Product: template and variant, with the stock concern left to stock
**Naming follows Odoo** — `product.Template` and `product.Product`, where Product is
the variant — so the migration map stays one to one. The name reads oddly and a
comment says so; a comment costs less than a translation table.

**Where it deliberately does not follow Odoo:** `product.template.type` there takes
three values, one of which — `product`, meaning storable — is a *stock* concept
living in a module that must not know stock exists. Uninstall stock and the value
means nothing while still sitting in the data.

Here `product` says only `goods` or `service`, and `stock` extends the template with
`tracked`. Odoo's three states still map one to one — service · goods+untracked ·
goods+tracked — and a template keeps its meaning when stock is switched off. A test
asserts both halves.

**Attribute values reach a variant through an explicit join model**, not a hidden
many-to-many. The framework has no magic for it, and a join you can see is one you
can query, scope and migrate.

**Master data is shared**, per the decision that products, partners and price lists
are tenant-wide: no company column exists on these tables at all, and a second
company sees the same catalogue.

**Archived, never deleted** — the same reason a field is never dropped. Rows
elsewhere point at this one.

**Cut on purpose:** packaging, dynamic variant generation, attribute exclusions,
and units of measure. UoM in particular is deferred until its rounding behaviour has
been discussed on its own; getting a carton-to-piece conversion wrong is the kind of
bug that quietly skews stock for months.

## D24 — Relations, with no lazy side at all
**Deferred since D11, opened now** because product cannot be modelled without it:
a template has variants, a variant belongs to a template.

**Chosen:** `belongsTo` and `hasMany`, declared by a module that depends on both
sides, checked at compose against the models and the key they travel on. A typo is a
build error rather than a query that quietly returns nothing.

**There is no lazy loading, and that is the point.** Nothing populates itself when
touched; a caller asks with `preload()` or does not get the rows. The N+1 that makes
ORMs slow in ways nobody can see is not expressible here. A preload costs two
queries — the parents, then the children by id — and a test asserts exactly that
count rather than trusting the shape of the code.

**A relation is not a way around the company boundary.** Preloaded children go
through the same scoped path as any other read, so a child row belonging to another
company does not arrive through its parent. There is a test that deliberately
re-parents a row across companies to prove it.

**And a relation may not widen scope.** A `hasMany` from a `shared` model to a
company-scoped one would expose every company's rows through a row that belongs to
none of them, so the composer refuses it — `E_RELATION_WIDENS_SCOPE`. Only the
narrowing direction is allowed. This surfaced immediately: the obvious
`catalog.Product.orders` was rejected the first time it was written.

**Reading the far side needs its own declared effect.** A preload is a read, and it
is checked like one.

**Generated types mark relations optional**, because they are optional in fact —
present only if the query asked for them. The type says so instead of pretending
every row arrives complete.

## D23 — Company is a row-level boundary; branch is a dimension
**The situation being replaced:** Odoo has no branch concept, so a business with
several branches of one legal entity models each branch as a `res.company`. That
forces a chart of accounts per branch, turns internal transfers into inter-company
invoices that then have to be eliminated, and fragments master data. It is not the
right model — it is the model Odoo leaves you with.

**Chosen:** two dimensions with different semantics.

| | `company` | `branch` |
|---|---|---|
| is | a legal entity | an operational unit inside one |
| filter | **mandatory**, a module cannot widen it | **default**, widenable within the company |
| crossing it | needs `crossCompany: true`, visible in manifest, diff and agent descriptor | ordinary; aggregating branches needs no permission |

**Every model must declare its scope** — `shared`, `company` or `company+branch`.
Omitting it is a build error, because the safe-looking default is the one that leaks.
The scope columns are added by the composer, never by the module: a module that spelt
them itself could spell them differently and the filter would silently stop matching.
Extending them is refused for the same reason.

**Why this had to come before any vertical:** isolation used to be a database
boundary, where a miss fails loudly. It is now a WHERE clause, where a miss quietly
returns another legal entity's rows. Every query written before the filter existed
would have been unscoped, and nothing would have caught it. This is a D1-class
decision — tightening later is not possible.

**Writes are stamped from the request.** A module cannot set `companyId` itself;
attempting it is `E_SCOPE_FIELD_WRITTEN`. Otherwise a write could be aimed at another
company.

**A request with no company cannot touch company data at all** — it fails rather than
falling back to everything, which is the failure mode that would have gone unnoticed.

**`ctx.tx()` arrives with it.** Stock reservation is unsafe without a transaction
spanning several writes, and the transaction hands the body a ctx bound to the
transaction's connection — carrying the same company, on the same session that issued
BEGIN.

**Shared master data, by decision:** products, partners and price lists are
tenant-wide; warehouses and branches are scoped.

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
