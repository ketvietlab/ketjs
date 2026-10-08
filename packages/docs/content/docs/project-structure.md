---
title: Directory structure
description: Understand the files in a scaffolded application and how modules grow.
group: Set up KetJS
order: 2
---

## The application scaffold

[Installation](/docs/quick-start/) creates a small, explicit application rather than a hidden runtime convention.

| File or directory | Responsibility |
| --- | --- |
| `ket.workspace.ts` | Application composition and selected deployments. |
| `modules/` | Module declarations: models, functions, routes and other owned contracts. |
| `test/` | Deployment behavior exercised through the public testing API. |
| `tools/dev.mjs` | Development process and rebuild lifecycle. |
| `tools/openapi.ts` | Writes the OpenAPI document of the composed HTTP operations (`npm run openapi`). |
| `openapi/` | The generated, committed OpenAPI document; Biome leaves it as generated. |
| `package.json` | Released dependencies and application commands. |
| `tsconfig.json` | TypeScript/TSX compilation to executable artifacts. |

The initial scaffold is intentionally small. Separate a growing module's functions, routes and views into its own files while keeping one explicit public module declaration.

## Source and production artifacts

Author TypeScript or TSX; deploy emitted JavaScript. A module catalogue descriptor names a real executable artifact in production. Source loaders belong to development. Read [Module discovery](/docs/module-discovery/) and [Deployment](/docs/deployment/) before packaging a catalogue.

## Ownership boundaries

A module owns its models and behavior. Dependencies expose contracts that other modules may extend. A deployment selects the complete module composition. File organization does not bypass [extension rules](/docs/modules/) or [declared function effects](/docs/functions/).

## View-only projects

A static site has pages, island entries, styles, static assets and `ket-view.config.ts`. A Markdown adapter belongs to the site's content layer; its view stays pure. See [Static sites](/docs/view-static-sites/) and the [runnable example](/examples/static-site/).
