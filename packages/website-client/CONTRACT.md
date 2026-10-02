# Website Studio design contract

This is the contract later agents iterate against. Change the mock only in ways this file allows; when
a change needs a new rule, change this file in the same commit and say why. The function-level contract
is [API-CONTRACT.md](API-CONTRACT.md); the extension contract is [EXTENSIONS.md](EXTENSIONS.md).

The mock follows Flow's open-core model: an MIT core with a private Pro extension, client-rendered,
served by an Atlas host that answers `/_ket/fn` with fixture data. The old proposal in `tasks/website/`
stays untouched as history; it is not a contract.

## Business ownership decision (2026-09-30)

There are no business-handoff screens in Website Studio. Order, enquiry and booking requests flow
directly to their owning module; the visitor sees its acknowledgement. Website does not manage another
module's records, processing states or history. Earlier review requests for HO-001…010 are superseded.

Industry experiences are visitor journeys, not a Studio navigation section. The sidebar does not
include the adapter catalogue. Editors open the public site through “Xem website”; connection
readiness stays in Settings and processing stays in the owning business module. Direct catalogue
routes remain available for Atlas review; this navigation change does not remove public journeys.

Page templates are selected during page creation (blank by default) or applied explicitly in the
builder with replacement confirmation. The template catalogue is not a sidebar item; its direct
routes remain available for Atlas review. Both entry points use the same template layout expansion.

The Operations screen and its navigation/Atlas flow were removed by product decision (2026-09-30).
Legacy health/import/export fixture APIs remain test helpers, with no Studio screen.

The Redirects and Customer accounts administration screens, routes and Atlas flows were removed
by product decision (2026-09-30). Menu editing and public visitor login/account journeys remain.
Legacy resource schemas live only in the fixture host for migration/publication tests.

## Publication decision — 2026-09-30 (supersedes earlier review flows)

Pages and posts publish independently, from their own editor. The toolbar publishes immediately;
scheduling is configured inside that editor. There is no publication list, review record, site-wide
change set, calendar screen, activation step or Pro approval flow. History remains per entry; restoring
an old revision creates a draft which the user may publish separately.

`website.publishEntry` names the expected revision. A scheduled job freezes that revision, so editing
later cannot silently alter what was scheduled. Publishing one entry never replaces another entry's
live revision. Permissions, revision conflicts and content validation remain server enforced.
Menu, theme, taxonomy and site SEO settings apply on Save; they never require publishing a page.
Internal snapshots in the Atlas fixture support deterministic visitor delivery, not another workflow.

Verification for this change: 149/149 Core + Pro tests; three mutations rejected (entry isolation,
frozen scheduled revision, publish permission). KetPlus: Core desktop light schedule/cancel/publish;
Pro mobile dark article publish/schedule and readonly builder schedule. Both Atlas bundles validate
and pass strict audit (Core 46 flows/89 screens; Pro 2 flows/4 screens). This verifies the mock,
not completion of the production integration. No screenshot evidence is committed.

## 1. Editions

Cloud and self-hosted are ways to ship the product, not editions. Both run the same core, and a tenant
may add Pro to either.

**Core (MIT, `client/`, `server/`)**

- Several sites per company, domains, ERP-provided editor and publisher permissions.
- Pages and posts, revisions, taxonomy, Object Storage image references, locales.
- Preview, per-entry publish-now and scheduling, revision history.
- Menus, themes, SEO basics, search, the full page builder.
- Forms, submissions, CSV export, notifications, anti-spam.
- Customer accounts and adapters.

**Pro (UNLICENSED, `pro/`)**

- First-party analytics.
- Company portfolio across sites.
- Scheduled audits, automation and webhooks, advanced forms.
- AI assistance, A/B tests and personalization.
- Staging to production, SSO/SCIM, the organization audit log.
- Premium themes. Pro also ships a theme set good enough for most sites; premium themes are extra.

**Deferred:** WEB-051, WEB-052 and WEB-053. The healthcare adapter is private but belongs to the
healthcare deployment, not to Website Pro.

