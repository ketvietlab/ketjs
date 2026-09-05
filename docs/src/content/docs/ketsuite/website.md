---
title: Website
description: KetSuite Website modules, the site and publication model, and the public SEO projection.
---

# Website

KetSuite Website is the public content surface: sites, domains, pages and posts, revisions and
publication, media, menus, forms, and the customer account that goes with them. Business facts stay
with the domain that owns them — price and stock in Sale and Stock, stays in Hospitality, cases in
CRM — and Website composes them through optional bridge modules.

## Modules

- `website`: sites, domains, site membership, entries and revisions, taxonomy, media metadata,
  redirects, preview tokens, and the customer realm.
- `website_backend`: the administration surface. Auto-installs once `backend` is present.
- `website_menu`: navigation items a theme can place.
- `website_seo`: per-entry metadata, and the public `robots.txt` and `sitemap.xml` projection.
- `website_search`: the search box a theme can place, over published entries.
- `website_form`: versioned public forms and their submissions.
- `website_form_mail`: optional bridge that tells a form's owner a request arrived.
- `website_retail`, `website_hospitality`, `crm_website`: optional bridges to the owning domain.

## Publishing a set

`publishEntry` flips one entry's pointer the moment someone presses the button on it, so a set of
related changes reaches visitors piecemeal — a page whose menu link is not there yet, or a link to a
page that is not published. A **publication** freezes which revision of which entry goes out, and
activating it moves all of them or none.

```ts
// File: examples/website/publish.ts
await ctx.call('website.preparePublication', {
  id: 'pub-2026-09-05',
  siteId: 'moc',
  entryIds: ['gioi-thieu', 'chuyen-ben-am-tra'],
})
// Nothing is public yet — a prepared publication is a proposal.
await ctx.call('website.activatePublication', {
  id: 'pub-2026-09-05',
  expectedPublicationId: '', // what was active when the reviewer looked
})
```

Both paths stay. A site that publishes one page at a time is not doing anything wrong, and this does
not take that away.

### What else goes out with the pages

A publication carries an `attachments` bag keyed by module name, and `website` does not read it. The
navigation has to be able to go out with the pages it points at — otherwise a link appears before the
page it points at, or a page arrives with no way to reach it — but `website_menu` depends on
`website`, not the other way round. So the slot is opaque, and the module that owns a key is the only
thing that reads it.

```ts
// File: examples/website/publish-with-menu.ts
const menu = await ctx.call('website_menu.snapshotMenu', { siteId: 'moc' })
await ctx.call('website.preparePublication', {
  id: 'pub-2026-09-05',
  siteId: 'moc',
  entryIds: ['gioi-thieu'],
  attachments: { website_menu: menu },
})
```

`website_menu.publicMenu` then reads the frozen navigation while that publication is active, and an
edit made afterwards stays in the editor's view until the next publication carries it out. A site that
has never prepared a publication reads live rows, which is what every site did before publications
existed.

Attachments are part of the content hash, so the same pages with a different menu is a different
publication rather than a replay.

### The site pointer is the concurrency token

Activation moves `Site.activePublicationId` under compare-and-set **before** it touches any entry.
Two activations that both started from the same base would otherwise each believe they replaced the
other, and the entry pointers would end up a mix of the two. The loser gets
`website.error.publicationStaleBase` and has run nothing.

Pass `expectedPublicationId` to say which base the reviewer was looking at; omit it to accept whatever
is current.

### What a publication refuses, and how

Preparing names the entry in every refusal — a caller publishing twenty pages needs to know which one
is the problem, not that "an entry" was wrong. An entry outside the site, in the trash, or without a
current revision stops the whole prepare, and nothing is written.

Preparing the same set twice under the same id returns what was prepared; the set is identified by a
hash over `entryId:revisionId`, so ordering is not identity. The same id for a *different* set is
`website.error.publicationConflict`. Replaying an activation is not an error — it already happened.

