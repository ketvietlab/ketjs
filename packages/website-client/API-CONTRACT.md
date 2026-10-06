# Website Studio browser contract

The Studio is a client-rendered island. Current client calls are in `client/api.ts` and the host
implementation is in KetSuite's `modules/website_backend`. The former Website Atlas mock
(`atlas/store.mjs`) and its `test/store.test.mjs` are no longer in this package. Historical fixture
sections below describe design proposals, not callable host routes.

This is a design contract, not a record of production. Each function carries a status:

| Status  | Meaning                                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------- |
| Real    | Exists in KetSuite (`modules/website*`) with a compatible input. The mock output may be a subset.          |
| Real Δ  | The name exists, but input or output differs. The listed differences must be closed before binding.     |
| NEW     | Proposed. Nothing in KetSuite answers it yet.                                                             |
| Pro     | Answered only when the Website Pro server extension is installed (UNLICENSED, private).                  |

Never bind a client call to a real function marked Real Δ without closing every listed difference, either
in the function or in a named adapter. Do not rename a Real function in the mock: the mock follows the
real names, not the other way round.

## Transport

- Same-origin credentials, JSON input, the Ket outer envelope `{ ok, value }`.
- A refusal is `{ ok: true, value: { ok: false, errors: [{ code, message, fields }] } }`. The client keeps
  `code` and `fields`; `message` is shown only when no extension maps the code to a message key.
- Reads take an `AbortSignal`; a late reply for an old route is discarded.
- Writes that create something send an `idempotency-key` header. The key is the id the client generated
  for the new record (`newId(prefix)`), so a retry after a network error cannot create twice. A replayed
  key returns the first reply unchanged, even if the input changed.
- Network failure is `code: 'unknown'`, not a refusal: the write may have happened.

Error codes the client understands: `forbidden`, `notFound`, `conflict`, `validation`, `unavailable`,
`unknown`, `response`, `http.<status>`. Extensions add their own through `errors` (see EXTENSIONS.md).

## Capabilities

`website_studio.bootstrap` returns `actor.capabilities`. The Studio hides actions the actor cannot
perform; the server checks again on every call.

| Capability             | Edition | Allows                                            |
| ---------------------- | ------- | ------------------------------------------------- |
| `website.content.write` | Core    | Create and edit pages and posts |
| `website.publish`      | Core    | Publish or schedule the current page/post               |
| `website.site.manage`  | Core    | Site settings and domains                   |
| `website.form.manage`  | Core    | Create, edit and archive forms                    |
| `website.submission.manage` | Core | Open, hold and export submissions          |
| `website.analytics.read` | Pro   | Analytics screen and the overview card            |
| `website.portfolio.read` | Pro   | The company-wide site list                        |

KetSuite's permission catalogue speaks in `read`/`configure`/`security` grants per function. The host maps
those grants to these capability names when it builds the bootstrap; the client never sees grants.

## Studio BFF (`website_studio.*`, NEW)

Screen-shaped reads that combine several core reads. They exist so one screen costs one request and
its states come from one snapshot. They never write.

### `website_studio.bootstrap`, input `{ site }`

`site` is the requested site id from the URL, or `null`. The server picks the first site the actor may
see when it is missing or not allowed.

```js
{
  actor: { id, name, role, capabilities: string[] },
  site: { id, name, host, defaultLocale, locales: string[], revisionId },
  sites: [{ id, name, host }],          // every site the actor may open; the topbar switch lists them
  offer: { title, message, label, href } | null, // edition offer; only Settings shows it
  home: string,                          // KétSuite URL the account menu returns to
}
```

`offer` is decided by the server from the tenant's edition. A Pro tenant gets `null`. The client never
decides its own edition.

### `website_studio.overview`, input `{ siteId }`

```js
{
  counts: { pages, changed, newSubmissions, issues },
  live: { id, state, activatedAt, activatedBy, entryCount } | null,
  queue: EntryRow[],                     // entries whose draft differs from the live publication
  submissions: (SubmissionRow & { formTitle })[], // newest five with status `new`
}
```

## Content (`website.*`)

`EntryRow = { id, type, title, path, locale, state, updatedAt, updatedBy }`, where `state` is one of
`draft`, `published`, `changed`, `trash`.

| Function              | Status | Input (mock)                                                            | Output (mock)                              |
| --------------------- | ------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| `website.listEntries` | Real Δ | `{ siteId, type, status, search }`                                      | `{ rows: EntryRow[] }`                     |
| `website.getEntry`    | Real Δ | `{ id }`                                                                | `{ entry, sections }`                      |
| `website.saveEntry`   | Real   | `{ id, siteId, type, slug, path, title, locale?, layout, expectedRevisionId }` | `{ id, revisionId }`                |

- `website.listEntries`: the real function returns a bare array and knows `draft`, `published`,
  `scheduled` and `trash`. The Studio needs `changed` (published, with a newer draft) and the filter
  value `all`. Close by adding `changed` to the real status projection and wrapping rows, or read through
  a BFF. It has no `updatedBy` or `locale` in its output today.
- `website.getEntry`: the real function returns `{ entry, revision }`. The Studio also needs the section
  catalog `sections: { [type]: { title, settings } }` of the site's theme, and `entry.state`.
- `website.saveEntry`: a new entry sends `expectedRevisionId: null`; an existing one sends the revision it
  loaded. A mismatch is `conflict`; the client keeps the draft and offers a reload.

## Per-entry publishing (Real Δ)

- `website.publishEntry` takes `{ id, expectedRevisionId, publishAt?: string | null }` and returns
  `{ id, revisionId, publishAt, scheduledRevisionId }`. Null/absent means publish now; a future ISO
  instant schedules the exact current revision. Requires `website.publish`, validates the entry and
  refuses stale revisions. Other entries keep their public revision. Repeating the same immediate
  publish does not create a second result.
- `website.cancelScheduledEntry` takes `{ id, expectedRevisionId, expectedScheduledRevisionId }`.
  Both the draft and the selected schedule must still match. Cancellation never removes public content.
- Production scheduling belongs to the Website worker. The fixture uses its injected clock and runs
  due jobs before a request; there is no simulation action in the UI. New drafts do not replace a
  scheduled revision. Failures keep the schedule and report the reason in that entry editor.
- Removed from the mock transport: prepare/list/review/activate/rollback publication APIs, site-wide
  preparation, publication calendar/schedule APIs and Pro approval APIs. No client calls them.

## Forms (`website_form.*`)

`SubmissionRow = { id, formId, status: 'new' | 'read' | 'held', summary, excerpt, createdAt }`.

