# KetSuite Docs

A standalone documentation application built with [Astro](https://astro.build/) and
[Starlight](https://starlight.astro.build/).

## Run locally

```bash
cd docs
npm install
npm run dev
```

## Validate and build

```bash
npm run check
npm run build
```

The docs application owns every dependency and its lockfile within this directory. The root npm
workspace includes only `packages/*`; do not add `docs` to the root `workspaces` list or add Astro
dependencies to the root manifest.

All published documentation must be written in English. The current content collection documents
the KetJS framework. KetSuite application documentation is intentionally deferred until the
application suite is complete; legacy Markdown remains available as historical design material.

Documentation pages must live under `src/content/docs/`. Do not create or extend Markdown pages at
the root of this directory. `README.md` documents the standalone docs application itself; the other
root-level Markdown files are legacy inputs that should be translated and migrated into the content
collection before they are updated.
