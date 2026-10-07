# KetJS website and documentation

The private site for **https://ketjs.dev**, built with native ketjs-view TSX, Markdown content and
`ket-view build`. Its deployment artifact is `dist/`; it requires no application server or database.
Home, Docs, Learn, Examples and Blog use the public Két Design System from npm.

## Local development

Build the two local producer packages once after a fresh checkout or a framework change:

```bash
# Run from: repository root
npm ci --ignore-scripts
npm run build --workspace @ketvietlab/ketjs-view
npm run build --workspace @ketvietlab/ketjs-view-tools
cd packages/docs
npm ci --ignore-scripts
npm rebuild @ketvietlab/ketjs-view-tools --ignore-scripts
npm run dev
```

The site has its own lockfile and dependencies. It uses local file dependencies for the two view
packages while their new contracts are developed here. Neither package imports the server framework
or PostgreSQL. There is no consumer preparation script or separate HTML generator.

```bash
# Run from: packages/docs
npm run check
npm test
npm run build
node site/seo-audit.mjs
npm run preview
```

Preview: **http://127.0.0.1:3700/**. Publish the contents of `dist/` on a static host serving directory
indexes and `404/index.html` for missing routes. Production hosting and DNS are managed separately.

## Content and rendering

- `content/home.md` supplies homepage copy and feature data. Other Markdown collections supply
  docs, learning content, runnable examples and project posts. Docs use explicit frontmatter group/order in a Laravel-inspired reading hierarchy; the overview links task-specific paths. Each file requires title and description
  frontmatter; filename determines its slug. Docs also use group/order for navigation.
- `pages/index.tsx` returns `definePages()` using those collections. ketjs-view-tools renders each
  route with its initial HTML, canonical URL and metadata.
- `site/content.mjs` parses frontmatter, sanitizes Markdown HTML, highlights code and generates
  stable heading anchors. `trustedMarkup()` receives only this sanitized output.
- `site/assets.mjs`, called from the page collection, prepares content JSON, a lazy-loaded search index, sitemap, robots and the Inter
  license. It does not render page HTML. Build-time and browser rendering share `site/docs-view.tsx`.
- The documentation island hydrates the initial page. Later doc links load content JSON and update
  its signal, rendering TSX in the existing document. Header, sidebar and footer persist; URL, title,
  description, canonical URL, active link, focus and scroll update. Back/Forward, hash links, modified
  clicks and ordinary links without JavaScript remain supported. Failed JSON loads use native navigation.
- Both singleton islands use `key: []`. Their identities are their island names; content belongs in
  props, never in `data-key`. Search data is fetched when search first opens.

## Design ownership

Public DS components own controls, labels, typography and card mechanics. The editorial recipe owns
the hero, prose, sticky documentation columns and diagrams; these use public Két tokens. Header background and
horizontal section hairlines span the viewport; header content and reading regions stay centered. Page/card gaps
use `--kv-layout-gap` once (12px desktop, 8px mobile). Inter is self-hosted, icons are Lucide via the
public DS and the original geometric K logo uses the accent token. SVG assets use its pinned light color. The site lifts primary within the public Két palette:
light blends primary/primary-active; dark uses primary-hover with a contrasting on-accent token.
The brand has fixed grid columns and a neutral Preview badge. A stable scrollbar gutter prevents
short/long-page shifts, and an external classic head script applies saved theme before first paint.
Mobile search, theme and navigation use accessible icon controls.

## Verification scope

This deployment is the KetJS documentation site. Check its content tests, types, native static build,
local links/anchors, canonical URLs, singleton keys and JSON payloads. Producer checks are limited to
`packages/ketjs-view-tools/test/page-collections.test.mjs` and the two package builds. Browser review
covers desktop/mobile, light/dark, island navigation, search and theme controls. These checks do not
replace the repository's broad develop gate.

Mermaid uses the self-hosted official Tiny 12.1.0 engine, loaded on demand. All diagram colors resolve
from the current DS tokens; it redraws after article navigation and theme changes. Source remains
available without JavaScript or after a rendering failure. The engine contract follows the
[official theme API](https://mermaid.js.org/config/theming); Tiny supports the flowchart, sequence and
state diagrams used here, but excludes mindmap, architecture diagrams, KaTeX and ELK.

Documentation organization follows the responsibility groups in [Laravel's documentation](https://laravel.com/framework/docs),
adapted to KetJS composition and ownership. Benchmarks link fresh raw samples under `measurements/`;
see their guide for workload scope, limits and reproduction commands. The benchmark guide reads
its comparative reports from frontmatter `benchmarkSources`, embeds native DS `BarChart` HTML in
the shared TSX doc view, and puts database charts before HTTP/SSR charts. Values are real text and
remain available without JavaScript. No browser charting library is loaded.
The pinned DS 0.1.40 BarChart has no mark-thickness option. A scoped compatibility adapter
uses its exported `bar-chart-track` hook to make benchmark marks 4px (`--kv-space-1`);
the DS still owns labels, values, row layout and responsive behavior. This adapter should
be replaced by a public thickness contract when the DS exposes one.

## Diagram viewer

Successful diagrams get an **Open diagram** button. A native modal dialog owns focus and Escape;
the public DS `ModalSheet` owns presentation. Buttons zoom, fit and reset; wheel and pointer
interactions support zoom, drag and two-pointer pinch. Keyboard `+`/`-`, arrows, `0` and `1` provide
zoom, pan, fit and reset. Closing restores opener focus; doc navigation closes the viewer, and theme
redraw updates an open diagram. The SVG clone gets unique IDs. Rendering remains pure; the controls
island's disposable runtime owns listeners and observers.

The Mermaid recipe is flat, with neutral fills, one accent, rounded rectangles/notes, no filters or
shadows, and Inter labels. Its public `themeVariables`, `themeCSS` and geometry config apply to both
inline and modal SVGs. CSS color-mix tokens are converted via the browser's color parser/canvas,
so light/dark token values become opaque hex colors understood by Mermaid.

## On-page SEO

`site/seo.ts` is the single page-head model for SSG and island navigation: unique metadata,
self-canonical production URLs, correct Open Graph properties, Twitter cards and page-specific
JSON-LD with breadcrumbs. Search and 404 are noindex and excluded from the sitemap. The page owns
H1; Markdown headings are normalized without skipped levels. `site/seo-audit.mjs` checks all emitted
routes and can write a JSON audit snapshot. See [the audit](SEO-AUDIT.md) for findings and limits.

`public/social.png` is generated from vector artwork using Inter, with no external image service:

```bash
# Run from: packages/docs
node site/social-image.mjs
```

The included Inter variable TTF is used only by this build-time rasterizer; the browser font stays
WOFF2. Its license is retained with the self-hosted assets. Source-only View Tools metadata/collection
contracts and the TSX starter update remain pending a package release, as labelled in release notes.
