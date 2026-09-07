---
title: SSR fragment navigation
description: Browser evidence for same-document navigation while screens remain server-rendered.
---

KetSuite keeps initial requests and route rendering on the server. For later same-origin navigation,
the browser requests an SSR fragment and reconciles the shell's stable slots. This preserves browser
state without introducing a second client-side data or screen model.

## Contract

- Initial entry returns a complete HTML document.
- Same-origin links and GET forms request `text/vnd.ket.fragments+html`.
- The server returns `backend.sidebar-main`, `backend.topbar`, and `backend.content` slots.
- The browser updates history, title, focus, scroll, and island lifecycles without replacing the document.
- Structural or transport errors fall back to normal document navigation.

The shell must emit every stable slot in the initial document, even when a slot has no visible content.
Server-only islands are valid fragment content and are distinguished from unknown deployment islands;
only islands with browser modules are hydrated.

## Reproduction

```sh title="Terminal"
# Run from: /path/to/ketjs
npm run bench:ssr-navigation
```

The runner seeds fresh SQLite tenants, opens Chromium, navigates from the complete partner directory to
the customer tab, and writes raw JSON plus screenshots under `.artifacts/ssr-navigation/`.

## 2026-09-07 result

Ten warm-browser samples were collected for each mode on the same machine and route. Times are click or
navigation start through a usable 30-row result.

| Partners | Mode | Median | p95 | Requests | Document requests | JS realm preserved |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 10,000 | Full document | 329 ms | 342 ms | 37 | 1 | No |
| 10,000 | SSR fragment | 360 ms | 404 ms | 1 | 0 | Yes |
| 100,000 | Full document | 1,093 ms | 1,155 ms | 37 | 1 | No |
| 100,000 | SSR fragment | 1,136 ms | 1,224 ms | 1 | 0 | Yes |

The result proves the no-reload property, but does not claim a local latency win: fragment reconciliation
added roughly 31–43 ms in this run. At 100,000 partners, the server-side list query dominates both modes.
The material benefit is continuity—one request, preserved JavaScript state, and no document replacement—
while retaining a single SSR rendering and authorization path.

This benchmark deliberately removes the former `0/1/5/10` client-extension axis. Extensions now compose
into the SSR screen before the response, so there is no separate client data-loading architecture to vary.
