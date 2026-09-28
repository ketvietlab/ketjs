# Flow core client adapter contract

The MIT client is shared between an Atlas fixture server and a future KetSuite
production deployment. **The fixture API is not a completed production API.**
Reuse existing KetSuite `flow` domain functions, identity, permissions, storage and
LiveDoc; adapt the client deliberately where their input contracts differ. Never
expose the fixture's generic collection writer as a production endpoint.

## Transport and lifecycle

`createFnClient()` calls same-origin `POST /_ket/fn/<name>` with JSON and cookie
credentials. The outer envelope is `{ok, value}`. An unsuccessful command may
return `{ok: true, value: {ok: false, errors: [{code,message}], fields}}`; network,
HTTP and command errors become `FlowApiError`. Reads accept AbortSignal. Late reads
must not replace the current organization. A mutation's idempotency key is sent in
both its JSON input and the `Idempotency-Key` header. Retrying an uncertain write
reuses the key; changing its payload creates a new operation.

`createFlowWorkspace(props, {call, upload})` returns a KetJS View island. Props identify
screen, organization/workspace/project, record, filters and base path. SSR emits only
the deterministic loading view. Mount reads data and attaches the public Flow UI
runtime. Dispose aborts reads and removes observers. Register extensions before
creating islands; see [EXTENSIONS.md](EXTENSIONS.md).

## Proposed core reads and commands

`flow.workspace.bootstrap` supplies the authorized user/company/workspace/project
context, capabilities, task catalogs, tasks, sprints, epics, pages, forms, inbox and
related collections. Atlas returns a bounded synthetic scenario. Production needs
separate bounded collection/detail/options reads before the accepted large-tenant
benchmark; never fetch the entire organization because the fixture does.

| Command | Client expectation | Production integration |
|---|---|---|
| `flow.issue.save` | Create or partial patch, task version, idempotency | Adapt existing domain save; validate every supplied field and owner scope |
| `flow.issue.move` / `flow.issue.reorder` | Atomic status/group/order change, expected task and order versions | Recheck dependencies, required fields, rights and versions inside the transaction |
| `flow.issue.bulk` | Atomic selected-task completion in the fixture | Explicit supported bulk result contract, permissions on every task |
| `flow.issue.dependency` / `flow.issue.linkChild` | Scope/cycle checks, no partial mutation | Use authoritative dependency and hierarchy operations |
| `flow.issue.comment` | Append comment; refresh activity | Durable comment, scoped attachments and notification delivery |
| `flow.issue.archive/restore/follow/assignSprint` | Named actions with stable replay | Bind the corresponding capability-specific functions |
| `flow.entity.save/action` | Atlas editing for projects/pages/sprints/catalogs/files | Replace with typed domain functions; never trust arbitrary collection names |
| `flow.document.command` / `flow.page.reorder` | Scoped sharing/order, expected version and sibling sequence | Enforce read/write/manage rights, privacy and concurrent ordering server-side |
| `flow.organization.command` | Atlas workspace/member/team/grant editing | Use KetSuite identity and grants; client visibility never authorizes a write |
| `flow.operations.command` | Internal forms, response ledger, inbox, views, preferences | Authenticated submit; form schema version, task and response in one transaction |

Task patches preserve omitted fields. Assignment uses stable member IDs; hierarchy,
dependencies, statuses, labels and custom fields belong to their permitted project.
Autosaves serialize per task and retain failed drafts for explicit recovery. Upload
bytes first with `createFileUploader`, then submit the upload reference; server-side
storage must verify ownership, type, size, access and attachment association.

Sprint cadence is `null` for Kanban or `{weeks:1..4, weekday:0..6}`. Only one active
sprint is allowed per project. Closing records an immutable commitment/completion
snapshot and explicit carryover. The core report counts ordinary points and remains
available with no private extension installed.

Document visibility is owner/grant scoped. Parent moves cannot create cycles or
cross ownership unnoticed. LiveDoc persistence, token binding, concurrent editing,
attachment authorization and export must use the existing server facilities.

## Edition and persistence boundary

The public package has no private imports, store records or migrations. Server
extensions are explicitly composed; absent commands are unhandled. Core permission,
version, replay, dependency and tenant checks apply even with no extension installed.
Paid extensions own their additional schema/migrations and private adapter contracts.

Atlas is development-only, in-memory synthetic data. Authentication fixtures,
generic writers, upload memory and scenario clocks are not production services.
A successful fixture or browser test establishes client behavior, not durable storage,
security acceptance, concurrency capacity, recovery objectives or feature completeness.
