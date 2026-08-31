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
| Staff | `/api/staff/v1/` | Internal staff apps | Available |
| POS | `/api/pos/v1/` | Point-of-sale terminals | Reserved |
| Integration | `/api/integration/v1/` | Partner systems and webhooks | Reserved |
| Internal | `/internal/v1/` | Trusted service-to-service traffic | Reserved |

A vertical contributes routes with `defineChannelRoute()`, depends on `channel_api`, and declares a
compatible contract major. Composition fails when a route bypasses the facade or an extension targets an
incompatible version.

The facade runs before the handler and settles everything the contract declares: the caller is resolved and
rejected against `auth`, a cookie caller proves intent on mutations, a profile capability authorizer (when
registered) accepts or rejects declared capabilities, and the request body is validated against the published
schema. A handler receives the result as its fifth argument and never repeats those checks.
The framework routes on path alone, so one path is one operation — `routesOf()` refuses two contributions
that claim the same path rather than letting the later one silently win.

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
- Headless customer clients, POS and native staff use short-lived Bearer access tokens backed by their own
  profile sessions. Native staff tokens are opaque deployment credentials, not POS or raw IdP tokens.
- Refresh grants are stored as digests, can be revoked, and are invalidated after password changes.
- A customer credential cannot be used against the generic `/_ket/fn` staff transport.

The CSRF check follows how the caller proved who they are rather than which route they reached: a cookie is
attached by the browser whether or not the caller meant to send it, a Bearer token is not. So every unsafe
method on a cookie session requires a same origin and the `X-CSRF-Token` returned at sign-in, and a Bearer
client is never asked for one. Which profile supplies identities is registered with
`registerChannelIdentity()`. Profiles with multiple credential presentations use
`registerChannelIdentityPresentation()` so a private Bearer resolver composes with the public cookie resolver
without import-order precedence. A contract declaring `auth` on a profile with no resolver fails the request
rather than serving it open, and supplying both presentations fails before either resolver runs.

Role storage stays with the module that owns a profile. It can call
`registerChannelCapabilityAuthorizer(profile, { owner, authorize })` to enforce the `{ key, action }` declared by its routes.
After registration, every capability-declared route in that profile is fail-closed before rate limiting, body
validation, or handler execution. Profiles without an authorizer retain metadata-only capability discovery, so
adding a role backend is an explicit product decision rather than a framework guess.

Bootstrap code can call `authorizedChannelCapabilities()` to enumerate only capability actions contributed by
the live deployment and accepted by that same authorizer for the resolved identity. The result is deduplicated,
grouped and sorted, so its stable hash can be used as a capability revision. POS bootstrap uses this list rather
than advertising every route in the package or hashing a static offline policy.

Registration is immediately usable in the current phase; email activation is not required.

## Staff profile

A staff identity is the verified session and nothing else. There is no realm header, no tenant hint in the
body, no company in the query — the session carries which company the caller writes to and which ones they
may read, and the framework re-resolves that from live rows on every request. Revoking a membership takes
effect on the next call rather than whenever a credential expires, and a caller cannot name a company they
were not already granted.

`StaffIdentity.presentation` is `cookie | bearer`. Both presentations enter the same route authorization
pipeline. Cookie mutations require same-origin and CSRF proof; Bearer mutations do not. The public package
registers only the framework cookie resolver. A private deployment registers the opaque Bearer resolver and
owns token persistence, expiry, revocation and live membership resolution.

`auth` is spelled `required` and `optional` on a staff route. Those are the profile-neutral names; the
customer profile's `customer` and `optional-customer` still work and mean the same thing.

The staff bootstrap, account, and attendance success responses publish concrete OpenAPI data models. Bootstrap
types the live company and branch scope, credential-presentation-specific CSRF value, capabilities, contract
revision, deployment name, minimum/recommended native versions, and localized maintenance policy. A deployment
owns the external-client policy through `serve.clientCompatibility`; absent policy is represented explicitly by
the non-blocking `0.0.0` baseline rather than an omitted or untyped field. Disabled maintenance always publishes a
null message. Enabled maintenance resolves the exact locale or language first, then falls back to Vietnamese,
English, or the first configured message so an unsupported locale cannot silently remove the blocker copy.
Attendance types clock state, timestamped punch results, and shift history explicitly, including
nullable corrections and stop times. Native generators can therefore reject an empty or free-form business data
schema instead of falling back to an untyped map.

