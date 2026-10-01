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

### Primitive harness

Run `npm run design:system` and open `/primitives` for a comparison surface of every
registered primitive. The catalogue rail links to it. `theme=light|dark|system`,
`density=compact|default|comfortable`, and `tab=overview|activity` are URL-backed;
theme and density changes retain the navigation specimen's active tab.

The seven families cover action hierarchy and sizes, loading/disabled states,
semantic tones, long labels and identifiers, field validation/access states,
native choices, route navigation, feedback, and progress boundaries. Use keyboard
Tab/Shift+Tab for focus, Space for checkboxes, arrow keys for radio/select controls,
and Enter for the breadcrumb disclosure and route links. Compare at 390px, 768px
and 1440px in both themes and all three densities. A text action and an icon action
of the same size must share a height; fields must align and content must stay inside
its sample at narrow widths. The harness deliberately leaves actions as specimens;
it does not simulate saving or creating records.

`PrimitiveHarness` and `primitiveSections` are available from the `/catalogue`
entry. Its `primitive-harness`, `primitive-section`, `primitive-section-head`,
`primitive-row`, `primitive-caption`, and `primitive-sample` hooks own only the
comparison layout. Component internals use the same production CSS as consumers.
Notices keep their icon beside the copy and move actions beneath it when the
notice itself is narrow. Action icons, spinners and tag remove links do not shrink;
long tags wrap and progress percentages remain intact.
Select keeps the native picker and keyboard behaviour. Its field-owned chevron
has a token-based inset, reserves space for long values, follows disabled colour,
and moves with the control when labels stack. Vertical option groups align their
label with the first option; checkbox/radio controls have no browser margin.

### Normalized primitive contract

Design rules and the numeric Polaris reference matrix are maintained in
[Két Design System](../../skills/ket-design-system/SKILL.md).
Install the agent skill with `npx @ketvietlab/ket-design-system-skill@latest`.
The component APIs and compatibility notes below describe the implementation.

| Family | Public component API | Verification |
| --- | --- | --- |
| Typography | Text: visual variant independent of semantic element, tone, weight and numeric treatment | Render + browser dimensions |
| Icon | Icon: shared Lucide names and informative/decorative semantics | Render + catalogue |
| Inline links | Link: native navigation, target and disabled treatment | Render |
| Actions | Button / LinkButton / IconButton: independent variant and tone, loading, pressed and width | Render + browser loading geometry |
| Action composition | ActionGroup: shared alignment and sibling spacing | Catalogue + CSS |
| Field shell | FieldFrame: label, help, error and associations | Render |
| Text inputs | TextField / Field: native value, validation, access and affixes | Render + browser |
| Search | SearchField: native search and optional clear control | Render + browser clear/focus/events |
| Numeric inputs | NumberField / MoneyField: numeric constraints, currency and precision | Render + browser dimensions |
| Multiline input | TextArea: rows, resize and native validation/access | Render + catalogue |
| Selection | Select: native choices, disabled state and label association | Render + browser |
| Choices | Checkbox / RadioGroup / CheckboxGroup / Switch: checked state separate from submitted value | Render + browser mixed/reset/submission |
| Status | Badge / CountBadge / Tag: tone, icons, progress and optional announcements/removal | Render + catalogue |
| Identity | Avatar / MediaLabel: optional image, fallback and text content | Render + browser image failure |
| Feedback | Notice / Tooltip: announcements, associations and shared interaction runtime | Render + browser keyboard/Escape |
| Progress | Progress / Spinner / Skeleton / LoadingState: determinate or loading semantics | Render + catalogue |

### Date pickers

Open `/dates` for the focused Vietnamese playground (`states=1` expands validation/access examples), or the `date-time` specimen
under `/components/form-controls`. `DatePicker` keeps its native date input. `DateRangePicker` combines one read-only range display with a calendar icon inside the same frame as DatePicker. Two hidden boundaries retain the existing names and ISO values. The runtime enforces required, min/max and step; read-only, disabled, help and field errors remain supported. Submission stays `YYYY-MM-DD`.
`DateTimePicker` and `TimePicker` retain their native local-time controls.

Load `/runtime/auto.js` alongside the stylesheet, or call
`attachDesignSystemInteractions(root)` from `/runtime` and dispose its returned
cleanup when the root is removed. The runtime also enhances fields inserted later.
Without JavaScript or the native Popover API, DatePicker retains its native input; DateRangePicker displays and submits its saved boundaries but cannot edit them.
Server views never read the clock or access the DOM.

