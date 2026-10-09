# KetJS website and documentation

The private site for **https://ketjs.dev**, built with native ketjs-view TSX, Markdown content and
`ket-view build`. Its deployment artifact is `dist/`; it requires no application server or database.
Home, Docs, Spec, Learn, Examples and Blog use the public Két Design System from npm.

## Local development

The site has its own lockfile and consumes the published KetJS version materialized from the root `VERSION` and Két Design System 0.1.41.

## Version source and release audit

Root `VERSION` is the authoritative framework version. `npm run version:sync` from the repository root
materializes this site's and both labs' package versions, exact dependencies, lockfiles and
`site/version.generated.ts`. `site/release.ts` exports that browser-safe constant; `test/release.test.mjs`
checks it against the actual independently installed npm runtime and every lab pin.

Use `{{VERSION}}` for the current version in Markdown, including metadata and shell examples. The content
compiler expands it before Markdown parsing and `site/learning-assets.mjs` expands the offline lessons.
Keep historical releases and API introduction/minimum versions literal. Lab README files refer to their
included package manifests, so downloaded projects remain standalone.

Version changes require a committed `Version-Reason`, then `npm run version:record` and a separate
`CHANGE_LOG` evidence commit. The dedicated CI gate checks source hashes and executes docs tests, type and
view checks, static build/link verification, both lab checkpoints and the actual download ZIPs. Before
publishing, consumers install candidate npm tarballs in temporary projects; the committed manifests/locks
continue to describe public npm packages. After publishing, the release workflow repeats the checks with
`npm ci` from the public registry. No workspace runtime substitutes for an independently installed consumer.
It can install and build independently of the framework source checkout:

```bash
# Run from: packages/docs
npm ci --ignore-scripts
npm run dev
```

Neither view package imports the server framework or PostgreSQL. There is no consumer preparation
script or separate HTML generator. `site/release.ts` derives the displayed framework version from
the site's exact runtime dependency, so an integration branch's source version cannot change it.

```bash
# Run from: packages/docs
npm run check
node --test test/content.test.mjs test/release.test.mjs test/search.test.mjs
npm run build
node site/seo-audit.mjs
npm run preview
```

Preview: **http://127.0.0.1:3700/**. Publish the contents of `dist/` on a static host serving directory
indexes and `404/index.html` for missing routes.

## Cloudflare Pages

Production at **ketjs.dev** deploys automatically when changes reach `master`. A documentation update
does not require a framework version bump, npm publication or GitHub release. Keep normal PR checks
and branch promotion gates before merging to `master`.

