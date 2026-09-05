---
title: Rendering and islands
description: Build first-party UI with ketjs-view signals, templates, SSR, hydration, JSX, and interactive islands.
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
// File: src/ui/order-page.ts
import { each, html, signal, when } from '@ketvietlab/ketjs-view'
```

An application that has both packages need not remember which half a name lives in:
`@ketvietlab/ketjs` re-exports the view entrypoint whole, so the same import works from there.

## HTML templates

`html` returns a `TemplateResult`; it does not concatenate a string:

```ts
// File: src/ui/order-page.ts
const orderCard = (order: Order) => html`
  <article class="order-card">
    <h2>${order.number}</h2>
    <p>${order.customerName}</p>
    <strong>${order.total}</strong>
  </article>
`
```

Hole values are escaped during SSR. On the client, static strings are parsed once per template call
site and subsequent renders update holes in place.

Use `when()` for conditional templates:

```ts
// File: src/ui/order-page.ts
html`
  <section>
    ${when(order.overdue, () => html`<span class="danger">Overdue</span>`)}
  </section>
`
```

Use keyed `each()` for collections:

```ts
// File: src/ui/order-page.ts
html`
  <ul>
    ${each(
      orders,
      (order) => order.id,
      (order) => html`<li data-id=${order.id}>${order.number}</li>`,
    )}
  </ul>
`
```

Stable keys let the renderer move or update existing instances instead of rebuilding the list.

## Events

Tagged templates use `on:<event>` attributes:

```ts
// File: src/ui/order-page.ts
const count = signal(0)

const Counter = () => html`
  <button type="button" on:click=${() => count.set((value) => value + 1)}>
    Count: ${count()}
  </button>
`
```

Handlers are not serialized into server HTML. Hydration attaches the listener once and updates its
current callback without detach/reattach churn.

## Signals

```ts
// File: src/ui/order-page.ts
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

## Client rendering

Mount a reactive view into a DOM container:

```ts
// File: src/ui/order-page.ts
import { domHost, mount } from '@ketvietlab/ketjs-view'

const mounted = mount(domHost(document), container, Counter)

mounted.refresh()
mounted.dispose()
```

`dispose()` stops reactivity and detaches behavior; it leaves the current DOM in place.

## Server rendering

```ts
// File: src/ui/order-page.ts
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
// File: src/ui/order-page.ts
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

## Interactive islands

An island is the boundary between server-rendered pages and browser behavior. A module defines the
behavior; a theme may place it but cannot write code.

```ts
// File: src/modules/example/islands.ts
import { defineModule } from '@ketvietlab/ketjs'
import { html, signal } from '@ketvietlab/ketjs-view'
import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'

const islands: Record<string, IslandDefinition> = {
  'cart.counter': {
    props: { cartId: 'id', initial: 'int' },
    key: ['cartId'],
    client: 'cart-counter.mjs',
    export: 'cartCounter',
    view: (props: IslandProps) => {
      const count = signal(Number(props.initial))
      return () => html`
        <button on:click=${() => count.set((value) => value + 1)}>
          Cart (${count()})
        </button>
      `
    },
  },
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

The browser client export must create the same view for the same props. KetJS publishes a tenant-aware
island bootstrap and serves the module under `/_ket/asset/<module>/`.

### Persistent identity

Every server-rendered island carries canonical JSON in `data-key`. Its identity is the pair
`data-island + data-key`:

| Declaration | Identity |
| --- | --- |
| `key: ['cartId']` | The listed prop values, in declaration order. |
| `key: []` | One global instance for that island name. |
| No `key` | All canonicalized props. |

A key field must name a required scalar prop. Optional, missing, or `json` props fail composition
because they cannot provide a stable identity contract. Two instances with the same identity in one
document are ambiguous: KetJS warns and remounts them instead of preserving an arbitrary one.

During fragment reconciliation, an island with the same identity and unchanged props keeps its exact
DOM node, signals, subscriptions, focus, and local state. If props changed, preservation requires an
`update()` method; otherwise the old instance is disposed and the new server instance is hydrated.

### Controllers and cleanup

A factory may still return a plain view, or return a lifecycle controller:

```ts
// File: src/ui/order-page.ts
import type { IslandController, IslandFactory } from '@ketvietlab/ketjs-view'

const cartCounter: IslandFactory = (initialProps) => {
  const props = signal(initialProps)
  const request = new AbortController()

  const controller: IslandController = {
    view: () => html`<button>Cart ${props().initial}</button>`,
    update(next) {
      props.set(next)
    },
    dispose() {
      request.abort()
    },
  }
  return controller
}
```

Use `dispose()` to stop module-owned requests, polling, observers, and document-level listeners. KetJS
always stops the reactive root first, then calls the controller cleanup once. An exception from
`update()` aborts fragment reconciliation so the navigation runtime can fall back to a full reload.

## Hydrate islands

Framework pages normally load the generated bootstrap. Low-level applications can hydrate a registry:

```ts
// File: src/ui/order-page.ts
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

Only `<ket-island>` elements hydrate. Headings, layout, and other server HTML remain inert. Unknown
islands fail in strict mode; `{ strict: false }` leaves intentionally server-only islands untouched.
`hydrateIslands()` remains the compatibility wrapper for applications that do not reconcile slots.

## Fragment navigation and persistent islands

A document opts into enhanced navigation by exposing named elements such as
`data-ket-slot="backend.content"`. Same-origin GET links and GET forms then request server-rendered slot
fragments. The manager moves matching old island nodes into the new fragment before inserting it, so
preserved islands never rehydrate or recreate their reactive graph.

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

Plain strings in template holes are escaped. `trustedMarkup()` exists for markup produced by a
restricted compiler such as KTL:

```ts
// File: src/ui/order-page.ts
import { trustedMarkup } from '@ketvietlab/ketjs-view'

html`<section>${trustedMarkup(compiledThemeOutput)}</section>`
```

Never wrap request or database text merely to make HTML render. The trust decision must belong to the
producer, not the final template call.

Continue with [Themes and KTL](/ketjs/themes/) for the restricted presentation layer.