| Function                         | Status | Input (mock)                              | Output (mock)                                      |
| -------------------------------- | ------ | ----------------------------------------- | -------------------------------------------------- |
| `website_form.listForms`         | Real Δ | `{ siteId }`                              | `{ rows: [{ id, title, active, newCount, total, lastAt }] }` |
| `website_form.getForm`           | NEW    | `{ id }`                                  | `{ id, siteId, title, active, retentionDays }`     |
| `website_form.listSubmissions`   | Real Δ | `{ formId, status, limit, offset }`       | `{ rows: SubmissionRow[], total }`                 |
| `website_form.readSubmission`    | Real   | `{ id }`                                  | `{ id, fields }`                                   |
| `website_form.holdSubmission`    | Real   | `{ id, reason }`                          | `{ id }`                                           |
| `website_form.exportSubmissions` | Real Δ | `{ formId }`                              | `{ filename, content }` (CSV, UTF-8 with BOM)      |
| `website_form.retryDelivery`     | NEW    | `{ siteId, id }`                          | `{ ok, state: 'pending' }`                         |

- `website_form.listForms`: the real rows carry the form definition (`name`, `schema`, …) but no counts.
  The Studio shows new/total counts and the last submission time.
- `website_form.getForm`: the submissions screen needs one form's title. The real module has no single
  read; add one rather than filtering `listForms` in the browser.
- `website_form.listSubmissions`: the real function returns a bare array; the Studio needs `total` for the
  result footer.
- `website_form.readSubmission` marks a `new` submission `read`. The real function records `reason` for
  its audit; the Studio sends none yet.
- `website_form.exportSubmissions`: the real function takes `fields` and returns rows. The Studio needs a
  file. Close with a server-side CSV writer, not by building CSV in the browser from a capped read.

## Site settings (`website.*`)

| Function                  | Status | Input (mock)                                    | Output (mock)          |
| ------------------------- | ------ | ----------------------------------------------- | ---------------------- |
| `website.listDomains`     | Real Δ | `{ siteId }`                                    | `{ rows: [{ id, siteId, host, role, state }] }` |
| `website.saveSite`        | Real Δ | `{ id, name, defaultLocale, expectedRevisionId }` | `{ id, revisionId }` |

- `website.listDomains` returns a bare array; the fixture wraps it in rows.
- `website.saveSite`: the real input also requires `title` and `theme` and has no revision check. The
  Studio sends `expectedRevisionId` so two managers cannot overwrite each other; the real function must
  add it.

## Website Pro (`website_pro.*`, Pro)

Registered by `pro/server.mjs` through `createWebsiteServerExtensions`. A core-only host answers none of
them. The client only calls them from the Pro client extension.

| Function                  | Capability              | Input                          | Output |
| ------------------------- | ----------------------- | ------------------------------ | ------ |
| `website_pro.analytics`   | `website.analytics.read` | `{ siteId, range: '7d' \| '28d' }` | `{ range, totals: { visitors, pageviews, conversions, conversionRate }, trend: [{ id, from, to, value }], pages: [{ id, title, path, views }], sources: [{ id, label, share }] }` |
| `website_pro.portfolio`   | `website.portfolio.read` | `{}`                          | `{ rows: [{ id, name, host, liveAt, waiting, submissions, visitors }] }` |

Trend buckets carry calendar dates (`from`, `to`); the client formats labels.

## Resource editors (NEW Studio BFF)

`website_studio.listResources` takes `{siteId, kind, search}` and returns `{rows}`.
`website_studio.getResource` takes `{siteId, kind, id}` and returns the scoped record.
`website_studio.saveResource` takes `{siteId, kind, id, expectedRevisionId, values}`; creates use
idempotency key `id`. Returns the record with `revisionId`. These are proposed screen-shaped adapters.
`client/resources.mjs` defines the finite schema. All operations check site, kind and capability.
Writes use the shared mutation boundary and compare revision. Production must map existing storage,
website_menu, website_seo, domains and website_form APIs, never a generic entity writer.
Domain states simulate DNS/TLS. Member/account records do not send real invitations.

## Content journeys (NEW BFF)

`website_studio.entryHistory` `{siteId,id}` returns `{entry,revisions}`.
`website_studio.restoreEntry` `{siteId,id,revisionId,expectedRevisionId}` creates a new draft revision.
`website_studio.setEntryArchived` `{siteId,id,archived,expectedRevisionId}` toggles the trash state.
Both mutations require content.write and use the extension mutation boundary.
`website_studio.preview` `{siteId,id,revisionId?,token?}` returns `{entry}` from the requested snapshot.
The Studio has no visitor view of its own. "Xem website" and a page preview's internal links open the
site at `bootstrap.site.url`: this origin when the ERP and the site share a host, else the primary
domain, and empty until the site has one (the button is then hidden). `website_studio.publicSite`
and the simulated shop, stay, account and adapter screens were removed from the client on
2026-10-03. Their fixture routes are no longer present.

## Form journeys (NEW BFF)

`website_studio.submissionDetail` `{siteId,id}` requires submission.manage and returns `{form,submission,labels}`.
`website_studio.visitorForm` `{siteId,id}` returns only the active form's public metadata and fields.
`website_studio.submitVisitorForm` `{siteId,formId,id,consent,fields}` creates an idempotent submission.
This is an anonymous-intent fixture simulator, not a staff mutation. The production adapter must use
website_form's public submission boundary with rate limits, consent audit, spam checks and outbox.
The mock validates required fields and consent but does not deliver email or provide real anti-spam.

## Operations (NEW BFF)

The Operations screen was removed (2026-09-30); these legacy fixture APIs are no longer called by Studio.
All require site.manage and a valid site. `website_studio.operations` `{siteId}` returns domain checks and jobs.
`website_studio.exportSite` `{siteId}` returns a versioned content-only JSON package, excluding PII and credentials.
`website_studio.previewImport` `{siteId,content}` validates the entire package and returns the proposed entries.
`website_studio.applyImport` `{siteId,id,content}` validates again inside the mutation transaction and imports new
drafts only; duplicate paths refuse the entire package. The id is its idempotency key.
`website_studio.runHealthCheck` `{siteId,id}` records fixture domain findings; it performs no external probes.

## Domain verification (NEW BFF, F-01)

`website_studio.verifyDomain` takes `{siteId,id,expectedRevisionId,observedTxt}`. The Atlas-only provider
simulator compares the observed TXT value against the server challenge and owns ownership/TLS states;
returns the domain with a fresh revision and an immutable appended attempt. `observedTxt` is a mock
provider input, never proof supplied by an end user in production. Production must obtain it from Platform.

