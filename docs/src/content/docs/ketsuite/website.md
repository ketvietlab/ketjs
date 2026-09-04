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
- `website_retail`, `website_hospitality`, `crm_website`: optional bridges to the owning domain.

## SEO and the public projection

`website_seo` adds four optional fields to an entry it does not own — `metaDescription`, `canonical`,
`noindex` and `ogImage` — and declares the `website:page.head` fill that would render them. Because
the module declares the fields, it also owns writing them: `website.saveEntry` deliberately does not,
so SEO validation does not end up inside the content module.

:::caution[Head rendering is not wired yet]
Of the four fields, only `noindex` has a consumer today: the sitemap below. The storefront page scope
in `packages/ketjs/src/server/boot.ts` passes the theme an empty `meta`, so the head fill has nothing
to interpolate and `metaDescription`, `canonical` and `ogImage` are stored and read back but not
rendered. Connecting the page scope is a framework change and is tracked separately.
:::

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

### Pre-existing damage is not this edit's problem

Only the parent the caller named is validated. The rest of the chain is walked for one reason: to see
whether *this* edit would close a loop back to *this* item.

That distinction matters because menus can already hold broken chains — the delete this module used
to allow orphaned children. Validating the whole stored chain would refuse an edit two levels below
the damage, report `parentId` as invalid while naming a parent that is perfectly fine, and point at
nothing that needs repair. A chain that is already broken, or already looping above, cannot close a
loop through this item either, so the walk stops rather than refusing. Existing orphans are therefore
harmless, and the delete guard stops new ones appearing.

## Public site search

`website.searchPublished` matches a term against the **published** title and excerpt of each entry.
Those live on the revision rather than the entry, so a draft title is never searchable and a result
always shows what a visitor would actually see.

- The publication filter is part of the query. Unpublished entries used to be fetched and discarded,
  spending the scan window before the published ones were reached.
- Revisions are read in one batch keyed by id. The previous shape issued one query per candidate
  entry — up to 500 per keystroke.
- `countSearchPublished` returns the total behind the pages, plus `capped`, which says the scan
  window was full and the count should not be presented as a final total.
- A site that is not active has no public search, the same rule the sitemap follows.

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

## Testing

```bash
# Run from: repository root
npm run build --silent && node --test .build/test/website-seo.test.js
```

`test/website-seo.test.ts` covers the projection rules as pure functions and the write path against a
SQLite adapter, including cross-site isolation and the refusal of a foreign canonical.
