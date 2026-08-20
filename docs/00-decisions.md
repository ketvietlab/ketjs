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

## D6 — Source is built; Node only runs artifacts
**Verified:** Node's type stripping neither checks types nor transforms TSX. It is
therefore not a compilation boundary suitable for a framework.
**Chosen:** `tsc` emits workspace JavaScript into `.build`, package JavaScript and
declarations into `dist`, and rewrites relative TypeScript extensions. Every
production serve, test, benchmark and audit command builds first and executes only
`.js` artifacts. Development is the explicit exception: `tsx watch` transforms
source modules in memory while `tsc --noEmit --watch` checks them independently.
It writes neither `.build` nor `dist`, eliminating output races during editing. The
CLI rejects a source workspace unless the dev orchestrator sets its private source
mode. Artifact builds remain serialized and fingerprinted, so concurrent production
or verification commands reuse the same revision instead of deleting each other's
outputs.
**Why:** TSX lets UI components be authored structurally while the custom JSX
runtime still produces Ket's existing `TemplateResult`; there is no React or VDOM.
The explicit build also makes published package contents identical to what was
tested locally.
**Cost:** a compiler is a required development dependency and startup waits for an
initial build. It remains absent from runtime dependencies.

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

## D41 — Backend screens open up, by name, and only by name
**The gap, found by being asked about it.** Backend screens are `html`` ` and
joints only existed in KTL, so `backend` published none and nothing could reach
them. A module could not add a column, a button or a menu item. For a framework
whose first pillar is lego, that was a hole rather than a style choice.

**What actually hurts in Odoo is not extension.** It is two specific things, and
naming them is what settled the design:

1. **XPath into unpromised anchors.** `<xpath expr="//field[@name='partner_id']"
   position="after">` addresses a node upstream never promised would exist or stay
   put. Rename it and every extension breaks.
2. **`position="replace"` severs the link.** Upstream fixes and improvements never
   arrive, and nobody is told.

So the axis is not *insert versus modify*. It is **declared anchor versus
undeclared**, and **link kept versus link cut**.

**Fills are KTL, not functions — and this reversed my first proposal.** A
function-valued fill would have been typed, and it would have been arbitrary
JavaScript from another module running in this process, which is the thing KTL
exists to prevent. It would also have made `fills` the first part of the manifest
that is not data: unprintable by `ket manifest`, undiffable by `ket diff`,
unsnapshotable. A fill is text. One extension language for the storefront and the
backend, sandboxed by construction rather than by promise, and a fill that wants
behaviour places an island the way a theme does.

**What that took in the view:** a value kind for markup a trusted compiler already
escaped. Inserting it as a plain string double-escapes — the tags render as text —
so it is its own kind, branded so it cannot be made from an arbitrary string. SSR
writes it verbatim; hydration, which cannot count nodes it did not produce, runs
to the closing marker instead. That worked because a hole has been fenced on
*both* sides since the SSR text-merge fix, which was done for an unrelated reason
and paid for itself here.

**Omit removes rather than hides.** CSS hides at the wrong layer: the data still
travels and the tab order still walks through what nobody can see. An omitted
joint renders nothing at all, server-side. An omission by a module that is switched
off is not an omission — the joint returns, exactly as its fills would.

**A fill that will never render is recorded, not silently dropped.** Omitting a
joint someone else fills is not an error — both modules may be deliberate — but it
is exactly what gets discovered six months later, so it lands in `manifest.patches`
where `ket check` and the upgrade diff show it.

**Screens still receive data, not a runtime.** The card joint takes the app as a
prop, so the route renders one per card and hands the screen a map keyed by name.
Passing a function would have been shorter and would have made a screen depend on a
server — and the design catalogue renders these same screens with no server at all.

**A module does not depend on the admin just to add a button to it.** The fill
went into `product` first, which made `product` depend on `backend` — so every
composition without an admin failed, and a headless API could not have a catalogue.
It belongs in a bridge that installs itself once both sides are present, which is
what `install: 'auto'` was built for and what Odoo does with `sale_stock`. CI found
this; running only the tests I had touched did not, because I had touched
`product` without thinking of it as touched.

**Cut, deliberately:** replace and reorder. Replace is the one that severs the
upstream link, and the vertical-rewrite case it serves is better answered by a
different screen on a different route than by replacing slots in a generic one.
Reorder needs the joint list to become ordered data, which is a bigger declaration
change worth making once a real screen has slots in it. Both are additive later;
neither is blocked by this.

## D39 — The screens that make the enforcement usable
D38 closed the door. This gives it a handle: a browser arriving uninvited gets a
sign-in page rather than a bare 401, and lands where it was going once it signs in.

**A browser gets a page, anything else gets a status.** The signal is
`Accept: text/html`, because a redirect to an HTML form is a useless answer to a
`fetch()`, and a 401 with no body is a useless answer to a person. The same route
serves both without either pretending to be the other — it accepts a form-encoded
body and a JSON one, and answers in kind.

**The sign-in page runs without JavaScript, and has to keep doing so.** A login
that breaks when a script fails breaks in the one situation where getting in
matters most. There is nothing on it a form element does not already do.

**`next` is carried through and is only ever a path on this site.** Landing back
where you were going is the difference between a guard and an obstacle; accepting
`//attacker.example` as a destination would make the sign-in page an open redirect,
so anything not starting with a single `/` becomes `/admin`.

**A cross-site POST to /login is refused.** SameSite protects the session cookie
once it exists, not the request that creates it — an attacker who can make your
browser sign in as *their* account then watches what you do in it. Browsers send
`Origin` on any cross-site POST and nothing else sends one at all, so absence is
not suspicious and presence has to match.

**Already signed in, the form is skipped.** Showing someone a login they do not
need is how they sign in twice and cannot tell which one took.

**The login screen belongs to `user`, not to `backend`.** It was written in the
backend module first, which meant `user` importing `backend` without declaring a
dependency on it — a module borrowing another's code and strings, and breaking
quietly the day that other one is uninstalled. It moved, and its messages moved
with it.

**The topbar says who and offers the way out.** The company appears only when the
account belongs to more than one, because a label that is always the same value
teaches nobody anything. New `data-ui` selectors are in HANDOFF.md: the markup is
here, the look is the design team's, and both the wrong-password and
several-companies states need drawing rather than only the happy one.

## D38 — A stranger is not an unrestricted caller
**The hole, as it was found.** With sessions on and no cookie at all:

```
TẠO người dùng : {"ok": true, "id": "hack"}
TẠO vai trò    : {"ok": true, "id": "r"}
/admin         : 200, rendering the app list
```

Anyone reaching the port could create an account and then log in as it. The whole
of D35 and D36 was in place and none of it applied.

**The cause was a rule from D36, defended in its own pull request.** `allow: null`
means unrestricted, and `allowFor` returned null when there was no session — under
the reasoning that migrations, internal calls, tests and the public storefront all
arrive without an identity, so restriction should begin where identity does. That
is correct about *in-process* calls and catastrophically wrong about an HTTP
request that simply has not logged in. Absence of identity is not absence of
constraint; it is the constraint.

**Chosen:** a request with no session gets the anonymous set, not the full one, and
membership is declared per function (`anonymous: true`) and per route. Two
functions need it and they are the two that make sense — `user.authenticate`,
because there is no session until it runs, and `website.getPageByPath`, because a
public storefront is public. Three routes: login, logout, whoami.

**The terse form is the closed one.** A route written as a bare factory is
protected; opening it takes an object with `anonymous: true`. A default of open is
a default nobody notices until it is on the internet.

**The route check is central, not per screen.** Every module route passes through
one place that refuses a session-less request. Putting it in each screen is how it
ends up missing from one.

**Fixing it immediately broke the permission resolver**, which is the honest kind of
consequence: the app resolves what a user may do by calling `user.permitted`, and
that call went through the check it was trying to answer — asking permission to
find out whether it has permission. So there is now `ctx.callUnchecked`, one word
to grep for, like `raw`. Deciding what a caller may do is the one question someone
has to be allowed to ask; nothing else has that excuse.

**What this did not change:** an app that has not turned sessions on is unaffected,
because there is no login to be outside of — the header shim is still the identity
there, and the banner still says so.

## D37 — One deployment, many databases, and one door into each
**Chosen:** Odoo's model — the code ships with the deployment, the decision about
what is switched on lives in each database. `ket_app` per database is
`ir_module_module` per database, and D7 makes it cheaper here: every schema exists
everywhere, so enabling a module for a tenant is one UPDATE rather than a
migration. Measured earlier: 400 empty tables cost 17 MB, and adding a column
across all of them 43 ms.

**What this closes is not a missing feature but a wrong answer.** `bootApp` opened
one adapter and built one AppRegistry, so the restricted manifest was computed
once. Serving two tenants through that would not have crashed — it would have
shown tenant B the module set of tenant A. The registry is per datastore now and
the manifest is resolved per request.

**One datastore is the degenerate case of the same interface, not a second path.**
Two code paths through the thing that decides whose data a request sees is exactly
how one of them rots; every existing test exercises `singleTenant`, and the pooled
implementation differs only in where the adapter comes from.

**The bug that proves the point.** The HTTP layer was handed the raw pool, which
looked equivalent and was not: `/_ket/fn` leased a datastore that had never been
migrated, because migration happens the first time the *tenant runtime* touches
one. The first API call to a new tenant failed with "no such table" while a page
request to the same tenant worked. It now leases through the tenant runtime, so
there is one place preparation can be forgotten rather than two.

**Leases are scoped, never handed out.** The pool is bounded — Postgres has a hard
connection ceiling, which is where the Odoo model hurts most in practice — so
`ServeContext` exposes `live(req)` and `appsOf(req)` rather than an adapter or a
registry. An adapter that escapes its lease is a connection nobody gives back.

**The theme is per tenant too, keyed by the installed set.** It compiles every
template, so it is cached — but cached against *what is installed*, so switching an
app on rebuilds it rather than serving a stale one until restart.

**A host this deployment does not serve is refused, not defaulted.** A default
tenant is how one customer's request quietly reads another's data.

**Sessions follow the tenant, and which way depends on how the tenant is named.**
With subdomains the Host says which tenant before any cookie is read, so each keeps
its own sessions in its own database — and that *is* the isolation: a session id
from one tenant is not a row in another's table, even though the signature is
valid, because it is the same secret. An app serving every tenant from one domain
cannot resolve a tenant that way at all — reading the session needs the database,
knowing the database needs the session — so it passes one shared store and records
the tenant on the session. Both are expressible; neither is assumed.

**The cookie carries no `Domain`,** which is what makes the subdomain case safe:
`Domain=.example.com` would hand `acme.example.com` the cookie set for
`globex.example.com`. It was already absent; it is now deliberate and tested.

**Also still single:** the stream store falls back to memory when there is no
single adapter, so resumable streams are not yet per tenant. Named here rather than
discovered later.

**What a deployment that never wants tenants pays.** Nothing to declare — `tenants`
is absent by default, `ket new` does not mention it, and KetSuite itself has no
such line. The runtime cost is the `singleTenant` wrapper, which is a Map lookup;
measured end to end, a request is 0.368 ms. The restricted manifest was already
rebuilt on every call before this change, and is now cached against the installed
set — 0.0153 ms to 0.0003 ms — so a single-database app comes out of this slightly
faster than it went in. The API cost is real but small: `ctx.live()` became
`ctx.live(req)` and `ctx.apps` became `ctx.appsOf(req)`, four call sites in the
whole repository. That is the price of there being one shape rather than two, and
it is the shape that cannot answer for the wrong tenant.

## D36 — A role is a list of functions, enforced where every call already passes
**Chosen:** the framework enforces an allow-list, the app decides what is on it —
the same split as the datastore driver, and for the same reason. Roles are the
app's model; a framework that knew their shape would be a framework every app had
to agree with.

**A role is a named list of function keys, additive across roles**, which is
Salesforce's permission sets rather than Odoo's `ir.model.access`. Model-plus-CRUD
is what makes Odoo's permissions unanswerable: granting read on `product.template`
grants it in the form, the list, the export, XML-RPC and every `search()` any
module makes. Here the unit is the action, so the role *is* the list of actions,
and `ket permissions --role kho` prints exactly what it reaches — including which
fields, since D33.

**The check runs before input validation.** A caller who may not call this at all
should learn that and nothing else: validating first answers with the signature,
which is a map of the surface handed to someone who may not touch it.

**Absent means unrestricted, and that reads backwards until you see the
alternative.** Migrations, internal calls, tests and the public storefront all
arrive with no identity. Narrowing them by one would break every path that has no
user. The restriction begins where identity does — and an *empty* list is a real
restriction, distinct from a missing one.