`website_studio.setPrimaryDomain` takes `{siteId,id,expectedRevisionId,expectedPrimaryId,confirmed}`.
Requires verified ownership, ready TLS and explicit confirmation, updates the previous/new primary
atomically and preserves the old host as redirect. Both operations use the extension mutation boundary
and require `website.site.manage`. Generic domain saves accept only `title`; role/state/TLS writes
are refused. The first domain becomes primary when no primary exists; subsequent domains are redirects.
Hostname changes require a new domain. DNS/TLS are simulated, not checked on the network.

On the host this is superseded: see "SEO, domains and customer passwords on the host (2026-10-03)".
`observedTxt` is mock-only; the host looks the record up itself.

## Red-screen parity additions (mock BFF, all NEW)

These handlers are domain simulators, not production payment, stock, identity or booking adapters.
Public functions derive the visitor owner from the server session; client `owner`, totals and Partner
IDs are ignored. Both account and anonymous carts are isolated by site and owner. Quotes are scoped,
expire after ten minutes, and are rechecked transactionally against overlapping bookings.

| Function | Input / result / guard |
| --- | --- |
| `website_studio.shopProducts` | site, query/category/page → public catalog page |
| `website_studio.shopProduct` | site, product id → variants, UoM, current prices and stock |
| `website_studio.shopCart` | site → derived visitor cart, revision and server totals |
| `website_studio.shopCartUpdate` | variant, integer quantity → validated cart |
| `website_studio.shopCheckout` | stable id, expected cart revision, contact, consent → order; server price/stock, owner and replay guard |
| `website_studio.ownOrders` | site/page → only current visitor orders |
| `website_studio.ownOrder` | site/id → owned order or notFound |
| `website_studio.stayProperties` | site → published properties |
| `website_studio.stayProperty` | site/id → rooms, capacity, amenities, timezone |
| `website_studio.stayQuote` | property/room, date range, rooms/guests → owned expiring quote with policy snapshot |
| `website_studio.stayQuoteContext` | site/quote id → owned quote or missing |
| `website_studio.stayBook` | stable id, quote id, contact/consent → single booking group; inventory recheck, replay guard |
| `website_studio.ownBookings` | site/page → owned groups |
| `website_studio.ownBooking` | site/id → owned group, units, policy and cancellation eligibility |
| `website_studio.stayCancel` | id, expected revision, confirmation → whole-group cancellation; deadline and state guard |
| `website_studio.publicBlog` | site/category/query/page → frozen publication posts, excerpt, author/date |

Builder simplification (2026-09-30): Pattern, dynamic binding, translation, migration and device-local
recovery are removed from Core. Their five BFF handlers and localStorage draft implementation are
removed; they are not registered in Pro. Accessibility validation remains in the publish review.
Image uploads from the block inspector use the existing `/files` boundary with `resModel=website.Entry`,
`resId=<entry id>` and `resField=image`; references enter the page draft only after explicit selection.

`website_studio.shopReceipt` (NEW): site and stable checkout id → received owned order or unknown
reference, without revealing whether another visitor owns that id. Rechecking never creates an order.
The public journey is shop → product → cart → checkout → receipt → own order.

## Resource lifecycle and visitor account review additions

- **NEW** `website_studio.archiveResource` (`{siteId, kind, id, expectedRevisionId, confirmed}`): capability-checked, transactional soft archive. Rejects stale revision, active/scheduled publication references, draft references and taxonomy children. Sites/domains use their own lifecycle instead. `getResource` includes `usage`. Archived resources are excluded from future publication preparation; old snapshots remain immutable.
- `saveResource` checks duplicate redirect sources, normalized member emails, taxonomy slugs and parent cycles. Form field rows accept a fourth `required | optional` column (legacy rows default to required).
- `submitVisitorForm` accepts honeypot/challenge, returns an opaque receipt, stores immutable form revision/labels/delivery destination; the mock does not send email.

- Import review: `website_studio.previewImport` returns every row with `accepted`, `reason`, `media`, and a digest `checkpoint`. `website_studio.applyImport` requires the same checkpoint, revalidates destination paths, imports accepted rows only and records rejects. Replaying the completed job returns its result. This mock models a preview checkpoint, not a production resumable worker.
- Public metadata is applied by the client after reading the active publication. The Atlas host still serves the island bootstrap, not a production SEO delivery server.

- **NEW** `website_studio.submissionReceipt` reads an opaque receipt in its site and returns only receipt/time/delivery state, never submitted PII. The public receipt route is directly refreshable. Submissions retain consent/form revision, retention deadline and received audit. CSV columns follow the submitted schema and neutralize formula-leading values.

`website_studio.siteReadiness` — NEW read BFF, requires `website.site.manage`: scoped site/realm,
allowed companies, theme, bindings and domain/delivery/auth blockers. Mock configuration only; no IdP
or retention worker is deployed. Site resource writes validate company scope, code, host, timezone and
retention bounds. `bootstrap.companies` supplies allowed companies to the picker.

Builder editing uses the existing site-level `website.content.write` capability. Block-specific
locks, access requests and their endpoints were removed by product decision (2026-09-30). Read-only
users still cannot save; entry revision CAS and publication permissions remain enforced. Legacy
panel URLs fall back to Structure.

`website_studio.savePageSettings` — NEW content-write CAS operation: saves title/path and SEO in one
entry revision. The public metadata reads the active revision's SEO before a site-wide SEO resource.
`entryHistory` adds draft theme/menu resources and `liveRevisionId` for the builder's context and frame.

`website_studio.createPreview` `{siteId,id,revisionId?,audience,minutes}` /
`website_studio.revokePreview` `{siteId,token}` — content-write preview links. A link pins the
revision it was made for, so a later draft never shows through it. `audience=staff` opens only for a
signed-in actor who can open the site, in Studio and at `/_ket/preview` alike; `audience=link` opens for
whoever holds it. `minutes` is an integer 5–1440 (native `website.createPreviewToken` keeps TTL within
60 s–24 h). Create returns `{id,token,audience,expiresAt}`; only the token's digest is stored. Revoke
closes that one link, leaves the entry's other links open, and answers `notFound` for another site's
token. `preview` with `token` reads it through native `website.previewLink`, answers `expired` when the
link is revoked, expired or for another entry, and adds `preview {token,audience,expiresAt,url}`. `url`
is the site's own `/_ket/preview?token=` address for `link` (the Studio origin, port kept, when the site
shares the ERP host) and null for `staff`. `/_ket/preview` sends `no-store`, `noindex, nofollow,
noarchive` and `no-referrer`, dresses the draft in the site's current style (what publishing now would
capture), and answers 404 for a closed or unknown link. The Atlas host simulates the actor and hands out
a mock `/website/preview/...` url.

