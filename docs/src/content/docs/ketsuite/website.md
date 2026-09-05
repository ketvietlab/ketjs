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

### The outbox, and its first consumer

WEB-014 asks for "CAS pointer + outbox atomic". The atomic half is already there and does not need a
table: `ctx.tx` hands its body a context bound to the transaction's own connection, and
`jobs.enqueue` queues through that context's adapter — so a job enqueued inside an activation would
commit with it, and an activation that loses the compare-and-set would queue nothing.

What is missing is a **consumer**. There is no cache to invalidate, no physical search index to
rebuild, and no delivery to make off the back of a publication. Enqueuing a job nobody handles would
be a mechanism pretending to be a feature, so nothing is queued today — and a test asserts that, so
adding one is a deliberate change rather than a silent one.

The search index is that consumer, and it sidesteps the dependency question rather than answering it:
`website` still cannot depend on `website_search`, so instead of being pushed at activation the index
notices on read that the active publication has changed. Nothing is enqueued, nothing is wired, and a
site that never searches never pays for an index.

A push would still be better for a large site, where the first search after a publication does the
catching up. That needs either a consumer `website` may depend on, or deployment wiring of the kind
`serve.pages.menuResolve` uses.

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

### Metadata that travels, and metadata that does not

A description, a canonical and a share image describe a particular revision of a page, so they are
frozen into the publication alongside the revision. Saving a new description used to rewrite what was
public immediately, with no publication involved at all; it now waits for the next one, while the
editor's own view shows what they saved.

`noindex` is deliberately **not** frozen. It is not a description of the page, it is an instruction to
stop showing it — and an instruction to stop should not wait for a publication to take effect. It is
read live in the head and in the sitemap alike, so a delist is immediate everywhere.

Because the SEO fields sit on the entry that `website` owns, they need no attachment: they are frozen
into the publication's own entry list, next to the revision they describe.

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

### Nothing goes live that cannot be drawn

`saveEntry` checked a layout against the sections that exist. Nothing else did.

That left five paths to live content taking the stored layout as given: `publishEntry`,
`preparePublication`, `activatePublication`, `rollbackPublication`, and the entry pointers those move.
So a page placing a section from a module the deployment has since dropped could be made live, and
`E_UNKNOWN_SECTION` would be raised in the renderer — at a visitor, as a five hundred, rather than at
the editor who could have fixed it. A publication makes it worse rather than better: it moves a whole
set at once, so one page referencing a vanished section takes every page in the set down with it.

**`publishEntry` refuses**, and the refusal carries the layout errors and the path, so an editor is
told which section rather than that something is wrong.

**`preparePublication` refuses and names the entry** — a caller publishing twenty pages needs to know
which one. It checks at prepare rather than at activate because prepare is where the caller can still
fix the page.

**`activatePublication` checks again**, because a deployment can drop a module between preparing and
activating and that is the moment content reaches visitors. It does not re-read the set: preparing
records `Publication.sectionTypes`, the distinct section types the frozen entries place, so the last
gate costs one pass over a handful of names. `rollbackPublication` carries that list forward, and
computes it where the base publication predates the column — otherwise rolling back to an older
publication would produce a set the gate has nothing to check.

**`restoreRevision` is deliberately not gated.** A restore makes a draft; it moves
`currentRevisionId` and never touches `publishedRevisionId`, so it does not change what a visitor
reads. Refusing it would trap an editor with a page they can neither recover nor repair — getting the
old content back is how the missing section gets replaced. The gate that matters still refuses to
publish it.

`website.preflightPublication` runs the same check without publishing anything. Given `entryIds` it
checks those; given none it checks every page on the site that is not in the bin, which is the
question an operator actually asks after a deployment changes. It answers `ok`, how many pages were
looked at, and the ones that would break with their errors.

An unnamed run reads a thousand pages and reports `capped` beyond that, and a capped run is **never**
`ok` however clean the pages it reached were: a partial scan cannot answer "is this site safe to
publish" with yes. Naming what it did find is still worth more than refusing to answer at all.

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

### Navigation that points somewhere

`validHref` checks the *shape* of a menu link — it starts with `/`, it has no backslash, no control
characters, no credentials — and stops there. Nothing ever asked whether the path names a page.

So a menu item could point at `/bang-gia` when no page serves that path, and the site's own navigation
walked a visitor into its own 404. Nobody noticed, because a menu item and the page it names are
edited on different screens on different days.

`website_menu.preflightMenu` answers it. An internal link is satisfied by a **published** page at that
path or by a route the deployment serves — `/robots.txt` and `/sitemap.xml` are links a menu may
legitimately carry and neither is an entry. A trailing slash, a query and a fragment all name the same
page.