### Rollback is a publication

Going back prepares the previous set again rather than undoing. The history stays, and the entries go
through the same activation the forward direction does — so a page trashed since it was last public
does not come back by the side door.

## SEO and the public projection

`website_seo` adds four optional fields to an entry it does not own — `metaDescription`, `canonical`,
`noindex` and `ogImage` — and declares the `website:page.head` fill that would render them. Because
the module declares the fields, it also owns writing them: `website.saveEntry` deliberately does not,
so SEO validation does not end up inside the content module.

The head metadata travels with the page it describes: `website.getEntryByPath` returns a `meta`
object and the storefront hands it to the theme, which is what the `website:page.head` fill
interpolates. `meta` carries an **allowlist** — `metaDescription`, `canonical`, `noindex`, `ogImage` —
rather than the row, because a theme is untrusted presentation and modules extend `website.Entry` for
their own purposes. A field that was never set is absent rather than sent as null.

```ts
// File: examples/website/seo.ts
await ctx.call('website_seo.saveEntrySeo', {
  entryId: 'entry-1',
  metaDescription: 'Trà và gốm thủ công.',
  canonical: '/gioi-thieu',
  noindex: false,
})
```

### Every field is a partial update

`saveEntrySeo` writes only the fields the caller passed. Writing all four on every call meant that
setting `noindex` erased the description — and, in the direction that matters, that editing a
description silently cleared `noindex` and re-listed a page someone had deliberately delisted. Pass
an explicit `null` to clear a field.

### A canonical may only point back at its own site

`canonical` accepts a site-relative path, or an absolute URL whose host is one of that site's own
domains. Anything else is refused as a validation error rather than stored: a canonical naming a
foreign host hands the site's ranking to whoever owns that host, which is a permission decision.
A protocol-relative value such as `//other.example/x` reads as a path and is not one, so it is
refused as well — and so are `/\other.example/x` and a value with an interior tab, CR or LF, because a
browser normalises a backslash to a slash for http(s) and strips those control characters before
parsing. Testing for a leading `//` alone let all of them through. Credentials in an absolute
canonical are refused rather than published.

### Reserved namespaces

The reserved namespaces are **derived from the composed manifest**, not hardcoded: the first segment
of every registered route, plus `/api` and `/internal/v1`, which are reserved as families rather than
registered as single paths. A hardcoded list drifts from the routes that actually answer — a page
published at `/login` would be advertised in the sitemap while the `user` module serves that path.

The comparison is per path segment: `/administrative-notes` is an ordinary page that merely begins
with the same letters as `/admin`, and delisting it would quietly remove real content. Because
`robots.txt` itself matches by character prefix, each namespace is emitted as both a subtree rule and
an anchored exact rule.

### Two public files

| Path | Behaviour |
| --- | --- |
| `/robots.txt` | Disallows the reserved namespaces and points at the sitemap. A host that resolves to no site — including the synthetic `__legacy__` site `resolveSite` returns while a company has no active site at all — disallows everything, so content being prepared is not discovered first. |
| `/sitemap.xml` | Lists the published entries of the site that owns the request host. Returns 404 when the host resolves to no site. |

Both answer in the origin the request arrived on. Naming a different canonical host would contradict
the domain the site actually answers.

### The sitemap filter is the publication

An entry appears in the sitemap when its site is **active**, it has a published revision, it is not
in trash, it is not marked `noindex`, and it does not sit under a reserved namespace. There is no
separate sitemap switch to keep in step: unpublishing a page or marking it `noindex` removes it from
the sitemap by the same act.

The publication filter is part of the query rather than applied after it. Applied as a plain row
limit over a path ordering, a site with enough drafts sorting before its published pages returned an
empty sitemap while those pages existed.

`sitemapEntries` is `exposure: 'internal'`. The two public files are the entry point and they resolve
the site from the request host; left directly callable, an anonymous caller could name any site in
the company and read the published paths of a site that is not being served yet.