`website_studio.processSubmissionDelivery` — NEW worker-facing intent boundary; Atlas exposes an
explicit simulator button. Requires submission management, site scope and expected attempt. Only pending/
failed may run; accepted/uncertain cannot resend. Recipient is frozen with the submission. The fixture
`@retry.example.test` fails once and `@unknown.example.test` yields uncertain; no email leaves Atlas.


## Review completion deltas (2026-09-30)

- Form field rows now accept six columns: key, label, type, required/optional, maxLength (1–4000),
  classification (public/personal/sensitive). Legacy rows default to required/4000/personal. Submission
  stores the site's consent version and retention deadline, plus frozen field labels/classification.
- `website_studio.savePageSettings` accepts post metadata alongside SEO; cover images require alt.
  `entryHistory` adds deterministic revision digests. `listResources` for SEO adds per-entry metadata
  audit and a simulated sitemap/index snapshot; no crawler or external index is contacted.
- Publication preflight evaluates all manifest revisions, including unchanged pages using media whose
  visibility changed. Missing SEO is a warning; unsafe links/private media are blockers.
- Media batch retry retains completed file IDs in the editor session. Metadata/scan comes from server
  bytes; it is not a production file-scanning service. Reload resets that batch record.

## Core cosmetics preset (2026-09-30)

Theme resources have `preset: default | cosmetics` (default `default`). It uses the existing
`website_studio.saveResource` capability/CAS/draft-publication boundary. Selecting a skin does not
replace pages, menus or product content. Unknown preset values are rejected by the resource schema.
`website_studio.preview` now also returns the site's current draft theme; revision links still freeze
the entry, not the shared theme. Public delivery reads the publication's frozen theme resource.

`client/theme/cosmetics.mjs` supplies a Core starter with six ordinary Placement pages and default
settings. The opt-in `cosmetics` Atlas scenario seeds `site-cosmetics`; it does not alter baseline data.
The host loads both `theme/default.css` and `theme/cosmetics.css`. No theme script execution or KTL
contract change is introduced.

### Bundled trade presets (2026-10-03)

`preset` is now `default | cosmetics | retail | restaurant | hotel | services`; the list lives in
`client/theme/presets.ts` and is mirrored by the host schema in `website/studio-style.ts`. Unknown values
are still rejected. Every preset except `default` shares one structure, `theme/skin.css` (extracted
from the former cosmetics stylesheet), and adds its own token file: `cosmetics.css` (Lành),
`retail.css` (Phố), `restaurant.css` (Bếp Nhà), `hotel.css` (An Trú) and `services.css` (Vững). Each
file sets colours, type and radius, plus a small signature (hero composition, title ornament, card
shape). Accent, font, spacing and button choices apply to all of them. Lành renders pixel-identical
to before the split. The theme card shows `theme/<preset>.svg`, a local vector illustration.

The presets are named after trades, not deployments, and any site may pick any of them; a new site still
starts on `default`.

### Review 2: canonical saved revision comparison

`website.diffRevisions` — **Real**: `{ entryId, fromRevisionId, toRevisionId }` →
`{ ok, fromVersion, toVersion, changes, identified }`. The fixture imports KetJS `diffPlacements`
read-only; both history views consume its result. Unsaved draft changes are not labelled as saved
history. Metadata remains visible in revision details; no second client diff algorithm is maintained.

### Real Δ: SectionDef additions (production binding blocked)

`server/section-additions.mjs` explicitly declares proposed gallery/image/callout/quote/faq/video
sections and presentation/image settings. `atlas/layout-contract.mjs` composes these with the real
pinned SectionDefs (including the 20-child column limit), and runs canonical `validateLayout` plus
`placementIdErrors`. These additions are **not present in the pin**. Register them upstream before
binding this UI to production. `bindingIssues` checks against the unextended pinned definitions.
Unknown settings/sections and duplicate placement IDs are rejected; legacy data is readable but cannot
be re-saved unchanged through a bypass. No pin or `.ketjs` file was modified.

### Business ownership (product decision, 2026-09-30)

Website has no business-handoff workspace, registry or lifecycle. Orders, enquiries and booking
requests are submitted to their owning module. Website displays the acknowledgement returned by that
module; it does not create a second owner record, state machine or handoff history. The Atlas is a
fixture and does not prove production delivery. Removed: `handoffs` routes and their mock APIs/screens.

## Settings scope revision — 2026-09-30

Settings now saves general/guest-connection fields through website_studio.saveResource (kind=sites),
using the resource revision and preserving unedited fields. Its read combines siteReadiness and
listResources(kind=domains). website.saveSite remains a legacy fixture handler, not the current UI
write contract. ERP owns staff membership; website.listSiteMembers and kind=members were removed
from the mock, including generic create/update/archive support. Actor capabilities remain enforced.


### Object Storage ownership — 2026-09-30

The Website Media Library and its client upload/batch lifecycle have been removed. Resource editor
schemas no longer contain `media`. Builder selection currently reads mock public-file metadata through
`website_studio.listResources { kind: 'media', publicOnly: true }`. `atlas/storage-fixture-schema.mjs`
and the simulator's media mutation support exist only to construct storage/preflight fixture states;
there is no Website client command for those writes. They are not a proposed Website storage API.
Bind image selection to the deployment's Object Storage API before production; no live storage
connection, credential, provider or upload implementation is delivered by this mock change.

Update 2026-10-02: the builder no longer reads `kind: 'media'` when an image is chosen. The
deployment has no such resource, so choosing an image failed there. An uploaded image is the page's
own lease (`/website/images/{entryId}/{field}`), and the revision save claims it or refuses it.


### Taxonomy description, SEO and storage upload — 2026-09-30

Mock `saveResource/getResource/listResources` taxonomy values now include `descriptionDoc` (JSON of native LiveDoc blocks), derived `description`, `thumbnail/thumbnailAlt`, `cover/coverAlt`, `seoTitle`, `seoDescription`, `canonical`, `indexing`. Writes enforce scope, capability, CAS, parent/type rules, document shape and public/clean same-site image references. `website.saveEntry` also preserves/validates the post's `tags[]`; category and tag IDs cannot be interchanged.