**Resolved per request, not cached in the session.** A cached list is a revoked
role that keeps working until someone logs out, and "why can they still do that" is
a worse conversation than one extra query. Tested: unassigning a role takes effect
on the next call. Cache it when a measurement says to.

**A superuser column rather than a magic id.** Something has to be exempt or a
deployment that turns roles on can never grant the first one — the functions that
manage roles are themselves behind the check. Odoo solves this with user id 2 and a
group that everyone learns about by being told. A declared boolean is the same
escape hatch with its name written on it, and it shows up in a query.

**A grant for a function nobody ships is refused rather than stored.** It would sit
in the table looking like access, and become access again the day the name comes
back.

**`ket permissions --role` is the only part that reads the database**, because what
a role grants is a fact about a deployment rather than about the code. It looks for
`user_role` and `user_grant` by convention and says so plainly when they are not
there — the framework ships no role model, so it cannot import one.

## D35 — Sessions, with the store an interface because pods are the point
**The seam was built for this.** `resolveScope` has been one function since D27
precisely so that replacing headers with a login would be one change, and D32
settled the shape a session has to produce: a set of companies to read and one to
write. `sessions.scopeOf(record)` returns exactly that, so nothing downstream
learned a new concept.

**With sessions on, the header shim is gone — not kept as a fallback.** A system
where `X-Ket-Company` can stand in for a login is a system with no login. An app
that has not turned sessions on keeps the shim and keeps the banner apologising for
it; the banner now names which of the two is in force.

**The store is an interface, and that is the whole reason it exists as one.**
Sessions in memory behind three pods means a login lands on one and the next
request is anonymous on another — a bug that only appears once you scale, which is
the worst moment to find it. `dbSessionStore` solves it with no extra
infrastructure, because the database is already shared; verified on live Postgres
with two runtimes over one store. Redis would be faster and belongs in its own
package the way the Postgres driver does — the framework cannot depend on a client
without spending an exception it has already spent.

**The secret is the part that fails quietly, so it is said out loud.** A cookie
signed by one pod and rejected by another is a login that works until the load
balancer sends you elsewhere. Absent `KET_SECRET`, one is generated and the banner
prints two lines saying sessions will not survive a restart and will not work
across pods. Tested by signing on one instance and reading on another with a
different secret.

**Signing at all, given the id is 32 random bytes:** it makes a forged cookie cheap
to reject — no store lookup at all, asserted by counting reads.

**Refresh is capped.** A session extends while in use, never past
`createdAt + absoluteTtl`. A session that renews forever is a session that never
ends. Expiry is enforced on read as well as by the sweep, because a record that
reads back after its expiry has outlived it for however long nothing swept — and
the `UPDATE` that refreshes carries its own expiry guard, so a session that lapsed
between the read and the write is not quietly revived.

**Both stores take an injectable clock.** A store that reaches for `Date.now`
cannot be tested for expiry without sleeping, and a test that sleeps is a test that
flakes.

**Login is a route, not a server function.** `Ctx` is data and nothing else — no
request, no response, no cookie — and that boundary is what keeps handlers testable
and HTTP out of the data layer. So `user.authenticate` decides whether the password
is right and what the account may see, and the route decides what to do about it.
It also means `/login` arrived through the module-route mechanism from D30 rather
than needing anything new.

**One answer for every failure.** A wrong password, an unknown login and an account
with no company are three different reasons and one 401: telling them apart is how
someone learns which of the three they hit.

**`RouteResult` gained headers**, and a `withHeaders` helper rather than a spread —
spreading would produce a plain object that only looks like a RouteResult, which is
the hole the brand exists to close.

## D34 — Parties, legal entities and users, with the three things Odoo folds together kept apart
**Parties are shared, and addresses are their own model.** `res.partner` is one
table for customer, supplier, contact, delivery address, invoice address and legal
entity, and the cost is visible in the model itself: `is_company` to ask whether
this is a legal entity, `type` to ask whether it is an address, and a computed
`commercial_partner_id` to answer the only question invoicing cares about — who do
we bill.

That third field is the tell. It exists *because* addresses are parties: when a
delivery address is itself a partner, the system has lost the ability to say who
the counterparty is, so it walks up the parent chain to recover it. SAP, Tryton and
ERPNext all keep addresses separate. Doing the same removes `commercial_partner_id`
and `type` outright — the party on a document is the party.

**Roles are rows, as in SAP's BUT100.** A supplier who is also a customer is one
party with two rows. Odoo uses `customer_rank` / `supplier_rank` counters, so a new
role is a new column on a table that already has about 120.

**`ir.property` becomes an ordinary company-scoped model.** The party is shared, its
payment terms are not: the same customer may be on 30 days with one company and
prepayment with another. Odoo keeps that in a side table keyed by
(field, company, record) — EAV, invisible to SQL, untyped, and the reason "it is
blank in company B" is a recurring ticket. `partner.CompanyTerms` is SAP's KNB1: a
real table with real columns, scoped by machinery that already existed.

**The scope guard caught the first draft of it.** A `Partner.terms` hasMany was
refused at compose with `E_RELATION_WIDENS_SCOPE` — preloading it from a shared row
would hand back every company's terms at once. SAP reads KNB1 by (customer, company
code) for the same reason: the segment is reached from the scoped side, never from
the shared one. The relation is one-directional now because the framework insisted.

**A user *has* a party rather than *being* one.** Odoo is alone in making the user a
delegated subclass (`_inherits`), which puts every user in the address book and
leaks through archiving, deletion and sudo. Salesforce keeps `User` separate and
links a Contact only for external users; SAP keeps SU01 separate from the business
partner. The link is optional here for the same reason — an operator account is not
someone you invoice.

**Memberships are rows too**, so granting a company is an insert and revoking it a
delete: traceable, and not a read-modify-write two requests can race on. What
`authenticate` returns is exactly the shape D32 defined — a set to read and one to
write — so the session that replaces the headers has nothing new to invent.

**Passwords need no dependency.** node:crypto ships scrypt, which is memory-hard;
the encoded value carries its own parameters, because a hash that cannot say how it
was made cannot be moved on without reading every row. `needsRehash` reports when a
stored one is behind. Node's default 32MB cap rejects N=2^15, so the limit is passed
rather than assumed — a detail that costs an afternoon if it is met at deploy time.

