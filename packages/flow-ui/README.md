# Flow UI

Compact work-management components for KétJS View: shell, lists, boards, task dialogs, documents and overview visuals. Styling comes entirely from the public `@ketvietlab/design-system` tokens.

## Run the demo

From the repository root, using Node 24 or newer:

```sh
npm install
npm run build
npm --workspace @ketvietlab/flow-ui run demo
```

Open `http://127.0.0.1:4190/`. Set `PORT` to change the port. The server binds only to loopback.

- Library: typography, colors, actions, controls, states, work items and dialogs.
- Sample workspace: list/board, accent-insensitive search, status filter, selection limited to visible tasks, bulk completion, task creation and editing.
- Switch between light/dark and compact/comfortable density.
- Demo changes live in browser localStorage under `flow-ui-demo:v1`. Use the reset action to restore fixtures. No backend, account or production data connection.
- Board items open an editable dialog; drag-and-drop is outside this first kit version.

## Ownership

`@ketvietlab/flow-ui` is a public MIT package in the ketjs repository. Product data, persistence, routing and paid features belong to consumers; see `AGENTS.md` for agent-facing rules.

The shared foundations are `@ketvietlab/ketjs-view` and `@ketvietlab/design-system/tokens.css` from this repository. Colors, typography, spacing, radius, elevation, focus and motion inherit KétJS tokens. Flow owns its component structure and compact density, with `--flow-*` aliases to shared semantic tokens. It does not load Suite page layouts or Suite's document-wide runtime. Token names are checked against the design-system source in the same repository, so there is no pinned copy to drift.

| Boundary         | Contract                                                    |
| ---------------- | ----------------------------------------------------------- |
| Public API       | `Flow*` exports only; business state supplied by consumers  |
| Root             | `[data-flow-ui]`                                            |
| Component hooks  | `data-flow`                                                 |
| Tokens           | `--flow-*`                                                  |
| Runtime          | Explicit `attachFlowUI(root)` with `sync()` and `dispose()` |
| Private behavior | No calls to Flow APIs or storage from library components    |
| Demo             | `demo/` owns fixtures, persistence, routing and layout      |

## Design direction

The shared design system owns the visual language: `--kv-accent`, `--kv-font-sans`, `--kv-radius-*`, and semantic status colors. Both light and dark modes resolve from the same upstream tokens. Flow uses the existing smaller text steps and a compact density profile. Status always has text and a shape, not color alone. The demo has no custom font or independent palette.

| Measure                     | Compact      | Comfortable / touch |
| --------------------------- | ------------ | ------------------- |
| Main content and navigation | 14px         | 14px                |
| Controls / metadata         | 13px / 12px  | 13px / 12px         |
| Small control               | 28px         | 32px / 44px         |
| Normal control              | 32px         | 36px / 44px         |
| Task row                    | 36px minimum | 44px / 48px minimum |

`FlowButton` uses intrinsic width with `inline-flex`; standalone buttons in `FlowStack` align right. Use `FlowInline({ align: "end", children })` for a wrapping, right-aligned form action group (cancel before submit). Navigation rows and task cards retain their full clickable surface.

Rows can grow for wrapped content; minimum heights are not clipping constraints. Focus rings, native form controls, native modal dialogs and reduced-motion support are included.

## Components

| Category | Exports                                                                  |
| -------- | ------------------------------------------------------------------------ |
| Actions  | `FlowButton`, `FlowIcon`                                                 |
| Input    | `FlowInput`, `FlowSearch`, `FlowSelect`, `FlowCheckbox`, `FlowSegmented` |
| Metadata | `FlowStatus`, `FlowPriority`, `FlowAvatar`, `FlowTag`, `FlowProgress`    |
| Feedback | `FlowEmpty`, `FlowDialog`                                                |
| Work     | `FlowTaskRow`, `FlowTaskCard`                                            |

`FlowShell` supplies the reusable application frame: 240px sidebar, 44px header and scrolling content bounded by `contentWidth`. Its slots are `sidebar`, `title`, `breadcrumb`, `actions`, `navigation`, `children` and optional `footer`. Navigation sits outside the centered content container. It follows the proportions of the original Flow atlas proportions (now codified in this package) while using current shared tokens. Workspace titles belong in this header, with no oversized hero above the list. `FlowSegmented` supports `appearance: 'underline'` for the shallow view bar.

