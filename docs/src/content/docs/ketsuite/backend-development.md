---
title: Backend UI development
description: Build KetSuite admin routes, server-rendered screens, forms, menus, joints, and islands.
---

KetSuite's backend is trusted first-party UI. It is server-rendered with `@ketvietlab/ketjs-view` and
the shared component kit in `@ketvietlab/ketsuite/ui`; it is not a replaceable storefront theme.
Client JavaScript is added only as an island for interaction that cannot be represented by a normal
request, response, or URL.

## Request-to-screen flow

```mermaid
%% File: docs/src/content/docs/ketsuite/backend-development.md
flowchart LR
  request["Admin HTTP request"] --> route["domain_backend route"]
  route -->|"ctx.call()"| fn["Domain function"]
  fn --> data["Scoped datastore"]
  route --> screen["Screen data and translation"]
  screen --> kit["KetSuite UI components"]
  kit --> page["adminPage() response"]
```

Backend companions contain `index.ts`, route declarations/adapters, a `screens/` directory,
`menus.ts`, and optional `islands.ts` plus client assets. Their manifest depends on the domain and
`backend`; it may declare assets, styles, routes, menus, messages, islands, joints, and fills.

## Screen organization

Every routed business screen owns one `screens/<name>.tsx` file and composes its UI with JSX.
Shared business components may live in `screens/shared.tsx` or another appropriate UI directory;
generic presentation belongs in the design system. `screens/index.ts` only exports screen entry
points and types, with no composition or business logic.

```text
# File: packages/ketsuite/src/modules/example_backend
packages/ketsuite/src/modules/example_backend/
├── index.ts
├── routes.ts
├── screens/
│   ├── index.ts
│   ├── example-list.tsx
│   ├── example-form.tsx
│   └── shared.tsx
└── menus.ts
```

This tree starts at the public module source root. Private deployments put the same organization
under their module's `src/`; see [module source roots](/ketsuite/module-development/#module-source-roots).
Do not change build entry points as part of moving a screen.

**When changing a routed business screen or its route, migrate the complete affected screen to its
own JSX file in the same change.** The rule follows the code's role, not its name: it covers
`screen.ts`, `screen.tsx`, `screens.ts`, `screens.tsx`, `routes.ts`, `routes.tsx`, and differently named
files. Do not add new template-string or legacy view-builder screens, or leave one affected screen
split between the new component and its old route. Unrelated screens do not need a simultaneous rewrite.

Route files, whether `.ts` or `.tsx`, must not contain JSX, view builders, screen-specific state,
form/table markup, action layouts, or other rendering logic. They may call exported screen components
as ordinary functions; this keeps JSX composition in the screen file without requiring a route rename.

The shared `modules/backend/screen.ts` helpers (`adminPage`, `screen`, and `frameOf`) provide frame,
locale, session context, and document/fragment responses. They are infrastructure, not legacy
business screens; keep valid consumers and do not duplicate their behavior in each module. API and
webhook routes and public website theme/template pipelines are not business screens. A portal or
kiosk still organizes its business UI in JSX files, but must not gain an admin shell through this rule.
Administration screens continue to use the canonical `ListPage`, `RecordPage`, or `WorkspacePage`
contract and the owning repository's design-system rules.

Update imports, re-exports, and source-based audits when moving a screen. Preserve route paths,
authorization, locale, query-owned state, form refusals, and document/fragment behavior. Run focused
HTTP and browser E2E coverage for the affected screens, including desktop/mobile and relevant locales;
read the generated evidence before handoff.

## Route responsibilities

A route parses the request, calls domain functions, selects locale-aware navigation, and chooses a
screen. Keep business validation in the domain function.

```ts
// File: packages/ketsuite/src/modules/example_backend/routes.ts
import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { adminPage, inLocale, readForm, seeOther } from '@ketvietlab/ketsuite/backend'
import { ExampleFormScreen } from './screens/index.ts'

export const routes = {
  '/admin/example/new':
    (ctx: ServeContext): Route =>
    async (url, request) => {
      if (request.method === 'GET')
        return adminPage(ctx, url, request, {
          title: 'example_backend.create.title',
          body: (_, frame) => ExampleFormScreen({ translator: _, frame }),
        })

      if (request.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(request)
      const id = randomUUID()
      const result = await ctx.call('example.saveExample', { id, ...form }, url, request)
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, `/admin/example/${id}`))
        : adminPage(ctx, url, request, {
            title: 'example_backend.create.title',
            body: (_, frame) => ExampleFormScreen({ translator: _, frame, result }),
          })
    },
}
```