**Nothing hands back the hash, and that is structural rather than careful.** Every
function here declares its output, so the projection from D33 picks the named
fields — a handler that returned the whole row would still hand back only what was
declared. `createUser` and `authenticate` are deliberately not agent tools: an agent
that can mint logins can mint itself one.

**Found while building: `db.del` had never worked.** `website_menu.removeMenuItem`
built its query with `from()` rather than `deleteFrom()`, so it rendered as a SELECT
— and the effect check saw `read`, refusing a function that had correctly declared
`write`. It threw on every call, and no test had ever called it. `db.del` now
refuses anything that is not a delete, naming the fix, so the trap is closed rather
than the instance repaired.

## D33 — `output` becomes a projection, enforced when declared
**Chosen:** enforce where it is declared; leave an undeclared output meaning "hands
everything back", and let `ket permissions` count what is still open. Making it
mandatory is a migration across every function at once, and a gap that is *visible*
beats a migration nobody finishes. The count is the progress bar: 16 of 17
unprojected when the report landed, 5 after this change.

**What it was before:** a comment. `output` was composed into the manifest and read
by nothing, so a function could declare three fields and return eight. Measured on
a handler that preloads a relation to show a product's name:

```
output đã khai : {"id","qty","productName"}
thực tế trả về : { companyId, id, productId, qty,
                   product: { id, name, cost: 12000, price: 30000 } }
```

The cost of goods left the building, and so did the scope column, which is
machinery and nobody's business.

**Two properties, deliberately told apart.** *Nothing undeclared escapes* is
picking, so it holds for every value and for an empty result — it cannot depend on
the data, which is the mistake the preload check made and #10 fixed. *Everything
declared is present* can only be checked where a row exists; an empty result proves
nothing about it. That is a bug in the handler rather than a hole in the boundary,
and it is reported as one, with the fix in the hint.

**`?` means the same as it does everywhere else.** Enforcing the declaration
immediately caught the only function that had one: `uom.convert` declared
`{ qty: 'float' }` and actually answers `{ok:true, qty}` or `{ok:false, errors}`.
A flat record cannot describe a union without optionality, and that union is the
convention every write function here uses. The declaration was simply wrong, and
nothing said so until something read it.

**It is one level deep, and that is a limit rather than an oversight.** Naming a
nested object hands it over whole; a narrower slice is what view models are, and
they already exist. Asserted in a test so the limit is a fact rather than a
surprise.

**The report now answers the field-level question**, which was the half that was
missing from D31:

```
product.listTemplates  reads
                       returns active, categoryId, description, id, name, …
website_menu.listMenu  reads
                       returns WHOLE ROWS — output undeclared
```

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

**Cut:** hot module replacement. The project compiler watches source and emits
JavaScript; `ket dev` watches only that emitted graph and restarts it. Source is
never handed to Node as an executable input.

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
found a stream table in its database. Framework tables now arrive with the runtime
that owns them: `ket_stream` on the first stream, `ket_idem` on the first
idempotency key, and `ket_job` when a queue producer or worker first prepares the
database. Queue preparation happens before user transactions so rolling back a
first enqueue cannot also roll back its system schema.

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

## D42 — Menus are declared in the module, and hidden by permission
**Where a menu lives.** Odoo keeps menus as rows: `ir.ui.menu`, created by XML data
files, edited in the database, surviving the code that put them there. That is why
an upgrade can leave an entry pointing at an action nobody ships any more, and why
"who put this here" is answered by an XML id rather than by a file.

Here a menu is `menus` on the module, beside `models`, `functions` and `joints` —
data in the manifest, so it arrives and leaves with the code that serves it, and
`ket check` can refuse a broken one at build time rather than at click time.

```ts
menus: {
  product: { label: 'menu.app', icon: '📦', sequence: 20 },
  'product.catalogue': { parent: 'product', label: 'menu.catalogue' },
  'product.templates': { parent: 'product.catalogue', label: 'menu.templates',
                         path: '/admin/products', needs: 'product.listTemplates' },
}
```

**Ids are global, like joint keys.** Two modules claiming one is `E_MENU_DUPLICATE`
naming both, not one of them quietly winning. Hanging an entry under somebody else's
needs the same declared dependency filling their joint would
(`E_MENU_NOT_DEPENDED`) — otherwise a module could rearrange a sidebar it never
admitted to knowing about.

**Three filters, in this order:** what the deployment shipped, what this database has
switched on (`restrictManifest` drops the entries of an uninstalled module), and what
this request may call. The last is `needs`, naming a function key. An entry the
viewer cannot use does not appear — the 401 arrives *instead of* the click, not
after it. A heading left with no children goes too: an empty section reads as
"broken", not as "not for you".

**`needs` on a module that is not in the build is a soft dependency, not an error.**
If the named module is installed and the function is missing, somebody mistyped and
hiding it would hide the mistake — `E_MENU_UNKNOWN_FUNCTION`. If the module is
absent, the entry is gated on something this deployment simply does not ship, and it
is dropped silently. That is what let `backend` gate its Pages entry on
`website.listPages` without depending on `website`.

**Cost and reversibility.** Menus can no longer be reordered by an administrator at
runtime, which Odoo allows; `sequence` is the only lever and it is in code. Cheap to
reverse — a database table read *after* the manifest would layer on top without
changing any of this. Deferred until somebody actually asks.

**What this replaced.** `product_backend` used to add its sidebar link by filling
`backend:nav.items` with a KTL string that re-implemented the active check. The
joint stays for genuinely arbitrary additions; a menu entry is no longer one.

## D43 — The URL is the list's state
**Which page, which search, which view — all in the query string.** No store, no
hook, no component that has to be told what page it is on. The consequences are the
point: the back button works, a bookmark works, and a link somebody pastes into chat
opens the same list they were looking at. None of that needed code.

Every applied control in the chrome is a link or a `method="get"` form. A custom
filter editor may use buttons and temporary draft state, but Apply must navigate to
a canonical URL before the table changes. The table never owns a second client-side
copy of search, filter, grouping, sorting, paging, or open-group state.

Filter and Group By tokens name only fields declared by a per-list allowlist. Same-group
preset filters are OR-ed, different groups are AND-ed, and a custom filter is a bounded
nested AND/OR tree. Group headers and their counts come from database grouping, not from
loading a page and grouping it in memory. Open paths and group pages are URL values, so an
expanded grouped list remains reloadable and shareable.