**Published, not merely present.** A link to a draft is the harder version of the bug: it answers for
the editor, who is logged in and can see the draft, and 404s for everyone else.

**External links are left alone.** Whether another site answers is not a question this can ask, and
pretending to answer it would be worse than saying nothing.

It reports rather than refuses, and names every broken link rather than the first. A menu is built
alongside the pages it points at, so a link that does not resolve *yet* is an ordinary state of an
afternoon's work — the point is that nobody has to remember to look.

### Why this is not a gate on the publication

`preparePublication` refuses a page it cannot draw, and it would be natural to expect it to refuse a
publication whose navigation points outside the set it freezes. It cannot, and the reason is the shape
of the publication itself.

The frozen navigation lives in `Publication.attachments`, which is **opaque to `website` by design**:
`website_menu` depends on `website` and not the other way round, so the module that owns a key is the
only thing that reads it. Teaching `preparePublication` to read the menu attachment would invert the
dependency the whole publication design rests on — the same constraint that put the navigation in an
attachment rather than a column in the first place.

So the check lives in the module that owns the data, and the two preflights are run side by side
before preparing. That is honest about what it is: a thing you look at, not a thing that stops you.
Closing it properly needs a way for a module to register a check against a publication it contributes
an attachment to, which is a framework seam rather than a website change.

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

### The index

`website.searchPublished` reads every published entry of a site, fetches each revision, and matches in
JavaScript. That is correct and it does not scale: the cost of one keystroke grows with the site, and
the window that bounds it is also a ceiling on what can be found.

`website_search` keeps a `SearchDocument` per published entry and a `SearchIndexState` per site.
`searchIndexed` answers from it, and the box calls that instead of scanning.

The index is **derived data**. It never decides what is public — the publication does — so it is built
under the same gate the reader and the sitemap apply, and a test asserts that everything it offers is
a page `getEntryByPath` will serve.

**Staleness is by publication.** `SearchIndexState.publicationId` records which set the index was
built for; when that is no longer the active one, the index is behind. A search that finds it behind
runs a few build passes itself and then answers with what it has, reporting `stale: true`. A visitor
is never blocked on a full rebuild, and the caller is never told a partial count is final.

**Rebuilds resume.** A pass reads a bounded batch ordered by path and records the last path it
handled, so `reindexSite` can be called repeatedly — by an operator, or by the search itself — without
starting again or indexing anything twice. A rebuild for a different publication clears first, because
leftovers describe pages that may no longer be served.

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

### A form is only as live as the site under it

`getForm` and `submitForm` used to check `Form.active` and stop there. Deactivating a **site** — the
way a whole website is withdrawn — reached its pages and left every form on it answering and
accepting posts. Both now resolve `website.Site` and refuse unless the site is active too, which is
the case the check exists for: the page is already sitting in a visitor's browser, the site is gone,
and the submit button still worked.

### A submission is personal data with a lifetime

Everything below is one idea: the answers a visitor types have an owner, a shortest useful audience,
and an end. What existed before was a table that only grew, readable in full by anyone who could
arrange the site's menu.

**Working the queue does not mean reading it.** `listSubmissions` no longer carries `payload`. It
carries when a submission arrived, what state it is in, whether it is held, and `summary` — the
answers the form itself declares safe to preview, in `Form.summaryFields`. That list is empty by
default, and empty is workable: a queue that shows arrival and status can be triaged without showing
what anyone wrote. `Form.summaryFields` is deliberately **not** part of `schemaVersion`: marking a
field previewable changes nothing a visitor sees, and versioning it would invalidate every open page
for an internal decision. It is also applied as it stands now rather than as it stood at collection
time — someone who realises today that a field holds personal data expects yesterday's rows covered
by that realisation, not exempt from it. Naming a field the schema does not declare is refused at
save rather than dropped, because an editor who mistypes a name and sees an empty column concludes
the feature is broken.

**Opening one record is a separate, recorded act.** `readSubmission` returns the answers, requires
site administration rather than structure management, and files a row in `FormSubmissionAudit`. A
caller below the bar gets the same answer as a caller naming a row that does not exist, so the
refusal never confirms the row. `countSubmissions` exists beside `listSubmissions` for the same
reason `countSearchPublished` does: the list's output is a projection of submission rows and a total
is not one of them.

**An export names its fields.** There is no "export everything". `exportSubmissions` takes an explicit
field list, checks it against the form's own schema, caps the result and reports `capped` rather than
presenting a truncated file as the whole set — and writes exactly that field list and row count into
the audit. An export is the one operation that puts personal data somewhere this system can no longer
reach, so what it took has to be answerable later without guessing. The columns
the export carries beside the answers are spelled `_id`, `_createdAt` and `_status` — a form field
name must start with a letter, so an underscore is a key no form can ask for, and a form with a
question named "status" cannot overwrite the row's real state with a visitor's answer. The submit
route reserves `_schemaVersion` for the same reason.