This supersedes the selection-only restriction above: the two taxonomy image fields now upload through existing KétSuite `POST /files` multipart (`file`, `resModel=website.TaxonomyTerm`, `resId`, `resField`, `public=true`). The Atlas adds site/session context and emulates bytes plus public metadata in memory. This does not implement a production bucket, scanner or publication worker. Before production, bind taxonomy image ownership/readiness to the deployment's real attachment policy. No media list/editor returns.

`descriptionDoc` is rendered using the same public LiveDoc editor in read-only mode on public archives. The native block model is stored instead of a separate HTML representation. Browser bundling keeps the host's single KetJS view runtime; no fork of the editor source is used. The client-local editor has no presence/network collaboration.

### Article editor (2026-09-30) — Real Δ

`website.saveEntry` for posts now accepts `bodyDoc` (JSON native LiveDoc blocks) and `seo` alongside
existing post metadata. The mock validates the document and SEO, derives `bodyText`, and snapshots them
atomically with the same permission, idempotency and revision CAS rules. The canonical API must accept
and validate these fields before production binding. Public search reads `bodyText`; previews and frozen
publications render the stored LiveDoc document. Existing layout remains stored for compatibility.
Object Storage upload for `website.Entry` accepts `cover` as well as `image`, with an existing entry and
same-site validation. No new function key or alternate publication endpoint is introduced.

### LiveDoc inline images (2026-09-30)

The article composer reuses DS DropZone and `POST /files` with `resModel=website.Entry`,
`resId=<saved entry>`, `resField=image`, and the selected `siteId`. The local renderer still simulates
Object Storage in memory; it is not a live bucket connection. New articles must be saved before upload.
The owner saves native `image` blocks (`src`, `alt`, `delta: []`) in `bodyDoc`. Save refuses media from
another site or media without a clean scan. Production must enforce these checks at the same write
boundary. Public rendering uses the canonical `/files/{id}` attachment URL.

The current pin lacks native image blocks. The compatible upstream source change is in
`/Users/kieuduy/dev/worktrees/ketjs-livedoc-image-upload`, branch `feat/livedoc-image-upload`, based on
pin `48949714`. No pin or `.ketjs` files were changed. To preview this unmerged capability, set
`KET_WEBSITE_LIVEDOC_SOURCE` to that worktree's `packages/ketsuite/src/ui/client/live-doc-view.tsx`
when starting either renderer. This explicit source override also selects its sibling editor CSS.
Without it the button reports the missing capability; it does not fake an image in the document.

#### Required orphan prevention

All fixture uploads now start with a 24-hour pending lease. The save transaction promotes only
attachments referenced by persisted records/revisions to `attached`. Failed validation/CAS rolls
back this promotion. The server runs collection every minute and checks it on attachment requests;
closing a tab or crashing the browser does not need to send any request. Expired unattached uploads
lose both their bytes and metadata. References in current content, revision history and publication
snapshots prevent deletion. Attached files that lose every reference get a separate 24-hour grace.
The public media URL is retained for mock preview; this simulator does not implement private staged
bucket access and must not be treated as a production confidentiality boundary.

Production gate (not implemented by this mock): persist leases and ownership in the database;
authorize staged preview; atomically claim/commit attachment references with article CAS; run a
retryable idempotent worker that locks/rechecks references before deleting object bytes and then
metadata. Storage deletion failures must remain queued for retry. Never garbage-collect based only
on the latest article body or on client unload. Revision/publication retention must release its own
references before the last-reference grace can begin. Do not bind this UI to direct permanent
uploads until these server capabilities exist.

## Superseded publication references

The per-entry publishing decision above supersedes historical references below to preparing,
activating or reviewing a site-wide publication. Menu, theme, taxonomy and site SEO saves apply
immediately. Core and Pro share this behavior; approval is not part of the current Website mock.

### Native navigation menu — 2026-10-01

Each site has one Studio-owned navigation: `website_menu.Menu {id = siteId, siteId (unique), title?,
revision}` over the existing `website_menu.MenuItem` rows. Only the header menu in the site's default
locale exists; a footer position or another locale is refused with `validation`.

- `website_menu.menuState {siteId}` (`website_menu.view`) returns `{ok, revisionId, title, items}`.
  `items` are `{id, label, href, position, parentId}` in display order. A site that has never saved a
  menu reports `revisionId: 'initial'`.
- `website_menu.saveMenu {siteId, expectedRevisionId, title?, items}` (`website_menu.configure` and
  `website.configuration-audit`, idempotent) replaces the whole tree in one transaction. Order and
  nesting are one write, so visitors never read a half-moved tree. Before anything is written it checks
  the plan (at most 100 items; unique ids; label 1–200 characters; `href` accepted by the menu link
  rules and at most 2000 characters; every parent present; no cycle), the caller's structure permission,
  the revision (`website.error.editConflict`) and that no id belongs to another site's item
  (`website.error.immutableOwnership`). It then compare-and-sets the revision (inserting the `Menu` row on
  first save), deletes the site's items and inserts the planned ones.
- The legacy `addMenuItem`, `moveMenuItem` and `removeMenuItem` run in a transaction and also advance
  the revision, so a Studio form opened before them cannot overwrite their change unnoticed.
- Studio resources: `kind=menus` with `id = siteId`. `listResources` returns that single row with
  `creatable: false`; the record carries `archivable: false`, `position: 'header'` and the site's default
  locale. `getResource` adds `warnings: [{target, state: 'draft' | 'missing'}]` from
  `website_menu.preflightMenu`; dangling links are a report, not a refusal. `saveResource` maps
  `values.{title, items}` and `expectedRevisionId` to `saveMenu` and returns the re-read record.
- The client hides the create action when a list reports `creatable === false` and hides archive when
  a record reports `archivable === false`. Both flags default to the previous behavior when absent.
- `entryHistory` includes the menu only when the caller is allowed `website_menu.menuState`, so the
  Builder header and the public page read the same tree.
- `website_menu.publicMenu` prefers the Studio-owned menu: once a site has a `Menu` row, the menu frozen
  in the active publication is ignored.
- Every menu read orders siblings by `(position, id)`. Items added through `addMenuItem` without a
  position all store 0, so the id tie-break is what keeps the Studio and the public header in the same order.
- Managed roles: `website.reader` adds `website_menu.view`; `website.editor` and `website.publisher` add
  `website_menu.configure`. All four Website role templates are version 2.

Gates not covered: compare-and-set races on PostgreSQL (SQLite serializes transactions), drag and drop
in a real browser, and footer or multilingual menus.

### Public search — 2026-10-01

