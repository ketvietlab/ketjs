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

The facade runs before the handler and settles everything the contract declares: the caller is resolved and
rejected against `auth`, a cookie caller proves intent on mutations, and the request body is validated against
the published schema. A handler receives the result as its fifth argument and never repeats those checks.

```ts
// File: packages/ketsuite/src/modules/booking_extension/index.ts
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
      auth: 'customer',
      handler: async (ctx, url, request, params, channel) => ({
        data: await ctx.callUnchecked(
          'booking_extension.getPublicBooking',
          { id: params.id, accountId: channel.identity!.accountId },
          url,
          request,
        ),
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

The CSRF check follows how the caller proved who they are rather than which route they reached: a cookie is
attached by the browser whether or not the caller meant to send it, a Bearer token is not. So every unsafe
method on a cookie session requires a same origin and the `X-CSRF-Token` returned at sign-in, and a Bearer
client is never asked for one. Which profile supplies identities is registered with
`registerChannelIdentity()`; a contract declaring `auth` on a profile with no resolver fails the request
rather than serving it open.

Registration is immediately usable in the current phase; email activation is not required.

## Contract behavior

Every response uses one envelope:

```jsonc
// File: examples/channel-api-response.jsonc
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

Errors carry a stable code and localized message metadata. A body that does not match its declared schema is
answered `422` with one entry per offending field in `error.fieldErrors`, keyed by path — the published schema
is the check, so the generated document cannot claim more than the server enforces.

Mutating operations that advertise idempotency require `Idempotency-Key`. Reusing a key with a different
request body returns `409 channel_api.idempotencyConflict` instead of replaying the wrong result, and reusing
it while the first attempt is still running returns `409 channel_api.idempotencyInFlight` with
`retryable: true`. Invalid media types, oversized bodies, and invalid JSON are rejected at the HTTP boundary.

## OpenAPI and Starlight

KetSuite's `openApiDocument()` maps the Customer profile, Bearer/cookie security schemes, capabilities, and
idempotency metadata to OpenAPI 3.1. The checked-in artifact is regenerated from the composed server contract
before Starlight development and production builds:

```sh
# Run from: /path/to/ketjs
npm run generate:api --prefix docs
```

The [Customer API reference](/ketsuite/channel-api-reference/) renders that artifact directly and offers the raw
document for SDK generation and external tooling.
