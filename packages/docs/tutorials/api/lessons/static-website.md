---
title: "Publish a small static website"
description: "Build a multi-page website with metadata, native links, assets and explicit islands."
stage: "Build the frontend"
duration: 35
lab: "Terminal + browser"
order: 10
---

Before you start: complete [Fetch data without render side effects](/learn/data-fetching/), or make sure you can pass its checkpoint.

## Give the website a purpose

Turn the learning journal into a four-page website: a homepage explaining the project, an About page, the Todo lab, and the data-loading lab. Use one H1 per page, a meaningful title and description, and a navigation link back home.

The completed View project uses this configuration:

```ts
// File: learn-view/ket-view.config.ts
import { defineConfig } from '@ketvietlab/ketjs-view-tools'

export default defineConfig({
  pages: 'src/pages',
  styles: ['src/styles/main.css'],
  islands: {
    'task-search': 'src/islands/task-search.tsx',
    counter: 'src/islands/counter.tsx',
    todo: 'src/islands/todo.tsx',
    validation: 'src/islands/validation.tsx',
  },
  base: '/',
})
```

## Understand what generation produces

Pages render during `ket-view build`. The result includes HTML, styles, browser entries and assets. A static host serves those files; it does not run the KetJS server for every request. Islands add behavior after the initial HTML loads.

Keep code that reads Markdown or filesystem data in build-time page modules. Only serializable props and browser code should cross into an island. Never send the entire content collection as an island identity key.

## Build for the hosting path

This project uses `base: '/'` because it lives at the root of a domain. If you deploy under a subdirectory, configure and test that base deliberately. Check nested pages by opening their URLs directly; navigation from the homepage alone does not catch every asset-path mistake.

```bash
# Run from: learn-view
npm run check
npm run build
npm run preview
```

## Deploy the generated directory

For Cloudflare static hosting, the artifact is `dist`. Run the build in an environment with Node 24+, then configure the host to serve that directory. The browser playground also works as static assets: compiling an example happens on the visitor's computer.

Test the generated homepage, `/about/`, `/todo/`, and `/data/` directly. Inspect title/description, keyboard navigation, mobile overflow and a JavaScript-disabled view. The todo controls require JavaScript; the article and navigation should remain meaningful without it.

## Decide where the backend belongs

Adding a static website does not select a backend hosting architecture. The backend labs later in this course run locally with Node and SQLite. You can keep the website static while selecting an appropriate server environment for the API.

## Checkpoint

All four generated routes open directly, static content is present in View Source, and the todo island works after loading.

## Practice on your own

Add a project screenshot as WebP with descriptive alt text and explicit dimensions. Rebuild and verify the image exists in the output.

## Reference

For the complete API contract, read [View Static Sites](/docs/view-static-sites/).
