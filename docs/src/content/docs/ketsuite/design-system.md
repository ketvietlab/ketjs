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

Responsive behavior belongs to component and container contracts. Form fields remain inline, with the
label on the left and the control on the right, including narrow panels; only the number of field pairs in
a row collapses. Canvas workspaces keep spatial columns and use local horizontal scrolling on small
screens.

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