Prop types are authored in JSDoc, checked by TypeScript and emitted as `.d.mts` declarations by `build`. The same component functions work in SSR and browser rendering. Consumers own localization: the first review version currently has Vietnamese status/priority vocabulary.

```js
import { html, createRoot, domHost } from "@ketvietlab/ketjs-view";
import { FlowButton, FlowStatus } from "@ketvietlab/flow-ui";
import { attachFlowUI } from "@ketvietlab/flow-ui/runtime";
import "@ketvietlab/design-system/tokens.css";
import "@ketvietlab/flow-ui/styles.css"; // when using a CSS-capable bundler

// container is an existing HTMLElement with data-flow-ui.
const root = createRoot(domHost(), container);
const runtime = attachFlowUI(container);
root.render(
  html`${FlowStatus({ status: "progress" })}
  ${FlowButton({ label: "Tạo công việc", variant: "primary", onClick: openCreate })}`,
);
runtime.sync(); // call after each render to synchronize native control properties

// On teardown: runtime.dispose(); root.dispose().
```

`FlowInput.value` supplies the initial/current record value. Runtime sync preserves an edited draft until this supplied value changes. `FlowSearch`, `FlowCheckbox`, and a `FlowSelect` with `onChange` are controlled: update their props in the callback, render, then call `sync()`. A select without a callback retains its native form draft. Native `form.reset()` restores supplied defaults.

`FlowDialog` renders a closed native dialog. After rendering, call `runtime.open(id)` from its opener. Escape and close buttons dismiss it; focus returns to the opener. Application-specific unsaved-change handling remains a consumer concern.

## Verification

```sh
npm run build
npm --workspace @ketvietlab/flow-ui test
```

`npm run build` type-checks the JSDoc and emits `.d.mts` declarations; the root `test/flow-ui-package.test.ts` runs the package tests as part of `npm test`. Semantic tests cover safe escaping, accessible labels, native dialog semantics, loading/disabled actions, rendered collections and package/CSS boundaries.

## Workspace composition API

Import `@ketvietlab/flow-ui/workspace` for navigation, toolbar, sections, tables, grouped lists, board columns, properties, document, activity, timeline, calendar and routed sheets. These components own their markup and sizing; consumers compose them into routes. `FlowStatus.label` accepts a project-defined column label while `status` selects the shared visual semantic.

`FlowSelectField` composes a named, labelled native select for forms. Product forms use this and `FlowInput` (including file inputs), without recreating control markup.

## Document workspace

`@ketvietlab/flow-ui/documents` exports `FlowDocsShell`, `FlowDocTree`, `FlowDocEditor`, `FlowDocOutline`, `FlowDocTool`, `FlowDocToolGroup`, `FlowDocPanel` and `FlowDocBlank`. They use the same `FlowFrame` as `FlowShell`, so the normal 240px Flow menu remains visible. The document area adds a 300px resizable tree, a flexible paper column and a 260px inspector at desktop widths. Reading text uses public `--kv-text-lg`; headers use the public heading scale. There is no Atlas CSS override.

The toolbar acts on the focused block. Editor callbacks expose plain text, table cells and checklist state; HTML is escaped. This initial block editor is not a real-time rich-text engine. The product controller owns drafts and saving.

Card surfaces share `--flow-card-radius: var(--kv-radius-lg)` (9px) and `--flow-card-padding: var(--kv-space-4)` (16px). Notices and every metric, including static colored metrics, have full inset padding and a rounded border. Task/resource cards and table/group containers share that radius; application shell separators retain straight edges.

### Route-owned task dialog

`FlowDialog({ size: 'task', onRequestClose, ... })` uses the shared 1440px responsive dialog layout. The runtime opens it as a native modal when it mounts; Escape, backdrop and close delegate to the route controller. Header/footer remain visible while the body scrolls. `FlowRecordLayout` provides the main content and 440px inline properties column, stacking on mobile. At widths up to 760px, task dialogs fill the viewport (100dvh), with square edges, no outer gutters, a scrolling body and fixed header/footer. Use this component for every task route; do not recreate its size or CSS in a client presenter.

`FlowAtlasViewport` is the labeled host slot for the official KetAtlas viewer. Flow owns its responsive height, border and radius; the viewer owns its isolated Shadow DOM. The client mounts/destroys the viewer and resolves repository sources; the component never fetches GitHub or starts renderers. The component demo includes the host-slot specimen.