The mock implements, from Pro, analytics and portfolio. Everything else on the Pro list is
out of the mock until a later iteration adds it through the extension contract.

## 2. Decisions

| Decision | Why |
| -------- | --- |
| The Studio is client-rendered only. The server renders a loading island; `createWebsiteStudio` reads and renders in the browser. | The same source runs in Atlas and in KetSuite, like Flow. |
| Clicking Website in the ERP opens the Studio in a new tab (`delegateWebsiteLaunch`). The ERP never embeds it. | The Studio is its own application with its own shell. |
| The client never decides its edition. Without Pro nothing Pro renders: no locked buttons, no teasers. The only offer is a `Notice` in Settings from `bootstrap.offer`. | Selling happens in one quiet place; server data decides it. |
| Route visibility is not authorization. Every capability is checked again on the server. | A hidden button is not a permission. |
| The mock uses the real function names. Where a real function differs, API-CONTRACT.md lists the differences. | Agents binding production must see the gap, not discover it. |
| **Open, not analysed:** review KTL and theming. They were designed to forbid JavaScript in themes; the product owner now thinks the platform is safe enough to allow it. | Recorded on request (2026-09-29). Do not design around either answer until the review happens. |

### Builder permissions — decision 2026-09-30

The product owner removed per-block permissions as unnecessary complexity. All blocks follow the
site's content editing permission. No block lock/unlock/request-access UI, API or Atlas scenario.
Read-only mode, entry revision conflicts, site settings and publishing permissions remain separate.
This supersedes the old WEB-PB-015 mustSee requirement; do not reintroduce it to satisfy legacy parity.

### Builder simplification — decision 2026-09-30

Core exposes five panels: Structure, Add block, Page settings, Style and History. The Add block panel
contains page templates; the Structure panel opens shared header/footer settings. Block design and
visibility live in its inspector. Image upload opens from its image field. Page switching is in the
header; commands, scheduling and accessibility errors open contextual dialogs. This replaces the earlier 20-panel scope.
Pattern, binding, translation, migration and device-local drafts are removed, including their fixture
BFFs. Undo/redo and in-memory drafts across page navigation remain. No automatic promotion to Pro.

### Menu authoring — decision 2026-09-30

Menus use a WordPress-style source picker (pages, posts, categories, tags and custom links) beside a
collapsible structure in a wide RecordPage (1100px content maximum). Dragging moves an entire branch; horizontal movement in 24px steps nests under the previous sibling or outdents across ancestor levels. Dropping in the middle of another item also nests it. Keyboard
arrows and explicit move/parent controls provide the same operations. Cycles are refused; removing a
parent promotes its children. Mobile shows the structure before the source picker. Saving keeps the
existing resource capability, revision CAS and draft/publication boundary. No new backend API.

### Article editing — decision 2026-09-30

Posts use a dedicated wide RecordPage: LiveDoc content, excerpt and SEO in the writing column;
author, permalink, locale, category, tags and an Object Storage cover in document settings. The new-post
route is a full editor. Lists and old builder URLs lead to `posts/:id`. Pages retain Page Builder.
Saving keeps document blocks, derived search text and metadata in one revision. Preview and publication
use that revision; publication and scheduling happen in the article editor. Existing layout
sections are preserved, with legacy prose read into LiveDoc. New unsaved posts save a draft before upload.

## 3. Screens

Paths are relative to the Studio base (`/website/`). `?site=<id>` selects the site on every site-scoped
route. Only `site` and a route's declared `query` keys survive `href`.

| Key | Path | Pattern | Capability | Edition |
| --- | ---- | ------- | ---------- | ------- |
| `overview` | `overview` | WorkspacePage | none | Core |
| `pages` | `pages` | ListPage (operational), query `q`, `status` | none | Core |
| `page-new` | `pages/new` | ModalSheet over `pages` | `website.content.write` | Core |
| `builder` | `pages/:id/builder` | WorkspacePage, `frame: 'workspace'`, query `node` | none (editing needs `website.content.write`) | Core |
| `posts` | `posts` | ListPage (operational), query `q`, `status` | none | Core |
| `forms` | `forms` | ListPage (operational) | none | Core |
| `submissions` | `forms/:id/submissions` | ListPage (operational), query `status` | none (hold and export need `website.form.manage`) | Core |
| `settings` | `settings` | WorkspacePage | `website.site.manage` | Core |
| `analytics` | `analytics` | WorkspacePage, query `range` | `website.analytics.read` | Pro |
| `portfolio` | `portfolio` | ListPage (operational), `scope: 'company'` | `website.portfolio.read` | Pro |

