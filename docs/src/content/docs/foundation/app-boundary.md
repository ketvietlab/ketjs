---
title: Documentation application boundary
description: Why the Ket developer documentation owns its dependency graph and build lifecycle.
sidebar:
  order: 1
---

The Ket developer documentation is a standalone application inside the KetJS repository. It is not a package in the
root npm workspace.

| Scope | Owner |
| --- | --- |
| Astro, Starlight, Sharp, and TypeScript for documentation | `docs/package.json` |
| Locked dependency graph | `docs/package-lock.json` |
| Source, content collection, and theme | `docs/src/` |
| Static output | `docs/dist/` |
| Framework and KetSuite applications | Root workspace `packages/*` |

The root workspace intentionally includes only `packages/*`. Installing or building the docs does
not change the KetJS dependency graph, zero-dependency audit, or runtime artifacts.

## Theme contract

`src/styles/ketsuite.css` maps KetSuite color roles directly to Starlight custom properties. Light
and dark modes share the KetSuite backend's indigo accent, warm-neutral canvas, borders, and corner
radii. The current SVG logo is a placeholder, not a final brand asset.
