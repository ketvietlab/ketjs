---
title: HTML first, islands where interaction belongs
description: Choose static rendering, server rendering and interactive islands deliberately, and keep browser behavior separate from pure ketjs-view templates.
date: "2026-09-09"
order: 4
---
A documentation page and a shopping cart do not need the same browser runtime. The first mostly presents text; the second owns changing state and user actions. Treating both as one large interactive application makes it harder to see where behavior belongs.

ketjs-view lets an application start with HTML and add explicit islands where interaction is needed. It can also be used independently of the KetJS server framework. The useful distinction is ownership: which work produces a document, and which work must remain alive in the browser?

These are the current **KetJS 0.2.0 Preview** contracts, not a guarantee that a particular rendering strategy wins for every product.

## A static site still has a rendering pipeline

A static site can render pages at build time and deploy the resulting HTML, styles and browser assets. No application server needs to run for each visitor to read the document.

The `ket-view` tooling supports this path using the same TSX view primitives. This Docs website is a concrete example: Markdown supplies content, views compose the page, and the build produces static artifacts. Interactive search, diagram viewing and the playground remain browser features.

That does not require importing the server database framework into a client bundle. The [standalone static-site guide](/docs/view-static-sites/) describes the view toolchain. Decide package boundaries from the functionality you need instead of assuming that using the view layer implies adopting the entire backend.

## SSR prepares the first useful document

Server rendering is useful when a page depends on request-specific data. The server resolves identity, performs authorized reads and passes the resulting presentation data into a pure view.

A pure view describes output from its inputs. It should not open sockets, fetch remote data or register browser listeners during rendering. The same view may be evaluated outside a browser, and rendering it twice should not duplicate a business action.

Suppose a task page initially shows ten authorized tasks. Load those tasks before rendering and pass them into the island's initial props. The initial document can contain useful content before the browser has loaded its interaction code. Never serialize credentials or unnecessary private fields simply because they were available to the server.

## An island owns a bounded interaction

A counter owns its count. A task list owns refresh state, a filter and the currently displayed rows. A search dialog owns its open state and keyboard handling. These are different lifetimes, even when they appear on one page.

An island factory creates instance state and returns its view and optional lifecycle behavior. Signals drive the relevant DOM updates. Side effects belong in the client lifecycle, with cleanup attached to the island's lifetime.

```tsx
// File: src/islands/counter.tsx
import { signal, type IslandFactory } from '@ketvietlab/ketjs-view'

type CounterProps = { initial: number }

const counter: IslandFactory<CounterProps> = (props) => {
  // Each island instance owns its state, initialized from the rendered page.
  const count = signal(props.initial)

  return {
    view: () => (
      <button onClick={() => count.set((value) => value + 1)}>
        Count: {count()}
      </button>
    ),
  }
}

export default counter
```

There is no fetch in the view and no need to make the entire surrounding article reactive. See [rendering and islands](/docs/rendering/) for registration, hydration and browser entry points.

## Identity decides which state survives

An island key describes its persistent identity. It should use a stable domain identifier, not the entire content object or a serialization of every prop.

For a cart counter, a cart ID describes identity. If the same cart appears in a new fragment, preserving the island may preserve useful interaction state. If the cart changes, reusing the old identity would preserve the wrong state. Think about both cases when choosing a key.

An empty identity can be appropriate for a page-wide control that deliberately survives fragment updates, but it is not a universal default for every feature. The key expresses a lifecycle decision; it is not only a rendering optimization.

## Navigation does not automatically imply a new document

Native links remain meaningful URLs and work without a client router. A client navigation layer can then update a supported content region and preserve selected islands. Browser history, loading failures and focus or scroll behavior still need deliberate handling.

This is why first-load rendering and later navigation are separate design decisions. A server-rendered first page does not require a full reload for every subsequent interaction. Equally, a fragment update is not permission to ignore changed metadata or reuse unrelated state.

For a docs site, preserving search and navigation controls can feel smoother than reconstructing the whole page. For an account switch, resetting some state may be necessary. Define the desired lifetime before implementing the navigation mechanism.

## Choose the smallest runtime that explains the feature

Use static rendering for content that can be known at build time, SSR for request-dependent initial output, and islands for bounded browser interaction. A client-rendered application is also possible when its workflow calls for that ownership model.

The right test is whether someone can explain what happens when the page loads, when a prop changes and when the island is removed. If those answers are unclear, moving more logic into a view will not clarify them.

Continue with [effects and data loading](/blog/effects-and-data-loading/). It follows a task list beyond its initial HTML and explains how to refresh data without letting old requests take control of the interface.
