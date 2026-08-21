---
title: HTTP routes and responses
description: Serve KetJS functions, module routes, dynamic paths, HTML, JSON, binary data, and streamed responses.
---

KetJS provides a Node HTTP runtime around the composed application. The framework mounts function,
asset, island, and agent endpoints; modules and the app may add routes through declared factories.

## Module-owned routes

Declare reusable routes on the module that owns them:

```ts
import { defineModule, json } from '@ketvietlab/ketjs'

export const sales = defineModule({
  name: 'sales',
  routes: {
    '/api/orders/{id}': (ctx) => async (url, request, params) => {
      const order = await ctx.call('sales.getOrder', { id: params.id }, url, request)
      return json(order)
    },
  },
})
```

A parameter occupies one complete path segment. Values are decoded and passed in `params`. Two modules
claiming the same path fail during composition.

Module route dispatch checks the live manifest. Disabling a module therefore returns `404` for its
routes instead of leaving stale handlers mounted.

## Anonymous routes

Routes default to requiring a session. Public endpoints must opt in:

```ts
routes: {
  '/health': {
    anonymous: true,
    handler: () => () => json({ ok: true }),
  },
}
```

Use anonymous exposure only for routes that truly precede identity: health checks, login, provider
callbacks, and deliberately public content. The functions called by an anonymous route must also be
declared `anonymous: true`.

## App-level routes

`serve.routes` is useful for application shell routes that do not belong to a reusable module:

```ts
import { defineApp, json } from '@ketvietlab/ketjs'

const app = defineApp({
  name: 'orders_api',
  modules: [sales],
  headless: true,
  serve: {
    routes: (ctx) => ({
      '/': () => json({ app: 'orders_api' }),
      '/api/orders': async (url, request) =>
        json(await ctx.call('sales.listOrders', {}, url, request)),
    }),
  },
})
```

Prefer module routes when install state should control availability. Keep deployment health and
application-level orchestration in `serve.routes`.

## `ServeContext`

Route factories receive live runtime services:

| Member | Use |
| --- | --- |
| `manifest` | Full manifest shipped by the deployment. |
| `live(request)` | Manifest restricted to modules enabled for this request's tenant. |
| `reportsOf(url, request, target)` | Installed reports for a model whose source the viewer may call. |
| `appsOf(request)` | Installed/available module information for this tenant. |
| `scopeOf(url, request)` | Company and branch scope resolved from the session or development shim. |
| `call(name, input, url, request)` | Function call carrying tenant, session, permissions, actor, and scope. |
| `callUnchecked(...)` | Internal authorization bootstrap only; deliberately easy to audit by name. |
| `sessionsOf(url, request)` | Session manager for the request's tenant, or `null`. |
| `storageOf(url, request)` | Tenant-namespaced blob storage. |
| `translate(locale)` | Translator for the composed message catalogue. |
| `document(...)`, `styles(request)` | Safe document shell and installed module styles. |
| `joint(...)`, `jointShows(...)` | Installed extension-point output. |
| `menu(url, request)` | Navigation filtered by install state and function permissions. |

Do not cache `live()` or a tenant-specific service globally. Which modules, sessions, and storage
apply can change per request.

## Response helpers

Routes return branded `RouteResult` values. Create them with public helpers:

| Helper | Body | Default content type |
| --- | --- | --- |
| `page({ body })` | Escaped `TemplateResult` document | `text/html` with doctype |
| `fragment(body)` | Escaped HTML fragment | `text/html` |
| `navigablePage(request, options)` | Full document or named navigation slots | Negotiated |
| `json(value)` | JSON serialization | `application/json` |
| `text(value)` | String | `text/plain` |
| `bytes(value, { type })` | `Uint8Array` | Required non-markup type |
| `streamed(iterable, { type })` | `AsyncIterable<Uint8Array>` | Required non-markup type |
| `raw(value, { type })` | Trusted prebuilt string | `text/html` |
| `withHeaders(result, headers)` | Existing result plus headers | Preserves the original type/status |

Each helper accepts a status option. `bytes()` and `streamed()` refuse HTML, XHTML, and SVG content
types so binary APIs cannot accidentally become a markup escape hatch.

## Safe HTML

