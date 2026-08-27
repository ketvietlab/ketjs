---
title: Mobile Channel API baseline
description: Cross-repository source and contract anchors for the native staff Channel API integration.
pagefind: false
---

# Mobile Channel API baseline

Baseline ID: `mobile-channel-wave-0-2026-08-27`.

| Repository | Wave 0 source revision | Branch |
| --- | --- | --- |
| `ketvietlab/ketviet` | `b36ac1a06bc294543e471be758594e07920e6c9e` | `codex/mobile-channel-wave-0` |
| `ketvietlab/ketjs` | `f012f39b54913a3ec3bd83be703a548f7374a89b` | `feat/mobile-channel-wave-0` |
| `ketvietlab/ketviet-app` | `9986e08e4d3c3149605aa0ddcd77fae9d5a11aba` | `codex/mobile-channel-wave-0` |

The legacy mobile OpenAPI document has 154 operations and SHA-256
`c5d901a4c40104610b91b04709b8b60c46068107e810c092093ce8b4722c1b76` in both the private
deployment repository and the mobile repository. The composed private staff profile has 148 operations:
131 retain their method and relative path, 17 use an explicit path cutover, and 6 legacy operations are
intentionally omitted or replaced.

KetJS owns the public Channel API and identity presentation primitives. It does not own the private union
contract assembled from Cosmetic, Commerce, and Hospitality deployments. The private repository generates
that artifact; the mobile repository pins and consumes it.

This baseline is an audit anchor, not the target contract. In particular, 40 composed success responses are
not yet typed strongly enough for safe Swift or Kotlin generation.
