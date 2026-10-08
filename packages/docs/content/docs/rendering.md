---
title: Rendering and islands
description: Build first-party UI with ketjs-view signals, templates, SSR, hydration, JSX, and interactive islands.
group: ketjs-view and KTL
order: 1
---

`@ketvietlab/ketjs-view` is KetJS's browser-safe, zero-dependency rendering package. It uses runtime signals and
cached template shapes instead of a virtual DOM. Server rendering and hydration walk the same static
template structure, so updates touch only changed holes.

## Install and import

`@ketvietlab/ketjs` already depends on `@ketvietlab/ketjs-view`. Applications may also install and use the view package alone:

```bash
# Run from: /path/to/ketjs
npm install @ketvietlab/ketjs-view
```

```ts
// File: src/ui/order-page.tsx
import { each, signal, when } from '@ketvietlab/ketjs-view'
```

An application that has both packages need not remember which half a name lives in:
`@ketvietlab/ketjs` re-exports the view entrypoint whole, so the same import works from there.

## TSX templates

TSX produces a `TemplateResult` through `ketjs-view`'s automatic JSX runtime. It does not require React or build a virtual DOM:

```tsx
// File: src/ui/order-page.tsx
const OrderCard = ({ order }: { order: Order }) => (
  <article class="order-card">
    <h2>{order.number}</h2>
    <p>{order.customerName}</p>
    <strong>{order.total}</strong>
  </article>
)
```

Dynamic values are escaped during SSR. On the client, cached template shapes let later renders update dynamic values in place.

Use `when()` for conditional content:

```tsx
// File: src/ui/order-page.tsx
const OrderStatus = ({ order }: { order: Order }) => (
  <section>{when(order.overdue, () => <span class="danger">Overdue</span>)}</section>
)
```

Use keyed `each()` for collections:

```tsx
// File: src/ui/order-page.tsx
const OrderList = ({ orders }: { orders: Order[] }) => (
  <ul>{each(orders, (order) => order.id, (order) => <li data-id={order.id}>{order.number}</li>)}</ul>
)
```

Stable keys let the renderer move or update existing instances instead of rebuilding the list.

## Events

TSX uses event props such as `onClick`:

```tsx
// File: src/ui/order-page.tsx
const count = signal(0)
const Counter = () => (
  <button type="button" onClick={() => count.set((value) => value + 1)}>
    Count: {count()}
  </button>
)
```

Handlers are not serialized into server HTML. Hydration attaches the listener once and updates its current callback without detach/reattach churn.

## Signals

```ts
// File: src/ui/order-page.tsx
import { batch, computed, effect, signal } from '@ketvietlab/ketjs-view'

const quantity = signal(2)
const unitPrice = signal(15)
const total = computed(() => quantity() * unitPrice())

const stop = effect(() => {
  console.log('total', total())
})

batch(() => {
  quantity.set(3)
  unitPrice.set(20)
})

stop()
total.dispose()
```

- Calling a signal reads and tracks it.
- `.set()` accepts a value or updater.
- `.peek()` reads without subscribing.
- `computed()` settles before ordinary effects observe the graph.
- `batch()` coalesces several writes into one flush.
- `effect()` returns a disposer and may return its own cleanup callback.

For execution timing, lifecycle cleanup, async requests, SSR initial data and stale-response protection, read [Effects and data fetching](/docs/view-effects-data/). The step-by-step exercises are [Reactive effects](/learn/effects/) and [Data fetching](/learn/data-fetching/).

## Client rendering

Mount a reactive view into a DOM container:

```ts
// File: src/ui/order-page.tsx
import { domHost, mount } from '@ketvietlab/ketjs-view'

const mounted = mount(domHost(document), container, Counter)

mounted.refresh()
mounted.dispose()
```

`dispose()` stops reactivity and detaches behavior; it leaves the current DOM in place.

## Server rendering

```ts
// File: src/ui/order-page.tsx
import { renderToString } from '@ketvietlab/ketjs-view'

const markup = renderToString(orderCard(order))
```

SSR emits comment markers around dynamic holes. `hydrateRoot()` or `mountHydrated()` adopts those
nodes rather than creating a second tree. A mismatch throws `HydrationMismatch` with a hint when the
HTML parser inserted implied structure such as `<tbody>`.