For an independent Pages build, use root directory `packages/docs`, build command
`npm ci --ignore-scripts && npm run build`, and output directory `dist`. The build needs Node.js 24
or newer (set `NODE_VERSION` in Pages when the image's default is older). All dependencies are public;
the site build needs no `NPM_TOKEN`. The existing project's settings are managed in Cloudflare.
See [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

## Content and rendering

- `content/home.md` supplies homepage copy and feature data. Other Markdown collections supply
  docs, the `/spec/` introduction, learning content, runnable examples and project posts. Docs use explicit frontmatter group/order
  following KetJS responsibilities; the overview explains each group and links task-specific paths.
  Each file requires title and description frontmatter; filename determines its slug.
- Form documentation has three entry points: [Form validation](content/docs/form-validation.md)
  covers shared schemas and issues; [Forms and edit sessions](content/docs/view-forms.md) belongs to
  ketjs-view and covers browser state, native binding and render subscriptions;
  [Transactional form actions](content/docs/form-actions.md) covers server commits and receipts.
  Former section anchors in the validation guide link to their new locations.
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
The brand renders its mark, Inter wordmark and neutral Preview badge as SVG paths, with accessible
text on the homepage link. The lettering uses no SVG text or browser font. It reserves an explicit
inline width and flex basis before fonts load. Its width follows the compact mark size below 359px, so font swapping cannot
resize the brand or move the navigation beside it. Desktop menu labels and action slots also reserve
font-independent widths; search and theme use the public DS `fullWidth` prop inside those slots.
This keeps the header geometry stable when top-level navigation loads a new document and swaps fonts.
A stable scrollbar gutter prevents
short/long-page shifts, and an external classic head script applies saved theme before first paint.
Mobile search, theme and navigation use accessible icon controls.

The main navigation contains Docs, Spec, Learn, Playground and Blog. Spec is a native standalone
editorial route with installation, scaffold, static hosting and server-rendering examples; the
content loader also includes it in search and the sitemap. The menu uses the same reserved label
slots, active-route semantics and mobile navigation as the other sections. Search ranks exact and
prefix title matches before prose matches, keeping Spec discoverable within the eight-result limit.
Blog has its own editorial recipe:
a 72rem canvas, an explicitly selected featured article, then the remaining articles by publication
date (newest first). Native story rows own their editorial heading, summary and metadata; related
articles use public DS ContentCard slots. Public Text, Badge, Breadcrumbs and LinkButton components
retain their internals. No card internals or global type roles are overridden.

Article reading uses a 42rem maximum measure and a named editorial 16px/28px prose role, plus a
14rem sticky section navigation at widths >=1024px. Below that width, a native details/summary
provides the same anchors. Metadata uses UTC-formatted publication dates and reading time calculated
from complete plain text at 230 words/minute. Missing dates are omitted, missing category/author
use Engineering/KetJS team, and an empty journal offers a Learn recovery link. Titles wrap fully.
The content is public, read-only English SSG with eight articles; translated/RTL routes are not
provided. Permission, mutation, disabled,
filtered-empty, pagination, realtime and 10,000-item states do not apply. No loading spinner or
client fetch is required; the reading links and TOC work without JavaScript. Existing offline
documents remain readable, while opening an uncached page depends on normal browser networking;
this change does not introduce an offline cache or service worker. Each article links to maintained
Docs or Learn contracts and identifies the Preview boundary.
The shared header moves its main navigation into the native menu at 768–900px so fixed logo/action
slots keep their insets; controls switch to mobile icons below 768px as before.
The logo reserves its inline width without a fixed flex basis, so reusing it in the footer's
column does not create a square 176px link target. The named editorial prose role stays at
16px/28px at every width; public Text components keep their DS type roles.
The reading column explicitly fills its grid track; code blocks and diagrams scroll inside their
own viewports rather than expanding the article on small screens.
Small accent text and syntax accents use the darker DS accent-hover tone in light mode,
retaining the current accent in dark mode, so text clears AA contrast on the editorial canvas.
Code comments use the secondary text tone for the same contrast requirement.

## Verification scope

This deployment is the KetJS documentation site. Check its content tests, types, native static build,
local links/anchors, canonical URLs, singleton keys and JSON payloads. The build verifies its installed
runtime/tool versions against the site's pins and checks Spec's desktop/mobile menu links and active state.
No local framework producer build is needed when consuming the released npm packages. Browser review
covers desktop/mobile, light/dark, island navigation, search and theme controls. These checks do not
replace the repository's broad develop gate.

Mermaid uses the self-hosted official Tiny 12.1.0 engine, loaded on demand. All diagram colors resolve
from the current DS tokens; it redraws after article navigation and theme changes. Source remains
available without JavaScript or after a rendering failure. The engine contract follows the
[official theme API](https://mermaid.js.org/config/theming); Tiny supports the flowchart, sequence and
state diagrams used here, but excludes mindmap, architecture diagrams, KaTeX and ELK.

Documentation navigation follows KetJS's own composition and execution boundaries. Its ordered groups
are Set up KetJS, Application composition, Request execution, Data contracts, Identity and access,
ketjs-view and KTL, Runtime services, Verify and deploy, API and tooling, and Project evolution.
Start with a runnable project, then understand the modules and deployment manifest before following
requests, data and identity into rendering. Runtime services follow those application contracts;
testing and benchmarks precede deployment. API lookup and project maintenance stay at the end.
Within composition, modules precede workspaces and deployments, followed by filesystem discovery.
Sessions and tenants precede authorization; static ketjs-view sites precede server theme templates.
The same frontmatter ordering supplies desktop/mobile navigation and previous/next links. The Docs
overview names these exact groups and offers shorter reading paths for specific tasks. Existing
article slugs and inbound URLs stay stable when a guide changes group.

Docs prose uses an editorial hierarchy from the public Két type scale, a 72ch reading
measure for paragraphs, and underlined accent links. The site's native-link reset has deliberately
low specificity so prose and navigation retain their own link treatments. The overview presents
responsibility groups as named sections with ordered guide lists, in two columns on desktop and one
on mobile. Subtle separators distinguish groups without introducing another primary action.
The website accent keeps the public Két primary hue, with slightly higher saturation and brighter
dark-theme variants. Primary controls and prose links must retain AA contrast in both themes.

Benchmarks retain measured summaries in Markdown;
generated raw runs and reports are neither committed nor published. The Node harnesses write to
the ignored repository-root `.artifacts/benchmarks/` directory; browser samples can be saved there
manually. After a new run, review the measured values before updating the Markdown summaries.
See the guide for workload scope, limits and reproduction commands. Its chart data comes directly
from frontmatter `benchmarkReports`, which embeds native DS `BarChart` HTML in
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

## Learning path and browser playground

`/learn/` has its own roadmap and sequential lesson layout, with browser-local completion,
previous/next navigation and the same static HTML fallback as Docs. Lesson frontmatter owns
`stage`, `order`, `duration` and `lab`; content JSON drives island navigation.

`/playground/` runs editable TSX through a self-hosted esbuild WASM compiler. CodeMirror owns
the specialized code-editing surface (gutter, selection, scrolling, syntax and undo history);
public DS Surface and controls own its surroundings. JetBrains Mono is self-hosted for code,
while interface text stays Inter. Markdown Shiki and editor highlighting share semantic DS
syntax tokens. Tab leaves the editor; Cmd/Ctrl+Enter runs code. Example drafts survive switching
within the mounted playground, and undo can restore a reset. Drafts do not survive a reload.

User code runs in an opaque-origin sandboxed iframe with no network access and only the bundled
ketjs-view imports. Dynamic execution is permitted inside that iframe, never in the host page.
This is a learning playground, not a resource-isolated server sandbox: an infinite loop can still
freeze its browser context. Node, database and worker exercises run locally.

`site/learning-assets.mjs` packages explicit source roots into two ZIP downloads, excluding
node_modules, build output and local databases. Both projects pin the coordinated KetJS version from `VERSION` rather
than workspace aliases. The View project includes counter, todo and cancellable data-loading
examples. The API project includes a local learning CLI and three executable checkpoints:
HTTP/validation, company isolation and durable jobs. Advanced lessons are guided extensions;
they are not represented as preimplemented production modules.

The API download includes copies of the learning Markdown and `course.json` for offline use.
`site/learning-assets.mjs` regenerates those copies from `content/learn` during each docs build; edit the source collection, not the copies. Font licenses
and compiler assets are copied during the static build. Screenshots embedded in lessons are WebP.

Focused checks for this work:

```bash
# Run from: packages/docs
node --test test/playground.test.mjs test/learning-data.test.mjs test/content.test.mjs test/navigation.test.mjs
npx tsc --noEmit
npm run build
node site/seo-audit.mjs
```

Run each downloadable project's README commands in that project. Local verification covers the
Docs deployment and these learning projects only, not the framework-wide test gate or deployment.
