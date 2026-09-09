# @ketvietlab/design-system

Public server-rendered components for dense operational applications.

The package depends only on `@ketvietlab/ketjs-view`. It does not know about
KetSuite routes, translators, models, functions, sessions, or deployments.

```ts
// File: src/ui/orders.tsx
import {
  AppShell,
  Button,
  DataTable,
  ListChrome,
  ListPage,
  ModalSheet,
  Page,
  RecordPage,
  Section,
  Surface,
} from '@ketvietlab/design-system'
```

Load `@ketvietlab/design-system/styles.css` and put `data-kv-design-system` on the
application root. Components own their markup and `data-ui` hooks; applications
provide business data and translated labels.

Compose content with unframed `Section`, `Stack` and `Grid`. `DataTable`, `Metric`
and `ContentCard` already own their surfaces; do not wrap them in `Surface` or
another card. Reserve `Surface` for unframed content that needs a working panel,
such as a form group or a standalone process tool.

Section headings have no bottom border or divider padding in any page pattern.
Separate sections with layout gaps; add a divider only when the content explicitly
requires one, never through a page-specific section override.

For titled working blocks, use `Surface title="..." body={form}` or
`DataTable title="..."`. The title sits inside the panel at 18px (`--kv-text-xl`),
with optional `actions` beside it. A titled table owns one panel, with a borderless,
transparent scrolling viewport inside; never wrap it in another `Surface`.
The title is retained in its empty state, with optional `emptyActions` for recovery.
Omitting `title` preserves the existing unheaded form surface or standalone table.

The app structure is demonstrated with `AppNavigation` and four practical layouts inside `AppShell`:
collection (`ListPage`), record (`RecordPage`), flow workspace (`WorkspacePage`
with `layout="flow"`), and canvas workspace (`WorkspacePage` with
`layout="canvas"`). Compatibility adapters remain available for migrated
screens, but new catalogue examples should show one of those practical surfaces
inside the shell.

`AppNavigation` is the canonical dashboard menu. Supply one grouped item model and
place it in `AppShell.sidebar`; it is a persistent sidebar above 768px and a native
`details` drawer below that breakpoint. The markup remains usable without JavaScript.
Items may contain recursive `children`; a parent expands its submenu directly below
the parent row, and an active descendant opens the complete path on first render.
Only leaf links expose the active state. Top-level branches form one accordion across
the complete sidebar, and the interaction adapter keeps the open branch from being
collapsed without choosing another branch. Use `expanded` when a branch should start
open without an active descendant.
The optional interaction adapter adds mobile dialog semantics, Escape/backdrop/link
closing, focus trapping and restoration, background inertness, and scroll locking.

```tsx
// File: src/ui/workspace.tsx
<AppShell
  sidebar={
    <AppNavigation
      id="main-navigation"
      label="Main navigation"
      identity="KétSuite"
      context="Operations workspace"
      groups={[
        {
          id: 'sales',
          label: 'Sales',
          items: [
            { id: 'orders', label: 'Orders', href: '/orders', active: true, count: 7 },
            { id: 'customers', label: 'Customers', href: '/customers' },
            {
              id: 'reports',
              label: 'Reports',
              children: [
                { id: 'sales-report', label: 'Sales report', href: '/reports/sales' },
                { id: 'stock-report', label: 'Inventory report', href: '/reports/inventory' },
              ],
            },
          ],
        },
      ]}
    />
  }
  main={<ListPage title="Orders" body={orders} />}
/>
```

The catalogue is isolated behind `@ketvietlab/design-system/catalogue`, so the
production entry point does not load its specimen data or catalogue chrome.
Its registry connects every public component to an owner, maturity, supported
states and a rendered specimen. Component implementation and selector-bearing CSS
live below per-component-family directories; consumers still import only from the
package root.

Run the component catalogue from the repository root:

```bash
# Run from: ketjs/
npm run design:system
```

Then open `http://127.0.0.1:4100`.

Open `http://127.0.0.1:4100/inventory` for the documentation-style governance
registry. It lists current public exports, the KetSuite compatibility kit, and
the planned component catalog with ownership, maturity, Wave, evidence posture,
and promotion decisions. Filters are URL-owned and work without client JavaScript.

Regenerate and verify its source snapshot with:

```bash
# Run from: ketjs/
npm run design:inventory
npm run design:inventory:check
npm run design:governance:check
```

### Operational demo

Run the same app on a separate port to inspect a connected sales workflow:

```bash
# Run from: ketjs/
PORT=4000 npm run design:system
```

Open `http://127.0.0.1:4000/demo`. The Vietnamese demo includes a flow overview,
searchable and paginated order collection, inline record forms, activity and
document tabs, a delivery board, creation sheet and state confirmation dialog.
It consumes public design-system components directly. App-owned behavior includes
selection, native form submission, validation, modal focus management and CSV export.
Synthetic orders live in the server process only and reset when it restarts;
the demo has no connection to production records, email or delivery services.

