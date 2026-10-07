---
title: Static site with islands
description: Build plain HTML, CSS, and JavaScript with optional interactive islands and no application server.
order: 2
---
## Scaffold the site

```bash
# Run from: /path/to/projects
npm create @ketvietlab/view@latest my-site
cd my-site
npm install
npm run dev
```

## Build the output

```bash
# Run from: /path/to/projects/my-site
npm run build
```

Deploy the generated `dist/` directory on a static host. Ordinary page content stays marker-free; explicit islands receive their client runtime.

Read [static sites](/docs/view-static-sites/) for pages, assets, islands, development, and preview.