**Retention runs on its own.** `Form.retentionDays` is a window in days; absent means kept, which is
the honest default — a form nobody has given a period has not been thought about, and erasing on a
number this module invented would destroy records nobody agreed to lose. `website_form.retentionSweep`
is scheduled `every: '24h'` rather than `dailyAt`, because an age in days has no opinion about what
time it is anywhere and naming a wall clock would force a timezone into a decision that has none. It
runs `crossCompany`, reads which companies have forms with a window, and hands each its own
`purgeExpired` job keyed on the day. Passes are bounded: a form switched to ninety days after two
years of collecting has a very large first pass, and a sweep that runs for an hour is a sweep that
gets killed halfway and retried from the start for ever.

**Erasure keeps the row.** A purge writes `payload: {}`, clears `source` and `fingerprint`, sets
`status: 'purged'` and stamps `purgedAt`. It does not delete. Deleting would take the consent record
with it — the one thing that says this person was asked and agreed — and would free `dedupeKey`, so a
client replaying a months-old request would be accepted a second time as new. What the visitor is
owed is that their answers stop existing, not that the fact they wrote to us is forgotten. Each row
is erased under a compare-and-set on `purgedAt`, so the scheduled sweep and an administrator pressing
the button cannot both count the same row, and one audit row is filed per pass rather than per
submission — which rows went is written on the rows themselves.

**A hold is a reason, not a flag.** `holdSubmission` keeps a row past its date and records why, so the
row says who is relying on it; a hold with no reason is indistinguishable from one nobody remembers
setting. Held rows are excluded in the retention query rather than skipped in the loop — filtered
afterwards they would still fill the batch, and a form with five hundred held rows would make every
pass do nothing and report nothing left. Releasing a hold returns the row to the ordinary queue
rather than erasing it on the spot: releasing is not a request to delete.

`FormSubmissionAudit` is append-only and separate from the submission it describes, because the point
of the record is that it survives the erasure of what it describes. It stays in `website_form` rather
than borrowing `user.SecurityAudit`: this is a record about site content, and reaching for the
identity model would drag a dependency on `user` behind it.

### The permission catalogue had a blind spot

`website_form` shipped in the production deployment with **no permission declaration at all** —
five functions, eleven after this change — and the coverage test could not see it. The check read
`Object.entries(manifest.functions).filter(([, fn]) => coveredModules.has(fn.by))` — so a module
absent from the catalogue removed its own functions from the set being checked, and the assertion
passed on what was left. Twenty-one modules were in that gap.

The test now checks owners first, against a named `UNGOVERNED` list. `website_form` and
`website_menu` are declared and off it; the remaining nineteen are written down. The list may only
shrink: adding a name is how that test stops meaning anything, and a new module that forgets its
declaration now fails the same way a new function does.

## A layout has identity

### Where the builder document lives, and why it is not a new table

The page builder design asks for a versioned document with stable node identity before anything else
is built, and asks that the model be reconciled against what exists rather than stood up beside it.
The reconciliation says: **the document is `EntryRevision.layout`, and no new table is needed.**

| What the builder needs | What already provides it |
| --- | --- |
| Immutable revisions | `EntryRevision` is one row per version, never updated |
| Optimistic concurrency | `saveEntry` takes `expectedRevisionId` and races the entry pointer |
| A frozen set at publish | `Publication.entries` freezes `{entryId, revisionId, path, meta}` |
| Content the theme renders | `pageScope.sections` is the layout, passed through untouched |

A parallel `BuilderDocument` table would need its own versioning, its own publication freeze, and its
own reconciliation with `Entry.status` and the preview token — three duplications of machinery that
already works, and three more places for the two to disagree about which content is live.

What was missing was never storage. It was **identity**.

### A placement that can be recognised again

A layout was an ordered array and nothing else. Save a page with the sections swapped, and the stored
revision cannot say whether a section moved or was deleted and a different one added in its place.
Nothing downstream can recover that from position: not undo, not a diff between two revisions, not a
conflict that explains itself. All three are in the builder design, and all three were unbuildable.

Every placement now carries an `id`, beside `type` rather than inside `settings` - it is not something
a section declares or a theme renders, and putting it in `settings` would collide with a real setting
and fail validation.

`saveEntry` assigns ids rather than trusting them, so content written before identity existed gains it
on its first save. An id that is already there is never replaced: identity belongs to the client
across an editing session, and rewriting it server-side would break the undo stack it anchors. The
same happens on `restoreRevision`, because a restore is a write like any other - putting an
unidentifiable layout back at the head would make every diff after it read as a rewrite.