The same client-readiness rule applies to the warehouse completion result and hospitality operations. A completed
picking types the refreshed picking, released claim, and terminal transition. Hospitality types property context,
the property-local front-desk board, reservation/stay/folio aggregates, and the bounded references accepted by
operations. These schemas describe the existing projections and do not expose new domain state.

Which identity a profile hands its routes is declared once, in `ChannelIdentities`:

```ts
// File: packages/ketsuite/src/modules/channel_api/core.ts
export interface ChannelIdentities {
  customer: CustomerIdentity
  staff: StaffIdentity
  pos: PosIdentity
  integration: never
}
```

`PosIdentity` is resolved from the live device grant and POS session. It carries the operator, device,
company, granted POS configuration, grant and session ids. POS request bodies do not select that scope.
`integration` remains `never` deliberately: its prefix is reserved but its identity is not designed, so
writing an integration route is a compile error rather than a route that silently trusts whichever credential
happens to arrive.

POS command ids derive their namespace from the resolved company, POS configuration and device. Reusing a
client idempotency key on another terminal or configuration therefore cannot return the first terminal's
record. The deployment that owns the device registry registers the POS resolver; KetJS owns only this public
identity and routing seam.

Enrollment and exchange are different: the caller does not have a POS identity yet. Such a route remains
`auth: 'public'` to the POS resolver, declares `credentials: ['operatorBearer']` for its OpenAPI contract,
and delegates to a function that requires the live upstream operator actor and company scope. The credential
metadata documents that separate trust boundary; it does not turn a raw Bearer string into an identity.

A staff route calls `ctx.call`, not `ctx.callUnchecked`. The framework already knows which functions a
session may invoke, and reaching past that check is how a channel becomes a way around the roles every
other surface obeys. `npm run audit:staff-channel` fails the build on a staff route that reaches for the
unchecked call, because nothing about that is visible at a glance in a diff. A refused function grant is
mapped to `403 channel_api.forbidden`, rather than being disguised as an internal failure.

A staff session is a cookie, so the facade asks unsafe methods to prove intent the same way it does for a
customer one. The customer profile hands the CSRF token over at sign-in; staff sign in through the
framework, which knows nothing about this channel, so `staff/bootstrap` is where it is handed over. A
client that has not bootstrapped cannot mutate.

`sale_staff_channel` contributes read-only customer, product, and order slices. Customer lookup admits only active
partners holding the `customer` role and projects no raw contact or street-address fields. Order list and
detail call Sale's bounded, company-scoped functions and return server totals plus line data, delivery-move
progress, and invoice counts without claiming a writable aggregate version. Product lookup admits only active
variants on active `saleOk` templates with a live default UOM. It derives `stockable` versus `consumable` from
Stock's `isStorable` extension and withholds price, tax, barcode, and inventory data. Order mutations remain
outside this module until their mobile concurrency contract can be represented without guessing.

`purchase_staff_channel` contributes read-only vendor, product, order, and vendor-bill slices. Vendor lookup has the
same role and privacy boundary as customer lookup. Purchase orders expose server totals and receipt/billing
progress without writable actions or synthetic versions. Vendor bills expose document state and totals but
withhold ledger posting lines; posting, matching, payment, and e-invoice maintenance remain back-office work.
Product lookup applies the same active variant, live UOM, and product-kind rules to `purchaseOk` templates and
withholds supplier prices, tax setup, and barcodes. Purchase mutations remain outside this module until their
mobile concurrency and workflow contracts can be represented without guessing.

`stock_staff_channel` contributes the complete 19-operation staff warehouse system. Stock still owns the
transfer and quant ledger; the channel module owns the staff work around it: one unique active claim per
transfer, actor-scoped scan sessions and fingerprint-only scan events, and leased inventory-count attempts.
Stock batches the picking type, warehouse, location, move, move-line, lot, and tracking joins so the facade
does not issue one query per transfer row; Product, UOM, Company, and User remain the owners of their display
labels.