Additional Core routes now cover post creation; entry metadata, revision history and restore;
draft/frozen previews; public delivery/search; simulated visitor accounts; submission detail and public
forms; and industry adapter journeys. Resource list/editor pairs cover categories, tags,
menus, redirects, domains, visitor accounts, forms, SEO, sites, themes and templates.
`client/routes.ts` is the exact route/capability registry. The Core Atlas registers 95 screen states
across 51 flows; Pro retains 5 screens across 3 flows. See `COMPLETION.md` for coverage and evidence.

Every Studio screen returns one complete DS page pattern. Public visitor journeys use the website theme shell (`publicFrame`) with one h1 and native DS controls; they must not render a Studio WorkspacePage, staff navigation or publication identifiers. Collection lists use the operational `ListPage`:
create goes in `headerActions`, filters and search in `controls`, the result count in `footer`. A
status filter is `Tabs` on its own full-width row, with the `SearchBar` inside a `FilterBar` on the
row below (`Stack [Tabs, FilterBar [SearchBar]]`). Tabs are 43px with a bottom rule and controls are
30px, so they never share a row. The `FilterBar` keeps the search at its content width (a bare
`SearchBar` in a `Stack` stretches its submit button) and needs a `label`: the DS default is English. There is no `description` under a list title and no `context` link on pages inside the
shell: the DS hides page `context` under a location strip.

Content has two widths. Lists and workspaces fill the main area. Every record detail is a `RecordPage`
with `width: 'wide'` (68.75rem, about 1100px), never the narrower DS default and never full width.

Atlas states: `?state=baseline | empty | editor | readonly | error | loading` on `/erp` carries into the
Studio launch link.

## 4. Shell

`client/shell.tsx` composes the KetSuite shell the same way the product list screens in KetSuite do.

```
AppShell {
  mode: 'viewport',
  location: AppTopbar { location: site, navigation: NavigationToggle, search, tools },
  sidebar:  AppNavigation { externalTrigger: true, identity: brand, groups },
  main:     page + route modal,
}
```

- **Brand.** The KétSuite wordmark (`/_ket/asset/backend/brand/logo-{light,dark}.png`, served by
  KetSuite) with the product name "Web" beside it. The dark logo swaps with the theme. See gap
  `ds-app-brand-text`.
- **Location strip.** Where KetSuite shows the company, the Studio shows the site. With one site it is
  plain text `name · host`. With several it is a `Menu` whose items are links to
  `overview?site=<id>`; the current site has a check icon. Switching site is navigation, not a form.
- **Search.** Scoped to pages: the topbar search submits to `pages?q=`. See gap `ds-app-topbar-search`.
  Lists carry their own `SearchBar`.
- **Tools.** A theme toggle (`studio.theme`, persisted in `localStorage['ketsuite.theme']`, applied to
  `<html data-theme>` and the design-system root) and an account menu with the actor, role and a link to
  `bootstrap.home` (the KétSuite home).
- **Navigation.** Groups `home`, `content`, `experience`, `settings`, in that order. Extensions may only
  add to these groups. The narrow drawer is opened by the topbar toggle (`externalTrigger`).
- **Wrapper.** `data-kv-design-system` with `data-presentation="grouped"` and `data-density="compact"`.
- **Runtime.** DS interactions (menus, drawer, dialogs) bind to elements present at attach time, and the
  Studio re-renders client-side. After each route, bootstrap or data change the Studio detaches and
  re-attaches `attachDesignSystemInteractions` on its root, keeping focus. See gap `ds-runtime-rebind`.
  The Studio document does not load the DS `auto.js`.