The demo uses `data-presentation="grouped"` on its design-system root: a light grey
canvas, grey page chrome and white working groups, with a grey KetSuite sidebar in
light mode.
The default light palette uses a neutral `#F6F6F7` canvas and a `#F7F5F5`
sidebar, with a `#E9E7E8` sidebar border and a pale indigo
`#EEF0FB` selected item. Header and context use the page grey; cards stay white, with
`#E2E4E8` content dividers. The dark sidebar remains optional.
Forms and titled tables own one boundary with an 18px heading inside;
table viewports have no second frame. Titled tables use 12px inset on every side,
matching the sales demo card, without extra viewport margins or an inner frame.
The record context column is a continuous
white region with unframed subsections and metric. Disclosures inside a working
group are unframed. Kanban cards retain individual boundaries because each is a
separate navigable record. Do not wrap a whole page or arbitrary sections in cards.
Grouped layouts use 8px between cards and 12px padding around each entire card,
including its heading and body. Page gutters and heading-to-body spacing are 12px.
Field and table-row density is unchanged.
Collection paging lives in `ListChrome.pager` above the table, alongside search and bulk controls.
The demo shows the visible record range and previous/next links, with no page-number strip or
separate `ListPage.footer` pagination panel. Paging, search and status filters preserve the
current query and sort order.
ListChrome is one command bar: a bounded search field on the leading side, with
filters and the result range clustered at the trailing edge. On compact widths
search and paging stay on the first row; filters wrap on the row below.
Bulk actions occupy space only when a selection exists.
The earlier `data-presentation="flat"` experiment remains opt-in; the catalogue
and other consumers retain the default presentation.

The contract is intentionally strict:

- Inter is the only UI typeface;
- sidebar, main application region, and context right rail use `--kv-radius-app-region` (`0`);
- independent objects such as KPI cards use the shared 3–12px radius scale;
- a page is never wrapped in one large card;
- record sections and rail sections use low-contrast separators instead of nested cards;
- component CSS consumes semantic/component roles, not numbered palette swatches.

The public entry exports actions, status and feedback objects, fields, navigation,
tabs, progress, layout primitives, the responsive application navigation, the
three-region app shell, page/record layouts,
`ListChrome` with `BulkActions` and `PagerBar`, the canonical list and record page
compositions, data tables, forms, and modal sheets. Use `ListPage` for operational
collections: applications provide translated identity, URL-driven controls and
result content while the pattern keeps header, controls, status, body and footer in
one stable order. `DataTable` covers the common collection contract: responsive
stacking, row selection, sorting, grouping, visible columns and row links. Do not
place record action buttons inside table rows; link the row to the record instead.
Use `RecordPage` for durable subjects, and the compatibility `FormPage` only for
existing create/edit screens that have not migrated. Form fields support native
controls, custom controls, checkbox/radio groups and nested field groups. Route-owned
`ModalSheet` instances carry close/backdrop metadata and become fullscreen at the
mobile breakpoint. The catalogue includes common component states; the page preview
also covers loading, empty, error, validation and read-only states in English and Vietnamese.

`rowHref` provides one keyboard link per row, including the full row pointer target.
Linked cells are display-only. Associate `selection.form` and `bulk.form` with the
same native form to submit selected IDs and the bulk command. Selection syncing
and select-all remain application runtime responsibilities.

Forms keep labels on the left and controls on the right, including on mobile.
Help and errors align below the control. Narrow panels reduce the number of field
pairs per row without stacking labels above inputs. Native inputs support `readOnly`,
`min` and `max`; choices can be disabled individually, and invalid nested groups
open automatically. Give repeated search/sort controls unique IDs. Loading links
are disabled, and empty query rows do not occupy space.

Route-modal and mobile-navigation focus trapping, background inertness, Escape,
focus restoration, scroll locking, and anchored positioning are provided by the
optional `attachDesignSystemInteractions` adapter. Route state, unsaved-change
decisions and submit outcomes remain application
responsibilities. Menu, popover, tooltip, dialog, toast, spinner and skeleton renderers
retain native links/forms and useful no-script behavior. See the backend development
guide for the full composition and integration contract.

Typed form exports cover scalar and selection fields, controlled combobox/tag pickers,
civil date and local-time values, native file inputs, and a generic relation renderer.
Applications retain validation, query, permission, timezone, upload, and persistence
ownership; renderers preserve submitted text and expose native fallbacks.

Data-operation exports compose URL-owned search/filter/sort/view state, one-link
resource rows, bounded grids, hierarchy, and inline native forms. The package renders
state and carries version tokens; application adapters own persistence, conflicts,
permissions, cross-page selection, and dataset queries.

Record composition exports cover facts, people, formatted values, one identity summary,
one neutral rail, activity/audit, attachments, and media. Applications pass authorized,
redacted results and retain storage and mutation ownership. Catalogue recipes vary slots
within `ListPage`, `RecordPage`, and `WorkspacePage`; they do not add a fourth page pattern.

Before release, run `npm run design:release:check` from the repository root. It
requires zero planned components, current migration/rollback notes, and locked
deprecation admission. Publishing remains a post-merge operation from `master`.