**What that cost, and where it bit.** A GET form replaces the whole query string, so
searching while looking at the cards threw you back to the list. The fix is
`keep` — the rest of the URL as hidden fields. Found by clicking, not by a test;
the test came after.

**Paging is on the function, not on a generic list endpoint.** `listTemplates` grew
`limit`, `offset` and `search`, and `countTemplates` appeared beside it — Odoo's
`search_read` / `search_count` pair, for the same reason: a page needs a total it
cannot compute from the page. Both are built from one shared query expression,
because a count that filters differently from the list it counts is the bug you find
on page four, not on page one.

**Controls that have nothing to say are not rendered.** No pager when everything fits
on one page. No view switcher when there is one view. No search box unless the list
can search. A toolbar full of dead controls teaches people to stop reading it.

**But an exhausted arrow stays, disabled.** That is the exception, and it is
deliberate: a pager that changes width as you page is a pager you cannot aim at.

**Deferred:** the "Mới" button. `ListChrome` carries `create` and the catalogue shows
it, but no live screen sets it, because no create screen exists yet. A button that
404s is worse than no button.

## D44 — Columns are data, and one bar holds the chrome
**A module says what its columns ARE.** Key, label, how to read one out of a row,
whether it is on by default. It does not write a `<table>`. Three things follow at
once: every list in the product has the same row height, the same sticky header and
the same overflow behaviour; a column can be turned off without touching markup; and
a module extending another module's list has something to name.

```ts
export const templateColumns = (_: Translator): Array<Column<TemplateRow>> => [
  { key: 'name', label: _('…col.name'), cell: (r) => r.name },
  { key: 'variants', label: _('…col.variants'), cell: (r) => String(r.variants), align: 'end' },
  { key: 'id', label: _('backend.table.id'), cell: (r) => html`<code>${r.id}</code>`, optional: true },
]
```

**An optional column that is off is absent from the HTML.** Not hidden by CSS —
hiding it would still ship the data to the browser, and a column a viewer cannot see
but can read in view-source is a column that leaked. Which ones are on lives in the
URL, like everything else about a list (D43), so a colleague can be sent the list
*with the id column showing*.

**The column menu is links, not checkboxes.** A checkbox needs a handler to mean
anything, and a handler is client state. Each entry is the same list with one column
more, or one fewer. Toggling one keeps the page you are on — showing another column
is not a new filter, so `withParam` grew a `resetPage` argument to say so.

**One bar, and no breadcrumb in it.** The chrome was a breadcrumb row under the
topbar at first, the way a lot of admin UIs do it. Two bars cost 3rem of every screen
to say what fits in one, and the title above and the breadcrumb below were the same
sentence twice — so they became one bar: title, then the search in the middle, then
the pager and view switcher.

Then the breadcrumb went entirely. The sidebar already says which app you are in and
which entry is open, in two places you are looking at anyway; a trail across the top
repeats both, and earns its line back only on screens nested deeper than this product
goes. Both corrections came from looking at the thing, not from planning it.

**Who you are moved to the foot of the sidebar,** with the counters for what is
waiting. In the topbar it competed with the title and the search for the one line
that changes on every screen; at the foot of the sidebar it sits with the one thing
that never changes. The counters are `Indicator` data plus a `sidebar.foot` joint —
the shell does not know what an activity is, so a module with a queue of anything
says so and it appears. A count of zero renders the icon with no number: a badge that
says nothing is a badge people stop reading.

**Three labels came out of the sidebar.** The active app was named at the top, again
as the highlighted row in the app list, and a third time above its menu; "ỨNG DỤNG"
labelled a column of application icons. Each cost a line of the one column that has
to hold forty menu entries, and the highlighting had already said it.

**A list runs to both edges of the pane.** The border, the radius and the drop
shadow were drawing a card around something that is not a card, and the reading
measure that suits prose is wrong for a table: the eye follows a row to a column that
is not there, and the space it was centred in was the space the row needed. Screens
that are read rather than scanned — the app grid, the settings list — keep the
measure, which is what `:has()` selects on.

**Tone, not colour.** `badge(label, 'positive')` rather than `data-published="true"`.
A design team that wants "draft" amber changes one rule and every draft in the product
follows. `data-value` carries the raw state as well, so a stylesheet can still be more
specific where it must be.

**Initials, not photographs.** Nothing stores an avatar image yet, and a broken image
in every row is worse than none. When images arrive this stays as the fallback, which
it would have had to be anyway. Vietnamese puts the given name last, so that is the
letter that comes first.

## D45 — The shell is ported from vidoo_backend_theme, icons included
**Why port rather than design.** KétViệt already runs an Odoo backend with a theme
the team built and uses daily — `vidoo_backend_theme`, 228px sidebar, no desktop
application bar, systray at the foot. A framework that ships a *different* good admin
gives the company two products to learn. So the sidebar here is that sidebar: the
same widths, the same 13px/500 rows, the same `--kv-*` palette the tokens were
already derived from, the same brand row, menu search, app list, section tree with a
rule down its left and a dot on each leaf, and the same footer.

**Icons are vendored, not installed.** Twelve Lucide glyphs (ISC) as strings in
`icons.ts`, which is what the Odoo theme does too. An icon set is data — a few
hundred bytes of path each — and taking a package for it would put a dependency, a
build step and a supply chain between this repo and twelve strings. `audit:zero-dep`
is not a slogan to work around; it is the reason a Ket app is one `node` away from
running.

`MenuDef.icon` therefore became a *name*, not a glyph. Every entry may name one: the
declaring module owns the semantic choice and the theme owns the drawing. An app
name this build does not carry falls back to a monogram; a nested entry falls back
to the existing dot. A module naming an icon we never vendored loses its icon, not
its row.

**A glyph with no size is the size of its container,** which the search icon
demonstrated at about 300px tall. `[data-ui="icon"]` now defaults to `1em`, and the
fixed boxes opt into filling.

**Two searches, and they are different things.** The one in the sidebar narrows the
menu; the one in the control panel narrows the list. Both are GET forms with their
state in the URL (D43), so a filtered sidebar is also a link. A filter that matches
nothing says so — the label and silence under it read as broken rather than as
"nothing here".