- **GET forms.** A GET form whose action is under the Studio base is routed client-side: the action's own
  query (the site) is kept and the form fields are merged in. This is how `SearchBar` and the topbar
  search keep `?site=`.
- **Workspace frame.** A route with `frame: 'workspace'` (the builder) renders without the shell and
  owns the window.

## 5. Layout rules

The Design System layout rules L1–L8 (ketjs `packages/design-system/LAYOUT.md`) apply to every screen,
core or extension.

- Groups on the canvas are `Surface` and `Stack divided`; `Section` only inside a surface or overlay.
- Information strips are `DescriptionList layout="strip"`; references and logs are `Surface tone="subtle"`.
- Screens pass text, never sizes or positions. Components own their frame, spacing and headings.
- App CSS lives in `client/styles.css`. It arranges app-owned wrappers (`.website-*`) only, never
  selects `[data-ui]` or `[data-pattern]`, and passes `auditLayoutCss`. `test/render.test.mjs` enforces
  both, and is stricter than the audit: the audit lets grid tracks through on DS hooks, this test does
  not.
- A workaround for a DS defect goes in `client/ds-gaps.css`, one rule per gap, each with a
  `GAP <id>:` comment, and a row in §6. Delete the rule when the DS fix lands and the override is bumped.
  Never move app layout into that file.
- Collections are `ListPage` with `DataTable`, not `KetTable`. The Studio renders in the browser, and
  the `KetTable` component runs its cell callbacks on the server only and has no empty-state actions.
  Exception owner: Website; destination: `KetTable` once it renders on the client with empty actions.
  Every `DataTable` that can be empty passes a Vietnamese `emptyTitle` and `emptyMessage` (the DS
  defaults are English). A table cell with commands uses `size="compact"` buttons.