The first hydrated render is also the first reactive dependency-collection pass. The browser calls
the view once, adopts the existing nodes during that call, and subscribes to every signal it reads.
Later signal changes re-run the view normally. If that first pass fails, KetJS rolls back its partial
dependencies and DOM behavior before surfacing the error.

Write valid explicit HTML structure on both server and client. Do not suppress a mismatch caused by
different input.

## Static document rendering

Use `renderToStaticString()` when the result is final document markup rather than a root that the
browser will hydrate. It walks the template directly without emitting and then stripping comments:

```tsx
// File: tools/render-static.tsx
import { renderToStaticString } from '@ketvietlab/ketjs-view'

const markup = renderToStaticString(
  <main>
    <h1>{page.title}</h1>
    <p>{page.description}</p>
  </main>
)
```

Interpolated values are still escaped, and nested templates, conditions, and keyed lists inherit the
static mode. Do not pass this output to `hydrateRoot()` or `mountHydrated()`: ordinary holes no longer
have the anchors those APIs require.

Explicit island boundaries are the exception. Descendants of both the legacy `<ket-island>` host and
the standard `<div data-ket-island>` host keep hydration markers automatically. This lets a static
document remain inert and comment-free outside the small regions that `hydrateIslands()` adopts.

For file-based routes, CSS and JavaScript bundling, live reload, and automatic island bootstrapping,
use the [static site toolkit](/ketjs/view-static-sites/).

## JSX authoring

Configure TypeScript's automatic runtime:

```jsonc
// File: tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@ketvietlab/ketjs-view"
  }
}
```

Then write TSX without React:

```tsx
// File: src/ui/order-page.tsx
import { signal } from '@ketvietlab/ketjs-view'

const count = signal(0)

export const Counter = () => (
  <button type="button" onClick={() => count.set((value) => value + 1)}>
    Count: {count()}
  </button>
)
```

JSX compiles to the same `TemplateResult` runtime. There is no VDOM. The runtime rejects mutable refs
and `dangerouslySetInnerHTML`; pass only trusted compiler output through `trustedMarkup()`.