## D46 — Dynamic routes belong to the engine, not to website modules
**A parameter is one whole path segment.** `/products/{slug}` is a route;
`/products/product-{slug}` is not. Parameters use identifier names, may not repeat
inside one pattern, are URL-decoded once by the engine, and arrive as the third
argument of the route handler. Existing handlers that only need the URL and request
remain valid.

**Specificity, not registration order, chooses the route.** The pattern with more
static segments wins, so `/products/new` beats `/products/{slug}`. Two patterns that
can match the same pathname with the same specificity are a composition error. An
application must not change behaviour because two modules happened to be listed in
a different order.

**The rest of the route contract still applies.** A dynamic route belongs to its
module, disappears when that module is disabled, and is closed to strangers unless
it declares `anonymous: true`. Framework paths under `/_ket/` remain reserved.
Declared routes run before the theme page resolver, exactly as static routes already
did; the resolver is the fallback for paths no route owns. Website modules therefore
declare the public URL they own rather than teaching their own handlers to parse a
path the engine claimed not to understand.

## D47 — Durable jobs live with tenant data; notification is only a bell

**Chosen:** PostgreSQL or SQLite owns every job state. Redis is not required.
`LISTEN/NOTIFY` carries only the queue name and only shortens wake-up latency;
adaptive polling, due-time checks and expired-lease rescue are the correctness
path. PostgreSQL sends `pg_notify` on the enqueue transaction's reserved
connection, so rollback leaves neither business data, job nor notification.

**One app, two process roles.** `ket serve` and `ket worker` both start with
`bootRuntime`, compose the same `AppSpec` and register the same emitted module
artifact. Production runs them as separate processes; `ket dev --all` runs both
loops under the existing single source watcher. There is no second build watcher
and no execution of source TypeScript in production.

**Delivery is at least once.** A claim is a short transaction, the handler runs
outside it, and completion is another short transaction. A process can therefore
die after a business write and before completion; every job must explicitly state
`idempotent: true`. Leases, heartbeat and exponential full-jitter retry recover the
other crash positions. A handler receives an `AbortSignal`, but Node cannot
forcibly stop a Promise that ignores it. Heartbeat continues while that handler is
alive to avoid manufacturing an overlapping retry; if it eventually returns after
abort, the worker records a structured `handler_ignored_abort` warning.

**Scheduling is itself an effect.** A function or another job may enqueue only a
qualified job named by an `enqueue:module.job` effect. Composition checks that the
target exists and that the producer depends on its module; runtime checks the same
effect before a durable row is inserted. Otherwise asynchronous work would be a
way to bypass the model effects enforced on the request.

**Queue uniqueness coalesces active delivery, not business history.** A
`(job, unique_key)` constraint covers available, scheduled, executing and retryable
rows. Terminal rows release the key immediately, so whether the prune command ran
cannot decide whether new work executes. A handler that must apply a business
operation only once still enforces that invariant in business data.

Expired leases are rescued in bounded batches. Queue DDL uses explicit PostgreSQL
timestamp types, and legacy table migration is serialized by a transaction-scoped
PostgreSQL advisory lock so replicas may start concurrently without racing a
rename.

**Tenant fairness is scheduler state, not central queue state.** Jobs stay in each
tenant database so enqueue and business writes share one transaction. The worker
refreshes the tenant list, claims one bounded batch per turn and rotates the first
tenant. It does not reserve one PostgreSQL listener connection per tenant. If a
future fleet needs sub-100ms wake-up across thousands of databases, that is a
separate wake-up plane; durable ownership remains with the tenant database.
## D48 — Blob bytes are outside SQL; their authority is not

**Metadata and bytes have different jobs.** `storage.Attachment` is a
company-scoped row in each tenant database: ownership, target record, media type,
size, checksum and visibility remain queryable and transactional. The byte stream
lives behind one `Storage` contract on local disk or an S3-compatible service.
Putting large opaque bodies in SQL would make ordinary backups, replication and
table scans pay for data they cannot inspect.

**Tenant isolation is applied before a key reaches an adapter.** HTTP and worker
roles open the same configured storage and receive a namespace derived from the
resolved tenant key. A module never supplies that namespace, just as it never
supplies a database connection. Inside it, stored attachments are content
addressed by company and SHA-256; duplicate metadata rows share bytes safely.

**The contract streams.** `put` and `get` use async byte iterables. Local writes go
to a unique temporary file, sync, validate their declared length and rename into
place. S3 requests use Signature V4 with no SDK dependency; live MinIO tests cover
PUT, HEAD, GET, ListObjectsV2, presigned GET and DELETE. Multipart parsing is
bounded by total, part and header limits and keeps boundary fragments across
network chunks rather than buffering the upload in memory.

**A filename and media type are data, not trust.** Responses add `nosniff` and
force unknown or active content to `application/octet-stream` plus attachment
disposition. Only a small inline-safe set may use a short-lived S3 redirect. Public
download is a separately declared anonymous function that still passes through
company scope and the attachment's `public` predicate.

**Deletion is asynchronous and conservative.** Removing metadata does not delete
a content-addressed blob another row may share. `storage.sweep` runs on the durable
`maintenance` queue, lists only the captured company prefix and removes only
unreferenced objects older than a grace period. Its blob reads/removals are declared
effects, so adding storage to a job does not become a new way around the operation
boundary.

## D49 — Product and stock follow Odoo 19 where the subset is real
**Names and codes are compatibility boundaries.** UoM is a relative tree with one
root, product variants have a stable combination key, pricelist applicability keeps
Odoo's selection codes, and stock operations keep their warehouse and procurement
codes. Unsupported accounting, purchasing, selling and valuation behaviour returns
an explicit error; it is not approximated behind a familiar name.

**A reservation has one source of truth.** Demand belongs to `stock.Move`, reserved
detail belongs to `stock.MoveLine`, and `stock.Quant.reservedQuantity` is only a
query-friendly mirror. Updating that mirror uses compare-and-set, so two workers can
compete for the same quant without both winning. Inventory counts create completed
moves instead of rewriting a quant directly, preserving the trail that explains the
balance.

**Warehouse is a boundary, not a label.** Locations, quants, picking types and
warehouse routes determine which physical stock a flow may see. Forecast and
reservation operate on a requested location, while replenishment selects product,
category, then warehouse routes. Stock in one warehouse therefore cannot silently
satisfy another warehouse's move.

