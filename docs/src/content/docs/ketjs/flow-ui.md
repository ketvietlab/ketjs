---
title: Flow UI components
description: Compact work-management components for Ket view, styled only with design-system tokens.
---

`@ketvietlab/flow-ui` provides the presentation layer for task and project tools: an application
shell, lists, boards, task dialogs, document workspaces, pickers and overview charts. Components
are plain Ket view functions authored in JavaScript with JSDoc types, so the same call renders on
the server and in the browser.

The package owns markup and styling only. Data, persistence, routing, permissions and API calls
stay in your application.

## Install and render

```bash
# Run from: your application root
npm install @ketvietlab/flow-ui @ketvietlab/ketjs-view @ketvietlab/design-system
```

```js
// File: src/islands/tasks.mjs
import { createRoot, domHost, html } from '@ketvietlab/ketjs-view'
import { FlowButton, FlowStatus } from '@ketvietlab/flow-ui'
import { attachFlowUI } from '@ketvietlab/flow-ui/runtime'
import '@ketvietlab/design-system/tokens.css'
import '@ketvietlab/flow-ui/styles.css'

// container is an element carrying the data-flow-ui attribute.
export function mount(container, openCreate) {
  const root = createRoot(domHost(), container)
  const runtime = attachFlowUI(container)
  root.render(html`${FlowStatus({ status: 'progress' })}
    ${FlowButton({ label: 'New task', variant: 'primary', onClick: openCreate })}`)
  runtime.sync()
  return () => {
    runtime.dispose()
    root.dispose()
  }
}
```

Call `runtime.sync()` after every render so native controls and dialogs pick up new props.

## Styling contract

- Every selector is scoped under `[data-flow-ui]`; component hooks use `data-flow`.
- Colours, type, spacing, radius, shadow, focus and motion come from `--kv-*` tokens, directly or
  through `--flow-*` aliases. Switching the design-system theme restyles Flow UI with it.
- Density is fixed: 28px small controls, 32px controls, 36px compact rows, and at least 44px on
  touch.

Supply a logo through `--flow-logo-light` and `--flow-logo-dark` (absolute URLs), or with your own
`background-image` rule on `[data-flow="logo"]`, and set `--flow-logo-text: hidden`.

## Entry points

| Import                            | Contents                                                        |
| --------------------------------- | --------------------------------------------------------------- |
| `@ketvietlab/flow-ui`             | Buttons, inputs, status, tags, dialogs, task rows and cards     |
| `@ketvietlab/flow-ui/workspace`   | Shell, navigation, sections, tables, boards, pickers, charts    |
| `@ketvietlab/flow-ui/documents`   | Document tree, editor frame, outline and panels                 |
| `@ketvietlab/flow-ui/runtime`     | `attachFlowUI(root)` with `sync()`, `open(id)` and `dispose()`  |
| `@ketvietlab/flow-ui/i18n`        | Translator, locale helpers and `registerFlowMessages`           |
| `@ketvietlab/flow-ui/styles.css`  | Component stylesheet                                            |

## Translations

Copy ships in English, Japanese and Vietnamese under the `flow.` key prefix. Register your own
keys once at startup; a key that already exists throws instead of silently overriding.

```js
// File: src/i18n.mjs
import { registerFlowMessages } from '@ketvietlab/flow-ui/i18n'

registerFlowMessages({
  en: { 'billing.title': 'Billing' },
  ja: { 'billing.title': '請求' },
  vi: { 'billing.title': 'Thanh toán' },
})
```

## Demo

```bash
# Run from: the ketjs repository root
npm run build
npm --workspace @ketvietlab/flow-ui run demo
```

The demo serves the component library and a sample workspace on `http://127.0.0.1:4190/`, with
fixtures kept in browser storage only.