`FlowAtlasWelcome` owns the disconnected Atlas onboarding surface: project context, connection action slot, clearly labeled illustration, three setup steps, and expandable repository guidance. It inherits public tokens, stacks on narrow screens and is included in the component demo. The illustration is not a second renderer or a claim about connected data.

### Task property sidebar

`FlowPropertyFields` (workspace export) opts native `FlowInput` and `FlowSelectField` into an inline label/value layout. Use it only in a task sidebar; main title, description, checklist and other forms keep stacked labels. The task modal is up to 1440px (16px desktop outer gutters) with a 440px property rail, a 148px label track and 44px property rows. Labels use the 13px control token, medium weight and semantic muted text; editable values use 14px body text. `icon` is optional on inputs/select fields and decorative. The layout reflows on narrow screens and inherits both themes.

`FlowDocTree` renders the supplied canonical hierarchy without sorting. Its optional `onReorder` enables sibling-only drag/drop with a position indicator and Alt+Arrow keyboard fallback; omitting it removes drag controls. The document shell exposes a 220–420px tree splitter (default 300px), operated by dragging or arrow keys. It is hidden in the single-column mobile layout.

`FlowProjectViews` attaches a native popover to the List navigation item. Consumers supply project-scoped saved views, selected view ID, navigation and save callbacks; the shared component owns the menu structure and style.

`FlowSection({ width: "reading" })` centers a responsive section up to 1200px wide, including its normal inner padding. The notification inbox uses this shared width to keep titles and actions close together on large screens. Other sections retain full width.

`FlowToast` renders compact, bottom-centered operation feedback in a manual native popover. `attachFlowUI` opens it in the top layer so it works above dialogs and does not change page geometry. Callers own dismissal; Flow's client uses one 4-second notice, renewed by later operations and paused during pointer/focus interaction. The component has a polite live message and a close button, and uses the same tokens in both themes. The demo uses this component too.

### Configurable label picker

`FlowTagPicker` from `@ketvietlab/flow-ui/workspace` takes stable selected IDs, label records with semantic colors, a controlled `onChange`, optional `onManage`, and `disabled`. It renders removable colored chips, searchable checkbox choices in a native popover, and read-only state. Use the same component in creation and task properties. `FLOW_TAG_COLORS` lists the five token-backed choices; names and persistence remain client-owned. The library demo includes an interactive picker.

### Manual task ordering

`FlowTaskRow` and `FlowTaskCard` accept `onDropTask(id, position)` and `onMoveKey(direction)`. `FlowGroup` / `FlowBoard.columns` accept group-level `onDropTask`. The disposable runtime lets users grab anywhere on a row/card after 6px movement; no drag handle is necessary. Clicks still open tasks, and native checkbox/input gestures are excluded. It handles pointer capture, insertion feedback, Escape/cancel and cleanup; the consumer performs the atomic group/order update. Alt+Up/Down reorders; Alt+Left/Right changes group. The demo list supports manual reordering with the same components/runtime.

### Scrollable Gantt

`FlowTimeline` receives ISO day cells, period groups, date-derived rows, scale (`week`/`month`), `focusIndex`, `focusKey` and optional `caption`. Day widths are 64px/26px, names and calendar header remain sticky, and the runtime positions the focused date once per focus key without interrupting subsequent manual scrolling. Update the key when an explicit jump is requested. Caption spacing belongs to the shared component. Unscheduled rows remain visible; callbacks open tasks or locate their schedule.

Editable timeline rows accept `rawStart`, `rawSpan` (unclipped day geometry) and `onSchedule({mode,days})`, where mode is `move`, `start` or `end`. The shared disposable runtime previews a day-snapped move/resize, shows date feedback, scrolls at chart edges and emits once on release. Escape/pointer cancellation restores the original geometry. Alt+Left/Right on the bar or either handle provides keyboard editing. Omit the callback for read-only/busy rows. Dates and persistence remain consumer-owned. Resize handles are hidden for endpoints clipped outside the rendered window.

`FlowScopeMenu` provides a compact named disclosure with consumer-owned destinations and optional `placement="up"` for a personal footer. `FlowDocsShell.navigation` accepts the same project tab composition as other screens, reserves a responsive row for it, and keeps contextual actions and the library-return button accessible at narrow widths. Omit navigation for workspace-owned documents.