**Product media is metadata over storage, not a second blob system.** Product
screens retain the named template and variant media joints and the unavailable,
loading, ready and error states. The installed `product_media` bridge adds only
company-scoped ordering, alt text and primary-image metadata; bytes, checksums,
delivery and garbage collection stay with `storage.Attachment` and the `Storage`
contract from D48. Upload, primary selection, reordering and removal use native
forms, and the neutral UI component receives URLs and action endpoints instead of
depending on a schema or object-store convention. Product and stock still own no
blob column, resize pipeline, CDN rule or file-processing implementation.

## D50 — Module paths discover packages; they do not decide the deployment

**Chosen:** a workspace may declare several filesystem roots whose direct children
contain `ket.module.json`. An app selects a module by its declared name; resolution
loads that module and its dependency closure into the ordinary object-only
`AppSpec` before composition. Imported `KetModule` objects remain valid in the same
list, so existing workspaces need no migration.

**Why:** Odoo's `addons_path` makes private and vendor modules operationally easy
to place, but scanning a root and installing everything found are different
decisions. Ket keeps them different. A file appearing on disk makes a module
discoverable, not shipped; the workspace remains the reviewable statement of what
the deployment contains, and the database still only switches that build-time set
on or off.

**The fences:** roots are canonicalized, duplicate names across roots are errors
rather than order-dependent overrides, descriptor and executable identities must
match, and an entry may not escape its module directory. Discovery reads every
small descriptor but executes only selected modules. Production accepts emitted
JavaScript artifacts, preserving D6; TypeScript entries are admitted only through
the explicit development loader.

**Where it lives:** resolution is asynchronous and belongs between loading the
workspace and calling `composeWorkspace`. Composition, migrations, HTTP and workers
continue to know only `KetModule[]`. Module location therefore cannot become a
second registration mechanism or leak into business runtime code.

## D51 — Hospitality is two business modules, and language is not business data

The fourteen `vidoo_hospitality*` Odoo addons are a packaging history, not fourteen
bounded contexts. KetSuite consolidates property, content, rooms, reservations,
inventory restrictions, housekeeping, services and Vietnamese lodging operations
under `hospitality_core`; provider-neutral channel work and provider adapters live
under `hospitality_ota`. The public names carry no `vidoo_` prefix. Accounting and
legal e-invoicing remain outside both modules until their own contracts exist.

Operational codes are stable data. `available`, `out_of_order`, `hotel`,
`non_refundable` and their peers are stored and exchanged; labels are resolved by
the module catalogue. Every visible key and validation code ships in Vietnamese
and English from its first PR. Business names and authored descriptions remain the
user's data and are not copied into message catalogues.

A property is company-scoped and is itself the operational accommodation boundary.
Buildings, floors, room types and rooms repeat `propertyId` deliberately so every
write can prove the full structure belongs to one property before committing. The
database indexes enforce company and property uniqueness; APIs return translated
message keys for validation failures rather than embedding one locale in business
logic.

Hospitality screens are owned by the same module as their functions because the
agreed deployment has only two hospitality modules. They still compose the shared
KetSuite UI kit and write no private markup. Media remains `storage.Attachment`
metadata plus the storage backend; hospitality does not invent another binary
table or object-key convention.

## D52 — Reservation intent, physical stay and operational folio are separate records

A reservation is the commercial promise, a stay is the physical visit, and a
folio is the operational account for room and service charges. They are created in
one transaction but have independent state machines: cancelling before arrival
does not delete audit rows, checking in assigns a physical room, and checkout
closes the stay and folio. The `Charge` table is deliberately not an invoice or
accounting entry; accounting will consume this boundary in a later stack.

Room assignment history is append-only. Check-in claims a room with compare-and-set,
moving closes the current assignment and appends another, and checkout closes the
last assignment while marking the room dirty. A PostgreSQL benchmark opens two
connections against the same room and requires exactly one winner. SQLite keeps
the same transition contract for development but is only a single-writer target.

The tape chart reads stays and assignment history rather than becoming a second
availability source. Confirmed stays without a physical room have dedicated rows,
so overlapping unassigned bookings remain legible instead of painting over each
other. The browser acceptance path runs every hospitality route with seeded data
in Vietnamese and English, plus the calendar at a narrow viewport; this is part of
the feature definition, not a release-only visual pass.
## D53 — Collaboration keeps one polymorphic boundary and external I/O behind jobs

**A date is not a datetime with the clock hidden.** Activity deadlines and all-day
event boundaries use the `date` scalar and canonical `YYYY-MM-DD` values. SQLite
stores it as text and PostgreSQL as `DATE`; changesets, function/job inputs, layout
contracts, generated declarations and agent JSON schemas all retain that meaning.
Impossible and normalized dates such as `2026-02-30` are refused at every input
boundary rather than left for a database or timezone conversion to reinterpret.

**Record access stays with the record owner.** `mail.Thread` is the sole
`resModel/resId` boundary. Mail has no public generic function that accepts an
arbitrary model and id. Product, Stock and later business modules publish typed
joints; a bridge depending on both sides verifies the target row under its normal
company scope, then calls Mail operations while declaring both effect sets. The
small bridge cost is intentional: a reusable generic Chatter endpoint would be a
cross-domain record-rule bypass in a permission system whose unit is the function.

**The first message document is plain text.** Chatter and inbound bodies are stored
as text and escaped by the rendering layer. Odoo HTML is not copied into a trusted
backend surface before a sanitizer or restricted document format exists. Internal
notes exclude external followers; an external mention is rejected unless the UI
passes a confirmation that represents an explicit user decision.

**A delivery request is business data; `ket_job` is not.** Message, recipient
Notification and the later rendered Delivery snapshot commit with the enqueue.
The queue row owns attempts, leases and scheduling and may be pruned. A worker gets
an `OutboundTransport` from the deployment through `serve.openTransport`; the job
must declare `transport:send` before the provider sees anything. Provider secrets
therefore remain deployment secrets rather than plaintext company rows or module
globals.

Every send carries a stable idempotency key. The in-memory provider double proves
retry and provider-side deduplication, while the contract records whether a receipt
was deduplicated. This yields exactly-once external acceptance only for providers
that honor the key. Raw SMTP can reuse a stable RFC Message-ID but cannot close the
crash-after-acceptance window, so no UI or runbook may claim that it can.

## D54 — Inbound email enters through signed, concrete routes

