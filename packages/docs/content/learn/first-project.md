---
title: "Create your first View project"
description: "Scaffold a standalone ketjs-view project, inspect its files, and run a production build."
stage: "Build the frontend"
duration: 20
lab: "Terminal + browser"
order: 2
---

Before you start: complete [Choose your route through KetJS](/learn/orientation/), or make sure you can pass its checkpoint.

## Create the project

Use a new directory. The generator creates the package scripts and TSX configuration, so you do not need to configure a compiler by hand.

```bash
# Run from: your-projects
npx -y @ketvietlab/create-view@0.2.0 learn-view
cd learn-view
npm install
npm run dev
```

Open the URL printed by `ket-view`. The starter includes a static page and a counter island. Leave this terminal running while editing. If the port is occupied, stop the other process or pass a different port; do not assume the URL belongs to this project.

## Find the owners

| File | What to change here |
| --- | --- |
| `src/pages/index.tsx` | The homepage and its document metadata |
| `src/islands/counter.tsx` | State and interaction for one counter instance |
| `src/styles/main.css` | The website's stylesheet |
| `ket-view.config.ts` | Page roots, CSS inputs and named browser island entries |
| `tsconfig.json` | TypeScript and ketjs-view JSX compilation |

Open `package.json`: the standalone project depends on View and View Tools. It does not need `@ketvietlab/ketjs` or a database. Keep that boundary when adding frontend dependencies.

## Make the first change

Change the homepage heading to “My KetJS learning journal.” Save and verify that the browser updates. Then change `head.title`; inspect the browser tab separately. Visible headings and document titles have different owners.

## Check and build

Stop the development server with Ctrl+C. Run:

```bash
# Run from: learn-view
npm run check
npm run build
npm run preview
```

`check` validates TypeScript and the page configuration. `build` generates the site into `dist`. `preview` serves that generated output. Open View Source: the heading should already exist in HTML before the browser executes the island code.

## Troubleshoot setup

If JSX types are missing, compare `jsxImportSource` with `@ketvietlab/ketjs-view` in the generated tsconfig. If an import is unresolved, run `npm install` in this directory. Do not “fix” a browser example by importing the server framework. If the page is blank, read the terminal error before repeatedly refreshing.

## Checkpoint

Produce a successful static build and find your custom heading inside `dist/index.html`.

## Practice on your own

Add a second static paragraph and verify it appears with JavaScript disabled. Keep the counter interactive when JavaScript is enabled.

## Reference

For the complete API contract, read [View Static Sites](/docs/view-static-sites/).