## Navigation menus

`website_menu` holds one tree of items per site. The tree carries the same integrity contract as the
taxonomy tree in `website`, because an editor who can build one expects the other to behave the same
way.

- **No cycles.** Reparenting walks the ancestor chain, not just the immediate parent. Making A a child
  of B and then B a child of A is refused with `website_menu.error.menuCycle`; previously only
  self-parenting was caught, and the loop surfaced in whatever tried to render the tree.
- **Bounded depth.** An item may have at most 100 ancestors, which also bounds the walk.
- **No orphans.** Deleting an item that still has children is refused with
  `website_menu.error.menuInUse`, mirroring `website.deleteTerm`. Remove or reparent the children
  first; the alternative — silently rehoming a subtree — moves content the editor cannot see.

A parent belonging to a different site remains `website.error.invalidParent`.

### Navigation has to reach the page

A theme draws `{% for item in menu %}`. Nothing ever put a menu in that scope, so every public page
rendered an empty nav — the items were stored, editable, and invisible.

Navigation belongs to the site rather than to the page, so it is resolved beside it:
`serve.pages.menuResolve` names the function, the way `siteResolve` and `resolve` already do, and its
answer reaches the theme as `menu`. The framework names no module; the deployment points it at
`website_menu.publicMenu`, and a deployment that names a function no composed module declares fails at
boot rather than rendering a blank nav.

`publicMenu` is separate from `listMenu` rather than a loosening of it. `listMenu` is the editor's
view, scoped by site membership, and a visitor has no membership to scope by. The public one answers
only for a site that is actually being served — the same gate the sitemap and public search apply —
and returns only what a theme needs to draw a link.

### Pre-existing damage is not this edit's problem

Only the parent the caller named is validated. The rest of the chain is walked for one reason: to see
whether *this* edit would close a loop back to *this* item.

That distinction matters because menus can already hold broken chains — the delete this module used
to allow orphaned children. Validating the whole stored chain would refuse an edit two levels below
the damage, report `parentId` as invalid while naming a parent that is perfectly fine, and point at
nothing that needs repair. A chain that is already broken, or already looping above, cannot close a
loop through this item either, so the walk stops rather than refusing. Existing orphans are therefore
harmless, and the delete guard stops new ones appearing.

## Telling an operator a request arrived

`mail_transport` already owns the outbox — `Delivery`, retry, dead-letter, provider events — so
`website_form` keeps no delivery state of its own and no second ledger appears. `website_form_mail` is
only the bridge, and `website_form_mail.notifySubmission` queues one notification per submission,
keyed by the submission id so a retry sends nothing new.

### The notification carries nothing the visitor wrote

The mail says which form, on which site, when, and where to open it. That is a deliberate boundary,
not a default nobody chose:

- **A `Delivery` stores an immutable body snapshot.** Mailing the payload would persist contact data a
  second time, in another module, in a row that cannot be edited or purged — while the submission
  itself is under a retention policy that promises exactly that. The purge gate could never close.
- **`Form.notifyTo` is checked for the shape of an email address and nothing else.** Anyone who may
  edit a form may point it anywhere. With a bare notification, doing so leaks that a form was
  submitted; with the payload, it is a standing export of everyone's contact details.
- **The consent notice does not mention an email copy**, and under the versioning contract above,
  changing it to say so would invalidate every page currently open.

Two independent guards hold the line. The bridge builds its context **from** an allowlist rather than
filtering a record **into** one — `SAFE_KEYS` is `siteTitle`, `formName`, `submissionId`, `receivedAt`
and `adminUrl` — so a field added to a form tomorrow cannot appear. And `mail_transport` refuses to
save a template that references a key outside its own allowlist, before any mail can be queued
against it.

Widening this later is additive: a template may ask for more once `SAFE_KEYS` grows. Narrowing it is
not — mail that has been sent cannot be recalled from a mailbox, a forward, or a provider's storage.

