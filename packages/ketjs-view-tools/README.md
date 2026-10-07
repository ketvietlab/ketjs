# @ketvietlab/ketjs-view-tools

Static-site tooling for `@ketvietlab/ketjs-view`. It renders marker-free page HTML, bundles CSS and
JavaScript, and preserves hydration markers only inside explicit islands. Its dependencies are
ketjs-view and esbuild; it does not install the server framework, database adapters or service SDKs.

Use `npm create @ketvietlab/view@latest my-site` to start a project, then run `npm run dev`.

## Pages and content collections

A page module exports `definePage({ head, view })`. For Markdown or other build-time data, export a
nonempty `definePages()` collection. Every collection entry requires an explicit, unique, safe path;
filename routing still works for single pages. Async content can be loaded before exporting it.

```tsx
// File: my-site/src/pages/guides.tsx
import { definePages } from '@ketvietlab/ketjs-view-tools'

const guides = [{ path: '/docs/start/', title: 'Start', summary: 'Build your first site.' }]
export default definePages(guides.map(guide => ({
  path: guide.path,
  head: { title: guide.title },
  view: () => <main><h1>{guide.title}</h1><p>{guide.summary}</p></main>,
})))
```

Configure TypeScript with `jsx: "react-jsx"` and `jsxImportSource: "@ketvietlab/ketjs-view"`.
The standard `ket-view check`, `ket-view build`, `ket-view dev` and `ket-view preview` commands
handle these collections; consumers do not need their own HTML generation loop.

## Document metadata

`head` accepts `title`, `description`, `lang`, `links`, `meta` and `structuredData`.
Each meta entry uses either `name` (ordinary metadata) or `property` (Open Graph).
JSON-LD objects are serialized into the document head with HTML-sensitive characters escaped;
their contents cannot close the script element. Supply honest, page-specific schema data.

Use `head.scripts: [{ src: '/theme-init.js' }]` for an external classic script that must run
before styles and the first body paint, such as applying a saved theme preference.
Optional `type: 'module'` and `defer: true` retain normal browser scheduling; neither is implicit.
Head scripts are separate from the automatically bundled island entry.

```tsx
// File: my-site/src/pages/index.tsx
import { definePage } from '@ketvietlab/ketjs-view-tools'

export default definePage({
  head: {
    title: 'My site',
    description: 'Guides for my project.',
    links: [{ rel: 'canonical', href: 'https://example.com/' }],
    meta: [{ property: 'og:title', content: 'My site' }],
    structuredData: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'My site', url: 'https://example.com/' }],
  },
  view: () => <main><h1>My site</h1></main>,
})
```

## Islands and assets

Register island modules in `defineConfig({ islands: { counter: 'src/islands/counter.tsx' } })` and
place them with `island(name, factory, props, options)`. Props must be JSON serializable. Choose
identity with `options.key`, a list of prop names; use `key: []` for a singleton identified by its
island name. Omitting it retains the default full-props identity for compatibility.

Styles listed in the config are bundled, including referenced font and image assets. Supported
file loaders cover WOFF/WOFF2, TTF/OTF, SVG, PNG, JPEG and WebP. `public/` files are copied unchanged.
Escaped code samples that mention an island host do not require an island registry entry; live
hosts do.

## Build this package independently

```bash
# Run from: repository root
npm run build --workspace @ketvietlab/ketjs-view
npm run build --workspace @ketvietlab/ketjs-view-tools
node --test packages/ketjs-view-tools/test/page-collections.test.mjs
```

These package builds compile only the standalone view dependency chain. They do not run the core
framework build or the repository-wide test suite.