Picking reads and claim mutations carry a content-derived `pkv_` version. Canonical execution and reverse
execution use their own `opv_`/`rpv_` and `orv_` evidence hashes, while every scan session changes its `msv_`
version when an event or transition lands. Count sessions, attempts, and lines have independent monotonic
`ics_`, `ica_`, and `icl_` versions, so renewing a lease does not create a false conflict on an unrelated line.
All mutations require bootstrap CSRF proof and an idempotency key, bind ownership to the verified session
actor, and return `409` before a stale version can write. Barcode input is never persisted: the audit event
stores only a SHA-256 fingerprint and the resolved product/move identity. Quality remains explicitly
`unavailable`; the execution preview exposes that fact instead of inventing a passed inspection.

`inventory_staff_channel` contributes a bounded goods catalogue and one read-only stock detail under the
`inventory.products` read capability. Product owns variant identity and channel eligibility, Stock owns the
company-scoped availability and internal/transit positions, UOM owns unit labels, and Product Media supplies
only whether a primary image exists. The detail carries an opaque content-derived `ipv_` version, a matching
strong ETag, and independently versioned positions. Service products, prices, costs, tax setup, BOMs, and
management-option catalogues are deliberately absent. Create, edit, archive, restore, and stock-adjustment
commands remain outside this module until their aggregate versions and domain workflows can satisfy the mobile
contract without inventing state.

`account_staff_channel` contributes a bounded customer-invoice and credit-note list plus one read-only detail
under the `accounting.invoices` read capability. Account owns company scope, canonical document totals, and
open residuals; Partner supplies only the customer label. Detail carries a content-derived `aiv_` version and
matching strong ETag, while ledger posting lines are represented only by a count and never exposed. Electronic
invoicing remains deployment-owned. Posting, cancellation, payment collection, and their eligibility or replay
lookups stay outside the channel until the domain supplies the complete concurrency and idempotency workflows.

`mail_staff_channel` contributes the signed-in staff member's notification list, unread count, and read markers
under the `mail.notifications` read capability. Mail owns recipient isolation: neither query nor mutation accepts
a user, tenant, or company hint. The list includes read and unread entries by default, supports bounded page
numbers, and can filter to unread entries. Navigation is derived on the server from an allowlist of public thread
targets; unknown and deployment-private targets remain readable without becoming arbitrary client routes. Read
markers require the bootstrap CSRF token, preserve an existing read timestamp on retry, and never affect another
actor's inbox.

`crm_staff_channel` contributes the pipeline list, record detail, and explicit transition, assignment, and
mark-won commands under the mobile capability `crm.pipeline`. Every route calls CRM's audience-scoped
functions, so a non-superuser sees or changes only records they
created, records assigned to them, or records belonging to one of their active teams. The list accepts only
the domain's lead/opportunity kinds and open/won/lost outcomes. Detail includes the canonical integer version
and next pending activity, but deliberately withholds contact fields, timeline entries, messages, attachments,
and configuration options. Each command requires the CSRF token from bootstrap, an `Idempotency-Key`, and the
integer `expectedVersion`; a replay returns the same result, a changed replay or stale aggregate returns `409`,
and the response carries the refreshed safe projection. Create cannot yet share the list path because the
current router keys routes by path rather than method. Lost-reason and activity commands remain outside the
channel because their legacy request shapes do not map one-to-one to the current domain.

`quality_staff_channel` contributes the complete three-operation mobile inspection flow. Quality owns an
immutable template snapshot, step requirements, the actor's attempt, photo metadata, and final review record;
Storage owns the photo bytes. A photo is accepted only for the attempt actor, required MIME type, and bounded
byte length, and the persisted SHA-256 digest is computed from the bytes received rather than trusted from the
caller. Reads return a content-derived `qcv_` version and strong ETag. Upload and submit require bootstrap
CSRF proof, an idempotency key, and `If-Match`; a stale attempt returns `409` before it can append evidence or
finalize a superseded check.