- The visitor theme (`client/theme/`) renders the public site, not the Studio. The audit does not apply.
- When `design-system-layout.json` exists on integration (ketviet PR #643), add
  `design/website/client/styles.css` to `enforce` in the same change that rebases onto it.

## 6. Design System gaps

Report each to ketjs. A fix there, then an override bump, removes the workaround here.

| Gap | Defect | Workaround here | Proper fix |
| --- | ------ | --------------- | ---------- |
| `ds-form-stacked-fields` | `Field` has no explicit stacked-label option. | The form field editor keeps labels above controls at all widths. A select and its chevron are pinned to the row under the label: once the rule releases the DS row placement, auto placement drops the select below its chevron. | A `stacked` layout on `Field` that places the select and its chevron itself. |
| `ds-form-reorder-keyboard` | `ReorderList` lacks drag-first controls. | Desktop move buttons stay keyboard-focusable; touch keeps visible alternatives. | Keyboard and touch alternatives in `ReorderList`. |
| `ds-reorder-drag-icon` | `ReorderList` has no icon slot. | The form drag button masks the canonical `grip-vertical` SVG and keeps its accessible text. | An icon handle in `ReorderList`. |
| `ds-form-reorder-width` | `ReorderList` lacks configuration rows with a leading drag handle and a trailing remove action. | A grid layout scoped to form authoring. | A configuration-row variant of `ReorderList`. |
| `ds-link-target` | `LinkButton` and `NavItem` have no `target`. | `delegateWebsiteLaunch` opens same-origin links under the Studio base in a new tab. | A `target` prop (with `rel="noopener"`). |
| `ds-resource-list-meta` | `resource-list-item` always uses `auto 1fr auto`, sized for the selection checkbox; without selection, `meta` sits against the text. | Rule in `ds-gaps.css`. | Two tracks when there is no selection cell. |
| `ds-layout-audit-grid-tracks` | `auditLayoutCss` allows grid tracks on DS hooks. | `render.test.mjs` refuses any DS selector in app CSS. | Audit rule for grid tracks on owned hooks. |
| `ds-app-topbar-search` | `AppTopbar.search` is required. Its dialog uses `<template>`, whose `content` is empty when built by `ketjs-view` `html` on the client, so the dialog never opens (Cmd+K does nothing) and the trigger falls back to its link. | Search scoped to pages; lists have their own `SearchBar`. | Optional search; build the dialog without `<template>` or support client rendering. |
| `ds-app-brand-text` | `AppBrand` renders an image or a label, never both. | `Inline [AppBrand, Text 'Web']`. | A product-name suffix on `AppBrand`. |
| `ds-runtime-rebind` | `attachDesignSystemInteractions` binds only elements present at attach time; client re-renders lose menus and the drawer. | Detach and re-attach after each render, restoring focus. | Delegated listeners on the root, or a re-scan API. |
| `ds-surface-head-height` | A `Surface` head with `actions` is as tall as its button; one without is as tall as its title. Two surfaces in one grid row put their titles and bodies 3.6px apart. | Rule in `ds-gaps.css`: `min-height: var(--kv-control-height)` on every head. | The same minimum height in the DS `surface-head` rule. |
| `ds-section-head-align` | A `Section` head aligns to the top. With a title only, the 17px title sits on the top edge of its 30px action instead of its centre line. | Rule in `ds-gaps.css`, only without a description and above 48rem (below that the head is a column). | Centre the head when the heading has no description. |
| `ds-grouped-field-grid-gap` | The grouped presentation gives every `Grid` in `app-main` the 8px card gap. In a `Grid` of fields, an input ends 8px from the next field's label. | Rule in `ds-gaps.css`: the `form-grid` gaps on a `Grid` whose children are fields. | Scope the grouped card gap to card grids, or a field-grid component. |
| `ds-search-bar-type` | `SearchBar` sets no font size: its label and input inherit body text (15px) beside its 12px compact button, while field controls use `--kv-text-sm`. | Rule in `ds-gaps.css`. | `font-size: var(--kv-text-sm)` on the DS search-bar label and input. |
| `ds-table-action-align` | An end-aligned `DataTable` cell uses `text-align: right`, which a flex `ActionGroup` ignores: the header is at the end, the buttons at the start. | Rule in `ds-gaps.css`. | End-align flex content in `data-align="end"` cells. |
| `ds-bar-chart-row-columns` | Each `BarChart` row is its own grid with an `auto` value track, so a shorter value gives a longer bar track and the rows lose their shared scale edge. | Subgrid rule in `ds-gaps.css`, wide screens only. | Put the row tracks on `bar-chart-rows` and make rows a subgrid. |
| `ds-description-strip-wrap` | A wrapped `DescriptionList` strip keeps the separator border and padding on the first item of each new line, so that line starts indented behind a stray rule. | Narrow-screen grid rule in `ds-gaps.css`. | Draw separators only between items on the same line, or switch to a grid when the strip wraps. |
| `ds-app-shell-narrow-rows` | At ≤48rem the shell is one column with `min-height: 100dvh` and no row template; a short page stretches the empty sidebar row and opens a band above the location strip. | Rule in `ds-gaps.css`. | `grid-template-rows: auto minmax(0, 1fr)` in the DS. |
| `ds-data-table-header-priority` | An operational `ListPage` hides `secondary` cells at ≤42rem. `DataTable` defaults cells to `secondary` but gives `th` no priority, so headers stay over missing cells. `responsive: 'stack'` overlaps rows inside the operational list. The same rule drops the table's 38rem minimum, so with every column kept titles break letter by letter. | Rules in `ds-gaps.css` keep the cells and the 38rem minimum, so the table scrolls. | Priority on `DataTable` headers, or move lists to `KetTable`. |
| `ds-list-linked-cell-inset` | At ≤42rem an operational `ListPage` pads every cell 8px; a linked cell's `row-link` keeps its own 12px, so the linked title sits 12px right of its header. | Narrow-screen rule in `ds-gaps.css`: no padding on the linked cell, 8px on the link. | Give `row-link` the list's narrow cell inset. |
| `ds-menu-trigger-icon` | An icon inside a `Menu` trigger renders unsized. | The site menu's trigger is text only. | Size icons in the trigger like `Button` does. |
| `ds-builder-compact-identity` | WorkspacePage has no compact editor identity with back navigation and inline draft/publication states. | Builder-only header composition in ds-gaps.css. | Add a native compact editor identity, then remove this gap. |
| `ds-narrow-workspace-controls` | Narrow builder panels and taxonomy upload fields retain two columns; buttons can overflow. | Container-scoped rules in `ds-gaps.css`; all builder content panels and the block inspector establish the container. A select and its chevron are pinned to the row under the label, as in `ds-form-stacked-fields`. | Container-aware field layout and wrapping action labels; remove when the pin includes them. |
| `ds-livedoc-controls` | Public LiveDoc relies on legacy host control CSS. | Standalone control styles, hidden read-only toolbar, token mapping, taller article canvas (28–40rem desktop, 22rem mobile) and an article editor that fills the record column instead of stopping at 52rem. | Ship self-contained toolbar styling with the public editor. |

## 7. Known limits of the mock

- The builder supports empty slots, cross-slot moves, duplication, templates, media, undo/redo and
  device previews. Existing blocks can be dragged using handles on the canvas or structure tree,
  including across slots and into empty slots. Space/arrows/Enter provides keyboard placement; Escape
  cancels. Pointer feedback uses one animation frame and a fixed marker, with edge autoscroll. A valid
  drop creates one undo step; invalid, interrupted or stale drops never mutate the draft. The library
  still adds blocks with its Add action. This remains a finite block editor, not a theme-code editor.
- Pointer/touch controller tests pass; KetPlus only exposes click/fill/press/scroll, so physical
  mouse/touch drag, native touch scrolling and measured frame rate still need device verification.
  Keyboard placement, focus, cancel, undo/redo, save, empty slots and read-only UI are browser-checked.
- Visitor identity uses an explicit simulated verification code; no real identity provider or email.
- Scheduling runs through an explicit “simulate arrival” action; no background scheduler.
- Domain checks, notification/anti-spam settings and adapter receipts are fixtures. No DNS, mail,
  payment, booking, CRM or healthcare system is contacted.
- Media upload accepts small PNG/JPEG/WebP images in memory. Reload discards uploads.
- Import/export covers content drafts only. Import validates the whole batch before writing and never
  overwrites existing entries; it is not a complete tenant backup.
- Initial historical snapshots are synthesized from seed content. New revisions and publication
  snapshots are immutable within the fixture session; this is not real historical production data.
- Approval state in the Pro server is a map outside the fixture transaction; the command writes it last.
- No persistence: a reload restores the fixture.

## 8. Gates

Run from `design/website/`, with the node PATH prefix from the repository instructions.

1. `node --test 'test/*.test.mjs' 'pro/test/*.test.mjs'`: boundary, registry, routes, messages, store, shell,
   render and Pro. All green.
2. Every new test is mutation-checked: put the code back the way it was and the test must fail.
3. Visual check in KetPlus against both Atlas hosts, on a port other than the user's, at 1440 and 390,
   light and dark:
   `node atlas/server.mjs --port 4311` (core) and `node pro/atlas/server.mjs --port 4312` (Pro).
   Close every session and stop both hosts afterwards.
4. After a flow or route changes, run `npx --yes ketatlas@0.5.2 audit <bundle> --strict` on
   `design/atlases/website.ketatlas` (core) and `design/atlases/website-pro.ketatlas` (Pro), and open the
   changed flow in the viewer with `--renderer`.
5. Format and lint with the KetJS Biome, not the repository Prettier (KetJS style: single quotes, no
   semicolons, width 110). The KetJS config ignores this folder, so use a copy with VCS off:
   ```sh
   mkdir -p /tmp/website-biome && node -e "const c=require('../../apps/ketsuite/.ketjs/biome.json');c.vcs={...c.vcs,enabled:false};c.files={...c.files,includes:['**']};require('fs').writeFileSync('/tmp/website-biome/biome.json',JSON.stringify(c))"
   B=../../apps/ketsuite/.ketjs/node_modules/.bin/biome
   $B format --write --config-path=/tmp/website-biome client server pro atlas test
   $B lint --config-path=/tmp/website-biome client server pro atlas test
   ```

## Website scope and settings — decision 2026-09-30

The header explicitly selects a Website, not an ERP company/branch. Its menu switches websites and
contains Manage websites / Create website when the actor may manage sites. The company-scoped list
opens each website overview. ERP remains the authority for the company/workplace and access grants.

Settings is one flat page (no tabs): general information, domains, integrations and visitor-account
configuration. DS Section groups inside one Surface; no redundant Website heading. Domain detail
lives beneath settings/domains/:id and returns to Settings. General configuration preserves other
site fields and saves through the existing resource CAS boundary. The old company-list site editor
is replaced by Settings; sites/new is only for creation.

There is no Studio member list, editor or member API/fixture store. Legacy WEB-UI-006 requirements are
removed by the user. Removing member administration does not remove ERP capability checks. Guest accounts remain distinct from staff access in ERP.

The separate visitor-account privacy summary page was removed on 2026-09-30. Guest realm,
retention, consent version and login readiness are managed only in Settings. Readiness warnings
link to Settings. Public guest login and account routes remain unchanged.


### Image ownership — approved 2026-09-30

Website Studio has no standalone Media Library: no media list, editor, archive or upload screen.
Object Storage owns files. The builder retains image selection, alt text, fit and focal point settings
on the page block, plus public-file checks before publication. It does not link to a Website upload
screen. The Atlas keeps deterministic storage metadata fixtures for picker and preflight scenarios;
this is not a live Object Storage integration. The storage picker transport must be bound to the
existing storage API before production. Legacy WEB-UI-204/205/206 requirements are removed.

### Categories and tags — approved 2026-09-30

- Separate **Chuyên mục** and **Thẻ** navigation in Nội dung. Technical taxonomy-set configuration is hidden; existing bookmarks open the category list.
- Each detail page has separate surfaces: general fields, LiveDoc description, images, SEO/preview. Only categories have a parent. Both have slug, canonical, SEO title/description and indexing.
- Rich description uses the canonical `@ketvietlab/ketsuite/livedoc` local embedding. Persist the native blocks (including marks/table cells) plus a plain-text projection; no collaborative document server is implied.
- Both image fields use DS `DropZone`: thumbnail and cover, alt text, preview, replace/remove. PNG/JPEG/WebP/AVIF, one file per field, maximum 5 MB. Upload uses the existing `/files` multipart boundary, not a Website Media Library. The Atlas emulates Object Storage in memory; production storage/scanning remains unbound.
- A failed upload retains the previous image; a pending upload blocks record save. Saving the record commits references; it does not publish.
- Publication snapshots freeze description, images and SEO. Public category/tag archives filter assigned published posts and use the frozen metadata; cover is the share image.
- Archive is in the `…` header menu across resource editors and entry details. A native modal confirms the named record, focuses Huỷ, preserves draft on cancellation, and refuses in-use resources. There is no archive checkbox in the main form.

### Article composer: inline images

The native LiveDoc image capability is developed in the separate KétJS worktree described in
API-CONTRACT.md. The upload dialog composes DS ModalSheet and DropZone through AttachmentImage;
PNG/JPEG/WebP/AVIF up to 5 MB, alternative text, pending/error states, and entry/site binding reuse
the existing attachment path. Upload creates an attachment; only saving the article commits its
reference. Cancelling does not publish; unattached uploads expire after 24 hours and are collected server-side. Saved/history/publication references keep their images. No media-library screen
is restored. The composer is 28–40rem high on desktop and 22rem on narrow screens.

### LiveDoc image selection and layout

The core owns image selection, 20–100% width, left/center/right alignment, keyboard-accessible width
slider, drag handle and removal. The document stores `width` and `align`; read-only rendering has no
editing controls. Deleting a block only removes its reference in the new draft, never the storage
object or historical references. Attachment previews are bounded independently of intrinsic image
size (including the generic `image` field, not just cover/thumbnail).