`ExampleFormScreen` is exported from `screens/example-form.tsx` through the export-only
`screens/index.ts`. Its JSX owns the form, errors, actions, and page composition; the callback above
only passes route data and the shared frame to that component.

Use `ctx.call()` for staff-facing operations so the request's session, permissions, scope, and effects
are enforced. `ctx.callUnchecked()` is for narrow infrastructure boundaries that perform their own
authentication and authorization; it is not a shortcut for backend code.

## Screens use the component kit

The public `@ketvietlab/design-system` package is the source of truth for tokens, shared primitives,
application shell, page and record layouts, and reusable patterns. Import new shared UI directly from
that package. Existing screens may import compatibility components from `@ketvietlab/ketsuite/ui`, or
backend framing and helpers from `@ketvietlab/ketsuite/backend`, while they migrate. The compatibility
entry also exposes the public package as `designSystem`; it must not redefine raw visual values.

Screens should compose components rather than authoring raw tags or new `data-ui` hooks.
`tools/ui-audit.ts` protects that contract so markup and styles do not drift across dozens of screens.
Run `npm run design:system` to inspect every public specimen at `http://127.0.0.1:4100/`.

The kit includes list chrome, tables, cards, record workspaces, forms, actions, tabs, progressive
`Disclosure` for secondary detail, notices, empty and error states, media and attachment panels, date
pickers, calendars, and scheduling primitives.
Prefer PascalCase exports in TSX where available.

Keep list state in the URL: search terms, filters, grouping, page, view, visible columns, archived state,
and locale should survive a copied link. Reuse the backend paging and search helpers instead of creating
a module-local query-string convention.

### Page surface hierarchy

All three canonical patterns share component-owned surface roles. A light operational page uses a
quiet grey context/identity band, controls and page canvas. White belongs to independent cards,
tables and content/form sections, not a full-width page body or an entire right-hand column.
`ListPage`, `RecordPage`, and `WorkspacePage` keep their existing header measurements and structure;
do not implement the hierarchy with a route-local background override or another whole-page card.

| Region | Token / behavior |
| --- | --- |
| Context and identity header | `--kv-page-chrome-bg`: page grey in light, existing panel tone in dark |
| Controls and record tabs | `--kv-page-bg`: continuous quiet navigation band |
| List and record content canvas | `--kv-page-content-bg` aliases `--kv-page-bg`; the space around content stays grey in light |
| Workspace canvas, both flow and spatial | `--kv-page-bg`: keep the gaps grey; cards, table surfaces and timelines remain independent objects |
| Content blocks in every page pattern | Existing `Surface`, `ContentCard`, `Metric` and table tokens own the white fill; compose `Surface` + `Section` for each content/form group, never wrap the whole page in one white surface |
| Tables | `--kv-table-bg`: opaque white in light; transparent in dark, preserving row hover/selection |
| Sidebar and record rail | Existing sidebar / subtle panel tokens, separated with low-contrast borders |

For narrow tables, use `responsive="stack"`: labelled cells stack at 768px and below, and row/cell
heights grow with their contents. The default `responsive="scroll"` preserves the wide table,
suitable for spatial schedules and inventory grids. The option reads the same on the design-system
`DataTable` and on the KetSuite `dataTable` helper, which adds selection, groups, sorting and
configurable columns on top of the same markup — a stacked row hides the header, so the helper
labels every cell it renders. Do not duplicate mobile table CSS in consumer modules. Browser
coverage must assert cell/row bounds as well as page overflow.

Prefer `stack` for an operational collection a person reads on a phone. A scrolling table there
does not shorten the row, it moves the row sideways, so every column past the first is a value the
reader has to discover by dragging — and nothing on screen says it is there.

These roles alias the existing palette; they do not add brand colours or change the dark palette.
`FormPage`, `DashboardPage`, and `BoardPage` are compatibility adapters for the same surface rules, not
additional page patterns. Do not add new consumers of those adapters.

Open the catalogue's **Review page surfaces** link, or
`http://127.0.0.1:4100/surfaces?kind=record&theme=light&lang=vi` to inspect a full-page specimen.
The permalink supports `kind=list|record|flow|canvas`, `lang=en|vi`, `theme=light|dark`, and
`state=baseline|loading|empty|error|validation|readonly`. Record tabs preserve page padding; optional
rails and controls can be hidden without leaving empty chrome. Compatibility specimens are available
as `form-compat`, `dashboard-compat`, and `board-compat` for migration regression checks.

