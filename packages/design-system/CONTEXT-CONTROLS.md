# Workspace context and server-rendered client sheets

`ContextButton` is a native context selection command with a primary name, optional
second line, optional leading identity and count. A normal `Button` owns a one-line
32px command and cannot express this navigation role without private overrides.
The component owns its transparent/selected boundary and 4/8px inset, 8px sibling
content gap and 2px gap between bodyMd/medium and bodySm/muted lines. With two
lines its natural height is 48px. It does not create a working surface. Parents
own the ribbon layout, context visibility, overflow and submitted state. Long
names truncate within 15rem; the full native button name remains accessible.
Disabled contexts do not change the server's authorization.

`attachClientModalInteractions(root)` owns initial focus, Tab containment,
background inertness, Escape and focus return for `ModalSheet` in `client` mode.
It delegates closing to the native close button. Opening, server event binding,
draft persistence and business mutations remain application-owned. It never
changes history or treats a client close as navigation. Call its disposer before
replacing/removing the active layer and on teardown; reattach when the layer
identity changes, not on every field update. Embedded sheets and a ModalSheet
whose native dialog ancestor owns semantics are outside this focus lifetime.

Consumers using framework-native generated adapters may bind native attributes
and slots to this public DOM. They must consume the public CSS and runtime, not
recreate the hooks or restyle descendants. The catalogue `context-button` specimen
covers selected, unselected and unavailable contexts.

Focused verification for the KétChat consuming deployment:

- `node --import tsx --test test/design-system-context-controls.test.tsx`: 2 pass.
- `node --test test/design-system-client-modal.test.mjs`: focus lifetime assertions.
- Scoped JavaScript type check of `runtime/client-modal.js`, inventory and governance.
- KetPlus Chromium, 1024×768, light: two-line context measured 48px; opening the
  public client sheet focuses Close; Tab cycles Input → Last → Close; Shift+Tab
  from Close returns to Last; Escape closes and returns focus to the opener.
  Background content disappears from the actionable accessibility observation
  while inert and returns after disposal. The browser session was closed.

This is focused producer/consumer verification, not a full framework regression.