```tsx
<DatePicker id="delivery" name="delivery" label="Ngày giao hàng" />
<DateRangePicker
  id="period" label="Thời gian báo cáo"
  start={{ id: 'from', name: 'from' }} startLabel="Từ ngày"
  end={{ id: 'to', name: 'to' }} endLabel="Đến ngày"
/>
```

The range calendar header select offers **Hôm nay**, **Hôm qua**, **7 ngày qua**, **Tháng này**,
**Tháng trước**, **30 ngày qua**, and **90 ngày qua**. Rolling ranges include today;
month presets cover the entire calendar month. `today="2026-09-30"` supplies a
business-timezone civil date; otherwise the browser reads local today on opening.
`presets={false}` hides quick ranges, or pass an ordered subset of `DateRangePreset`
IDs: `today`, `yesterday`, `last7`, `thisMonth`, `lastMonth`, `last30`, `last90`.
Presets outside either input's bounds or step are disabled, never silently clamped.

Click two dates to form an inclusive range; reverse selection is ordered. Both
calendars hold a draft until **Áp dụng** updates the fields and emits bubbling
`input` and `change` events. **Hủy**, Escape and outside dismissal discard that draft.
Choosing a preset commits immediately. Activating the range display opens the calendar. Invalid or incomplete required ranges show a field error and block form submission. Reset restores the original values.

Arrow keys move by day/week; Home/End move to week edges; PageUp/PageDown move by
month (Shift changes year). Enter/Space selects. Tab can leave the non-modal popup;
Escape, Cancel and Apply return focus to its opener. Range calendars show two months
on desktop. Below 768px, a vertical list renders twelve consecutive months around the
selection; scrolling preserves the draft and month navigation recenters that window. Both pickers become fullscreen modal dialogs on mobile,
with fixed commands, a scrolling month list, safe-area insets, contained focus,
and an inert, scroll-locked background. Desktop calendars remain anchored non-modal
popups. The native top-layer popup avoids ancestor clipping.
`locale="vi"` is the default (`en` is also supported); `weekStartsOn` accepts 0 or 1
(Monday by default). `calendarLabels` overrides commands, status and preset labels;
it does not change the browser's native date-input formatting.

The `date-picker` / `date-range` hooks own composition; `date-inputs`,
`date-control-row`, `date-tools`, `date-field-control`, `date-range-preset`, `date-boundary` and `date-range-error` own the control area. The shared Field supports `labelHidden`, `selectionHidden` (select chevron only, options remain readable) and `appearance="embedded"` for accessible compound controls.
`date-calendar`, `date-calendar-head`, `date-calendar-title`, `date-calendar-body`,
`date-calendar-months`, `date-month`, `date-month-title`, `date-grid`,
`date-weekday`, `date-cell`, `date-day`, `date-calendar-footer` and
`date-calendar-status` own the popup. `data-selected`, `data-in-range`,
`aria-current="date"` and native disabled states define calendar styling; consumers
compose the public components rather than targeting their descendants.

### Popups close on an outside click and on Escape

Every popup built on `<details>` behaves like the action menu: a click outside it
closes it, and Escape closes the open one and returns focus to its summary. This
covers `Menu` (`data-ui="menu"`), the period choice of `TimeframeFilter`
(`data-ui="timeframe-menu"`) and list view settings (`data-ui="view-settings"`).
The runtime lists the non-menu popups in `DISMISSIBLE_POPUPS`; a new popup component
adds its hook there instead of wiring its own document listener.

### Collections open records in a modal

A row of a `DataTable` (or `ResourceList`, `DataGrid`) and a `KanbanCard` always open
their record in a `ModalSheet` on top of the collection. They never navigate to a
separate record page. The reader keeps the collection's filters, scroll position,
selection and board column while working on one record, and closing the modal
returns them exactly where they were.

- `rowHref` and `KanbanCard href` point at the modal trigger for that record, not at
  a record route. Create actions on the same collection follow the same rule.
- The modal is a client-side island. It owns open and close, focus trapping and
  restoration, Escape and backdrop closing, background inertness, tabs inside the
  record, unsaved-change prompts and completion feedback. Opening, switching tabs
  and closing do not reload the page or rebuild the collection on the server.
- Modal state is not a separate page state. A deep link may ask the island to open a
  record after hydration, but the server always renders the collection with a closed
  modal host, so the server and first client render stay identical.
- Size follows content: a short record uses the default size, and only long content
  such as a multi-tab record uses the large size with an internal scroll region.
