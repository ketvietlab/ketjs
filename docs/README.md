# Ket Developer Docs

A standalone documentation application built with [Astro](https://astro.build/) and
[Starlight](https://starlight.astro.build/).

## Run locally

```bash
# Run from: /path/to/ketjs
cd docs
npm install
npm run dev
```

## Validate and build

```bash
# Run from: /path/to/ketjs/docs
npm run check
npm run build
```

The docs application owns every dependency and its lockfile within this directory. The root npm
workspace includes only `packages/*`; do not add `docs` to the root `workspaces` list or add Astro
dependencies to the root manifest.

All published product documentation must be written in English. Vietnamese team handoffs may remain
in their original language and must set `pagefind: false`. Legacy product notes that have not yet been
translated must set `draft: true` so they are available to authors without entering production builds.

Documentation pages must live under `src/content/docs/`. Do not create or extend Markdown pages at
the root of this directory. `README.md` is the only Markdown file reserved at the app root because it
documents the docs application itself.

Static files required by documentation pages live under `public/`. Generated browser screenshots and
PR evidence must not be committed; the docs `.gitignore` excludes those image outputs.
