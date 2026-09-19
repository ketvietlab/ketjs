---
title: Design system
description: Use and govern KetSuite's public components, catalogue, inventory, CSS, and browser behavior.
---

The KetSuite design system is a public, server-rendered package and a documentation application. The
package owns reusable markup, tokens, component styles, and `data-ui` contracts. KetSuite modules own
business data, translated copy, routes, permissions, and workflow behavior.

Run `npm run design:system` from the repository root to open the documentation application in
`apps/design-system`. It has three review surfaces:

- **Components** renders the state specimens exported by the public package.
- **Page patterns** exercises the only three full-page contracts: `ListPage`, `RecordPage`, and
  `WorkspacePage`.
- **Inventory** is the Wave 0 governance registry. It shows public exports, KetSuite compatibility
  exports, planned components, ownership, maturity, promotion decisions, evidence posture, and CSS
  ownership.

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

KetSuite compatibility CSS loads after the public stylesheet. It may adapt legacy markup, but it must not
copy public selectors or create another token scale. A compatibility file is removed only after inventory
shows no remaining consumer.

The public cascade order is declared once as `ket.reset`, `ket.theme`, `ket.app`, then `ket.user`.
Component styles remain aggregated through `styles.css`, but selector-bearing files live below their
owning component directory. Density changes the shared control height, row height, and content gap.
Layer, focus, reduced-motion, and container breakpoints use named tokens rather than local numbers.

In a two-column `form-grid`, full-span fields share the label width of half-span fields, so their controls align. At the single-column breakpoint all fields use the same inline label contract. Modules must not compensate with local margins or label widths.

Responsive behavior belongs to component and container contracts. Form fields remain inline, with the
label on the left and the control on the right, including narrow panels; only the number of field pairs in
a row collapses. Canvas workspaces keep spatial columns and use local horizontal scrolling on small
screens.

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

KétSuite operational lists order context, page identity with collection actions, query controls and table tools, then collection body.
This is the required pattern for new collection screens. The KétSuite `ListPage` and `ListScreen`
wrappers automatically render `frame.chrome.create` beside the title, above filters. Supply
`headerActions` only when the screen has a specialised primary action; it replaces the automatic
create link, so authorization remains the caller's responsibility. Omitting both leaves no creation
control; an explicit `headerActions={null}` suppresses a frame's default create link. On narrow
screens the action stacks beneath the heading, still before filters.
Keep bulk and secondary collection commands in `actions`; the KétSuite wrapper places them beside
the primary action in the header and removes the separate action bar. Bulk controls appear only
when rows belonging to their form are selected. The primary action remains visible. Do not position
buttons with module-local CSS or put creation links into `actions`. The
application `collectionControls` and `collectionActions` helpers split existing list chrome into
those slots without changing command or permission decisions. `searchCollectionRows` is reserved
for complete authorized catalogues: its explicit callback searches reader-visible fields. Paged
collections continue using their existing server query/search contracts.

The catalogue's List page specimen demonstrates the shared header action composition. Product, Partner and the other
collection screens use this same composition. Existing inline creation forms, such as accounting
period closing, retain their disclosure below the filters rather than placing a form in the header.

```tsx
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

`SearchFilterConfig.capabilities` can disable `groupBy`, `favorites`, or `customFilters` for a consumer that does not support those operations; omitted flags preserve the complete existing interaction. The component owns `search-filter-columns[data-columns]` and fits the panel to its supported sections. Product attributes reuse this compact SearchFilter island via `frame.chrome.searchContent`, with URL-backed display-type and variant-policy facets; there is no legacy search-menu fallback.
