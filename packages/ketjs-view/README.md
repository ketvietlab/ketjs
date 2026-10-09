# ketjs-view

The browser-safe view layer used by KetJS: signals, surgical DOM updates, SSR, hydration, JSX
runtime support, and persistent islands. It has no runtime dependencies.

> ketjs-view 0.x is preview software. APIs may change before 1.0.

```bash
# Run from: your-project
npm install @ketvietlab/ketjs-view
```

```ts
// File: your-project/src/view.ts
import { signal, createIslandManager } from '@ketvietlab/ketjs-view'
```

JSX projects can use `@ketvietlab/ketjs-view/jsx-runtime` through TypeScript's automatic JSX runtime.

Documentation and source: [github.com/ketvietlab/ketjs](https://github.com/ketvietlab/ketjs)

For static sites, add `@ketvietlab/ketjs-view-tools`; its native builder supports TSX pages,
content collections and explicit islands without the server framework. For client rendering,
use `domHost()`, `mount()` and signals directly. Browser state, fetches and history belong in
client runtimes or island `mount()` lifecycles, while the shared view remains pure.

```bash
# Run from: repository root
npm run build --workspace @ketvietlab/ketjs-view
```

This build compiles the view package independently, without the application server or adapters.

## Form contracts and sessions

`defineFormContract(id, schema)` shares validation with the server, including nested `object.fields`,
`array.items`, `record.entries`, explicit nullable/empty semantics, bounded collections and stable row
keys. `createFormSession` owns one immutable draft and baseline, single-flight submission, field issues,
revision and retry intent. A lost response keeps the session locked and retries the same snapshot;
only a committed receipt replaces the baseline. Background data never replaces a dirty scope.
Baseline validation is cached until the baseline or a tracked rule dependency changes; each draft
change still validates the full schema, including cross-field constraints.

`attachForm` adapts native controls or custom read/write callbacks in an island's mount lifecycle.
It preserves native markup, associates errors and restores listeners/control state on detach.
Repeated scalar controls receive individual array entries in form order; submit buttons retain their
own values so the selected submitter determines the submitted action.
Each adapter update snapshots current controls once, indexes the first control per name and resolves
each issue once. It groups field errors and writes native values, flags, attributes and error text
only when they change. Multiple error targets retain all their description IDs alongside existing
hints. Dynamic and externally associated controls are included in the next snapshot.
`formActionTransport` calls an ordinary KetJS function with an idempotency key. `createForm` remains
available as a lower-level, transport-independent controller; its resolved handler is not a durable
save acknowledgement.

Read [Forms and edit sessions](../docs/content/docs/view-forms.md) for browser controllers, native
binding, island lifecycle, render subscriptions and migration examples.
See [Form validation](../docs/content/docs/form-validation.md) for shared schemas and nested issues,
and [Transactional form actions](../docs/content/docs/form-actions.md) for server writes, durable
receipts and native-route ownership.