`GET /search?q=&type=&page=` is a module route of `website_backend`, answered anonymously for the site the
Host resolves to, in the home page's appearance, with `robots: noindex`. `q` is trimmed to 100 characters
and needs at least 2; `type` is `page` or `post` (anything else searches both); 20 results per page with
`rel="prev"`/`rel="next"` links that keep `q` and `type`. Every other Studio public page carries a search
box in the header. The route returns 404 until the home page is published.
`website_search.searchIndexed` accepts an optional `type` (`website.page` or `website.post`). The index
reads the title, the excerpt, `bodyText` and the text settings of layout sections (including slots); an
entry with no excerpt is described by the start of its text, cut at a word. Paths under a namespace the
deployment routes itself are not indexed. The index is stale when the count or the latest `updatedAt` of
the published, non-trashed entries changes, so one publish, withdrawal or path move is enough; results
then come from inline passes and say `stale: true`. Deployments composing `website_backend` must also
compose `website_search`.

### Forms and submissions — 2026-10-01

Capabilities split in two. `website.form.manage` (`website_form.saveForm` and `archiveForm`) edits and
archives forms; `website.submission.manage` (`readSubmission`, `holdSubmission`, `exportSubmissions`)
opens, holds and exports submissions, and gates `submission-detail` and `processSubmissionDelivery`.
Managed roles are version 3: `website.reader` adds `website_form.view` (form list and counts),
`website.editor` and `website.designer` add `website_form.configure`, and `website.publisher` adds
`website_form.operate` and `website_form.sensitive`. An editor gets 403 on every submission read or write.

- `form-editor` resources are `website_form.Form` rows. `getResource`/`listResources` return
  `{ id, siteId, title, schema, recipient, successMessage, consentLabel, spamProtection: 'honeypot',
  active: 'yes'|'no', retentionDays, schemaVersion, revisionId, versions, usage }`. `revisionId` is
  `Form.revision`, bumped by every save, and is the compare-and-set token: a stale `expected` returns
  `conflict`. `versions` come from `website_form.formHistory` as `{ revisionId: 'v{n}', title, schema,
  createdAt }`, newest first. A new `FormVersion` is written only when the field contract changes; a
  wording change keeps the version. Forms saved before versions existed get their old version written on
  the next save.
- Real Δ `saveForm` takes `expectedRevision` (`null` for a new form) and refuses archived forms. Field
  rows accept `label` (1–200 characters), boolean `required`, `maxLength` 1–10000 and `classification`
  `public`/`personal`/`sensitive`; the answer cap is the smaller of `maxLength` and the type ceiling.
  `spamProtection: 'challenge'` is refused: the module only has the honeypot. An empty success message
  falls back to the default sentence. Public fields become `summaryFields`.
- NEW `website_form.archiveForm` `{ id, expectedRevision }` sets `active: false` and `archivedAt`,
  keeps the submissions, and is idempotent. The Studio refuses it while a draft, published or scheduled
  revision of a page places the form, nested slots included. Archived forms leave `listForms`, answer
  404 in the Studio and stop accepting visitors.
- `listForms` rows add `revision`; the BFF answers `{ id, title, active, newCount, total, lastAt }`.
  `listSubmissions` and `countSubmissions` take `held`. Rows add `deliveryState` (`mail` when the form has
  a recipient, else `notConfigured`) and `retentionUntil` (`null` while held). `summary` joins only
  public answers.
- `readSubmission` takes `siteId`; a submission from another site is `null` before any audit is written.
  Reading marks `new` as `read`. `listSubmissionAudit` takes `submissionId`.
- `website_studio.submissionDetail` labels the answers with the form version the visitor submitted.
  It returns `delivery: null` because `website_form_mail` does not record attempts per submission; the
  client hides the delivery block in that case.
- `exportSubmissions` answers `{ filename, content, capped }`: UTF-8 with BOM, `\r\n`, cells passed through
  the spreadsheet-formula guard, and a filename without diacritics (`Dat-ban-YYYY-MM-DD.csv`).
- `website_studio.overview` counts new submissions and lists the newest five only when the viewer may
  call `website_form.listSubmissions`.

Not wired yet: retention settings from the Studio and release/purge screens.

### Routing submissions to an ERP module — 2026-10-02

A form can hand each submission to the ERP module that owns the work: a contact request becomes a CRM
lead. The Website keeps its own copy (queue, retention, audit); the receiving module reports back where
the request stands, and the Studio shows that beside the copy.

- The contract is a job name. A module that declares `deliverFormSubmissions` is a destination. It
  depends on `website_form` and fetches what is waiting, because a module may only queue jobs of the
  modules it depends on. `website_form` never names a receiver. NEW `website_form.listDestinations` `{}`
  lists the composed ones as `[{ name }]`; the BFF labels each with the module's own `formDestination`
  message.
- `crm_website` is the only receiver today. The cosmetics deployment composes it; the hospitality one
  does not, so no destination is offered there. Every minute a sweep queues one pass per company that
  has a routed form. A pass turns up to 25 pending submissions into leads through the same
  `captureLead` that the public CRM form uses, keyed `website-form:{submissionId}`. The lead's name is
  `{form}: {person}`, email and phone come from the first `email` and `tel` fields, every answer goes
  into the description under the label the visitor saw, and the UTM fields are `website / form / {form}`.
  CRM's own rate limit is skipped: the Website already limited each visitor, and from CRM's side every
  routed lead arrives from the same worker. The pass then refreshes up to 50 open leads, the ones
  checked longest ago first. A merged lead is followed to the case it became.
- `Form.destination` (`text?`, outside the version) is saved by `saveForm`. When the input leaves it
  out, the saved value is kept; `null` or `''` clears it. A name that is not composed is refused with
  `website_form.error.unknownDestination`. A form with a destination must have an `email` or `tel` field,
  or the save is refused on `destination` with `website_form.error.destinationNeedsContact`; every
  receiver has to reach the person. `form-editor` resources add `destination` (`''` when none) and
  `destinations: [{ value, label }]`. The client sends `destination` only when it rendered the control,
  so a host with no destinations never clears one.
- A submission to a routed form starts at `deliveryState: 'pending'`. Its other delivery fields are
  `destination`, `deliveryAttempts`, `deliveryRef`, `deliveryHref`, `deliveryStatus` (the receiver's
  stage name), `deliveryOutcome` (`open`/`won`/`lost`/`closed`), `deliveryError` (a message key),
  `deliveredAt` and `deliverySyncedAt`. `listSubmissions` and `readSubmission` return them. BFF rows add
  `destinationState`, `destinationStatus` and `destinationOutcome`. `submissionDetail` adds
  `submission.destination: { name, title, state, status, outcome, href, attempts, error, deliveredAt,
  syncedAt }`, with `error` translated, or `null`. `href` is `/admin/crm/cases/{id}` only when
  `crm_backend` is composed and the viewer may call `crm.case.get`; a link they cannot open would only
  lead to a refusal. The stored `deliveryHref` keeps the link either way.
