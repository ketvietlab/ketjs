# KetJS View

The browser-safe view layer used by KetJS: signals, surgical DOM updates, SSR, hydration, JSX
runtime support, and persistent islands. It has no runtime dependencies.

> KetJS View 0.x is preview software. APIs may change before 1.0.

```bash
npm install @ketvietlab/ketjs-view
```

```ts
import { html, signal, createIslandManager } from '@ketvietlab/ketjs-view'
```

JSX projects can use `@ketvietlab/ketjs-view/jsx-runtime` through TypeScript's automatic JSX runtime.

Documentation and source: [github.com/ketvietlab/ketjs](https://github.com/ketvietlab/ketjs)
