---
title: HTTP routes and responses
description: Serve KetJS functions, module routes, dynamic paths, HTML, JSON, binary data, and streamed responses.
---

KetJS provides a Node HTTP runtime around the composed application. The framework mounts function,
asset, island, and agent endpoints; modules and the app may add routes through declared factories.

## Module-owned routes

Declare reusable routes on the module that owns them:

```ts
// File: src/modules/sales/index.ts
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

## Reserved API prefixes

A contract-owning module can reserve a static prefix such as `/api/customer/v1/`. Routes below a reserved
prefix must come from the owner or from a dependent extension using the owner's route factory. KetJS records
the route method, request schema, response schemas, capability, and idempotency behavior in the manifest so
OpenAPI can be generated from the deployed composition rather than maintained as a separate document.

See [HTTP contracts and OpenAPI](/ketjs/openapi/) for the framework contract fields, extension rules, and generator
boundary.

## Anonymous routes

Routes default to requiring a session. Public endpoints must opt in:

```ts
// File: src/modules/order/routes.ts
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
// File: src/app.ts
import { defineDeployment, json } from '@ketvietlab/ketjs'

const app = defineDeployment({
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
| `callUncheckedForVerifiedCompany(...)` | Exact-company function dispatch after an external credential has cryptographically authenticated that company. |
| `sessionsOf(url, request)` | Session manager for the request's tenant, or `null`. |
| `storageOf(url, request)` | Tenant-namespaced blob storage. |
| `translate(locale)` | Translator for the composed message catalogue. |
| `document(...)`, `styles(request)` | Safe document shell and composed module styles. |
| `joint(...)`, `jointShows(...)` | Installed extension-point output. |
| `menu(url, request)` | Navigation filtered by install state and function permissions. |

Do not cache `live()` or a tenant-specific service globally. Which modules, sessions, and storage
apply can change per request.

Provider callbacks may arrive without a staff session even though their durable records are company-scoped.
Authenticate the exact request bytes first, bind the credential to one company, and only then use
`callUncheckedForVerifiedCompany()`. The method keeps the existing tenant lease and constructs an exact
single-company scope; it does not make a path, query, header, or unsigned body company claim trustworthy.

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
// File: src/modules/order/routes.ts
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
// File: src/modules/order/routes.ts
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
# File: examples/request.http
X-Ket-Navigation: fragment-v1
Accept: text/vnd.ket.fragments+html
```

```html
<!-- File: src/templates/example.html -->
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
// File: src/modules/order/routes.ts
return withHeaders(json({ ok: true }), {
  'cache-control': 'no-store',
  'set-cookie': cookie,
})
```

Use `withHeaders()` rather than spreading a route result into a new plain object.

## Binary and streamed output

Serve an in-memory export:

```ts
// File: src/modules/order/routes.ts
return bytes(csvBytes, {
  type: 'text/csv; charset=utf-8',
  status: 200,
})
```

Serve large content with backpressure:

```ts
// File: src/modules/order/routes.ts
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
# File: docs/src/content/docs/ketjs/http.md
POST /_ket/fn/<qualified-function-name>
Content-Type: application/json
```

Use `TestClient.call()` or `ket call` instead of manually constructing this transport. They preserve
cookies, identity headers, dry-run, idempotency keys, and error parsing.

The generic transport buffers at most 1 MiB of JSON by default. Configure `serve.maxJsonBodyBytes` (or
`maxJsonBodyBytes` on `createKetServer`) when a deployment needs a smaller boundary. KetJS checks both
`Content-Length` and streamed bytes before it runs scope, permission, or actor resolvers, so an
unauthenticated request cannot make those paths retain an unbounded body first.

## Rate limiting

A deployment may put a ceiling on how often one caller reaches a route:

```ts
// File: src/deployment.ts
serve: {
  rateLimit: (ctx, url, req) =>
    url.pathname === '/api/token'
      ? { action: 'auth.refresh', key: callerOf(req), limit: 60, windowMs: 15 * 60_000 }
      : null,
}
```

A refusal is answered `429` with `retry-after`, before the route runs — refusing after doing the work
is a limit that costs what it was meant to save. Each refusal leaves a `rate_limited` record.

**Return null for almost everything.** The check is durable, which means a database round trip, so
pointing it at all traffic hands an attacker a lever rather than taking one away. Name the routes where
*repetition by one identified caller* is the abuse — signing in, refreshing a token, an expensive
report. Volumetric floods belong to whatever sits in front of the process.

`key` says who is being limited: an account id, a hashed address, a device. It is hashed with the
action before storage, so the table holds a counter and not a record of who was where. `action` is
kept, because it is low-cardinality and it is what an operator greps for.

State lives in `ket_rate` in the tenant's own database, created the first time a policy is claimed —
a deployment that limits nothing carries no limiter state. The worker prunes counters nobody has
touched for a day; a deployment running no worker should call `pruneRateSlots` itself.

The window is fixed rather than a token bucket, because `limit per windowMs` is what a person means
and a bucket quietly changes it. The cost, stated: a caller can spend a full allowance at the end of
one window and another at the start of the next, so the worst case across a boundary is twice the
limit.

`claimRateSlot` is exported for a module that needs the same ceiling somewhere other than a route.

## Error handling

`KetError` values serialize their `code`, message, and optional hint. Use stable codes for machine
decisions and messages for diagnostics. Unexpected errors remain server failures; do not convert every
exception into a successful JSON body.

Malformed request URLs, `Host` headers, percent encoding, and JSON bodies are client errors. KetJS
answers them with HTTP `400` inside the normal JSON error boundary; they never escape from the async
server listener. As an origin server, KetJS accepts only origin-form request targets (`/path?...`) and
a `Host` authority without userinfo, path, query, fragment, encoded delimiters, or whitespace. Absolute
and scheme-relative request targets are rejected before tenant resolution. Function bodies must be
JSON objects rather than arrays or scalar values.

`FormValidationError` and invalid generic function input use HTTP `422`. Their JSON includes flat
`issues`, grouped `fieldErrors`, and whole-form `formErrors`. See [Form validation](/ketjs/form-validation/)
for the shared browser/server contract. Other `KetError` values remain HTTP `400` unless a more specific
transport status applies.

The generic JSON limit is only a baseline. Keep content-specific limits and provider authentication on
dedicated routes. Use [Storage, transport, and streams](/ketjs/integrations/) for bounded multipart
uploads and webhook/service boundaries.
