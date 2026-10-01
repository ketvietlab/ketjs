# KetSuite composition

These are the Suite-specific contracts. Use the installed public APIs and preserve
permissions, native routes and form behavior while applying the visual contract.

## Collection lists

- The KetSuite shell uses `AppBrand` in the sidebar header and `AppShell.location` for the
  main-column organisation context and tools. It does not show breadcrumbs or a full-width
  global topbar. Standalone page patterns retain their context contract. Do not recreate shell
  chrome inside a module. Preserve the `backend.global-topbar` fragment slot despite its name.
- Global search is a compact dialog launcher, distinct from collection search. Preserve native
  links/GET fallback, Cmd/Ctrl+K, layered Escape, focus return and query drafts. See
  `docs/src/content/docs/ketsuite/design-system.md` for API examples.

- Every full-page collection uses the KétSuite `ListPage`/`ListScreen` composition: app shell, breadcrumbs/context, title with primary creation and collection actions, filters and table tools, then `KetTable` and result footer.
- Declare the create link in `frame.chrome.create`; the shared list wrapper places it at the right of the title, above filters. Use `headerActions` for an explicit permission-controlled primary action. Do not put a create link into `actions`, the filter region, or module-local positioned markup.
- `actions` is for secondary collection commands and bulk operations beside the primary action in the header. Do not render a separate action bar below filters. Bulk actions appear only while their own collection has selected rows; hiding them must never hide the primary action. Preserve native links, permissions, query state and external bulk forms when moving controls. On narrow screens, the shared header stacks its action group beneath the title; modules must not override that layout.
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

- Define record modals with `RecordModalDefinition`; do not build a parallel overlay, history handler, loading state, or close flow in a module.
- Use `RecordModalForm` for forms and named record commands for mutations. Views never call `fetch`, mutate history, query the document, or refresh the collection themselves.
- Use `context.draft(name, fallback)` for textual/select values and `context.draftChecked(name, value, fallback)` for checkbox/radio state. Any control that triggers a view-state re-render must preserve the current form draft first.
- Tab switches preserve drafts without prompting. Closing the record or the top nested dialog checks only that layer for unsaved input and prompts before discarding it.
- Open nested record dialogs with `RecordDialogTrigger`/`data-record-dialog`. The record beneath must be inert while the dialog is open, and closing returns focus to the opener.
- Field refusals belong on the matching field through `context.fieldError`; only unmatched/general issues render as the layer notice. Do not erase entered values on loading, validation refusal, tab switch, or view-state change.
- A record with more than one declared tab uses the fixed-height modal contract. A record without tabs and nested dialogs size to content unless a separate documented workflow requires otherwise.