### Triggering is explicit

`notifySubmission` takes the `submissionId`, the `templateId` and the `baseUrl` the link is built
from, the same shape `calendar_mail_transport.sendInvitations` uses. It is not called from
`submitForm`: `website_form` must not depend on `mail_transport`, and the framework has no commit hook
that would let the bridge observe a write without that dependency. Outbox administration also
requires a signed-in user, which an anonymous submission does not have.

## Public site search

`website.searchPublished` matches a term against the **published** title and excerpt of each entry.
Those live on the revision rather than the entry, so a draft title is never searchable and a result
always shows what a visitor would actually see.

- The publication filter is part of the query. Unpublished entries used to be fetched and discarded,
  spending the scan window before the published ones were reached.
- Revisions are read in one batch keyed by id, projected to the four fields the match and the result
  use. The previous shape issued one query per candidate entry; reading whole rows instead would make
  one anonymous request for a single result cost hundreds of megabytes, because a revision also
  carries `layout` and `fields` — half a megabyte each at what `saveEntry` allows.
- `countSearchPublished` returns the total behind the pages, plus `capped`, which says the scan
  window was full and the count should not be presented as a final total. The scan reads one row past
  the window, so a site with exactly that many entries is reported as complete rather than capped.
- A site that is not active has no public search, the same rule the sitemap follows.
- Pages under a reserved namespace are not offered, for the same reason the sitemap omits them: a
  module route answers that path first, so the result would not open.

### The box renders its own results

The box used to submit to a hardcoded `/tim-kiem`. No module route serves that path and no page had to
exist there, so a visitor who searched landed on a 404 — the query layer was complete and unreachable.

It now submits nowhere and renders results in place. That is not a shortcut: the query lives in the
URL, and a page resolver is handed a path rather than a query string, so **no server-rendered surface
can see it**. A results page would need either a framework change to widen the resolver contract for
every deployment, or a theme template placing an island — which would make every website theme depend
on `website_search` for one optional section. Rendering next to the box costs neither.

The browser half calls `website.resolveSite`, `website.searchPublished` and
`website.countSearchPublished` — the same anonymous functions the sitemap and the public reader are
held to, so anything it offers is a page the reader will serve. It applies the same two-character
floor `searchPublished` applies, rather than spending a round trip to be told nothing, and it keeps
`?q=` in the URL so a search can be linked and reloaded.

### The three public views agree

The sitemap, the site's own search and `getEntryByPath` — the reader that actually serves a page —
apply the same publication gate: a published revision, not in trash, on an active site. Search and
the sitemap add the reserved-namespace rule, which `website` owns in `paths.ts` precisely so all
three read one definition rather than three copies that drift.

The invariant is that anything offered is openable. `getEntryByPath` previously had no active-site
check, so a caller naming a site being prepared could read it a page at a time while both listings
refused to name it; it now closes with them.

Search deliberately does **not** honour `noindex`. That is a crawler directive about a public index,
not a visibility rule: a page a visitor can open by URL is a page a visitor may find in the site's own
search box.

## Public forms and their schema version

A form's field contract is versioned. `Form.schemaVersion` is bumped whenever the fields change and
left alone when they do not, so fixing a typo in the success message does not invalidate every form
page a visitor currently has open. The comparison is over a canonical rendering of the schema, so
re-saving the same fields with the keys in a different order is recognised as the same contract.

`getForm` returns the version, the rendered page echoes it back on submit, and `submitForm` compares:

```ts
// File: examples/website/form-submit.ts
const form = await ctx.call('website_form.getForm', { id: 'contact' })
// ...render the page, carrying form.schemaVersion as a hidden input...
await ctx.call('website_form.submitForm', {
  formId: 'contact',
  payload: { email: 'mai@example.test' },
  schemaVersion: form.schemaVersion,
})
```

`listForms` reports the same version `getForm` does, so an admin surface seeding a version from the
list cannot emit an empty value that the route would read as "no version declared".