`FlowLogo` and `FlowBrand` (workspace export) use the supplied KétFlow light/dark wordmarks in a 96 × 24px slot. The CSS resolves shared PNG assets at 1×, 2× and 3×; serve or bundle `src/assets/` with the stylesheet in production. Brand artwork colors are preserved, while surrounding UI still uses public design-system tokens.

### Organization navigation and permissions

`FlowContextPicker` switches Workspace within the current Company and optionally opens Workspace management. `FlowUserMenu` owns the Company selector and personal/organization destinations. `FlowProjectDirectory` presents direct Project links and optional favorite/create actions. `FlowAccessList` displays effective roles and grant sources, including pending/revoked/readonly text. `FlowCheckboxField` adds visible clickable text to a checkbox for forms such as preserving access during Project moves. These exports live in `@ketvietlab/flow-ui/workspace`, use canonical DS tokens and appear in the component demo. They contain no Company data, permission policy or backend API calls.

`FlowContextPicker` is placed in `FlowNavigation.context`. It displays only the Workspace name in a compact single line, with Workspace choices and `onManage` in its popup. Company context is available in the user menu. `FlowUserMenu` belongs in the navigation footer; it wraps `FlowScopeMenu` with an organization selector. Outside click and Escape dismiss these disclosures. On mobile, expanding navigation also reveals the user footer. Project links open the project's existing tabs; no nested sidebar menus.

## Layout spacing contract

`FlowSection`, `FlowToolbar` and `FlowMetrics` default to `inset: "page"`.
The outer page owns the horizontal gutter (`--flow-page-gutter`, shared space-5 on desktop and space-3 on phones).
Use `inset: "none"` when embedding these surfaces in a section, card or already-padded dialog body.
Task dialogs keep their edge-to-edge record layout: its main sections and property sidebar own their padding.

`FlowSection` owns a space-3 gap between its header and content, and between direct child blocks.
Use `FlowStack` for lists inside a fragment or form; do not add a second padded section for grouping alone.
Cards retain their own internal padding. Toolbars wrap controls; notice actions wrap and remain right-aligned.
The component demo includes nested sections to make the gutter contract visible.

`FlowScopeTabs` provides URL-backed Workspace/Company navigation with the project underline style. Each destination is a real link with `aria-current="page"`; compact viewports scroll horizontally and the runtime reveals the active destination without moving the page.

### Responsive task properties

Task dialogs keep the 440px property rail at widths of 1200px and above. Below 1200px, `FlowRecordAsideTrigger` in the dialog `headerActions` slot opens that same `FlowRecordLayout` aside as a native auto popover. The panel is positioned below the header, bounded by the dialog, independently scrollable and light-dismissible. Escape closes a nested tag picker before the properties panel, and the task remains open. Phone task dialogs still fill the screen.

Pass a unique matching `asideId`/`controls` pair when rendering more than one record layout. The runtime toggles popover behavior on resize without cloning or moving inputs, preserving form association, drafts and autosave. Client code owns all values and callbacks. The demo includes a responsive task dialog.

### Content width by screen

`FlowShell.contentWidth` has two bounded responsive maxima including page gutters: `standard` 1200px (organization administration, inbox, personal settings) and `wide` 1600px (Workspace tabs, project tabs, task lists and reports). The client assigns widths by navigation family in `content-layout.mjs`: adjacent tabs share the same width, including their settings and document library. Width is always 100% up to the cap and centered. This container adds no padding: sections and toolbars retain gutter ownership. Header and scope tabs remain full width; dialog dimensions are independent. Document reading/editing shells fill the remaining work area; the tree and inspector sit at its edges while the inner reading column stays readable. The document library retains its 1600px cap. Board, Calendar and Timeline explicitly use `contentWidth: "full"`: no maximum, filling the remaining work area while keeping normal page gutters and scrolling. This is not a third fixed width.

The document workspace is capped at 1920px with the existing 840px reading paper, resizable tree and responsive inspector. Dialog widths stay independent of page width; route modals retain the underlying screen's width.

### Spotlight

`FlowSpotlight` composes the native `FlowDialog` with `size: "spotlight"`: 680px maximum width, near-top positioning, a full-width search combobox, grouped listbox results, a bounded internal scroll region, an empty state and keyboard hints. `query`, `groups`, `activeId` and selection callbacks belong to the consumer. The combobox retains focus and exposes its active result through `aria-activedescendant`; arrows wrap, Enter selects and native Escape/backdrop dismiss. The shared runtime reveals the selected option without scrolling the underlying screen. Mobile constrains the dialog within viewport gutters. The component demo includes an interactive specimen.

