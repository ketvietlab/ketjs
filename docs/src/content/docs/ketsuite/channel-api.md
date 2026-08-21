---
title: Channel API architecture
description: Stable, profile-specific contracts for websites, mobile clients, POS terminals, and integrations.
---

The Channel API is KetSuite's supported boundary for clients outside the backend. It uses KetJS
[HTTP contract metadata](/ketjs/openapi/) but owns the product decisions: profiles, customer authentication,
capability discovery, response envelopes, and API versioning. It is a facade over domain functions, not a second
business layer; vertical modules retain validation and transaction ownership.

## Profiles and ownership

`channel_api` reserves these route namespaces so ordinary modules cannot accidentally publish an endpoint
inside them:

| Profile | Prefix | Intended clients | Status |
| --- | --- | --- | --- |
| Customer | `/api/customer/v1/` | Headless websites and customer mobile apps | Available |
| Staff | `/api/staff/v1/` | Internal staff apps | Reserved |
| POS | `/api/pos/v1/` | Point-of-sale terminals | Reserved |
| Integration | `/api/integration/v1/` | Partner systems and webhooks | Reserved |
| Internal | `/internal/v1/` | Trusted service-to-service traffic | Reserved |

A vertical contributes routes with `defineChannelRoute()`, depends on `channel_api`, and declares a
compatible contract major. Composition fails when a route bypasses the facade or an extension targets an
incompatible version.

```ts
import { defineModule } from '@ketvietlab/ketjs'
import { defineChannelRoute } from '@ketvietlab/ketsuite'

export default defineModule({
  name: 'booking_extension',
  depends: ['channel_api'],
  compatible: { channel_api: '^1' },
  routes: Object.fromEntries([
    defineChannelRoute({
      profile: 'customer',
      method: 'GET',
      path: 'bookings/{id}',
      operationId: 'customer.bookings.get',
      responses: { '200': { type: 'object' } },
      handler: async (ctx, url, request, params) => ({
        data: await ctx.callUnchecked('booking_extension.getPublicBooking', { id: params.id }, url, request),
      }),
    }),
  ]),
})
```

## Customer authentication

Customer identity is separate from KetSuite staff identity. Accounts belong to a customer realm; a realm
can be selected from the website host or explicitly with `X-Channel-Realm` for native clients.

- Browser clients use an HTTP-only, same-site cookie plus a CSRF token for mutations.
- Headless and mobile clients use short-lived Bearer access tokens and rotating refresh tokens.
- Refresh grants are stored as digests, can be revoked, and are invalidated after password changes.
- A customer credential cannot be used against the generic `/_ket/fn` staff transport.

Registration is immediately usable in the current phase; email activation is not required.

## Contract behavior

Every response uses one envelope:

```json
{
  "data": {},
  "error": null,
  "meta": {
    "requestId": "req_…",
    "serverTime": "2026-08-21T00:00:00.000Z",
    "nextCursor": null
  }
}
```

Errors carry a stable code and localized message metadata. Mutating operations that advertise idempotency
require `Idempotency-Key`; reusing a key with a different request body returns a conflict instead of replaying
the wrong result. Invalid media types, oversized bodies, and invalid JSON are rejected at the HTTP boundary.

## OpenAPI and Starlight

KetSuite's `openApiDocument()` maps the Customer profile, Bearer/cookie security schemes, capabilities, and
idempotency metadata to OpenAPI 3.1. The checked-in artifact is regenerated from the composed server contract
before Starlight development and production builds:

```sh
npm run generate:api --prefix docs
```

The [Customer API reference](/ketsuite/channel-api-reference/) renders that artifact directly and offers the raw
document for SDK generation and external tooling.
