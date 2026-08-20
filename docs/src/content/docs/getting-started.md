---
title: Develop the docs
description: Install, run, and validate KetSuite Docs independently from the main monorepo.
sidebar:
  order: 1
---

## Requirements

- Node.js 24 or later.
- The npm version bundled with Node.js.

## Run locally

From the repository root:

```bash
cd docs
npm install
npm run dev
```

Alternatively, keep your current working directory:

```bash
npm --prefix docs install
npm --prefix docs run dev
```

Astro prints the local URL and reloads when the content or theme changes.

## Validate a change

```bash
npm --prefix docs run check
npm --prefix docs run build
```

`docs/package-lock.json` is this application's only lockfile. Do not add Astro, Starlight, or docs
plugins to the root `package.json` or `package-lock.json`.

## Write in English

All published content, frontmatter, navigation labels, image descriptions, and diagrams must be in
English. Translate legacy documents before moving them into the Starlight content collection.

## Add a page

Create a Markdown or MDX file under `src/content/docs/`. Every page needs at least a `title` and a
`description` in its frontmatter:

```md
---
title: Page title
description: One sentence explaining the problem this page solves.
---
```

Navigation is declared explicitly in `astro.config.mjs`. Extend the taxonomy as legacy documents
are translated and migrated.

## Add a Mermaid diagram

Use a fenced `mermaid` block. Diagrams are rendered only on pages that contain one and automatically
follow the current light or dark theme.

````md
```mermaid
flowchart LR
  declaration["Module declaration"] --> manifest["Composed manifest"]
  manifest --> runtime["Live runtime"]
```
````

Keep diagrams focused on one relationship, use English labels, and prefer simple flows that remain
readable in the dense content column. Do not encode essential information only by color; explain the
contract in the surrounding text as well.