Run targeted component and surface browser coverage when changing these roles:

```sh
# Run from: ketjs repository root
npm run build --silent
node --test .build/test/design-system.test.js
npm --prefix e2e run test:design-system -- page-surfaces.spec.ts
```

### Theme preference

Backend pages follow the operating-system colour scheme until the reader uses the theme icon in the
sidebar footer. In light mode the button shows a moon; in dark mode it shows a sun. The shell writes
`data-theme="light|dark"` on the document root and stores the explicit preference under
`ket.backend.theme` in local storage, so it survives reloads and stays in sync across tabs.

Applications consume the public design-system `IconButton`; they must not copy icon-only action markup
or persist another theme key. The button keeps one stable accessible name (`Toggle light/dark theme` in
English), exposes the current dark-mode state through `aria-pressed`, and lets the KetSuite browser
runtime fall back to `prefers-color-scheme` whenever no explicit selection exists.

### List page layout

Use the design system's `ListPage` as the baseline for an operational collection. The screen provides
translated identity, the primary action, URL-driven list chrome, optional result context, and the list
body. `ListPage` keeps those regions in a stable order and owns their responsive spacing; a module must
not recreate that hierarchy with a route-specific header or a card around the whole page.

Keep the primary create action in `actions`, where it stays beside the title. Put
search/filter/view/paging controls in `controls` and the result count in `status`; the pattern combines
those two slots into one command bar instead of scattering them over separate rows. The table, kanban,
or empty state belongs in `body`. More capable KetSuite tables can still provide selection, groups,
sorting, and configurable columns inside the public page pattern. The product catalogue at
`/admin/product/templates` is the reference integration for this composition.

### Record workspace layout

Use `RecordWorkspace` for a deep record or edit screen. The shared layout owns the hierarchy rather
than each module rebuilding it:

- breadcrumbs, identity, record actions, and summary facts span the complete workspace;
- the action controller occupies the upper-right of the identity header and wraps below the identity on
  narrow screens;
- tabs remain between the record summary and the active body;
- an optional aside starts beside the body, not beside the breadcrumbs or identity header, and follows
  the body on narrow screens.

Pass an explicit three-level breadcrumb trail when the module has a catalogue or directory level. Older
screens receive a stable fallback from `kicker` and `title`. For an edit form whose submit action belongs
in the record header, set `RecordForm.submitPlacement` to `external` and place a button associated through
its `form` attribute in `RecordWorkspace.controller`. This keeps native form submission and validation
while avoiding a duplicate submit row inside the form card.

## Forms and validation

Render the values a developer submitted after a validation failure and map domain issues to their
owning fields. The domain function remains authoritative; client validation is an early feedback layer,
not a replacement for server checks. Follow the shared issue shape and the KetJS
[Form validation](/ketjs/form-validation/) contract.

Use Post/Redirect/Get after successful mutation. This prevents refresh from resubmitting a command and
keeps the record URL canonical. A rejected form should render directly with its errors and preserve
the input.

`AppShell` owns the page's single `main` landmark. Patterns rendered inside it, including `FormPage`,
use sections and neutral body containers instead of adding another `main`; optional contextual rails
use a labelled `aside`. This keeps the primary reading region unambiguous for assistive technology.

## Islands

An island declares a validated prop contract, a stable identity key, server view, and client export:

```ts
// File: packages/ketsuite/src/modules/example_backend/islands.ts
export const islands = {
  'example.editor': {
    props: { identity: 'text', recordId: 'id?', lang: 'text?' },
    key: ['identity'],
    client: 'example.mjs',
    export: 'editor',
    view: (props) => createExampleEditorView(props),
  },
}
```

Author non-trivial island views as typed TS or TSX beside the shared UI layer. A scoped build may emit
their browser ESM into the owning module's declared asset root; generated `.mjs` files are deployment
artifacts and must not be edited by hand. Keep `@ketvietlab/ketjs-view` external in that build and import
the copy served at `/_ket/view/`, otherwise every island bundles a second renderer. A module can keep
styles and generated browser entries under one asset root even when the authoring source lives in the
UI layer.

Do not hydrate an entire page to implement a small selector. Server rendering must remain useful before
hydration, and island props must contain only data the current viewer is allowed to receive.

### A screen that is waiting for something

A screen whose work finishes elsewhere — a backfill, a projection being rebuilt — used to say so with
`<meta http-equiv="refresh">`. That reloads the whole document on a timer: it throws away scroll
position, focus and anything typed, on a schedule with no relation to when the work actually finished.