Use `html` from `@ketvietlab/ketjs-view` and `page` or `fragment` from `@ketvietlab/ketjs`:

```ts
import { page } from '@ketvietlab/ketjs'
import { html } from '@ketvietlab/ketjs-view'

routes: {
  '/orders/{id}': (ctx) => async (url, request, params) => {
    const order = await ctx.call('sales.getOrder', { id: params.id }, url, request)
    const body = ctx.document({
      lang: ctx.localeOf(url, request),
      title: 'Order',
      body: html`<main><h1>${order.number}</h1><p>${order.total}</p></main>`,
    })
    return page({ body })
  },
}
```

Template holes are escaped. A plain object that resembles `RouteResult` is not assignable because the
type is branded. `raw()` is the deliberate, searchable escape hatch for already-trusted markup; never
pass request data to it.

## Fragment navigation

Use `navigablePage()` when one GET route can return either a complete document or replaceable slots:

```ts
import { navigablePage } from '@ketvietlab/ketjs'

return navigablePage(request, {
  title: 'Orders',
  document: () => ctx.document({ lang: 'en', title: 'Orders', body: screen }),
  slots: {
    'backend.sidebar-main': () => sidebar,
    'backend.topbar': () => topbar,
    'backend.content': () => screen,
  },
})
```

The callbacks are lazy. A normal request calls only `document`; a navigation request calls only the
declared slot renderers. Keep stable shell joints and global islands outside replaceable slots so the
server does not construct them during internal navigation.

The protocol is intentionally small:

```http
X-Ket-Navigation: fragment-v1
Accept: text/vnd.ket.fragments+html
```

```html
<ket-fragments data-title="Orders">
  <template data-ket-slot="backend.content">...</template>
</ket-fragments>
```

Fragment responses use `text/vnd.ket.fragments+html` and include
`Vary: X-Ket-Navigation`. `isNavigationRequest(request)` checks the request representation. Slot names
are lowercase dotted names, and each returned slot must occur exactly once in both the response and
current document.

The generated browser runtime enhances same-origin GET links and GET forms by default when the page
contains a slot. POST forms stay native unless a module enhances them. Modifier clicks, downloads,
external URLs, hash-only links, and elements under `data-ket-reload` are left alone. The runtime owns
history, back/forward restoration, request cancellation, title, scroll, hash focus, and `aria-busy`,
and emits `ket:navigation-start`, `ket:navigation-complete`, and `ket:navigation-error`.

An invalid MIME type, missing or duplicate slot, login redirect, unknown island, failed island update,
or any reconciliation error falls back to a full navigation. Without JavaScript, every link and form
continues to use ordinary document navigation.

For themed website pages, set `serve.pages.region` to the built-in theme region that carries the page
body, for example `website.page`. Themes without that declared slot keep full navigation and remain
backward compatible.

## Headers and cookies

Add response headers without reconstructing the branded object:

```ts
return withHeaders(json({ ok: true }), {
  'cache-control': 'no-store',
  'set-cookie': cookie,
})
```

Use `withHeaders()` rather than spreading a route result into a new plain object.

## Binary and streamed output

Serve an in-memory export:

```ts
return bytes(csvBytes, {
  type: 'text/csv; charset=utf-8',
  status: 200,
})
```

Serve large content with backpressure:

```ts
const stored = await ctx.storageOf(url, request).get(key)
if (!stored) return text('Not found', { status: 404 })

return streamed(stored.body, {
  type: stored.meta.type,
})
```

The HTTP layer consumes the async iterable chunk by chunk instead of buffering the object.

## Function transport

HTTP-exposed functions are callable at:

```text
POST /_ket/fn/<qualified-function-name>
Content-Type: application/json
```

Use `TestClient.call()` or `ket call` instead of manually constructing this transport. They preserve
cookies, identity headers, dry-run, idempotency keys, and error parsing.

## Error handling

`KetError` values serialize their `code`, message, and optional hint. Use stable codes for machine
decisions and messages for diagnostics. Unexpected errors remain server failures; do not convert every
exception into a successful JSON body.

Keep body-size limits and provider authentication on dedicated routes. Use [Storage, transport, and
streams](/ketjs/integrations/) for bounded multipart uploads and webhook/service boundaries.