`business_report_staff_channel` contributes the business-overview report as a checked facade over Company,
Sale, Account, Stock, and Partner functions. It supports the mobile contract's fixed UTC windows (`today`,
`yesterday`, `this_week`, `this_month`, and `last_month`), fills every time bucket including zero-value days, and computes current-versus-previous
changes without dividing by zero. Customer identifiers in the ranking are opaque hashes. The report never
uses unchecked calls and does not manufacture delivery state when a deployment-owned delivery module is not
installed; the standard report leaves that deployment-owned count at zero instead.

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
    "contractVersion": "1.0.0",
    "nextCursor": null
  }
}
```

`contractVersion` identifies the Channel API wire contract decoded by generated clients; it is present on
success and error envelopes. Errors carry a stable code and localized message metadata. A request that does not match its declared schema
is answered `422` with one entry per offending field in `error.fieldErrors`, keyed by path — the published
schema is the check, so the generated document cannot claim more than the server enforces. That covers query
parameters as well as bodies: a declared `enum` or `maximum` is refused rather than silently clamped. Because
a query string carries no types, values are coerced to the declared type before the check, and an empty value
(`?state=`) reads as absent rather than invalid. Parameters the contract does not declare are left alone.

Mutating operations that advertise idempotency require `Idempotency-Key`. Reusing a key with a different
request body returns `409 channel_api.idempotencyConflict` instead of replaying the wrong result, and reusing
it while the first attempt is still running returns `409 channel_api.idempotencyInFlight` with
`retryable: true`. Invalid media types, oversized bodies, and invalid JSON are rejected at the HTTP boundary.
Rate-limited requests return `429 channel_api.rateLimited`, set `retryable: true`, and publish a bounded
`Retry-After` value derived from the declared route window so native clients do not invent a retry cadence.

## Retail storefront

`website_retail` publishes the shopping half of the Customer profile under `/api/customer/v1/retail/`:
`storefront`, `products`, the cart routes, `checkout`, and the shopper's own orders.

A cart is held by an opaque token sent as `X-Cart-Token`, so a visitor can fill one before there is anything
to sign in to. `POST retail/cart/claim` attaches that cart to the account that just signed in and folds in
whatever the account already had open, because the alternative — two carts, one of them silently discarded —
loses items the shopper chose. A claimed cart no longer opens on its token alone.

`POST retail/checkout` turns the cart into a real `sale.Order` by composing Sale's own commands in one
transaction. Nothing about the order is computed in the storefront: the number, the prices, the taxes and the
totals all come from the functions a salesperson's quotation goes through, so an online order and a desk order
cannot drift apart. **A price is never accepted from the caller** — every line is re-priced from the store's
pricelist on the way in.

Checkout needs facts no shopper can supply, so they are configured once per site with
`website_retail.saveStoreSettings`:

| Setting | Why |
| --- | --- |
| `warehouseId` | Which warehouse ships the order. Required by `sale.createOrder`. |
| `pricelistId` | Prices the catalogue and the order. Absent falls back to the product list price. |
| `defaultUomId` | The unit for a product whose template never declared one. |
| `orderPolicy` | `quotation` leaves the order in draft for a human; `confirm` commits stock. |

A site with no settings row still browses and still builds a cart. `retail/storefront` reports
`ordering: false` and checkout answers `409 website_retail.orderingUnavailable`, rather than pretending an
order was taken.

Money and quantities cross the boundary as strings. A JSON number cannot hold every decimal the ledger can,
and a storefront that rounds a total in transit is worse than one that never showed it.

## OpenAPI and Starlight

KetSuite's `openApiDocument()` maps one channel profile per document — capabilities, idempotency metadata,
and the security schemes that profile actually accepts — to OpenAPI 3.1. Customer routes offer Bearer or the
storefront cookie; staff routes offer only the verified session cookie; POS routes offer only the POS Bearer
session. Describing that per profile is what keeps a generated client from being built without a credential to
send. Checked-in artifacts are
regenerated from the composed server contract before Starlight development and production builds:

```sh
# Run from: /path/to/ketjs
npm run generate:api --prefix docs
```

The [Customer API reference](/ketsuite/channel-api-reference/) renders the customer artifact directly and offers
the raw document for SDK generation and external tooling. The staff document is published alongside it at
`/api/staff-v1.openapi.json` for native staff clients to generate from.

Because that regeneration was a side effect of building the docs site, a route could be added without one
and the document would quietly fall behind — which it had, by three routes, before anyone looked. `npm run
check:api` compares every checked-in document against the composed server and is part of `npm run verify`,
so adding a route without regenerating now fails on the way in rather than on somebody's next SDK build. A
profile shipping routes with no published document is the same failure wearing a different hat, which is why
the staff document is generated and checked on the same footing as the customer one rather than on demand.
