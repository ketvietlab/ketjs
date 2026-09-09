# KetAtlas design-system adapter

KetAtlas is not coupled to Két. A design system can expose a generic
`ketatlas.design-system-adapter.v1` descriptor. Only its identity and assets are required. A descriptor
may additionally declare a materializer and verification lock, document-root requirements, a composition
API, or state ownership. This lets a CSS-only library, Web Components package, server renderer or
JavaScript component system implement the same protocol without pretending to expose Két's runtime.
The JSON Schema in this folder is the portable contract; `profile.json` is one Két implementation.

Without a materializer, asset paths resolve relative to the descriptor (and may be absolute URLs). With
a materializer, they resolve relative to the target atlas after the declared command runs. KetAtlas must
only consume optional capabilities that are actually declared.

KetAtlas screens run as self-contained HTML documents in an opaque iframe. This adapter therefore ships
a materializer instead of requiring module imports inside each screen.

From a built KetJS checkout or an installed package, run:

```sh
ket-design-system-atlas materialize path/to/ui-mockups
ket-design-system-atlas check path/to/ui-mockups
```

The command requires `atlas.json` in the target directory and manages four files:

- `assets/ket-design-system.css`: the public stylesheet with local imports inlined;
- `assets/ket-design-system-contracts.js`: canonical SSR page and layout templates;
- `assets/ket-design-system-runtime.js`: the classic-script keyboard, overlay and focus runtime;
- `design-system.lock.json`: package version, component count and SHA-256 hashes.

Consumers must read `profile.json` instead of assuming these Két-specific filenames or attributes. For
this adapter, link the declared CSS and classic scripts, add `data-kv-design-system` to the document root,
and compose page slots through `window.ATLAS_DESIGN_SYSTEM.templates` using the
`__ATLAS_SLOT_{NAME}__` pattern. Atlas-specific CSS may describe business content, but must not copy
component markup or override semantic design tokens.