Flow's command search groups authorized bootstrap tasks, projects and documents alongside curated navigation destinations. It supports accent-insensitive Vietnamese lookup and exact task IDs; it does not send data to Algolia or index a separate server. Production search completeness remains bounded by bootstrap data. References: [Apple Spotlight](https://support.apple.com/en-ph/guide/mac-help/mchlp1008/mac), [Algolia keyboard navigation](https://www.algolia.com/doc/ui-libraries/autocomplete/core-concepts/keyboard-navigation).

Form hierarchy: field labels use the existing 12px metadata token, muted text and medium weight; input/select/textarea values use the 14px body token, primary text and normal weight. Placeholder text is muted and inherits normal weight. The field wrapper never supplies bold type to editable values.

### Task-focused content

`FlowList` / `FlowListItem` are for ordinary lists (title, context, metadata, actions), not alert messages. `FlowDisclosure` keeps optional evidence, access sources and secondary form sections close to the task without expanding every row. `FlowHint` provides short supporting text. `FlowCalendarEvent` is a compact, named calendar action; mobile calendar renders an agenda. The shared runtime collapses mobile navigation and opens ancestor disclosures when a form field is invalid. `FlowInput.name` can differ from its unique label/id association for repeated forms. Do not replace these with route-specific copies.

`FlowIcon(name)` draws Lucide glyphs vendored in `src/icons.mjs` (ISC, `LUCIDE-LICENSE`), at Lucide's stroke width 2 like the design system's notice icons. Flow keys (`chevron`, `board`, `reset`…) map to Lucide names (`chevron-right`, `kanban`, `rotate-ccw`…) in `tools/vendor-lucide.mjs`; to add or update a glyph, edit that map and run `node tools/vendor-lucide.mjs <path-to-lucide-static>`. Never hand-draw paths.

`FlowFileDropzone` (workspace export) provides native multiple-file selection and drag/drop with a controlled `files: File[]`, `onChange(files)` and optional `disabled`. It shows names, sizes, total selection and removal controls; identical name/size/lastModified selections are deduplicated. Consumers own validation, errors, persistence and any upload policy. The component never uploads files. Use it inside the padded default `FlowDialog` with explicit cancel/confirm actions.

`FlowFileDrop` (workspace export) is the immediate variant for an existing record: dropping or choosing files calls `onFiles(files)` at once, with no staging dialog. Pass the record's current files as `children` so the whole list is the drop target. `busy` disables it while saving; `pending` plus `onRetry`/`onDiscard` show files whose save is in flight or failed. Like `FlowFileDropzone`, it never uploads.

`FlowAttachment({title,meta,type,url,onPreview})` renders one attached file. Only raster images and video (`attachmentKind(type)`) get a thumbnail/preview trigger; every file with a `url` gets a download link (`?download=1`), and a file without `url` says no content is stored. `FlowMediaPreview({title,type,url})` is the body for a `FlowDialog` with `size:"media"`.

`FlowToast` supports `tone: "success" | "error" | "warning"`, an optional title and recovery action. Errors use an alert announcement; success/warnings use polite status announcements. The consumer owns dismissal: success can expire, actionable failures remain until dismissed or resolved. Pass toast content through `FlowDialog.feedback` (or `FlowSpotlight.feedback`) while a modal is open so recovery buttons remain inside the dialog's interactive scope.

Filter/action toolbars separate content with spacing, without a full-width bottom rule. Page toolbars use 8px vertical padding; nested `inset:"none"` toolbars rely on their section/stack gap. Metrics and task-card metadata also avoid decorative horizontal rules. Keep selected navigation-tab underlines and structural boundaries for tables, modal headers, editor tools and distinct panels.

`FlowChoiceField` is a controlled single-choice field with rich selected and option content. Pass `id`, `label`, `value`, `options: {value,label,content}[]`, `onChange(value)` and optional label icon/disabled state. Task details compose it with `FlowStatus` (including project-specific label/color) and `FlowPriority`. It uses a native popover listbox, selected indicator, Arrow/Home/End navigation, Enter/Space activation and Escape dismissal; it works inside the responsive task-properties popover. Keep label icons muted without overriding semantic icons inside field values.

### Multiple-user selection