**Anonymous does not mean unauthenticated.** Provider callbacks use a dedicated
`KET_WEBHOOK_SECRET`, not the session cookie key. The HMAC covers timestamp, path
and exact body bytes; a five-minute window rejects replay and binding the path stops
a valid reply callback from being replayed against an alias bridge. Only the route
may call the closed receive function without a session. The generic function HTTP
surface stays unavailable to strangers.

**Dedupe precedes business work.** A company-scoped `(provider, providerEventId)`
identity owns the receive attempt. The message, attachment metadata and event state
commit together. Repeating a callback returns the existing outcome, while provider
References resolve only through a recorded outbound provider message id. A supplied
but invalid reply token is terminal and never falls back to a guessed Reference.

**HTML is input, never a document.** A conservative converter removes active blocks
and tags and stores only plain text in Chatter. Inbound files pass the same upload
limit, content-addressed company key and `storage.Attachment` contract as browser
uploads. A blob written before a failed database transaction is an unreferenced
object and is collected by the storage sweep.

**Aliases are bridges, not model names.** Core Mail records alias configuration but
does not dynamically open a table or call a string-named model. The first concrete
`stock.receipt` bridge depends on Stock and Mail, validates a configured picking
type, creates one draft receipt, then posts to its ordinary Chatter thread. Unknown
or uninstalled bridges remain bounded diagnostics. A maintenance job prunes failed
diagnostics and expired token digests; processed provider identities remain compact
dedupe tombstones.

## D55 — Odoo collaboration cutover advances one explicit checkpoint

**Identity is a four-part fact, not an inherited integer.** The import map keys the
source database, Odoo model, source record id and explicit Ket target model. One
Odoo Calendar row may therefore map both to its typed `calendar.Event` and to the
`mail.Thread` authorized by the Calendar bridge without pretending those targets
are interchangeable. Generated target ids contain a database namespace and remain
stable across retries.

**A batch and its checkpoint are one transaction.** Snapshot/delta rows, maps,
issues, pending outbound jobs and the completed run commit before `lastCursor`
moves. Delta callers must present the exact previous cursor. A repeated run payload
returns its stored report; a different payload under the same run id is refused.
Unresolved partners, users and business targets stay visible as issues rather than
causing generic records to appear outside a domain owner.

**Migration is allowed to lose syntax, never meaning silently.** Chatter-like Odoo
HTML becomes plain text. Recurrence rules outside the supported Calendar contract
are errors. Legacy QWeb templates are disabled for review, sent mail is not queued
again, and secret-like alias defaults are stripped with warnings. Attachment bytes
are streamed and checksummed before their transactional metadata is imported; the
importer accepts only the same content-addressed company key used by Storage.

**Rollback does not reverse history.** Until cutover, Odoo is the writable source;
at freeze it remains an intact read-only fallback. The rollback manifest is a read
of imported targets, not a delete script. Once KetSuite has accepted writes, an
automated reverse merge would guess at business conflicts, so both sides must be
frozen and reconciled explicitly.

## D56 — OAuth belongs to KetSuite; provider policy belongs to the deployment

KetJS remains an application-neutral framework. Its signed sessions, actor,
function allow-list, transaction and compare-and-set primitives are enough for an
application to build identity, but the framework does not own issuer discovery,
external subjects or account provisioning. The open-source `oauth` and
`oauth_backend` modules live in KetSuite because they map verified identities into
`user.User`, company/branch context and KetSuite Role/Grant rows.

The protocol path is generic OpenID Connect Authorization Code with PKCE. Provider
configuration contains issuer, client id, exact callback, scopes, client auth
method and signature algorithm allow-list; there is no ZITADEL branch in protocol
code. ZITADEL organization binding, KétViệt tenant policy and provisioning
credentials remain deployment adapters. Keycloak, Auth0, Okta, Entra or another
conforming issuer use the same module.

An external identity is `(provider, issuer, subject)`, never email. State and nonce
are digest-only, the short-lived verifier is server-side, and claiming a callback
is single-use CAS before code exchange. ID tokens must pass signature, key,
algorithm, issuer, audience, authorized-party, nonce and time validation. Provider
claims cannot grant function permissions; they resolve one local User, after which
the existing live session and Role/Grant rules remain authoritative.

## D57 — Address catalogs are versioned, lazy reference data

KetSuite owns one `address` module, not one source module per country and not a
country registry inside KetJS. Bundled data is organized by ISO 3166-1 alpha-2 and
catalog version. The server reads no administrative dataset at boot: a small index
is opened on first discovery and complete chunks only on explicit installation.
Every manifest, policy and chunk is checksum-verified before a transaction can move
the country's single active-catalog pointer.

Country and Division are shared reference rows; a Partner address remains the
business-owned row. Company refers to the Partner that represents the legal entity
instead of copying address columns. Canonical addresses store the terminal Division
reference and derive the complete parent path. A policy declares required levels,
allowed kinds, postal-code validation and formatting, so a new country is data plus
policy rather than new application code.

Catalog rows are immutable after verification. New writes must resolve against the
active catalog, while business modules that freeze a document must retain an address
snapshot with catalog id, named division path and formatted lines. `DivisionTransition` records
explicit splits, merges and replacements when a future source provides them; the
system never guesses a replacement by string similarity. Catalog installation is
an internal function owned by a trusted administration route and uses unique
indexes, `insertIfAbsent` and CAS so concurrent pods converge.

## D58 — Hospitality services are intentions plus immutable occurrences

A service intention (`ExtraLine`) attaches one sellable Product variant to exactly
one reservation or physical stay. It snapshots the description, unit, quantity,
price and recurrence used by hotel operations. `once`, `per_night` and `per_unit`
are explicit policies: a night must fall inside the property-timezone occupancy
range, while each quantity-based post carries a caller request key. Every policy
produces a stable Charge source key, so a retry or two concurrent PostgreSQL
connections converge on one operational occurrence.

Posting a service and advancing the open Folio total share one transaction. Once
any occurrence exists, the intention cannot be repriced or retargeted; corrections
will be represented by later operational adjustments rather than rewriting audit
history. The Charge remains an operational folio record, not an accounting move or
invoice line. Those systems may consume the stable Product, UoM, ExtraLine and
Charge references later without changing the hotel source of truth.

Property fees are separate provider-visible content. Their create/update writes a
ContentChange in the same transaction so each private OTA connection can rebuild
its current payload independently. Storage is not involved: services and fees are
structured database records, while Storage continues to own only binary media.