**Derived from content, not from position.** Two placements of the same type with the same settings are
disambiguated by how many identical ones came before. Deriving from the index instead would mean the
first save after a reorder - exactly the save that turns legacy content into identified content -
renamed everything it touched, which is the one case the id exists to distinguish.

Two ids are refused at the write rather than resolved at the read: a malformed one, and the same one
used twice. A duplicate makes every later diff ambiguous, and there is no honest way to guess which
of the two a change belongs to.

### A diff, and a conflict that carries one

`website.diffRevisions` compares two revisions of one page and answers per placement: `added`,
`removed`, `moved` (with where it came from), `settings` (naming the fields), and `retyped`. Retyped
is separate because a placement whose type changed is a different section wearing the same id, and a
reviewer must never read that as an edit. Both revisions must belong to the entry the caller was
authorized against, so a revision id cannot become a way to read another page's history.

`identified` says whether the comparison had identity to work with. Placements written before this
change have no id and compare as removed plus added - the truthful answer, since without an id there
is no evidence the two are the same section, and guessing by position is the thing being replaced. A
client can use the flag to explain that rather than present it as a real rewrite.

A failed `expectedRevisionId` check used to answer "someone else saved this", which leaves the editor
to reload and find the difference by eye. The refusal now carries the diff between the revision the
caller was editing and the one at the head. The report is best effort and attached to a refusal that
already stands on its own: a revision that cannot be read produces a refusal with no report, never an
error in place of the refusal.

### A section can hold sections

A layout was a flat ordered list, so a page could place a hero and a paragraph but could never put two
things side by side. Every mock in the builder design shows nested structure, and there was nothing to
render it from.

A placement may now carry `slots`, keyed by the slot names its section declares:

```jsonc
// File: examples/website/nested-layout.json
{
  "type": "website.columns",
  "settings": { "gap": "wide" },
  "slots": {
    "left": [{ "type": "website.rich_text", "settings": { "body": "..." } }],
    "right": [{ "type": "website.hero", "settings": { "heading": "..." } }]
  }
}
```

**Named slots rather than one child list**, because a two-column section has two places to put things
and the page has to say which. A section that declares no slots holds nothing, which leaves every
section written before this exactly as closed as it was.

`SectionDef.slots` is the declaration:

| Field | Meaning |
| --- | --- |
| `accepts` | Section types this slot takes. Absent means any composed section - the honest default for a plain container, since the alternative is every container listing the whole catalogue and going stale as it grows. |
| `max` | How many children fit. |

`website.columns` is the first one: `left` and `right`, capped at twenty each. Both are capped because
a slot with no ceiling is a way to put a whole page inside one container and walk past the limit on
the page.

**What the write refuses**, all as a list rather than an exception, and each with a `path` like
`0.left.2` so an editor can focus the node: a slot the section never declared (silently dropping the
children would lose an author's work between the save and the render), a type the slot does not
accept, a slot over its `max`, a tree deeper than six levels, and an unknown section type - which is
now caught inside a slot exactly as it always was at the top.

**The page limit counts the tree.** The old ceiling was a hundred *top-level* placements, which after
nesting would have bounded nothing: a hundred containers each holding a hundred children would have
passed a check written to bound a page. It is now a hundred nodes anywhere in the document.

### Drawing the children

`{% slot "left" %}` inside a section's template renders what the placement put in that slot. It goes
through the same path as `{% sections %}`, so a nested section is rendered by the same template and
checked against the same manifest as a top-level one, and an unknown type raises in both places.

The renderer tracks the open placement on a stack rather than passing children through the scope.
Children are already-rendered markup, and a scope carries values a template may print: putting markup
where `{{ }}` can reach it would either escape it into visible tag soup or open a hole, and reserving
a scope name would collide with a section that wanted that name. Rendering is synchronous, so a stack
is exact.

An empty slot renders nothing rather than raising. A container with an empty column is an ordinary
state of a page being built, not a fault; a slot the section never declared is caught at the write,
which is where an author can still do something about it. `{% slot %}` is refused in report mode, the
same way `{% sections %}` is - a printed report has no page tree to draw children from.

### Identity and diffs go all the way down

`withPlacementIds` walks the tree, so a child gets an id the same way a top-level section does, and
uniqueness is checked across the whole document rather than per level - a diff keyed on id has no
level to disambiguate with. A container's derived id folds in its children's ids, so two containers
holding different things are different containers even when their own settings match.

`diffPlacements` walks the tree too. This matters more than it sounds: comparing only the top level
would have folded a subtree edit into "the container's settings are unchanged" and reported nothing at
all. A change six levels down is now reported on the node that changed.

Every change carries a `path`, and `moved` carries the path it came from. That is what makes dragging
a section from one column to the other read as **one move** rather than as a removal in one place and
an arrival in another.

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
