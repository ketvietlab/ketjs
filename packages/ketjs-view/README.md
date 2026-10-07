# ketjs-view

The browser-safe view layer used by KetJS: signals, surgical DOM updates, SSR, hydration, JSX
runtime support, and persistent islands. It has no runtime dependencies.

> ketjs-view 0.x is preview software. APIs may change before 1.0.

```bash
# Run from: your-project
npm install @ketvietlab/ketjs-view
```

```ts
// File: your-project/src/view.ts
import { signal, createIslandManager } from '@ketvietlab/ketjs-view'
```

JSX projects can use `@ketvietlab/ketjs-view/jsx-runtime` through TypeScript's automatic JSX runtime.

Documentation and source: [github.com/ketvietlab/ketjs](https://github.com/ketvietlab/ketjs)

For static sites, add `@ketvietlab/ketjs-view-tools`; its native builder supports TSX pages,
content collections and explicit islands without the server framework. For client rendering,
use `domHost()`, `mount()` and signals directly. Browser state, fetches and history belong in
client runtimes or island `mount()` lifecycles, while the shared view remains pure.

```bash
# Run from: repository root
npm run build --workspace @ketvietlab/ketjs-view
```

This build compiles the view package independently, without the application server or adapters.