- A record with more than one tab passes `height: 'fixed'` to `ModalSheet`: the dialog
  holds the viewport cap (`data-height="fixed"`) so switching between tabs of different
  heights never resizes it. `TabbedView` keeps the tab bar visible and only `TabPanel`
  scrolls. The panel deliberately owns no left or right padding; the containing modal
  supplies the horizontal inset. A
  single-view record and its nested dialogs keep `height: 'content'` (the default).
- A child action of the record (reassign, postpone, confirm) opens inside the same
  island as a nested step, not as another page.
- `RecordPage` remains for records reached directly rather than from a collection,
  such as a shared link or a record without a parent list. It is never the target of
  a collection row or card.

### Option groups

`checkbox-group` and `radio` fields (`CheckboxGroup`, `RadioGroup`, or `RecordForm`
fields with those types) keep one label on the left and the options on the right
from tablet width up (above them below it, as every field does), each option's text
after its control. `optionsOrientation` sets how the options flow:

- `horizontal` (default): options wrap on one line. Use for a few short choices.
- `vertical`: one option per line, rendered as `data-orientation="vertical"` on
  `field-options`. Use when the choices should scan as a list, such as companies,
  branches or job roles.

Do not restyle `field-options` in an application to stack options; pass
`optionsOrientation: 'vertical'` instead.

### Relation pickers

`RelationSelect` (`createRelationSelectView`/`relationSelect`) is a live client
island, unlike the rest of the package's progressively enhanced controls: it owns
its own state and calls `/_ket/fn/<name>` itself through `RelationSelectConfig.manager`
(`listFunction`, optional `saveFunction`/`removeFunction`). A consuming app mounts
it through its own island runtime (`defineIsland` in `@ketvietlab/ketjs-view`) and
supplies a JSON-serializable config; nothing about it depends on server-rendered
markup, so it may be cold-mounted anywhere the host places a matching island
element — including inside a view that is itself already client-rendered, such as
a modal a JavaScript runtime opened — not only hydrated from the page's initial HTML.

Its option rows (`relation-option`, `relation-dialog-row`) show the current
selection as a trailing mark on the label's own line, never on a line of its own
below a description. The dialog's "more" action is a full-width row like the
options above it, not a chip-sized button; a consumer overriding the footer should
widen it to match, not narrow it to its label's content.

Its inline dropdown is not a `<details>`, so the shared outside-click delegator
(above) does not see it; the component closes it on an outside click itself,
same contract, different mechanism. Choosing a value also fires a real `change`
on the hidden native select (bubbling, a microtask after the choice settles) so
a host page's own `change`-driven wiring keeps working — a second field whose
options depend on this one's choice can key off it exactly as it would a plain
`<select>`. Rendering the picker itself through `each`, keyed on whatever the
dependency is, is what a host needs to swap it for a fresh instance when that
key changes: the component holds no `update()`, so a config change alone (a new
`manager.listInput`, a new options list) never reaches an already-mounted one.

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
Top-level navigation rows use the shared dense metrics: a 30px row, 13px label,
10px content gap and an 18px leading icon. Icon size belongs to `AppNavigation`, so
application shells and catalogue demos render the same geometry without local icon
overrides.
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

The demo supports grouped and flat presentations. Visual hierarchy, spacing and
surface rules are defined only by the skill; API behavior is documented below.

The public entry exports actions, status and feedback objects, fields, navigation,
`Tab`, `Tabs`, `TabPanel` and `TabbedView`, progress, layout primitives, the responsive application navigation, the
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

`KetTableColumn.wrap` opts a descriptive column into wrapping within the shared
text-width token; rows grow with content. It works in server and island tables.
Identifiers and numeric columns keep the default single-line behavior.

`rowHref` provides one keyboard link per row, including the full row pointer target.
Linked cells are display-only. Associate `selection.form` and `bulk.form` with the
same native form to submit selected IDs and the bulk command. Selection syncing
and select-all remain application runtime responsibilities.

From tablet width (48rem) up, a form keeps each label on the left of its control,
with help and errors below the control. Below tablet width, and in any column
narrower than 28rem such as a side panel, each label sits above its control
(see the skill visual contract). A lone checkbox keeps its label beside the box. Native inputs support `readOnly`,
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

Button/input dimensions are pinned to Polaris React 13.9.5: default buttons map to large (32px desktop / 36px mobile), matching inputs. Compact is 28/32px. Density does not resize controls. See [the dimension matrix](../../skills/ket-design-system/references/visual-contract.md) and run `npm run test:design-system:browser` to enforce measured geometry.