`FlowUserPicker` is exported from `@ketvietlab/flow-ui/workspace`. It is a controlled field with `id`, `label`, `value: string[]`, `options: {id,name,email?,avatarUrl?,disabled?,description?}[]`, `onChange(ids)`, and optional `disabled`, `placeholder`, `size`.

- `size: "md"` (default): 32px minimum control, overlapping avatars and the first name with a `+N` remaining-person count. Long names ellipsize on one line; full names remain in the tooltip and accessible label.
- `size: "sm"`: 28px minimum inline list control, up to three overlapping avatars and a `+N` overflow count, full names in the accessible label/tooltip. Both sizes use 44px minimum touch targets on coarse pointers.
- Both open the same searchable multi-checkbox popover. Search ignores Vietnamese accents, arrow keys move between eligible users, Space/Enter toggles, and Escape/Xong dismisses. Selection stays open and calls `onChange` immediately; the consumer owns saving.
- A disabled option already selected can be removed, but not added again. A disabled field blocks all edits. Consumers supply project eligibility and retained unavailable identities.
- `FlowAvatar` accepts optional `src` with initials fallback; `FlowAvatarGroup` is exported from the main package for read-only rows/cards. `FlowTaskRow.assigneeControl` accepts the compact picker; `FlowTask.assignees` supplies avatar display data.

`FlowShell.search` places a shared `FlowSearch` in the topbar, between context/title and actions. Equal side tracks keep its bordered surface centered in the header regardless of title and action widths. At viewport widths of 1368px and above it stays on one row, scaling from 240px to 440px to leave room for project actions. Only below 1368px viewport width does it occupy a separate centered row; at 760px or less that row fills the available width; header actions remain available and the input never forces horizontal overflow. Task filters remain in the content toolbar.

`FlowListItem` supports `variant: "plain"` for standalone context summaries inside a padded section: no row border or extra inset, a 24px horizontal gap to actions, and actions below the description on narrow shells. Regular list rows retain their existing separators.

`FlowChoiceField.size: "sm"` reuses the sidebar's colored options for borderless 28px inline list editing, retaining a hidden accessible field label. `FlowTaskRow` accepts `statusControl`, `priorityControl`, `assigneeControl` and `dueControl` slots.

`FlowDateField` (workspace export) shows a compact day/month value or “Đặt hạn”; its tooltip and accessible name include the year. The popover uses `FlowInput` with the native date picker, optional `min`/`max`, “Bỏ hạn”, and “Xong”. Consumers supply `id`, `label`, `value`, `disabled?` and `onChange(value)`; an empty string removes the date. Values autosave through the same task controller as sidebar edits. Disabled fields keep their current values visible.


`FlowSection.description` groups supporting context with the section title (4px title/description gap) instead of a separate body hint. Header actions stay aligned with that heading group. Nested sections still use `inset: "none"`.

`FlowListItem` defaults to `variant: "auto"`: standalone information has no inset or divider; direct children of `FlowList` receive 12px vertical/16px horizontal padding and separators between siblings. `plain` stays flush even in a list; explicit `row` adds an inset to a standalone row but no orphan separator. Parent sections/stacks own the gaps between standalone items. At narrow widths the text and actions stack with an 8px gap. This prevents indentation and stray borders when the same row component is reused in settings, overview pages, disclosures or dialogs.

`FlowColorPicker` (workspace export) presents the canonical `FLOW_TAG_COLORS` as real square swatches using existing semantic tokens. It is a controlled native-radio field: `id`, optional form `name`, `label`, `value`, `disabled`, `compact`, and `onChange(color)`. A selected swatch has both a check mark and outline; native arrow-key navigation and fieldset disabling apply. No arbitrary color input is offered.

`FlowCatalogEditor` (workspace export) edits controlled `items` (`id`, `title`, `color`, optional `kind`, `locked`, `lockedKind`) through `onChange(items)`. Optional `status` and `kindOptions` add the workflow-group column. Desktop rows place name, group, palette and remove together at 32px height; narrow containers and coarse pointers stack fields. The consumer owns drafts, validation and persistence. Project setup uses this editor for all four project/task status/label catalogs and hides duplicate previews while editing.

### Languages (KetJS i18n)

Flow uses the installed KetJS `translator` and `dateTimeFormatter`, with the
catalog exported from `@ketvietlab/flow-ui/messages`. English is the initial language;
the account menu offers English, 日本語, then Tiếng Việt. The browser remembers
selection; `?lang=en|ja|vi` takes precedence over that preference. Changing locale
updates the mounted island without changing API identifiers or user content.

