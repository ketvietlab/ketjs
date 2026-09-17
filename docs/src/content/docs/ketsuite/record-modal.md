---
title: Record modals
description: The KetSuite contract for opening a collection's records in a client-side modal island.
---

The design system settles *what* happens when a reader opens a row: the record opens in a
`ModalSheet` over its collection, never on a separate page, and the modal is a client-side island
(see "Collections open records in a modal" in `@ketvietlab/design-system`). This page is *how* every
KetSuite module does it, so a care task, a sales case and a partner behave identically.

## URL

One shape for every module:

```
# File: URL shape of every KetSuite record modal
/admin/<collection>?<list state>&record=<kind>:<id>&tab=<tab>
```

- `kind` is `<module>.<name>` (for example `customer_care.followup`) and never contains a colon; the
  id may.
- Build links with `recordModalHref(url, { kind, id, tab })`. It keeps the collection's own query, so
  filters, sort and page survive opening and closing.
- `record` and `tab` are reserved for the record modal. A collection that has its own tabs (for example
  configuration sections) names them with another parameter, such as `section`; otherwise opening or
  closing a record would overwrite the collection's tab.
- The server always renders the collection with a **closed** host. A deep link opens the record after
  hydration; server and first client render stay identical.

## Server side

1. Rows and cards link with `recordModalHref`; create actions with `recordModalCreateHref`.
2. The module declares one island per record kind with `defineRecordModalIsland({ kind, client, export })`
   and places it through `backend:runtime`. Its props are empty.
3. The module exposes one permission-checked read, `<module>.<kind>.modalContext({ id })`, returning
   `{ data, messages }`. `data` is everything the views need in one round trip, including the viewer's
   `permissions`; `messages` are the translated strings the views and the runtime use, including the
   `recordModal.*` labels below.
4. Writes are the module's existing domain functions. The modal adds no form routes; the server stays
   authoritative for permissions and validation.

## Client side

`createRecordModal(definition)` returns the island factory the module exports.

```tsx
// File: modules/customer_care/assets/followup-modal-view.tsx
export const followupModal = createRecordModal<FollowupContext>({
  kind: 'customer_care.followup',
  size: 'large',
  context: { fn: 'customer_care.followup.modalContext' },
  title: (c) => c.data.task.title,
  header: (c) => <CustomerStrip context={c} />,
  tabs: [
    { id: 'call', label: (c) => c.t('customer_care.modal.call'), view: CallTab },
    { id: 'result', label: (c) => c.t('customer_care.modal.result'), visible: (c) => c.data.permissions.work, view: ResultTab },
  ],
  dialogs: { reassign: { title: (c) => c.t('customer_care.action.reassign'), view: ReassignDialog } },
  commands: {
    complete: { fn: 'customer_care.followup.complete', input: completeInput, after: 'close' },
    claim: { fn: 'customer_care.followup.claim', input: versioned, after: 'reload' },
  },
})
```

The runtime owns, for every module:

