---
title: Backend UI development
description: Build KetSuite admin routes, server-rendered screens, forms, menus, joints, and islands.
---

KetSuite's backend is trusted first-party UI. It is server-rendered with `@ketvietlab/ketjs-view` and
the shared component kit in `@ketvietlab/ketsuite/ui`; it is not a replaceable storefront theme.
Client JavaScript is added through one of two explicit contracts: an island for a local rendered
component, or a browser behavior for progressive enhancement spanning server-owned shell DOM.

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

KétSuite sidebar menus normally have two levels: an application heading and its screen links.
Declare each screen's `parent` as the application ID (for example, `product.templates` and
`product.attributes` both use `parent: 'product'`). Do not add intermediate catalogue or
operations headings. A **Configuration** heading with two or more declared screen links
keeps its existing third level, including `admin.config`. Count declared links across
modules, before permission filtering; a viewer with fewer permissions still sees the
same configuration grouping.
Keep screen IDs, paths, `needs`, and `for` declarations stable when moving menu entries.
Use distinct sequence ranges to keep related screens together without another menu level.

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

The public kit includes list chrome, tables, cards, record workspaces, forms, actions, tabs,
progressive `Disclosure` for secondary detail, notices, empty and error states, and route-owned
modal sheets. Compatibility-only KetSuite UI may still provide domain-specific media, attachments,
date pickers, calendars, and scheduling primitives until those contracts move into the public
package. Prefer PascalCase exports in TSX where available.

Keep list state in the URL: search terms, filters, grouping, page, view, visible columns, archived state,
and locale should survive a copied link. Reuse the backend paging and search helpers instead of creating
a module-local query-string convention.

### Visual composition

Typography, spacing, component selection and surface/border rules live only in
[Két Design System](https://github.com/ketvietlab/ketjs/tree/develop/skills/ket-design-system).
The public catalogue at `http://127.0.0.1:4100/surfaces` demonstrates the components.

### Theme preference

Backend pages follow the operating-system colour scheme until the reader uses the theme icon in the
sidebar footer. In light mode the button shows a moon; in dark mode it shows a sun. The shell writes
`data-theme="light|dark"` on the document root and stores the explicit preference under
`ket.backend.theme` in local storage, so it survives reloads and stays in sync across tabs.

Applications consume the public design-system `IconButton`; they must not copy icon-only action markup
or persist another theme key. The button keeps one stable accessible name (`Toggle light/dark theme` in
English), exposes the current dark-mode state through `aria-pressed`, and lets the KetSuite browser
runtime fall back to `prefers-color-scheme` whenever no explicit selection exists.

### Screen composition

Use [Két Design System](https://github.com/ketvietlab/ketjs/tree/develop/skills/ket-design-system)
for collection, record-modal, typography, spacing and surface rules. The supported
component APIs are documented in [Design system](../design-system/).

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

An island declares a validated prop contract, a stable identity key, server view, and client export.
Use the typed helper so those four pieces cannot drift:

```ts
// File: packages/ketsuite/src/modules/example_backend/islands.ts
type EditorProps = { identity: string; recordId?: string; lang?: string }

export const islands = {
  'example.editor': defineIsland<EditorProps>()({
    props: { identity: 'text', recordId: 'id?', lang: 'text?' },
    key: ['identity'],
    client: 'example.mjs',
    export: 'editor',
    view: (props) => createExampleEditorView(props),
  }),
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

Factories are render-pure on both server and browser. They must not schedule `queueMicrotask`, fetch,
read storage/URL state, or query the document. Return a controller and start that work from
`mount({ root, lifetime })`; scope element lookup to `root`, bind listeners to `lifetime`, and keep
`dispose()` for timers, observers, sockets, or APIs without abort support.

Use a module `behaviors` declaration for delegated shell/form logic that has no component tree of its own. A
behavior receives `{ document, navigation, lifetime }`; call `navigation.apply(response, { signal })`
for enhanced POST responses so cancellation, build, MIME, slot, history, and island reconciliation
remain framework-owned. Do not use `globalThis.__ketNavigation`, module-level `installed` flags, or
manually replace slot HTML.

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

Product Template records publish `product_backend:template.tabs` and
`product_backend:template.panel` as one coordinated extension boundary. A contributing module renders
its tab through the first joint and renders content through the second only when its own tab is active.
Both joints receive `templateId`, `activeTab`, `locale`, and `querySuffix`; extensions must preserve the
locale suffix in their links and must use the shared `data-ui="tab"` contract. The Product screen keeps
the tabs inside the design-system `Tabs` navigation and owns the record page around the contributed
panel.

Cover shared components with contract tests and a representative rendered screen. Generated visual
artifacts may be used locally for inspection, but they are not source documentation and should not be
committed as PR evidence.

### Client record dialog context and actions

Tabbed record dialogs start at their content height on desktop. The runtime retains the tallest
rendered tab for that record as a minimum height, capped by the available viewport; switching to
another record resets the measurement. Only the panel scrolls, keeping the tab navigation visible.
Late text, image loads, disclosure changes, font readiness and viewport resizing trigger another
measurement. On compact screens the design system's full-screen dialog contract still applies;
that mobile viewport height is never retained as the desktop minimum. Explicit `fixedHeight`
workflow overrides retain their compatibility behaviour. Nested dialogs size independently.

`RecordModalDialog.actions(context)` renders a nested dialog's own fixed footer. Use
`RecordModalForm` with a stable `id` and footer buttons with the HTML `form` attribute,
just as for the main record's `actions`. The runtime continues to own validation,
submitting, busy state, layer-scoped drafts, focus and close confirmation. `hidden`
allows a form to supply non-visible command inputs without rebuilding its markup.
The form and trigger helpers are also exported from the browser `record-modal-client` entry.

A modal may use `context.route(id, creating)` for a read-only, same-origin JSON context
route instead of `context.fn`. That route returns `{ data, messages }` and composes
its reads through `ServeContext.call` so each function retains its authorization and
scope checks. It must not return server-rendered dialog HTML. The runtime handles
loading, aborts and cache policy for either source.

A successful command may declare `navigate(value, context)` for a same-origin
location, for example a newly created record or a URL-backed collection filter. The
runtime performs navigation only after the command succeeds; refusals retain the draft.

Action-only record forms (`data-layout="actions"`) opt out of field-container sizing and retain their intrinsic button width inside a fixed footer. This contract belongs to the shared RecordForm stylesheet.


### Deployment-owned record commands

A deployment may extend the browser-only `@ketvietlab/ketsuite/user-modal-client` entry to reuse the user record definition while supplying a separate record kind and permission-checked context route. A record command chooses exactly one `fn` or relative `route`; the shared runtime posts JSON with same-origin credentials and an idempotency header, normalizes refusal fields, preserves drafts and owns focus/history. Route commands must return the normal `{ ok, value }` transport envelope. The route must enforce actor permissions, tenant binding, CSRF and input bounds itself. A browser-visible command never makes an internal function public.

The external identity adapter may supply both email and temporary-password choices, provisioning state, verified activation, claim eligibility and persisted email delivery status. A local password hash or an accepted email request is not proof of external activation. Only a successful one-time claim may return the temporary password to the requesting administrator.

Persistent record modals follow completed navigation to a different record and close when the destination has no matching record. Refreshing the same record preserves its open draft.
