# KetAtlas design-system adapter

KetAtlas is not coupled to Két. A design system can expose a generic
`ketatlas.design-system-adapter.v1` descriptor that declares its materializer, document root contract,
portable assets, composition API, state ownership and verification lock. The JSON Schema in this folder
is the portable contract; `profile.json` is the Két implementation of it.

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