`liveRegion` says the same thing to the reader, announces it to a screen reader, and names the stream
the runtime should listen on:

```tsx
// File: packages/ketsuite/src/modules/example_backend/screens/example-detail.tsx
liveRegion({
  label: _('example.state.rebuilding'),
  stream: running ? `example-rebuild:${runId}` : null,
})
```

The backend runtime island opens `/_ket/stream/:id` for it, and on any chunk asks for the current URL
again — a fragment navigation, so the page is patched rather than replaced. When the stream ends the
connection is closed and the screen refreshed once more.

`stream` is the **public** id the deployment's `resolveStream` authorizes, never a storage key. Pass
`null` and the component is only a status line: correct, and refreshed by whatever refreshes the rest
of the page. A browser without `EventSource` gets the same — the screen is server-rendered and complete
without any of this.

The producer is the job, writing to the topic `resolveStream` maps that public id onto. See the
resumable stream section of the KetJS integration guide for what wakes the reader and what it costs.

### Charts

A chart is a canvas, so it is an island — `backend.chart`, reached through the
`backend:screen.chart` joint. `chartControl` resolves one the way `relationControl`
resolves a picker:

```ts
// File: packages/ketsuite/src/modules/example_backend/screens/example-revenue.tsx
const plot = await chartControl(ctx, url, req, 'example-revenue', {
  kind: 'line',
  label: _('example_backend.revenue.title'),
  labels: buckets.map((bucket) => bucket.label),
  datasets: [{ label: _('example_backend.revenue.now'), series: 1, values, formatted }],
  axis: axisScale(peakOf(datasets), units),
})
```

Two rules the config exists to enforce. The island is handed props and nothing else — no
context, no translator, no company currency — so every amount arrives already formatted
and every word already translated, including the axis unit; a browser bundle that
formatted money would disagree with the tables printed beside it. And a dataset carries a
palette slot rather than a colour: the client reads `--admin-chart-N` off the document
when it mounts, so `tokens.css` stays the only place a chart hue is named and a
colour-scheme change is re-read rather than baked in.

The same rule applies to server-rendered tables. Use `formatMoney(_, value, currency)` for business
amounts and `formatDateTime(_.locale, instant, options)` for instants. Both reuse immutable Intl
formatters; constructing `Intl.NumberFormat` or `Intl.DateTimeFormat` inside a column `cell` callback
makes formatter setup scale with the row count.

Pair the canvas with `Chart`, whose legend carries the same numbers as real text. A
canvas has no text in it, so a reader without the bundle, a screen reader, and a printed
page all get nothing from it — the legend is what makes the chart optional rather than
load-bearing, and it can carry links a canvas cannot. `BarChart` is server-rendered for
that last reason: its rows link into the ledger behind each bar.

`chart.js` is bundled by `tools/build-chart-client.mjs`, separate from the island builder
because it pulls a real dependency into the output — the same reason the Live Doc editor
has its own builder for `yjs`. Both are named exceptions in `tools/zero-dep-audit.ts`,
not an open door, and both are imported through the package's root entry only.

## Module-owned styles

The public design-system package owns the shared shell, tokens, and UI-kit baselines. The build copies
its CSS into the backend asset tree and loads it before KetSuite compatibility styles; never edit that
generated copy. A feature module must ship
its visual rules from its own asset root instead of adding product-, partner-, or route-specific selectors
to the backend design styles:

```ts
// File: packages/ketsuite/src/modules/example_backend/index.ts
export default defineModule({
  name: 'example_backend',
  depends: ['backend'],
  assets: new URL('./client/', import.meta.url),
  styles: ['example.css'],
  routes,
  menus,
})
```

Composition namespaces the asset URL by module and loads dependency styles first, so `backend` provides
the baseline before `example_backend` applies its scoped adjustments. Keep module rules inside
`@layer ket.app`, scope them to a module-owned root or state, and consume semantic tokens. Add a rule to
the shared backend styles only when the corresponding component is genuinely reusable through
`@ketvietlab/ketsuite/ui`.

## Extension joints

Publish a joint when another module has a legitimate structural contribution to a screen. Declare its
typed props in the owner, and let dependent modules provide fills. Do not create an empty joint for a
hypothetical extension or use CSS selectors as an extension API.

Cover shared components with contract tests and a representative rendered screen. Generated visual
artifacts may be used locally for inspection, but they are not source documentation and should not be
committed as PR evidence.