For the real application, register `flowMessages` as the `messages` contribution
of `defineModule({ name: 'flow', messages: flowMessages, ... })`. KetJS composition
prefixes the catalog keys with `flow.`. The standalone island's `i18n.mjs` adapter
uses that identical manifest shape and delegates interpolation/fallback to KetJS.
Keep the catalog and UI together when moving the mock to the real app. On a
server, resolve the translator per request; do not change browser locale state to
render another user's request.

All new interface copy needs keys in all three catalogs, including placeholders,
accessible labels, confirmations and empty states. Keep IDs and user-entered
names, document content and custom labels as data. Built-in task statuses may
carry a `labelKey`; custom or renamed statuses should omit it. Production API
errors should supply a message key and parameters, while user-authored error
context stays unchanged.

Products add their own copy with `registerFlowMessages(catalog)` from
`@ketvietlab/flow-ui/i18n`; keys are prefixed with `flow.` and a key that is
already registered throws. The demo import map uses a browser-only bundle of the
**installed KetJS i18n module**, built by `build:i18n`; there is no copied
translation engine.

### LiveDoc

`FlowLiveDoc` provides the shared rich editor for documents and task descriptions.
Call `attachFlowUI(root).sync()` after rendering and dispose the runtime on unmount.
Pass a stable owner-scoped ID, optional Yjs `snapshot` or legacy `blocks`/`text`,
`readOnly`, `onChange` and optionally `onBlur`. Owners persist the returned snapshot;
`FlowLiveDocText` and `FlowLiveDocLegacyBlocks` create plain/legacy projections.
The editor is `@ketvietlab/ketsuite/livedoc` (local mode, tables, read-only).
Live synchronization is a separate
server transport integration; this embedding uses the owner's existing save flow.

`FlowChoiceField.options` supports `disabled` and `description`. The explanation is shown on a separate line below option content, never in the selected trigger. Disabled options remain readable and cannot be selected; keyboard arrows skip them. `FlowTaskRow` accepts `statusHint` for reviewer context below the status control. `FlowDateField.overdue` colors the existing date red and includes overdue context in its accessible name, without adding a visible label.

### Overview visuals

Workspace exports for summary pages. They receive computed numbers only and own no data rules.

- `FlowStatGrid` — clickable tiles (label, value, optional `visual`, one detail line). Tiles navigate; they are not toggles, so they carry no `aria-pressed`.
- `FlowSegmentBar` — proportional bar with a spoken breakdown. Zero segments leave the track; an unlabelled segment is spacing (for example headroom to the busiest person) and stays out of the label. `legend: true` adds a visible legend.
- `FlowColumnChart` — selectable columns on one shared scale, with `muted` (non-working days) and `current` (today). Mark a backlog column `outlier: true` so it cannot flatten the rest; if it exceeds the scale it is drawn full height with a faded top (`data-clipped`) and keeps its exact number.
- `FlowMeterList` — goals, sprints or load as one title line, one bar and one muted line.
- `FlowEntryPage` — shell-less page for sign-in and first-run setup: brand line, optional numbered `steps` (`complete`/`current`), one centred card. Pass `onSubmit` to make the card a form with `actions` under the fields. Tenant-facing copy never names the identity provider.
- `FlowChecklist` — getting-started steps that tick themselves from data. Done steps drop their action; `doneLabel`/`todoLabel` are spoken for the mark.
- `FlowEvidenceTable` also takes `actionsLabel` (trailing icon-menu column via `FlowScopeMenu({icon:'more'})`), `more` (a row under the data) and column `size`. `FlowEvidenceTask` and `FlowEvidenceValue` keep each cell to one line plus an optional muted line.
- A row with `onOpen` opens on a pointer click anywhere outside its own controls (`data-open`); put `FlowEvidencePerson` (avatar, name, muted line) or `FlowEvidenceTask` in the row as the keyboard path to the same detail.
- `FlowResourceCard` in a `FlowCardGrid` is a whole-card button. `icon`, `eyebrow` (a short code) and `status` (a `FlowTag`) share its top row; `meta` sits on the bottom edge so cards in one grid row line up.

These components set tone through `data-state`, never `data-tone`: the shared `[data-tone]` rule tints tag-shaped pills and would paint a whole block with no padding.