A mismatch is refused once, plainly, with `website_form.error.staleForm` and HTTP **409** — not 422.
Nothing is wrong with what the visitor typed; the form they typed it into moved, so the client should
reload rather than ask them to edit. Validating a stale payload against the current schema instead
would report a field the visitor was never shown as missing, and blame them for it. A refused stale
submission does not consume the visitor's rate budget.

Over HTTP the hidden input is named **`_schemaVersion`**, not `schemaVersion`. A form field name must
start with a letter, so a leading underscore is a name no form can declare. Reserving the bare name
would have made a form that *asks* a `schemaVersion` question answer 409 for ever: its answer stripped
from the payload and reparsed as a contract number.

Saves race on the version, because the version is the concurrency token. Two editors who both read
version 1 and both compute 2 would otherwise publish two different contracts under one number — and
the staleness check would then certify a stale payload as current, which is the very thing it exists
to prevent. The loser gets `website_form.error.saveConflict` and reloads.

The check is opt-in by the page: a client that sends no version keeps the previous behaviour. Either
way the accepted submission records `FormSubmission.schemaVersion`, so an operator reading an old
submission knows which contract its fields meant. Forms that existed before versioning read as
version 1.

### Consent belongs to the same contract

`FormSubmission.consent` is a boolean: on its own it records that somebody ticked a box, not which
text they agreed to. When the privacy notice changes, every earlier consent is silently reinterpreted
as agreement to the new wording.

So the notice lives on the form as `consentText` and is part of the **same** version as the fields.
Changing it advances `schemaVersion`, which means a page open against the old notice is refused with
`staleForm` exactly the way a page open against old fields is — agreement to a notice that has been
replaced is not agreement to its replacement. One version rather than two is the point: two could
disagree, and then no single number would say what a stored submission meant.

The accepted submission stores the notice **verbatim** in `FormSubmission.consentText`. A `Form` is
one mutable row with no history, so the version number alone could never be resolved back to the
older text once the notice is edited — and a consent record that cannot say what was consented to is
not a record.

Three rules follow, and they apply only to a form that actually shows a notice:

| Rule | Error |
| --- | --- |
| A submission must carry agreement. | `consentRequired` (422) |
| A submission must say which notice it saw. Stamping an unversioned post with the version in force would manufacture agreement to a notice the visitor may never have seen — so no version means no truthful record, and no write. | `consentVersionRequired` (409) |
| A save that omits `consentText` leaves the stored notice alone. A full replacement row meant any writer without that field — including the admin form editor, which has none — silently wiped the notice and disarmed the gate. An explicit `null` still clears it. | — |

A form with no notice is unaffected, including the lenient unversioned submit.

Over HTTP the consent box is read as agreement for `on`, `true`, `yes` or `1`. A checked
`<input type="checkbox" name="consent">` with no `value` attribute posts `on` — the HTML default —
so accepting only `true`/`1` told a visitor who had ticked the box that they must agree.

## The storefront page scope

`packages/ketjs/src/server/boot.ts` builds the scope a theme renders a public page against: `site`,
`locale`, `page`, `meta` and `sections`. Joint fills and island props are projected from that scope,
so anything a module wants on a public page has to be in it.

`meta` used to be hardcoded to `{}`, which silently disabled the head tags. It now passes through
whatever the page resolver returns. The framework does not name the fields — the module that owns
them decides what is public — so this closed the SEO half without teaching `boot.ts` about
`website_seo`.

The search box still shows its fallback label, because `label` is a prop and props are projected from
that scope. That is cosmetic; the box itself now works (see below).

## Testing

```bash
# Run from: repository root
npm run build --silent && node --test .build/test/website-seo.test.js
```

`test/website-seo.test.ts` covers the projection rules as pure functions and the write path against a
SQLite adapter, including cross-site isolation and the refusal of a foreign canonical.