TypeScript only rewrites the syntax: every element still calls the runtime when it renders. The runtime
caches each element's shape by tag and prop names and validates a shape only the first time it sees it.
Children written out in source share their parent's template, while a list built at run time fills one
hole. A JSX element is still one template, so a hot path that renders many rows renders fastest as one
`html` template per row, or with the build-time JSX compiler described in
[Compile JSX](/ketjs/view-static-sites/#compile-jsx). Hydration markers follow these shapes, so server
markup must be hydrated by the same `ketjs-view` version and the same JSX build that rendered it.

## Interactive islands

An island is the boundary between server-rendered pages and browser behavior. A module registers the
island and its prop contract; a theme chooses its placement. Themes may also ship browser JavaScript
for presentation enhancements. See [Browser JavaScript in themes](/docs/themes/#browser-javascript)
for the distinction between theme assets and module-owned runtime registrations.

```tsx
// File: src/modules/example/islands.tsx
import { defineModule } from '@ketvietlab/ketjs'
import { defineIsland, signal } from '@ketvietlab/ketjs-view'

type CartCounterProps = { cartId: string; initial: number }

const islands = {
  'cart.counter': defineIsland<CartCounterProps>()({
    props: { cartId: 'id', initial: 'int' },
    key: ['cartId'],
    client: 'cart-counter.mjs',
    export: 'cartCounter',
    view: (props) => {
      const count = signal(props.initial)
      return () => (
        <button onClick={() => count.set((value) => value + 1)}>
          Cart ({count()})
        </button>
      )
    },
  }),
}

export default defineModule({
  name: 'cart',
  assets: new URL('./client/', import.meta.url),
  islands,
})
```

Island props are declared scalar contracts and must be plain JSON all the way down. The server
serializes exactly those props beside the rendered island. Functions, cyclic objects, non-finite
numbers, and class instances are rejected.

Use `defineIsland<Props>()` rather than annotating a heterogeneous registry with
`Record<string, IslandDefinition>`. The helper keeps the props schema, identity keys, `view()` input,
and `update()` input on one TypeScript contract; a broad registry annotation erases those checks.

The browser client export must create the same view for the same props. KetJS publishes a tenant-aware
island bootstrap and serves the module under `/_ket/asset/<module>/`.

Low-level callers may render an island into a standard `div`:

```ts
// File: tools/render-static.ts
import { renderIsland } from '@ketvietlab/ketjs-view'

const counter = renderIsland(
  'cart.counter',
  islands['cart.counter'].view,
  { cartId: 'cart-1', initial: 0 },
  { key: ['cartId'], tag: 'div' },
)
```

The result uses `<div data-ket-island="" data-island="cart.counter">`. Omitting `tag` keeps emitting
`<ket-island>` for compatibility. Hydration, reconciliation, fragment loading, and server bootstrap
recognize both forms. `data-ket-island` marks the host boundary; `data-island` remains the registry
name and must not be replaced with an opaque numeric flag.

### Persistent identity

Every server-rendered island carries canonical JSON in `data-key`. Its identity is the pair
`data-island + data-key`:

| Declaration | Identity |
| --- | --- |
| `key: ['cartId']` | The listed prop values, in declaration order. |
| `key: []` | One stable identity for that island name inside a reconciliation boundary. |
| No `key` | All canonicalized props. |

A key field must name a required scalar prop. Optional, missing, or `json` props fail composition
because they cannot provide a stable identity contract. Two instances with the same identity in one
replacement boundary are ambiguous: KetJS warns and remounts them instead of preserving an arbitrary
one. `key: []` therefore suits a singleton shell indicator, not repeated row widgets.

During fragment reconciliation, an island with the same identity and unchanged props keeps its exact
DOM node, signals, subscriptions, focus, and local state. If props changed, preservation requires an
`update()` method; otherwise the old instance is disposed and the new server instance is hydrated.

### Controllers and cleanup

A factory may still return a plain view, or return a lifecycle controller:

```tsx
// File: src/ui/order-page.tsx
import { signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandFactory } from '@ketvietlab/ketjs-view'

const cartCounter: IslandFactory = (initialProps) => {
  const props = signal(initialProps)
  let request: AbortController | null = null

  const controller: IslandController = {
    view: () => <button>Cart {props().initial}</button>,
    mount({ root, lifetime }) {
      // DOM, URL, storage, timers, observers, and network start only here. SSR
      // and the browser's first hydration pass therefore produce the same tree.
      request = new AbortController()
      lifetime.addEventListener('abort', () => request?.abort(), { once: true })
      const target = Array.from(root.querySelectorAll('[data-autofocus]'))[0]
      ;(target as HTMLElement | undefined)?.focus()
    },
    update(next) {
      props.set(next)
    },
    dispose() {
      request?.abort()
    },
  }
  return controller
}
```

`mount()` runs once in the browser after hydration adopts the server DOM; it never runs during SSR.
Scope DOM queries to `root`, and bind event listeners to `lifetime` where the browser supports an
abort signal. On removal KetJS aborts `lifetime`, stops the reactive root, then calls `dispose()` once.
Use `dispose()` for resources that do not accept an abort signal. An exception from `update()` aborts
fragment reconciliation so the navigation runtime can fall back to a full reload.

Do not read `window`, URL state, storage, or the document while constructing the controller. Doing so
can make the browser's first tree differ from SSR. Adopt browser-only state in `mount()` and let signals
render the next state after hydration. An island owns its root descendants; code outside it must not
replace that DOM behind the renderer.

### Browser-wide behaviors

An island owns a local rendered tree. A behavior progressively enhances an existing document surface
without pretending to be a visual component. Use a behavior for delegated shell actions, navigation
guards, or form interception that spans several server-rendered regions:

```ts
// File: src/modules/backend/index.ts
export default defineModule({
  name: 'backend',
  assets: new URL('./client/', import.meta.url),
  behaviors: {
    'backend.shell': {
      client: 'backend-shell.mjs',
      export: 'backendShell',
      when: '[data-ui="app-shell"]',
    },
  },
})
```

```ts
// File: src/modules/backend/client/backend-shell.ts
import type { BrowserBehavior } from '@ketvietlab/ketjs'

export const backendShell: BrowserBehavior = ({ document, navigation, lifetime }) => {
  document.addEventListener('submit', handleSubmit, { signal: lifetime })
  // navigation.navigate(url), navigation.apply(response), navigation.replace(url),
  // and navigation.reload(url) are the public routing boundary.
}
```

`when` is an optional CSS selector. KetJS loads and mounts the behavior while it matches, aborts its
lifetime and cleanup when it stops matching, then evaluates it again after every fragment update.
Behavior failures emit `ket:behavior-error` and do not prevent unrelated enhancements from mounting.
A behavior may listen, focus, toggle attributes, or submit through `navigation`; it must not take over
an island's rendered descendants or keep module-global “installed” flags. The runtime, not a private
global such as `__ketNavigation`, owns history and fragment application.

## Hydrate islands

Framework pages normally load the generated bootstrap. Low-level applications can hydrate a registry:

```ts
// File: src/ui/order-page.tsx
import { createIslandManager, domHost, hydrateIslands } from '@ketvietlab/ketjs-view'

const live = hydrateIslands(domHost(document), document.body, registry)

for (const island of live) {
  console.log(island.name)
}

const manager = createIslandManager(domHost(document), registry)
manager.hydrate(document.body)
manager.reconcile(contentSlot, nextTemplate.content)
manager.dispose(contentSlot)
```

Only `<ket-island>` and `<div data-ket-island>` elements hydrate. Headings, layout, and other server
HTML remain inert. Unknown islands fail in strict mode; `{ strict: false }` leaves intentionally
server-only islands untouched.

A `HydrationMismatch` stays inside its island. By default the manager discards that island's server DOM,
renders it on the client and continues with the other islands, so one stale or altered island does not
leave the rest of the page inert. Islands nested in the discarded markup are dropped, and the hosts the
new render places are hydrated in their turn. Each recovered mismatch goes to `onHydrationMismatch(error, island)`, or to `console.error`
when no handler is given. Pass `{ hydrationMismatch: 'throw' }` to fail the call instead; `ket-view dev`
does this so a mismatch is visible while developing. Other island errors, such as unreadable props or
an unknown island in strict mode, still throw.
`hydrateIslands()` remains the compatibility wrapper for applications that do not reconcile slots.

## Fragment navigation and persistent islands

A document opts into enhanced navigation by exposing named elements such as
`data-ket-slot="backend.content"`. Same-origin GET links and GET forms then request server-rendered slot
fragments. The manager moves matching old island nodes into the new fragment before inserting it, so
preserved islands never rehydrate or recreate their reactive graph.

Working surfaces can set `data-ket-preserve-context` on a container. Same-path GET links and forms
inside it retain window and nested scroll positions and restore focus when the corresponding control
still exists. Modified clicks, downloads, external links and `data-ket-reload` keep native behaviour.
Back/Forward retrieves the URL's server state and restores the saved scroll positions.

Browser behaviors can request the same treatment with
`navigation.navigate(href, { preserveContext: true })`. Pass `fallback: 'error'` to receive a rejected
promise instead of a document reload on failure, and an optional `signal` to cancel stale requests.
Network failures and HTTP 5xx errors carry `retryable: true`; HTTP refusals carry `retryable: false`.
Aborted requests reject with `AbortError` in this mode. History is committed after the fragment has
been applied. A server/browser build mismatch still reloads to obtain compatible assets.

Put long-lived islands outside slots that do not need them. For example, a global inbox indicator may
live in a stable sidebar footer while the server replaces sidebar navigation, topbar, and content.
Because `navigablePage()` receives lazy slot callbacks, a fragment request never calls the document or
stable-island renderer at all. Put a record island inside a slot only when its keyed identity should
follow that slot and be reconciled.

This is progressive hydration, not resumability. Initial HTML is still rendered on the server, and
the browser still executes each island view once to attach behavior and collect signal dependencies.
KetJS does not serialize closures or reactive graphs. A full reload always creates new island
instances.

## Trusted markup

Plain strings in template holes are escaped. `trustedMarkup()` exists for markup that a trusted
framework producer constructed or validated, such as restricted KTL compiler output. Higher-level
helpers such as the static toolkit's `island()` own that trust decision internally:

```tsx
// File: src/ui/order-page.tsx
import { trustedMarkup } from '@ketvietlab/ketjs-view'

const ThemeRegion = () => <section>{trustedMarkup(compiledThemeOutput)}</section>
```

Never wrap request or database text merely to make HTML render. The trust decision must belong to the
producer, not the final template call.

Continue with [Themes and KTL](/ketjs/themes/) for the restricted presentation layer.