- Failures:
  - A lead CRM refuses fails once and stays failed. Examples: no email or phone
    (`crm_website.error.noContact`), answers already erased by retention, the form deleted.
  - A fault on our side stays `pending` with `crm_website.error.deliveryFailed`. It is tried on later
    passes and fails after 5 attempts.
  - A lead deleted in CRM becomes `closed`.
  - A closed lead (won, lost, closed) is no longer refreshed.
- NEW `website_form.retryDelivery` `{ id, siteId? }` (`website_form.operate`, capability
  `website.submission.manage`) puts a `failed` submission back to `pending` with zero attempts and audits
  `retry`. It is idempotent while pending. Any other state is refused with `website_form.error.notRetryable`,
  and an erased submission with `submissionPurged`. All writes are compare-and-set on `deliveryState`, so a
  retry racing a pass cannot be overwritten. Managed website roles are version 4.
- Real Δ (mock): the Atlas offers CRM unless the scenario is `contact-unavailable`. It has no CRM worker:
  a retried submission stays `pending`, and its record link points at the ERP path. It shows that link to
  every viewer, since it has no CRM permissions to check.
- Limits: a new submission waits up to a minute. The Website's retention purge does not touch the CRM
  lead. Contact fields may be optional, so a visitor who leaves them all blank still fails with
  `noContact`; the public form does not yet require one of them when the form is routed.

### Public forms and the Studio preview — 2026-10-02

- KetJS `SectionDef.resolve` names a function that answers `{ siteId, settings }` for one placement.
  Compose refuses an unknown function (`E_SECTION_UNKNOWN_RESOLVER`) and one that is not anonymous or
  declares a `write:`/`enqueue:` effect (`E_SECTION_RESOLVER_UNSAFE`). Before the presenter runs, the page
  scope gains `sectionData[placementId]` for each such placement, nested slots included, at most 20 per
  page; a placement past the cap gets nothing.
- NEW `website_form.publicForm` (anonymous, read-only) is the resolver of `website_form.form`. It answers
  `{ id, title, heading, description, schemaVersion, fields: [{ name, label, type, required, maxLength }],
  consentText, successMessage, submissionKey }`, or `null` without a `formId`, for another site's form, or
  for a form that is closed or archived. `submissionKey` is fresh per render.
- The section posts without JavaScript to `/forms/{id}` (form-encoded: declared fields, `consent`,
  `honeypot`, `_schemaVersion`, `submissionKey`), checked by `website_form.submitForm` exactly as the JSON
  endpoint. Answers: 303 to `/forms/receipt/{submissionId}` (the same key lands on the same receipt), the
  form again with answers kept and errors beside fields (422; 409 when the form changed; 429 over the rate
  limit), 403 for another origin, 404 for a form the site does not serve. A filled honeypot gets the
  form's thanks and stores nothing. `GET /forms/{id}` is the form's own page (noindex). `/forms` is
  therefore a reserved path prefix: no entry can be published under it.
- `/forms/receipt/{id}` shows the form's success message, the receipt code and the time (zone
  `Asia/Ho_Chi_Minh`; sites carry no zone yet), noindex, and answers 404 on any other site.
  NEW `website_form.submissionReceipt` (internal) feeds it: `{ id, formId, siteId, title, successMessage,
  createdAt }`.
- NEW `website_form.validateSubmission` `{ formId, payload, consent }` runs the consent and field checks
  of `submitForm` and writes nothing; `{ ok }` or `{ ok: false, errors }`. Readers may call it.
- Builder: the `website_form.form` block is in the library (content group). Its `formId` setting is a
  select of `website_form.listForms`; the canvas draws each open form from `website_studio.visitorForm`,
  disabled, and a missing or closed form as a note.
- `website_studio.visitorForm` answers the saved form: `{ form: { id, title, consentLabel, successMessage,
  spamProtection }, fields }`; a closed form fails `validation`.
- Real Δ `website_studio.submitVisitorForm` on the host is a check, not a post: it calls
  `validateSubmission` and returns `{ preview: true }`, or fails `validation` with `Label: message · …`.
  No submission is stored and no mail is sent; the client says so. The mock still simulates a visitor and
  stores a `WEB-…` receipt, which the review journeys depend on.
- Real Δ `website_studio.submissionReceipt` `{ siteId, id }` answers `{ receipt, createdAt, state:
  'received' }` for a submission of that site, else `notFound`.

## Customer sign-in accounts and real Settings (2026-10-02)

The Studio runs on the host BFF for its Settings page and for the customer accounts of a site.

- Real Δ `website_studio.siteReadiness` `{ siteId }` answers `{ site: { id, title, code, defaultLocale,
  revisionId }, publicUrl, bindings, blockers: [], customers }`. `customers` is `{ available, selfSignup,
  signInUrl, total }`, or null for an actor without `website.listCustomerAccounts`. `bindings` lists
  `retail | hospitality | crm` for the installed modules.
- Real Δ `website_studio.saveResource` with `kind: 'sites'` saves `{ title, code, defaultLocale }` through
  `website.saveSite`, keeping the theme, tokens, group and active state. `expectedRevisionId` is the
  site's `updatedAt`; a stale one fails `conflict`. Timezone and guest-connection fields were removed from
  the Settings form.
- NEW `website.listCustomerAccounts` `{ siteId, search?, status?, limit?, offset? }` (read, bundle
  `security`) answers `{ realm: { id, selfSignup, signInHost } | null, rows, total }`. Search matches the
  name, the email and, only when it holds digits, the phone. `status` is `active | disabled`; rows never
  carry a password or hash. The new role template `website.customers` grants it with `partner.view`.
- Capabilities: `website.customer.manage` (list, read, close, reopen, reset, sign-up switch) and
  `website.customer.issue` (`website.issueCustomerAccess` and `partner.listPartners`).
- NEW `website_studio.customers` `{ siteId, search, status, offset }` pages 50 rows: `{ available,
  selfSignup, signInUrl, rows, total }`. `website_studio.customer` `{ siteId, partnerId }` reads one account
  plus `signInUrl`; an account of another realm fails `notFound`.
