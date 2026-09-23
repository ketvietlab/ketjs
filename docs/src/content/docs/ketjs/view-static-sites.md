---
title: Static sites with Ket view
description: Scaffold, develop, and deliver plain HTML, CSS, and JavaScript with explicit interactive islands.
---

The Ket view static toolkit is for projects whose deliverable is a directory of HTML, CSS, and
JavaScript files. Pages render through `renderToStaticString()`, so their ordinary dynamic values do
not leave hydration comments. Only explicit islands retain markers and receive browser code.

## Create a project

Node.js 24 or later is required.

```bash
# Run from: /path/to/projects
npm create @ketvietlab/view@latest my-site
cd my-site
npm install
npm run dev
```

The generator creates this layout:

```text
# File: my-site project tree
ket-view.config.ts
public/
  favicon.svg
src/
  islands/
    counter.ts
  pages/
    about.ts
    index.ts
  styles/
    main.css
```

Files under `src/pages` become routes. `index.ts` becomes `/`, `about.ts` becomes `/about/`, and
`docs/index.ts` becomes `/docs/`. Every route is written as an `index.html`, so it works on ordinary
static hosts. Dynamic file names such as `[slug].ts` are intentionally rejected: the build must know
every file it will deliver.

## Commands

```bash
# Run from: /path/to/my-site
npm run dev       # build, watch, serve, and live-reload at 127.0.0.1:5173
npm run check     # type-check and validate routes, pages, and island bundles
npm run build     # write the deployable site to dist
npm run preview   # serve the current dist at 127.0.0.1:4173
```

The build fingerprints CSS and JavaScript filenames. With the default `base: './'`, asset links are
relative to each output page, so the same `dist` directory can be mounted below any URL path.

## Define a page

A page supplies document metadata and a body view. Its path normally comes from its file name; set
`path` only when a deliberate override is clearer.

```ts
// File: src/pages/contact.ts
import { html } from '@ketvietlab/ketjs-view'
import { definePage } from '@ketvietlab/ketjs-view-tools'

export default definePage({
  head: {
    title: 'Contact',
    description: 'How to contact the team.',
    lang: 'en',
  },
  view: () => html`
    <main>
      <h1>Contact</h1>
      <p>Email ${'hello@example.com'}</p>
    </main>
  `,
})
```

The interpolation is escaped as usual, but the final paragraph has no `<!--k-->` comments because
the page is inert HTML. It does not need `hydrateRoot()`.

## Add an island

An island is a normal `IslandFactory` that runs once during static rendering and again in the
browser. Keep props JSON-serializable so both sides receive exactly the same input.

```ts
// File: src/islands/counter.ts
import { html, signal } from '@ketvietlab/ketjs-view'
import type { IslandFactory } from '@ketvietlab/ketjs-view'

const counter: IslandFactory<{ initial: number }> = (props) => {
  const count = signal(props.initial)
  return () => html`
    <button type="button" on:click=${() => count.set((value) => value + 1)}>
      Count: ${count()}
    </button>
  `
}

export default counter
```

Register the browser entry once:

```ts
// File: ket-view.config.ts
import { defineConfig } from '@ketvietlab/ketjs-view-tools'

export default defineConfig({
  styles: ['src/styles/main.css'],
  islands: {
    counter: 'src/islands/counter.ts',
  },
  base: './',
})
```

Then place it in any page:

```ts
// File: src/pages/index.ts
import { html } from '@ketvietlab/ketjs-view'
import { definePage, island } from '@ketvietlab/ketjs-view-tools'
import counter from '../islands/counter.ts'

export default definePage({
  head: { title: 'Home' },
  view: () => html`<main>${island('counter', counter, { initial: 0 })}</main>`,
})
```

`island()` emits the standard `<div data-ket-island data-island="counter">` host. The builder adds
the hydration bundle only to pages that actually contain an island. A misspelled or unregistered
island name fails `check` and `build` instead of producing inert controls.

## Configure delivery

`defineConfig()` accepts `pages`, `publicDir`, `outDir`, `styles`, `islands`, `base`, `host`, and
`port`. Paths are relative to the project root. Files in `public` are copied unchanged; imported CSS
and its referenced assets are bundled and fingerprinted.

Use the relative base for portable directories. For a site that is always deployed at a fixed URL
prefix, use an absolute path ending in a slash:

```ts
// File: ket-view.config.ts
import { defineConfig } from '@ketvietlab/ketjs-view-tools'

export default defineConfig({
  base: '/company-site/',
  styles: ['src/styles/main.css'],
})
```

The output contract is intentionally conventional: upload the contents of `dist` to any static file
server. No Ket runtime server is required.
