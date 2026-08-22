---
title: HTTP contracts and OpenAPI
description: Record transport-neutral HTTP contracts in the KetJS manifest and generate deployment-specific OpenAPI documents.
---

KetJS owns the contract substrate, not a product API. A module route can attach machine-readable HTTP metadata;
composition validates its ownership and preserves it in the deployment manifest. An application or facade can
then generate OpenAPI from the routes that actually shipped.

KetJS does not choose a public API prefix, authentication scheme, documentation UI, or `/openapi.json` endpoint.
Those are application decisions. This separation lets the same framework support a storefront API, an internal
service API, or no public HTTP API at all.

## Route contract metadata

The object form of a route accepts an `HttpRouteContract`:

```ts
// File: src/modules/catalogue_api/index.ts
import { defineModule, json } from '@ketvietlab/ketjs'

export const catalogueApi = defineModule({
  name: 'catalogue_api',
  version: '1.0.0',
  reserves: ['/api/catalogue/v1/'],
  routes: {
    '/api/catalogue/v1/items': {
      anonymous: true,
      contract: {
        profile: 'catalogue',
        method: 'GET',
        operationId: 'catalogue.items.list',
        summary: 'List published catalogue items.',
        auth: 'public',
        responses: {
          '200': { type: 'object', properties: { data: { type: 'array' } } },
        },
      },
      handler: (ctx) => async (url, request) =>
        json(await ctx.callUnchecked('catalogue_api.listPublishedItems', {}, url, request)),
    },
  },
})
```

The contract records:

| Field | Meaning |
| --- | --- |
| `profile` | Logical API surface selected by a generator. |
| `method` and `operationId` | Stable transport operation identity. |
| `summary` | Optional human-readable description. |
| `auth` | Opaque application-defined authentication policy interpreted by the facade generator. |
| `capability` | Stable capability key and action advertised to clients. |
| `request` | JSON Schema for path parameters, query parameters, and JSON body. |
| `responses` | JSON Schema keyed by HTTP status. |
| `idempotent` | Signals that the operation uses a caller-provided idempotency key. |

Contract schemas are JSON Schema fragments. They describe the HTTP boundary; domain function input and output
signatures remain the authoritative server-side business contract.

## Prefix ownership and extensions

`reserves` assigns a complete static route namespace to one module. Another module cannot publish below that
prefix unless it:

1. depends on the owner;
2. creates the route through the owner's published factory, which records `through`;
3. declares a compatible major when the owner exposes a versioned extension contract.

```ts
// File: src/modules/catalogue_reviews/index.ts
export const extension = defineModule({
  name: 'catalogue_reviews',
  depends: ['catalogue_api'],
  compatible: { catalogue_api: '^1' },
  // Routes are produced by the facade's published route factory.
})
```

Composition rejects overlapping reservations, direct route bypasses, and incompatible extension versions. The
resulting `Manifest.routePrefixes` retains the owner of every namespace.

## Generating OpenAPI

An OpenAPI generator receives a composed `Manifest`, selects route entries by `contract.profile`, and maps the
contract metadata without importing individual feature modules:

```ts
// File: src/modules/order/routes.ts
const manifest = compose(app.modules, { headless: true })

for (const [path, route] of Object.entries(manifest.routes)) {
  if (route.contract?.profile !== selectedProfile) continue
  // Map method, schemas, authentication, capabilities, and idempotency metadata.
}
```

Generate after composition, not from a handwritten route list. This ensures disabled or absent modules do not
leave stale operations in the document and extension routes appear automatically.

The generator decides how contract authentication maps to OpenAPI `securitySchemes`, where the document is
published, and which renderer consumes it. KetJS only guarantees the checked manifest metadata.

## Generic function transport is separate

`/_ket/fn` is the framework's function transport, not an automatic public REST API. `ServeSpec.resolveAudience`
and `allowFor` can classify credentials and prevent a non-staff audience from reaching it. A public facade should
expose selected domain operations through owned routes and attach HTTP contracts there.

For a concrete implementation, see KetSuite's [Channel API architecture](/ketsuite/channel-api/) and generated
[Customer API reference](/ketsuite/channel-api-reference/).
