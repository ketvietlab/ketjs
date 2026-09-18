// Bundled by tools/build-design-system-atlas-runtime.mjs into island-runtime.mjs, a
// self-contained script with no imports or exports of its own — KetAtlas mocks are
// self-contained HTML with no bundler and no package install, so the real
// @ketvietlab/ketjs-view runtime this pulls in has to be inlined rather than resolved
// as a bare specifier the way a real ketjs app's islands do (those instead point the
// specifier at the framework's own /_ket/view/index.js, which does not exist here).
// apps/design-system's own demo pages serve this same bundle from the asset mount
// (it lives under the package's own src, which that app already exposes at
// /design-system/*) rather than pointing at /_ket/view/index.js, for consistency
// with the one KetAtlas cares about — one bundle, one registry, two consumers.
//
// Every island this hydrates is `strict: false`: a page may render the contract
// markup without keeping every field synchronized, and a mismatched or missing
// island name should degrade to inert markup, not throw.
//
// Interactivity is real (open, close, choose, chips) but the manager-backed calls
// (search beyond the seeded options, create, remove) stay no-ops without a
// `manager.listFunction`/`saveFunction` — there is no backend for a static mock to
// call. That is the honest limit of a self-contained document, not a bug; the demo
// app pages that seed real options accept the same limit for consistency.

import { domHost, hydrateIslands } from '@ketvietlab/ketjs-view'
import type { IslandElement, IslandRegistry } from '@ketvietlab/ketjs-view'
import { createRelationSelectView } from '../interactions/relation-select/index.tsx'

// A hydrated island's props arrive off `data-props` as plain, generic JSON — the
// registry type reflects that. The actual shape is whatever the matching
// renderIsland() call served, which is that call site's own responsibility to
// keep in sync.
const registry: IslandRegistry = {
  'design-system.relation-select': (props) =>
    createRelationSelectView(props as Parameters<typeof createRelationSelectView>[0]),
}

const boot = (): void => {
  // `document` is duck-typed against IslandElement at runtime (the same way the
  // framework's own generated browser bootstrap treats it, in plain untyped JS);
  // the cast makes that explicit here since this file is real TypeScript.
  hydrateIslands(domHost(), document as unknown as IslandElement, registry, { strict: false })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
else boot()
