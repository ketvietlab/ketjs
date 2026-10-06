# KetSuite composition

These are the Suite-specific contracts. Use the installed public APIs and preserve
permissions, native routes and form behavior while applying the visual contract.

## Collection lists

- SearchFilter owns a 48rem maximum inline size for the complete search/filter
  group, including applied facets. It fills narrower containers, stays aligned
  to the start of the collection, and wraps long facet content. Lists and modules
  do not override that width or stretch the input across the remaining page.

- The KetSuite shell uses `AppBrand` in the sidebar header and `AppShell.location` for the
  main-column organisation context and tools. It does not show breadcrumbs or a full-width
  global topbar. Standalone page patterns retain their context contract. Do not recreate shell
  chrome inside a module. Preserve the `backend.global-topbar` fragment slot despite its name.
- Global search is a compact dialog launcher, distinct from collection search. Preserve native
  links/GET fallback, Cmd/Ctrl+K, layered Escape, focus return and query drafts. See
  `docs/src/content/docs/ketsuite/design-system.md` for API examples.

- Every full-page collection uses the KétSuite `ListPage`/`ListScreen` composition: app shell with its location band, title with primary creation and collection actions, filters and table tools, then `KetTable` and result footer.
- Declare the create link in `frame.chrome.create`; the shared list wrapper places it at the right of the title, above filters. Use `headerActions` for an explicit permission-controlled primary action. Do not put a create link into `actions`, the filter region, or module-local positioned markup.
- `actions` is for secondary collection commands beside the primary action in the header. Bulk operations go in `ListPage.selection` (KetSuite: `collectionSelection` with a `presentation: 'bar'` selection): while rows are selected, a `BulkActions` bar with the count and "Clear selection" replaces the filter row in place, beside the row checkboxes; it never adds a second bar or moves the primary action. Selection belongs to the visible page: server pagination, filtering and sorting start with nothing selected, as in Polaris and Gmail. Legacy screens may keep the header bulk menu until migrated. Preserve native links, permissions, query state and external bulk forms when moving controls. On narrow screens, the shared header stacks its action group beneath the title; modules must not override that layout.
- Existing inline creation forms (such as period closing) may remain in their documented disclosure/body compatibility boundary. Do not move a whole form into the header to imitate a create button.
- New list screens must include a rendered contract check for title/create, filters, tools and table ordering, including the absence of a create action when it is not authorized.

## Tabs

- Use `Tab` for one route-navigation item, `Tabs` for the navigation bar, `TabPanel` for panel content, and `TabbedView` for the complete bar-and-panel layout. Do not hand-build a tab bar or tab body in a feature module.
- KétSuite tabs are URL-backed navigation. Preserve native links and `aria-current="page"`; do not add ARIA `tablist`/`tab` behaviour unless the interaction is changed to an actual in-page tab widget with the full keyboard contract.
- A tabbed record modal must render through `TabbedView`. The runtime, not each module, owns the stable height, active-tab association, focus, and scroll container.
- `TabPanel` has no left or right padding. Horizontal spacing comes from the containing modal/page or an explicit child layout. Do not add module-specific margin or padding to imitate a panel inset.
- In a fixed-height tabbed surface, the tab bar stays visible and only `TabPanel` scrolls. The runtime sets that height from what it has actually rendered — the tallest tab shown so far, held as a min-height — so the surface never shrinks under the reader and a record whose tabs are all short is never given the height of the screen. Do not pin the height to the viewport.
- A module supplies tab identity, translated label, URL, visibility, and panel view only. It must not wrap each tab in a custom body shell.

## Record modals

- `ModalSheet.size` owns width; product modules choose `small`, `default` or `large`,
  never a private CSS width. At a 16px root, centred dialogs are capped at 34rem
  (544px), 56rem (896px) and 75rem (1200px), respectively. Side sheets use 34rem
  for small/default and 56rem for large. Dialogs retain the owner's 24px viewport
  gutter on desktop; below 768px every non-embedded modal becomes fullscreen,
  except a ConfirmDialog, which stays a small centred card.
- Choose small for a short single-column form; default
  for ordinary record details and two-column forms; large for line-item tables,
  rich editors or the three-column purchase form. Choose once for the record,
  accounting for all its tabs; do not resize width as tabs change. A confirmation
  step rendered inside an existing record keeps that record's width.

- A separate confirmation before a hard-to-undo action is a `ConfirmDialog`,
  never a `ModalSheet` in its default side-sheet presentation and never a drawer.
  It is small by default. The title names the action ("Archive collection"), the
  message states the consequence, and the body does not repeat the title as a
  Notice heading. Put an impact notice or an acknowledgement checkbox in
  `details`, inside the form named by `confirmForm`; gate the button with
  `confirmDisabled`. Its footer always has the cancel link back to `closeHref`
  beside the confirm button; route a product command through
  `confirmName`/`confirmValue` rather than rebuilding the actions.

- `RecordForm.columns={3}` groups three peer controls in one row when the form
  container is at least 56rem wide on desktop. Smaller desktop containers use
  the default two-column form; mobile stacks the fields. The form owns column
  and row gaps; fields retain their label, help, error and full-span contracts.