- NEW `website_studio.customerCommand` `{ siteId, partnerId, action: disable | enable | reset, password? }`
  checks the account belongs to the site first, then answers `{ account, password }`. `password` is the
  generated one when staff left it empty, else null; it is shown once and never stored in the client.
- NEW `website_studio.customerCandidates` `{ siteId, search }` (2+ characters) answers up to 10 partners
  with the status of their account on this site. `website_studio.issueCustomer` `{ siteId, partnerId,
  values: { displayName, phone, email, password } }` refuses a partner who already has an account
  (`conflict`), because issuing again would silently reset the password.
- NEW `website_studio.saveCustomerSettings` `{ siteId, selfSignup }` opens or closes self sign-up.
- Password recovery and the public "my account" pages: see the next section.

## SEO, domains and customer passwords on the host (2026-10-03)

The host owns the behaviour below.

- Real Δ `website_studio.listResources` / `getResource` / `saveResource` with `kind: 'seo'` read and
  write the SEO of each page and post that is not in the trash, through `website.saveEntry`. Rows are
  `{ id, siteId, kind: 'seo', title, path, description, image, indexing, canonical, state, revisionId }`.
  A save takes `{ title, path, description, image, indexing, canonical }`; a title equal to the page's
  own is stored empty so the page title keeps driving it. A stale `expectedRevisionId` fails `conflict`;
  SEO cannot be created or archived. The list `audit` is `{ publicationId, indexState, rows }` and lists
  only published entries missing a description or image, or whose draft differs from what is served.
- Real Δ `kind: 'domains'`: adding a host goes through `website.saveDomain`; the site's first host is
  primary. Each host has its own proof: a TXT record at `_ketsuite.<host>` with the value
  `ketsuite-verify=<token>`, returned as `challenge: { type: 'TXT', name, value }` until it is proven.
  Retrying an add with the same host answers the same domain; another host under that id is refused.
  A host renamed outside the Studio gets a new token and must be proven again.
- NEW `website.verifyDomain` `{ id }` (configure) looks the record up from the server. The result is
  `matched | missing | mismatch | unreachable`; the first match stamps `verifiedAt`, which a later failed
  lookup does not take away. `WEBSITE_DNS_SERVERS` (comma-separated `host:port`) overrides the system
  resolvers. `website_studio.verifyDomain` `{ siteId, id, expectedRevisionId }` wraps it; `observedTxt`
  is gone. Domain rows carry `state: pending | verified | failed`, `tls: pending | ready`, `checkedAt`,
  `reason` and the last check as `attempts`. Hosts saved before proofs existed count as proven and served.
- NEW internal `website.markDomainServing` `{ id, serving }` is how Két Việt records that a host answers
  over HTTPS. No Studio role reaches it; it refuses a host that is not proven.
- `website_studio.setPrimaryDomain` needs the host proven **and** served: every other host redirects to
  the primary, so an unserved primary would take the site down. Until then the Studio shows
  "Két Việt đang kích hoạt".
- Customer pages: `/account` (my account), `/account/register`, `/account/forgot` and `/account/reset` render on the site's own
  look, `noindex`, and are filled by `customer-account.mjs` from the customer API. The reset token stays
  in the address and is never written into the page.
- Customer API (`/api/customer/v1`, see `docs/public/api/customer-v1.openapi.json`):
  - `PATCH me/profile` `{ displayName }` (signed in; a cookie session needs its CSRF token).
  - `POST auth/password` `{ currentPassword, newPassword }` signs every device out; a cookie session
    answers a fresh `csrfToken` and cookie.
  - `POST auth/password/forgot` `{ email } | { phone }` answers `202 { accepted: true }` whatever the
    account, so it cannot be used to find who has one. An active account with an email gets a link good
    once for 30 minutes; one without is told to ask the shop. Spending a link voids every other.
  - `POST auth/password/reset` `{ token, password }` sets the password and signs every device out, or
    fails `website.customer.error.resetExpired`.
  - Both are same-origin only and rate limited, per sender and per account.
- The mail is queued by the bridge `website_customer_mail` on `mail_transport`, from the company's own
  template named `website.customer.password-reset` with the keys `siteTitle`, `displayName` and
  `resetUrl`. Without an active template, or without a mail provider, nothing is sent; the visitor sees
  the same answer. The delivery body keeps the link, which lapses within 30 minutes.
- `website_studio.customerMail` `{}` answers `{ template, keys }`, where `template` is `{ fromAddress,
  fromName, replyTo, subject, text, active, version }` or null until saved. `website_studio.saveCustomerMail`
  `{ expectedVersion, values: { fromAddress, fromName, replyTo, subject, text, active } }` writes it under
  the fixed name and keys; the body must carry `{{resetUrl}}`, and a stale `expectedVersion` is a
  `conflict`. Both need the capability `website.customer.mail` (role template `website.customer-mail`,
  registered only where `website_customer_mail` is composed). The mail is one per company: Settings
  shows it on every site.

## Creating a site and its first look (2026-10-03)

`website_studio.saveResource` `{ kind: 'sites', siteId: <current or null>, id: <new>, expectedRevisionId:
null, values: { title, code, defaultLocale, host } }` creates a site on the host: `website.saveSite` with
the current site's theme module (or the first composed theme), then the deployment's default Studio
preset, then `host` as its primary domain. Sending the same create again answers with the site it made.
A deployment chooses the preset by composing `websiteBackendWith({ defaultPreset })` from
`@ketvietlab/ketsuite` in place of `websiteBackend`; without it a new site starts on `default`. Sites
that already exist keep the look they render with.

## Customer portal on the public site (2026-10-03)

- `/account/login` offers `/account/register` only while the site's realm allows self sign-up.
  `/account/register` then renders a `noindex` form in the site's look, asks for display name, email
  and password, and posts to `POST /api/customer/v1/auth/session/register`. A successful response
  creates a customer cookie session and opens `/account`. Closing self sign-up removes the link,
  makes the page 404 and makes the API refuse registration; a page already open handles that refusal.
- Signed-in `/account` reads customer capabilities from `GET /api/customer/v1/bootstrap`. It loads
  `GET retail/orders` when `website_retail.orders:read` is served, and
  `GET hospitality/my-bookings` when `website_hospitality.bookings:read` is served. Each section shows
  its first 10 records, an empty or error state, and a button to follow `meta.nextCursor`. These are
  the customer channel's own partner-scoped endpoints; the public page does not accept a partner ID.
- Két Việt composes `website_retail` in commerce and cosmetic, and `website_hospitality` in hospitality.
  F&B and office do not show either history section unless they later compose a matching channel.
