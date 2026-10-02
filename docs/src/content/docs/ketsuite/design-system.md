---
title: Design system
description: Use and govern KetSuite's public components, catalogue, inventory, CSS, and browser behavior.
---

The KetSuite design system is a public, server-rendered package and a documentation application. The
package owns reusable markup, tokens, component styles, and `data-ui` contracts. KetSuite modules own
business data, translated copy, routes, permissions, and workflow behavior.

Design guidance is maintained only in [Két Design System](https://github.com/ketvietlab/ketjs/tree/develop/skills/ket-design-system).
Install it with `npx @ketvietlab/ket-design-system-skill@latest`. This page documents
APIs and runtime delivery; it does not define a competing visual rulebook.

Run `npm run design:system` from the repository root to open the documentation application in
`apps/design-system`. It has three review surfaces:

- **Components** renders the state specimens exported by the public package.
- **Page patterns** exercises the only three full-page contracts: `ListPage`, `RecordPage`, and
  `WorkspacePage`.
- **Inventory** is the Wave 0 governance registry. It shows public exports, KetSuite compatibility
  exports, planned components, ownership, maturity, promotion decisions, evidence posture, and CSS
  ownership.

## Relation selectors

`createRelationSelectView` also accepts optional client-only `RelationSelectCallbacks`. A composing
island can supply reactive `options` and `disabled` readers, handle `onSelect`, and enable an
`onCreate(query)` action in the dropdown. `resetAfterSelect` returns an add-to-list picker to its
placeholder after selecting an option. Local callback-backed options are searchable in full, with no
empty remote-manager dialog. These callbacks do not go into serialized island configuration; existing
form fields and server-managed relation selectors retain their contracts.

## Disclosure actions

`Button` and `IconButton` accept optional `expanded` and `controls` props for an action that shows or
hides a region, such as a row's inline editor. They render `aria-expanded` and `aria-controls`; the
application still owns the open state and the region's id. Omitting both keeps the previous markup.

## Inventory contract

`npm run design:inventory` regenerates the inventory from the public and compatibility entry points.
`npm run design:inventory:check` fails when the committed snapshot no longer matches source. The normal
verification pipeline runs this check before building.

Classification policy lives in
`packages/design-system/src/catalogue/inventory-policy.json`. A source module must have an owner,
decision, target, wave, and gap task before its exports can enter the registry. Planned components use
the same vocabulary before implementation starts.

The decisions mean:

- **Keep** preserves a public contract as-is.
- **Refactor** changes source ownership while preserving the public contract.
- **Promote** moves a generic compatibility capability into the public package after evidence and tests.
- **Build** introduces a missing domain-neutral component.
- **Recipe** documents a composition without creating another full-page pattern.
- **Domain** stays in KetSuite or an optional domain kit.
- **Defer** requires more consumer or performance evidence before a package boundary is chosen.

The inventory is evidence, not an automatic promotion mechanism. A compatibility capability still needs
independent consumers or a canonical dependency reason, domain-neutral props, an SSR fallback, states,
accessibility behavior, specimens, and tests.

## Source and catalogue governance

Wave 1 gives every public component family a directory entry point. The root package remains the only
application import path; the former source files are temporary internal forwards so repository code can
migrate mechanically without changing the published API or `data-ui` markup.

The catalogue has three separate responsibilities:

- `catalogue/registry.ts` maps every public component to its owner, directory, maturity, states, group,
  and specimen.
- `catalogue/groups.ts` adds owner, maturity, and state coverage to documentation groups.
- `catalogue/specimens.tsx` contains rendered examples, separate from the page renderer and navigation.

Run `npm run design:governance:check` to enforce public-export coverage, unique registrations, valid
component directories, specimen references, unique hook declarations, selector ownership, and the ban
on unsupported package deep imports. This check is part of `npm run verify`.

## CSS delivery

Component source owns its selectors. The package continues to publish one ordered production stylesheet
so applications do not have to reconstruct cascade order. As components move into per-component
directories, their CSS moves with them and the aggregate entry remains compatible.

The public cascade is `ket.reset`, `ket.theme`, `ket.app`, then `ket.user`.
Visual and compatibility ownership rules live in the skill.

### SearchFilter and KetTable

SearchFilter owns its popup geometry. The panel anchors to the search bar, fits its container, and
switches from stacked sections to three columns using the component's container query. Consumers
must not compensate with sidebar-width calculations or raise the entire application main layer.
`size: 'compact'` changes the bar density. `maxGroupBy` optionally limits grouping depth while leaving
removal and reordering available. The added grouping labels are optional for existing consumers.

KetTable supports two delivery modes through the same public `createKetTableView` contract:

- **RPC:** supply `manager` for client-driven sorting, paging and group loading.
- **URL-driven:** supply server-rendered rows and groups, column `sortHref`, and group `href`/`open`.
  Nested group expansion is explicit at every depth. Group `pager` accepts `label`, `prev` and `next`.
  `page` and `sort` seed the current state. `pager: false` leaves paging to the existing page toolbar;
  otherwise `pager: { prev, next }` renders native links (page size comes from `manager.pageSize`,
  default 50). Native navigation preserves bookmarks, server permissions and record-modal links.

Both modes share row selection and external bulk forms. The primary `kt-row-link` has
`data-primary="true"`; its hit area spans the row while checkboxes and cell controls remain separate.
An empty grouped result uses the same empty-state contract as a flat result.

All `ListPage` consumers preserve navigation context for same-path GET controls. SearchFilter's
`{ href }` apply result uses the backend shell's shared fragment navigation: filtering, grouping,
clearing and selecting favorites no longer reload the document. The shell updates the results,
toolbar and URL together, then focuses the search input (desktop) or filter trigger (mobile).
Back/Forward re-renders the corresponding server state. This covers native/static `KetTable`
adapters and island-backed tables without duplicating domain queries in the browser.

This is an SSR-first hybrid, not JSON-only CSR: URL-driven responses still contain server-rendered
fragments; islands hydrate/reconcile those fragments and own their client interactions. The first
document remains complete SSR. Permissions, localized cells and custom server cell callbacks retain
their server contracts. RPC-driven tables retain their existing client loading mode.

For a custom shell, listen for `ket:search-filter-navigate` on `document`. Its exported
`SearchFilterNavigateDetail` contains the filter `id`, `href`, cancellation `signal` and
`respondWith(promise)` callback. Supply the navigation promise synchronously. A failed navigation
rolls back chips to the displayed list; retryable failures retain the exact attempted draft. Without
a handler the component retains native navigation, and the legacy `{ html, href }` response remains
supported. A new filter attempt aborts its preceding navigation request.

`locale` controls formatted cells. Currency cells and `FormattedMoney` accept decimal strings without
coercing them through a floating-point number, preserving database precision.

Custom cells register through `KetTableExtensions` in one shared SSR/client adapter, not through
callbacks serialized in island props. KetSuite's `thumbnail-label` renderer intentionally reuses the
existing backend thumbnail compatibility primitive pending that primitive's public promotion.

The public `KetTable<Row>` server component renders through this same grid engine. Use it when a
URL-owned collection has semantic cell callbacks, record links or inline command forms. Its
`KetTableServerProps<Row>` accepts `columns[].cell`, rows, recursive groups, sort state, caption,
responsive mode and external-form selection. These callbacks execute only on the server; they never
cross an island JSON boundary. Native checkboxes submit `fieldName.id=1` to the supplied form.
`rowLink: false` retains keyboard row navigation when the first cell already contains a link.
KetSuite's `collectionTable` adapts its existing column/selection metadata to that public component;
the legacy column visibility menu remains an explicit compatibility slot until its own promotion.

The `listChrome`/`pagerBar` adapter accepts `Pager.totalLabel` for a localized or
capped display count such as `10,000+`; `total` remains numeric and `prev`/`next`
come from the query result. `headerActions` replaces the automatic create link;
`headerActions={null}` suppresses it. `search.id` and `sort.id` associate controls
when several toolbars share a document. `searchCollectionRows` searches a complete
authorized catalogue through its explicit reader-visible-field callback; paged
collections retain their server-side query implementation.

Native `Field.readOnly` text/date/number values remain selectable and submitted;
disabled controls do not submit. Selects and choice controls have no native read-only
state, so an application can pair a disabled control with a hidden submitted value.
`min`/`max` preserve numeric/date bounds, and checkbox-group requirements belong to
group validation rather than making every option required.

For an existing RecordWorkspace integration, `RecordForm.submitPlacement="external"`
omits the local submit row; a controller button associated through its native `form`
attribute submits and validates that form. `ModalSheet mode="embedded"` renders a
specimen, while active route modals require the shared focus/history runtime.

The collection adapter exposes `frame.chrome.create`, `headerActions`, `actions`
and `controls`; the [skill](https://github.com/ketvietlab/ketjs/tree/develop/skills/ket-design-system)
defines their composition. Example:

```tsx
// File: packages/ketsuite/src/modules/product_backend/screens/list.tsx
<ListPage
  variant="operational"
  frame={frame} // chrome.create contains the authorized { label, path }, if any
  title={title}
  controls={collectionControls(_, title, frame)}
  actions={collectionActions(_, frame)}
  body={collectionTable(_, table)}
/>
```

### Record and workspace composition

Wave 5 adds description lists, people, avatar groups, status, formatted values, record summaries,
actions, neutral rails, activity, audit, attachments, and media. Applications provide already-
authorized and already-redacted results; storage URLs, uploads, deletions, queries, and permission
decisions stay outside the renderers. Activity and media families cover loading, empty, error, and
redacted outcomes without inventing domain behavior.

The catalogue documents worklist, analytical list, settings, master-detail, board, schedule, and
timeline recipes by composing `ListPage`, `RecordPage`, or `WorkspacePage`. These are slot recipes,
not additional page-pattern exports. Canvas recipes are reserved for spatial work and keep their own
horizontal overflow contract on narrow screens.

## JavaScript delivery

Public renderers are pure SSR. Native links, forms, disclosure elements, and URL-owned state must remain
useful without JavaScript.

Browser behavior has two explicit delivery paths:

- Document-wide behavior owns shared dismissal, focus restoration, table selection synchronization, and
  other behavior that applies to existing server-rendered markup.
- Typed islands own stateful widgets such as autocomplete, anchored positioning, charts, and future
  virtualization. An island receives serializable props and has an explicit mount and cleanup lifetime.

The documentation and design-system roots are not hydrated as one client application. A component may
not create a private runtime merely to support its catalogue specimen.

### Interaction runtime

Wave 2 adds `Menu`, `ActionMenu`, `Popover`, `Tooltip`, `Dialog`, `ConfirmDialog`, `ToastRegion`,
`Toast`, `Spinner`, and `Skeleton`. Their state stays explicit in renderer props and URLs. Menus use
native disclosure, actions remain links or native form submissions, tooltip content is text-only, and
dialogs always have an accessible name and close path.

`attachDesignSystemInteractions(root)` is the optional document adapter. It owns Escape handling,
modal focus containment and restoration, background inertness, menu focus restoration, and collision-
aware popover positioning. It returns cleanup and does not own business state. The catalogue loads the
same adapter from `runtime/auto.js`, so specimens exercise the production behavior rather than a private
documentation runtime.

Without JavaScript, menu disclosure still works, action links navigate, form commands submit, and
controlled overlay close/open URLs remain usable. Applications decide when an overlay exists and own
unsaved-change policy; the adapter only enforces browser mechanics around the rendered state.

### Typed forms and pickers

Wave 3 keeps `Field` compatibility while separating its native control renderer and adding typed scalar,
selection, combobox, civil date/time, upload, and relation-picker APIs. A visual error can be supplied
directly or resolved from a `{ path, message }` issue list; validation remains an application concern and
rejected submissions can render the original text unchanged.

Combobox query, open state, result set, and selected values are controlled. `RelationPicker` receives
permission-filtered records and mapping functions; it never queries data or decides permissions. Date
values stay as civil `YYYY-MM-DD` text, and local date-time values are not implicitly converted through
UTC. File controls use the native input for submission while the application owns transport, storage,
limits, and authorization. Every control keeps the left-label/right-control form layout at narrow widths.

### Data operations

Wave 4 adds composable search, filters, applied filters, sorting, saved views, view settings, resource
lists, bounded data grids, trees, tree grids, and inline editing. `withQueryState` updates named URL keys
while preserving unrelated search state. Saved-view renderers carry version tokens but do not read or
write persistence, and inline edit keeps the rejected input and a native form submission path.

`ResourceList` gives each row one keyboard destination. `DataGrid` supports explicit column order,
visibility, pinning, and density, and caps rendered rows (500 by default) instead of rendering an
unbounded dataset. Use `Tree` for navigation hierarchy; use `TreeGrid` only when the hierarchy has
independently useful tabular columns. Every large or spatial surface owns its local overflow on narrow
screens.

## Maturity and compatibility

The registry uses `planned`, `stable`, `compatibility`, and `deprecated` maturity states. Planned
components are not package exports. Stable components are available through the root package entry.
Compatibility and deprecated entries remain visible until their replacement has shipped and downstream
consumers have migrated.

Do not add category subpaths while root exports remain manageable. The current public subpaths are for
the contract, catalogue, and styles. Source directories are ownership boundaries, not consumer import
paths.

## Release readiness

`npm run design:release:check` requires a current zero-planned inventory, aligned workspace/package
versions, deprecation metadata, migration notes, rollback instructions, and an explicit classification
for optional/deferred capabilities. On feature branches it also rejects newly added `FormPage`,
`DashboardPage`, or `BoardPage` consumers outside the compatibility layer.

This check establishes release readiness; it does not publish. Publication must run from a commit
reachable from `master`. Private Két Việt pinning, cohort migrations, zero-consumer deletion, and rollback
evidence follow the released exact SHA.

Public operational `ListPage.actionsPlacement="header"` places `actions` in the `list-page-tools` subgroup beside `headerActions`, without a separate action row. The KétSuite wrapper selects this placement for every operational list. `actionsHidden` hides only the tools subgroup in this mode, preserving the primary action and external form associations. Bulk-only tools initially stay hidden, including when extensions render empty fragments. The client follows each form's enabled row checkboxes and KetTable island persisted selection inputs. Clearing selection closes that form's menu and hides its tools when no other commands remain. The public component retains its default body placement for compatibility. Complete inline creation/configuration forms belong in the body above the table, not in the header tools.

`ReorderList` owns ordered editable row layout, drag handles, add/remove and accessible move controls. It emits the ordered stable ids as JSON through its hidden native field and a bubbling `change` event; its controlled parent supplies updated row content. The record-modal runtime captures textual drafts before consuming this field into view state. `RecordModalForm.body` composes the editor inside the single submission form; `dirty` keeps structural and retained edits subject to the existing close guard.

`SearchFilterConfig.capabilities` can disable `groupBy`, `favorites`, or `customFilters` for a consumer
that does not support those operations. Omitted flags enable sections that have usable content: grouping
requires options; favorites require existing entries, a save function, or `favoriteHref`. Explicit
`false` always hides the section. The component owns `search-filter-columns[data-columns]` and fits the
panel to its supported sections. Product attributes reuse this compact SearchFilter island via
`frame.chrome.searchContent`, with URL-backed display-type and variant-policy facets; there is no legacy
search-menu fallback.

SearchFilter uses separate Filters, Group by, and Favorites triggers by default for every consumer.
`search-filter-toggle` remains the single filters trigger; nested options keep `disclosure-summary` and
`menu-item`. Applied `search-filter-facet` chips live in a separate row, including ordered groups. Their
existing `data-type` distinguishes `filter`, `field`, `favorite`, and `groupBy`; count tests should
select the kinds they mean. `search-filter-section-toggle[data-section]` opens a desktop section;
`search-filter-columns[data-panel]` selects that section. Triggers and panels have names matching their
section. Below 641px, only the filters trigger is visible and opens a native modal dialog
(`search-filter-sheet`) containing the shared client `ModalSheet` with `dialogSemantics="parent"` so the
native ancestor owns the single accessible dialog role. Opening focuses the visible close button; the
client backdrop is hidden from the accessibility tree and tab order. Native modal focus containment,
backdrop/close buttons and focus return are owned by the island. Escape closes the nearest open nested
disclosure and focuses its summary, then closes an open favorite form and focuses its toggle, before
a subsequent Escape closes the panel or sheet. Closing the menu resets the inline favorite form.
`search-filter-empty` owns the sentence-case saved-search empty message; `search-filter-icon` and
`search-filter-clear` also belong to this component. Consumers must not override their descendants.

Clear filters preserves the keyword and grouping, removing filter rules/presets and the active favorite.
The shared apply handler removes the `favorite` query parameter; an explicit empty `q` prevents a
cleared list from automatically reloading its default favorite. Other navigation parameters remain
screen-owned. `SearchFilterLabels.operatorLabels`, `clearFilters`, `close`, `favoriteCancel`,
`favoriteError`, `valueFrom`, and `valueTo` are optional translated labels with English defaults.
KétSuite supplies Vietnamese and English; downstream consumers that construct labels directly must
translate the new labels during their release-pin update. `CustomFilterField.choices` supplies
value/label pairs for selection and reference editors. KétSuite maps declared spec choices and can
supply permission-checked `fieldChoices`; product uses its existing category/unit API results.
Number/date/datetime use typed controls, ranges have two inputs, and valueless operators have none.

`favoriteHref` links to an existing screen-owned form; product keeps that route modal inside
`backend.content` so fragment navigation can open and close it. Without it, the local save form is
created below `favorite-save-toggle` only after the reader requests it. This trigger is not a menu
selection and keeps the desktop panel open. Opening focuses the name; cancellation and successful saving
return focus to the trigger while the component remains mounted. API errors in favorite operations use
`favoriteError`, independently of filter-application errors, and never expose raw server diagnostics.

Migration: no module opt-in is required; existing capability flags, hooks and apply payloads are
retained. Rollback the SearchFilter change as a unit (component, labels, shared URL handler, inventory
and tests) if a downstream consumer fails its interaction checks. The product-only density/header branch
is independent.


### Application topbar and compact lists

KétSuite uses compact density by default: 40px desktop rows, sentence-case column headings, and
smaller operational list headers. Mobile selection targets remain at least 44px. Tables retain all
columns and scroll horizontally; the scroll region is keyboard focusable. Classifications use plain
`Text`, with `tone="muted"` for secondary values; reserve `Badge` for lifecycle states and exceptions.
`MediaLabel` renders a 24px thumbnail only when present or explicitly reserved. Product lists reserve
image space across a page only when at least one visible record has an image.

`AppShell.location` places `AppTopbar` with its `location` prop inside the main column: organisation context
on the left, compact search and all account/indicator/theme tools on the right. `AppBrand` lives in
the sidebar navigation header. The strip is 48px high; no global bar spans both columns.
The optional `AppShell.topbar` remains available to other consumers. The launcher opens a native modal dialog
containing the existing GET search form; local list search remains visible beside its results. `NavigationToggle` can control `AppNavigation` with `externalTrigger`;
the shared runtime owns its mobile drawer, focus return and inert background. Ctrl/Cmd+K opens global search and focuses its input when no other dialog is open.
Escape, the close button and backdrop close search and return focus to its launcher without clearing
the draft. The modal frame stays in an inert template until opened; its search form remains
inside the closed native dialog so fragment navigation can preserve its draft. Mobile uses an icon launcher the height of the other topbar controls and a full-screen dialog. The optional
`search.triggerLabel`, `search.closeLabel` and `search.id` localize the launcher and close action and
distinguish multiple catalogue shells. A native link and noscript form preserve search without JavaScript. KétSuite retains the `backend.global-topbar` fragment slot for navigation compatibility, now inside
the main column. KétSuite no longer displays breadcrumbs. A shell with `location` hides
the nested page identity context; standalone pages keep their context. The sidebar footer tools
move into this strip, including extension items and the account menu. Account menus open downward.

`/admin/search` requires a session and searches permitted menus, products and partners. Optional record
providers call the same permission-checked, company-scoped functions as their lists, with eight results
per provider and native detail links. Empty queries never enumerate records. Search terms are bounded
to 200 characters. Search is server rendered and works without JavaScript.

`searchFilterRuleLabel` is shared by server and island labels. Group intervals are localized, including
Day/Week/Month/Quarter/Year. KetTable errors use the consumer's localized `loadError`, never raw server
exception messages. The sidebar search hooks are retired; consumers should use AppTopbar search.