- Define record modals with `RecordModalDefinition`; do not build a parallel overlay, history handler, loading state, or close flow in a module.
- Use `RecordModalForm` for forms and named record commands for mutations. Views never call `fetch`, mutate history, query the document, or refresh the collection themselves.
- Use `context.draft(name, fallback)` for textual/select values and `context.draftChecked(name, value, fallback)` for checkbox/radio state. Any control that triggers a view-state re-render must preserve the current form draft first.
- Tab switches preserve drafts without prompting. Closing the record or the top nested dialog checks only that layer for unsaved input and prompts before discarding it.
- Open nested record dialogs with `RecordDialogTrigger`/`data-record-dialog`. The record beneath must be inert while the dialog is open, and closing returns focus to the opener.
- Field refusals belong on the matching field through `context.fieldError`; only unmatched/general issues render as the layer notice. Do not erase entered values on loading, validation refusal, tab switch, or view-state change.
- A record with more than one declared tab uses the fixed-height modal contract. A record without tabs and nested dialogs size to content unless a separate documented workflow requires otherwise.

## Record pages for administration profiles

- Choose the presentation by what the record is. An administration profile —
  a user, a role, an access policy — is read top to bottom, linked to, and
  returned to, so it is a record page at its own URL (`/admin/<things>/{id}`).
  A transactional record (order, invoice, task, lead) keeps the large record
  modal over its collection, so the reader keeps their place in the queue.
- A record page uses `RecordPage` at `width="default"` (56rem, no aside) and no
  tabs. Its blocks follow the reader's questions in order — who this is and how
  they sign in, where they are admitted, what they can do there, why (the roles),
  what changed — and each block is its own titled `Surface` (a card), returned as
  siblings so the record page body owns the gap between them. Put a block's own
  command in the Surface `actions` (tertiary, compact); the page header keeps the
  record's command group. A block's tabular content is a `DataTable` without a
  title, flattened by the card. Long or rarely read detail goes into a
  `Disclosure` or a nested dialog, never into a tab.
- Show authority the way the permission model decides it, not as stored rows:
  roles apply only where the person is admitted and only in their assigned scope;
  effective access is measured at one named workplace; an archived account, a
  workplace the person is not admitted to, or a managed role whose template moved
  on grants nothing, and the page says which. Read levels on the four-step scale
  (none, view, create and edit, manage).
- Build it on the record runtime: `defineRecordPageIsland({kind, client, export})`
  on the server and `createRecordPage(definition)` in the client bundle. The
  definition is the record's modal definition without `header`/`tabs`, with
  `body` for the sections and `pageActions` for the header's command group (one
  primary). Nested dialogs, commands, drafts, field refusals and
  `ket:records-changed` behave as in the modal; `close`/`reload`/`open`/tab
  afters only close the top dialog, and the page itself never closes.
- The route preloads the record context (the envelope) and passes it with the
  title and trail as island props; the server writes `recordPageShell` and the
  client adopts the same markup, so the page neither fetches on arrival nor
  mismatches during hydration. The trail ends at the collection with the
  reader's `returnTo`, and the collection's rows link to the page carrying it.
- Creating stays a modal over the collection (`record=<kind>:new`); after
  creating, the command navigates to the new page. A link written for the old
  modal (`?record=<kind>:<id>`) redirects to the page.


## Image upload fields

Always use the public `ImageDropZone` thumbnail surface for image upload fields.
In record modals use `RecordImageField`, which adapts it to the disposable record
runtime. Reuse this for product template/variant images and care checkpoint photos.
Keep the native file input accessible but visually hidden. Show the existing image
in the same tile, with choose/replace and remove actions inside its boundary; allow
dropping onto that tile. Preserve upload validation, permission checks, busy/errors,
and keyboard file selection. Generic FileUpload/DropZone remain for non-image files.
The DS owns thumbnail geometry, picker visibility and action spacing; product code
supplies image URLs, translated labels and commands. Never substitute a “has image”
badge for the actual preview. Do not display that badge as proof the file loaded.

## Fixed dashboard periods

For CRM/customer-care dashboards that only allow reporting presets, use the public
`DatePresetPicker`. Do not compose a date input or a DateRangePicker with hidden calendar controls.
The trigger displays only the selected preset, has an accessible label, sizes to its
content, and sits immediately before the primary action in the page title row.
Selecting a native menu link applies that period immediately; there is no Apply command.
The menu owns popup spacing, control height, single-selection semantics and keyboard behavior.

Pass `today` as a civil YYYY-MM-DD in the business timezone. `resolveDatePreset` returns
inclusive boundaries: weeks start Monday; this week/month/year covers the full calendar
period; rolling 7/30/90-day ranges include today. Consumers preserve unrelated query filters
and remove obsolete custom `from`/`to` values when changing a fixed period. Keep the 11
public choices (today, yesterday, last 7 days, this/last week, last 30 days, this/last month,
last 90 days, this/last year) and translate their labels through the component.

## Temporal record fields

Record `Field` specifications with type `date` use DatePicker; `datetime-local`
uses DateTimePicker. A date popup anchors to its whole control, commits valid
selection on close, and discards an incomplete selection. Short scheduling dialogs
use ModalSheet small. DateTimePicker progressively enhances one native wall-time
field into date/time controls; its disposable runtime owns synchronization and
validation. Preserve the canonical name, permission state, help and validation.
