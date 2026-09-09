# KetAtlas design-system adapter

## Decision

KetAtlas remains independent of KetJS, Ketsuite, React and any design-system vendor. Integration uses a
portable descriptor with schema version `ketatlas.design-system-adapter.v1`. A design-system package owns
its adapter; KetAtlas only discovers the descriptor, includes the declared assets and consumes the
capabilities it actually declares.

Every descriptor declares an identity and one or more assets. It may also declare:

- a materialize command, a non-mutating check command and a generated lock path;
- CSS, JavaScript, font, image or other assets and their document load positions;
- an optional document-root attribute and classic/module/no-script mode;
- optional template, slot, attach and public-hook contracts;
- whether interactive state belongs to the URL, memory, storage or the host.

`{atlasDirectory}` is the only command placeholder in version 1. When a materializer is declared, it must
generate deterministic, self-contained assets under the target atlas and a lock containing its identity,
source version and file hashes. Without one, asset paths resolve relative to the descriptor and may be
absolute URLs. Document, composition and state fields are optional so CSS-only libraries, Web Components,
server renderers and JavaScript component systems can all use the protocol. KetAtlas projects do not
install the design system or carry a custom bundler.

## Két implementation

`@ketvietlab/design-system/atlas/profile.json` is one adapter. Its companion JSON Schema is exported as
`@ketvietlab/design-system/atlas/adapter.schema.json`. The `ket-design-system-atlas` command:

1. recursively inlines the public CSS imports;
2. server-renders canonical list, record, workspace, shell, surface, section and metric templates;
3. converts the small interaction runtime into an iframe-safe classic script;
4. writes a reproducible lock with all asset hashes and the 99-component registry count.

The generated browser namespace is `window.ATLAS_DESIGN_SYSTEM`; Két-specific asset names, root attribute
and `data-ui` hooks stay in the descriptor. KetAtlas must never infer those values.

## CRM migration

`tasks/crm/ui-mockups` proved the model by manually inlining CSS, rendering page contracts and maintaining
`design-system.lock.json`. Its next design-system refresh should replace that bespoke process with the Két
adapter, then update screen references to the descriptor-declared assets. The migration is intentionally a
consumer change and is not part of the design-system release branch.
