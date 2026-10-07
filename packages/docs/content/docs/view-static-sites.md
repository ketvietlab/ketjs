---
title: Static sites with ketjs-view
description: Scaffold, develop, and deliver plain HTML, CSS, and JavaScript with explicit interactive islands.
group: Views and frontend
order: 3
---

The ketjs-view static toolkit is for projects whose deliverable is a directory of HTML, CSS, and
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
    counter.tsx
  pages/
    about.tsx
    index.tsx
  styles/
    main.css
```

Files under `src/pages` become routes. `index.tsx` becomes `/`, `about.tsx` becomes `/about/`, and
`docs/index.tsx` becomes `/docs/`. Every route is written as an `index.html`, so it works on ordinary
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

```tsx
// File: src/pages/contact.tsx
import { definePage } from '@ketvietlab/ketjs-view-tools'

export default definePage({
  head: { title: 'Contact', description: 'How to contact the team.', lang: 'en' },
  view: () => <main><h1>Contact</h1><p>Email {'hello@example.com'}</p></main>,
})
```

The interpolation is escaped as usual, but the final paragraph has no `<!--k-->` comments because
the page is inert HTML. It does not need `hydrateRoot()`.

## Add an island

An island is a normal `IslandFactory` that runs once during static rendering and again in the
browser. Keep props JSON-serializable so both sides receive exactly the same input.

```tsx
// File: src/islands/counter.tsx
import { signal, type IslandFactory } from '@ketvietlab/ketjs-view'

const counter: IslandFactory<{ initial: number }> = props => {
  const count = signal(props.initial)
  return () => <button type="button" onClick={() => count.set(value => value + 1)}>Count: {count()}</button>
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
    counter: 'src/islands/counter.tsx',
  },
  base: './',
})
```

Then place it in any page:

```tsx
// File: src/pages/index.tsx
import { definePage, island } from '@ketvietlab/ketjs-view-tools'
import counter from '../islands/counter.tsx'

export default definePage({
  head: { title: 'Home' },
  view: () => <main>{island('counter', counter, { initial: 0 }, { key: [] })}</main>,
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

## Build a content collection

This collection API is available in the current source checkout and is not part of the published
0.1.41 View Tools package yet. Published projects can use one `definePage()` module per route until
the next tooling release.

Use `definePages()` when one Markdown collection supplies many routes. Each page needs an explicit,
unique path. Load and sanitize Markdown during the build, then return pure TSX views. The standard
static builder handles the collection; no separate HTML generation script is needed.

```tsx
// File: src/pages/guides.tsx
import { trustedMarkup } from '@ketvietlab/ketjs-view'
import { definePages } from '@ketvietlab/ketjs-view-tools'
import { loadSanitizedGuides } from '../content.ts'

const guides = await loadSanitizedGuides()
export default definePages(guides.map(guide => ({
  path: `/docs/${guide.slug}/`,
  head: { title: guide.title },
  view: () => <main><h1>{guide.title}</h1>{trustedMarkup(guide.html)}</main>,
})))
```

`loadSanitizedGuides()` is the application's content adapter, not a framework export. Never pass
untrusted Markdown HTML directly to `trustedMarkup()`.

## Hydrate once, navigate within an island

For documentation navigation, render the initial article in a registered island. Its pure TSX view
reads an article signal; the browser-only `mount()` lifecycle intercepts eligible internal links,
loads content JSON and updates that signal. Keep persistent shell elements outside the changing
article. Update history, metadata, focus and scroll in the runtime, and remove listeners with its
lifetime signal. Preserve native navigation for modified clicks, failures and visitors without JS.

A singleton island can use `key: []`; its name is its stable identity. Use selected identity props
for repeated instances. Avoid making content or navigation indexes part of identity.

Configure `jsx: "react-jsx"` and `jsxImportSource: "@ketvietlab/ketjs-view"` in TypeScript. Standalone
SSG and client rendering need only View and the static tooling; they do not install the core server,
PostgreSQL or job runtimes. CSS font and image imports are bundled as fingerprinted assets.

## Metadata and saved theme

The current source checkout also supports Open Graph `property` metadata, `structuredData` JSON-LD
objects and external `head.scripts`. These additions are pending the next tooling release, rather
than published 0.1.41 features. Keep the same head model when navigating with a browser island so
titles, descriptions, canonical URLs and structured data follow the loaded page.

For a saved theme preference, use a small external classic script before CSS/body paint. Applying
it only when an island mounts can briefly show the system theme on each new document. Keep browser
effects in that script/runtime; server views remain pure.

```tsx
// File: my-site/src/pages/index.tsx
import { definePage } from '@ketvietlab/ketjs-view-tools'

export default definePage({
  head: {
    title: 'My preview site',
    description: 'Guides for my project.',
    scripts: [{ src: '/theme-init.js' }],
    meta: [{ property: 'og:title', content: 'My preview site' }],
    structuredData: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'My preview site', url: 'https://example.com/' }],
  },
  view: () => <main><h1>My preview site</h1></main>,
})
```