| Concern | Behaviour |
| --- | --- |
| Opening | A click on a link naming this kind opens it (`pushState`); a link to the open record switches tab (`replaceState`). `record=<kind>:new` opens the create form (see below). |
| History | Back and forward over modal entries open or close the modal only. The navigation layer asks through the cancelable `ket:popstate` event and does not re-fetch the page. |
| Accessibility | `ModalSheet mode="client"`: close controls are buttons, focus moves in and is trapped, Escape closes the top layer, the rest of the page is inert, focus returns to the opener. |
| Height | A definition with more than one tab renders `ModalSheet height="fixed"`: the dialog keeps one height from loading through every tab. `TabbedView` keeps the bar fixed and only its `TabPanel` scrolls; the panel adds no horizontal padding. A single view and dialog layers size to their content. |
| States | Loading, load failure with retry, not found. |
| Cache | Each island keeps the last 30 contexts it read (including the create form's). Reopening one renders it at once and reads it again quietly behind it. A successful command drops the record it changed, and `ket:records-changed` for the kind drops the named ids (all when none are named). A definition sets `cache: false` when its context must never be shown before a fresh read. |
| Commands | A form inside the modal names its command with a `__command` field (or a submit button with `name="__command"`). The runtime maps `FormData` through `command.input`, calls `/_ket/fn` with an idempotency key, and applies `after`: `close`, `reload`, `refresh`, `stay`, `{ tab }` or `{ dialog }`. |
| Refusals | Issues with a `field` are read back by the view through `context.fieldError(name)`; the rest render as a danger notice at the top of the layer. Text/select values survive through `context.draft(name, fallback)` and checkbox/radio state through `context.draftChecked(name, value, fallback)`. |
| Success | A command that leaves the modal open says so where a refusal would have appeared: a positive notice at the top of the layer (`recordModal.savedTitle` / `recordModal.saved`). It clears on the next submit and when another record opens. A command that closes the modal says it by closing. |
| Unsaved input | Switching tabs preserves text, select, checkbox and radio drafts without prompting. Closing asks `recordModal.unsaved` only for the top layer being discarded. |
| Dialogs | An element with `data-record-dialog="<name>"` opens a dialog layer of the same record; `data-record-param-*` attributes become its params. Closing it returns to the record without reloading. |
| Uploads | A command's `upload` names file fields; each file is stored through `/files` with the metadata the command gives, and the attachment ids reach `input` as its third argument. A `data-record-submit` file input submits on choice, and a `data-record-dropzone` form takes a dropped file. |
| View state | `context.state(key)` reads what a `data-record-state` control set: a button or link with `data-record-value` on click, an input or select on change. It resets when another record opens. |
| Islands | `recordIsland(name, props)` places an island inside a view; the runtime asks the page's island manager to start it (`ket:islands-attach`) and to dispose it when its host leaves (`ket:islands-detach`). A joint filled with islands renders in a record modal this way. |
| Collection | After a successful command the runtime dispatches `ket:records-changed`; the backend shell re-fetches the content slot as a fragment. The modal lives outside that slot and is untouched. |

Views are render-pure. They read the context and return design-system markup (`RecordForm`, `Field`,
`DataTable`, `Notice`…); they never fetch, never touch history and never query the document. The runtime
builds `TabbedView` and `TabPanel`; a module supplies the tab's label and view and must not create its own
tab-body wrapper, padding, or scrolling contract.

## Creating a record

A collection's create action opens the **same** record modal as its rows, with no record yet. There is
no create page and no separate create modal.

```
# File: URL shape of a create action
/admin/<collection>?<list state>&record=<kind>:new&tab=<tab>
```

- Build the link with `recordModalCreateHref(url, { kind, tab })`. `new` (`RECORD_NEW_ID`) is reserved:
  a kind whose ids could literally be `new` must not use this contract.
- The runtime calls the context read **without an id** (`{}`) and sets `context.creating = true`.
  `<module>.<kind>.modalContext` then returns the empty record's defaults, the choices its form needs
  and the viewer's `permissions` (a viewer who may not create gets a refusal, not an empty form).
  A definition that needs another input shape uses `context.input(id, creating)`.
- Views branch on `context.creating`: hide tabs that need an existing record (members, history…),
  title the modal for creation, and name the create command in the form.
- The create command is the module's existing save function. Give it `after: 'open'`: on success the
  runtime reads the new id (`created(value)`, else the value's `id`), replaces the `:new` history
  entry with the created record and opens it on `openTab` (or the first tab). Without an id it closes.
  `ket:records-changed` carries the created id, so the collection behind refreshes.
- A child that only exists once the record does (a team's members, a programme's milestones) is added
  after the switch, inside the created record's modal.

## Runtime labels

The runtime shows these labels before a record's context has loaded, so a module passes them in the
page's language through `labels` (an object or a function returning one). The context's `messages`
override them once loaded, the last record's messages carry over while the next one loads, and the
runtime keeps English defaults (`RECORD_MODAL_LABELS`) so a reader never sees a key. Contexts should
still ship the same keys in `messages`:

| Key | Use |
| --- | --- |
| `recordModal.close` | Close control label |
| `recordModal.loading` | Loading state and provisional title |
| `recordModal.loadFailed` | The record could not be read |
| `recordModal.notFound` | The record is gone or not visible |
| `recordModal.retry` | Retry after a load failure |
| `recordModal.errorTitle` | Title of the refusal notice |
| `recordModal.saveFailed` | A command failed without issues |
| `recordModal.savedTitle` | Title of the notice a succeeded command leaves |
| `recordModal.saved` | A command succeeded and the modal stayed open |
| `recordModal.unsaved` | Prompt before discarding typed input |
| `recordModal.uploadFailed` | A file could not be stored |

## Building the island

Author the definition in TSX and bundle it with esbuild into the module's asset root. Keep
`@ketvietlab/ketjs-view` external (it is served at `/_ket/view/`) and bundle
`@ketvietlab/design-system` and `@ketvietlab/ketsuite/ui` in, so the island shares the page's single
renderer and renders the same markup the design-system CSS expects.
