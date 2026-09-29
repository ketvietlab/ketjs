# Flow extension contracts

Core is MIT. The application entry registers client extensions before creating the
first workspace. Registration order is render/guard order; names, routes, forms and
API error codes have one owner. Invalid registration changes no shared registry.
The registry is process-local: an entry must choose its edition once, not register
features conditionally per HTTP request. Tenant entitlements and authorization stay
on the server, not in route visibility.

Each island gets a fresh `create(ctx)` instance. `view`/`modal`, `topAction`,
`navigation`, `taskSection`, `taskLinks`, `taskEstimate`, `taskStatusHint`,
`taskPoints`, `settingsSection` and `sprintSummary` compose public Flow UI components.
`transition` may refuse or redirect client actions, but never replaces server checks.
`mutationError` can claim a failed operation; `ownsFeedback` suppresses the outer toast
while a feature dialog renders the same feedback. Failing writes must show one toast.

`readUrl` restores Back/Forward state; `urlParams` contributes route state before
explicit navigation parameters override it. `beforeNavigate` runs before changing
route. `sync` runs after reads/navigation; `afterRender` attaches an external viewer.
These asynchronous hooks own their cancellation/error handling. `reset` discards
context-specific state on organization/workspace switches, including browser history.
`dispose` releases viewers and requests. Product source must never import Atlas.

## Server boundary

Import `createFlowServerExtensions` explicitly from `server-extensions.mjs`. It is
an independently composed registry, not a global registration side effect. Command
names and capability requirements are explicit. Missing commands return
`{ handled: false }`; a core-only host has no private commands or guards.

`mutate(context, {name, input, capability}, write)` calls the host's
`requireCapability(capability, input)` before opening its transaction. The host must
throw on refusal and must resolve tenant, actor and record scope from authenticated
server state. Inside `transaction(callback)`, all `beforeMutation(scoped, mutation)`
guards run in registration order before `write(scoped)`. A guard throws to refuse;
the transaction must roll back any failure. `dispatch` uses that same path for an
extension-owned command. Cleanup is idempotent and attempts every extension in
reverse registration order, reporting failures together.

The host remains responsible for input validation, capability and tenant resolution,
CAS/locks, idempotency/replay and durable outbox work. No external effect belongs
inside a retryable transaction. All write paths (HTTP, staff, import, bulk, automation)
must eventually invoke this boundary or its equivalent inside the same authoritative
transaction. This commit supplies and tests the contract; it does not claim that the
existing KetSuite production endpoints have been migrated. That adapter is tracked
by D05/G03 in the implementation matrix.

## Atlas adapters

`atlas/extensions.mjs` is a synchronous fixture hook runner used only by the mock.
It is deliberately separate from the transactional server contract. Core fixtures
contain no pro data. The private Atlas entry supplies additional seeds, reads,
commands, guards, scoped fields and cleanup to the public fixture creators. Never
use an Atlas session or generic fixture writer as a production command handler.
