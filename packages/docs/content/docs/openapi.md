---
title: HTTP contracts and OpenAPI
description: Publish server functions as HTTP operations, record transport-neutral HTTP contracts in the KetJS manifest, and generate deployment-specific OpenAPI documents.
group: Request execution
order: 6
---

KetJS owns the contract substrate, not a product API. A module route can carry machine-readable HTTP metadata,
either derived from a server function by `httpRoutes()` or written by hand; composition validates it and preserves
it in the deployment manifest. An application or facade can then generate OpenAPI from the routes that actually
shipped.

KetJS does not choose a public API prefix, authentication scheme, documentation UI, or `/openapi.json` endpoint.
Those are application decisions. This separation lets the same framework support a storefront API, an internal
service API, or no public HTTP API at all.

Use [Spec](/spec/) to render an exported document as a static API reference and request console.
The current KetJS {{VERSION}} release scaffolds the exporter and Spec build commands in new applications.

## Function bindings

`httpRoutes()` publishes server functions as ordinary HTTP operations: a method, a path, query parameters or a
JSON body, and a JSON response. The function stays the implementation. Permission, input validation, idempotency
and output projection run in `ctx.call` exactly as they do for any other caller; the route only translates the
request into the function's input and the result into a response.

Composition derives each operation's contract from the function signature, and the running route checks both the
request and the response against that contract. The document a client reads and the route it calls therefore
cannot disagree.

Declare how many rows each published function returns:

```ts
// File: src/modules/shop/index.ts
import { defineModule, KetError } from '@ketvietlab/ketjs'

export const shop = defineModule({
  name: 'shop',
  functions: {
    listProducts: {
      anonymous: true,
      input: { search: 'text?', limit: 'int?' },
      output: { id: 'id', name: 'text', price: 'decimal' },
      returns: 'many',
      effects: ['read:shop.Product'],
      handler: listProducts,
    },
    myOrders: {
      input: { customerId: 'id', status: 'text?' },
      output: { id: 'id', status: 'text', total: 'decimal' },
      returns: 'many',
      effects: ['read:shop.Order'],
      handler: myOrders,
    },
    placeOrder: {
      input: { customerId: 'id', lines: 'json', note: 'text?' },
      output: { id: 'id', total: 'decimal' },
      returns: 'one',
      idempotent: true,
      effects: ['write:shop.Order'],
      handler: async (ctx, input) => {
        if (!(await inStock(ctx, input.lines))) {
          throw new KetError({ code: 'E_OUT_OF_STOCK', message: 'a line exceeds the stock on hand' })
        }
        return placeOrder(ctx, input)
      },
    },
    cancelOrder: {
      input: { id: 'id' },
      returns: 'none',
      effects: ['write:shop.Order'],
      handler: cancelOrder,
    },
  },
})
```

Then publish them from the module that owns the API surface:

```ts
// File: src/modules/shop_api/index.ts
import { defineModule, httpRoutes } from '@ketvietlab/ketjs'

export const shopApi = defineModule({
  name: 'shop_api',
  depends: ['shop'],
  reserves: ['/api/shop/v1/'],
  routes: httpRoutes(
    {
      profile: 'shop',
      prefix: '/api/shop/v1',
      errors: { E_OUT_OF_STOCK: { status: 409, messageKey: 'error.outOfStock' } },
    },
    {
      'GET /products': { call: 'shop.listProducts', auth: 'public', summary: 'List published products.' },
      'GET /me/orders': { call: 'shop.myOrders', bind: { customerId: 'actor' } },
      'POST /orders': {
        call: 'shop.placeOrder',
        status: 201,
        idempotency: 'required',
        bind: { customerId: 'actor' },
        schemas: {
          input: {
            lines: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['sku', 'quantity'],
                properties: { sku: { type: 'string', minLength: 1 }, quantity: { type: 'integer', minimum: 1 } },
              },
            },
          },
        },
      },
      'POST /orders/{id}/cancel': 'shop.cancelOrder',
    },
  ),
  messages: {
    en: { 'error.outOfStock': 'Some items are out of stock.' },
    vi: { 'error.outOfStock': 'Một số mặt hàng đã hết.' },
  },
})
```

Endpoints are keyed `"METHOD /path"`; a string is shorthand for `{ call }`. The routing module must depend on the
module that owns each function.

The first argument holds what every endpoint of the call shares:

| Group option | Default | Meaning |
| --- | --- | --- |
| `profile` | required | API surface the operations belong to; generators select by it. |
| `prefix` | none | Prepended to every endpoint path, such as `/api/shop/v1`. |
| `auth` | `required` | `required` or `public`; an endpoint may override it. |
| `envelope` | `data` | `data` answers `{ "data": value }`; `none` answers the value itself. |
| `errors` | none | Business error codes every endpoint maps; an endpoint's own entry wins. |
| `through` | none | Prefix owner whose published factory contributes these routes. |
| `maxBodyBytes` | 1 MiB | Largest JSON body accepted. |

Each endpoint may set:

| Endpoint option | Meaning |
| --- | --- |
| `call` | Qualified function name. |
| `auth` | Overrides the group's `auth`. |
| `status` | `200` (default) or `201` for a successful response with a body. |
| `params` | Maps a function input to a differently named path placeholder: `{ id: 'orderId' }`. |
| `bind` | Supplies inputs from the request identity: `actor`, `company`, or `branch`. |
| `returns` | Row count, when the function does not declare it. It must not contradict the function. |
| `idempotency` | `optional` or `required` acceptance of an `Idempotency-Key` header. |
| `operationId` | Stable operation identity; defaults to `<profile>.<module>.<function>`. |
| `summary` | Human-readable description. |
| `schemas` | JSON Schema narrowing for `input` and `output` fields. |
| `errors` | Business error codes mapped to statuses and messages. |
| `maxBodyBytes` | Overrides the group's body limit. |

### Request mapping

Every function input comes from exactly one place:

| Source | Rule |
| --- | --- |
| Path placeholder | `{name}` reads the input of the same name, or the one `params` maps to it. The input must be a required scalar. |
| Identity (`bind`) | `actor` is the user id; `company` and `branch` come from the request scope. The input must be `id`, `text`, or `ref`. |
| Query string | Every other input of a `GET` or `DELETE` operation. A `json` input cannot be carried and is refused at composition. |
| JSON body | Every other input of a `POST`, `PUT`, or `PATCH` operation. |

The mapping is strict, so a client mistake is reported instead of silently ignored:

- An unknown query key or body field is refused. So is a key sent for a bound or path input.
- A query key may appear once.
- `int`, `float`, and `bool` path and query values must parse exactly: `true` or `false`, and integers within the safe range.
- A `decimal` travels as a string. A JSON number for a `decimal` input is refused, because it has already been rounded.
- An optional body field accepts `null`; an optional query parameter may be absent.
- A body must be a JSON object with an `application/json` or `+json` content type. An empty body counts as `{}`.
- Translated messages follow `Accept-Language`. A `lang` query key is refused like any other unknown key.

`actor` cannot be bound on a public operation, which may have none. A `branch` input, and a `company` input on a
public operation, must be optional because a request may lack them.

### Responses and `returns`

A function's `output` names the fields of a row. `returns` says how many rows the operation answers with, and
composition refuses to publish a function without it:

| `returns` | Successful response |
| --- | --- |
| `one` | One object, with status `200` or the endpoint's `201`. |
| `optional` | One object or `null`. |
| `many` | An array of objects. |
| `none` | `204` with no body; whatever the handler returned is discarded. |

Every `returns` other than `none` needs declared `output` fields. With the default `data` envelope the success
body is `{ "data": ... }`.

Before answering, the route spells values the way the contract does: a `decimal` computed as a number becomes its
exact text, and a `Date` for a `datetime` field becomes its ISO instant. The result is then validated against the
contract. A function whose result breaks its published contract answers `500` with `E_INTERNAL` and logs
`http_binding_output` with the JSON pointer and rule that failed, never the value itself.

### Field schemas

Each field type maps to a JSON Schema:

| Field type | JSON Schema |
| --- | --- |
| `id`, `text`, `ref` | `string` |
| `int` | `integer` |
| `float` | `number` |
| `decimal` | `string` matching a plain decimal, at most 4096 characters |
| `bool` | `boolean` |
| `date` | `string` with format `date` |
| `datetime` | `string` with format `date-time` |
| `json` | `object` or `array` for input; unconstrained for output |

An optional `T?` field may be `null` in a body or a response. Objects never admit undeclared properties.

`schemas.input` and `schemas.output` narrow a field's schema; they cannot widen it. Strings accept `minLength`,
`maxLength`, `pattern`, and `enum`; decimals keep their own pattern and accept `minLength`, `maxLength` up to 4096,
and `enum`; numbers accept `minimum`, `maximum`, and `enum`; booleans accept `enum`. Every field accepts `title`,
`description`, and `examples`, and the examples must satisfy the schema. A `json` field may use any schema from the
subset below, except that a `json` input stays an object or an array.

Schemas use a deliberate JSON Schema subset, which the runtime enforces exactly as documented: `type`,
`properties`, `required`, `additionalProperties` (boolean only), `items`, `enum`, `const`, `minLength`,
`maxLength`, `minimum`, `maximum`, `pattern`, `format` (`date` or `date-time`), `minItems`, `maxItems`, `title`,
`description`, and `examples`. String lengths count Unicode code points.

### Authentication and cross-site requests

A `required` operation needs the request identity the deployment already resolves: a cookie session, or
`serve.resolveIdentity` for a gateway or bearer credential. Without one the route answers `401`. A deployment that
configures neither cannot boot a `required` binding and fails with `E_HTTP_BINDING_AUTH_UNAVAILABLE`.

A `public` operation admits strangers, so it may only publish a function declared `anonymous: true`.

Bindings are open at the framework's session gate so a stranger receives the `401` error envelope rather than a
sign-in redirect; the route enforces `auth` itself before anything else. Function permission is still checked by
`ctx.call` and answers `403`. Because the contract is published, a malformed request may receive `422` before its
permission is checked.

A browser attaches cookies to any request it makes, so an operation that acts on a cookie session must know the
page asking belongs to this site:

- For a cookie-session identity, a non-`GET` request must carry an `Origin` header with this host, or
  `Sec-Fetch-Site: same-origin` when `Origin` is absent. Otherwise it is refused with `403 E_HTTP_CSRF`.
- A cookie-session body request must declare a JSON content type, which a plain HTML form cannot send.
- A bearer or gateway credential does not ride along with browser requests, so it is not checked.
- Composition refuses a `GET` binding to a function that declares `write:` or `enqueue:` effects.

Responses to `required` operations carry `Cache-Control: no-store`.

### Idempotency

Idempotency keys reach the runtime's own [idempotency](/ketjs/functions/#dry-run-and-idempotency) through the
`Idempotency-Key` header:

| Function and binding | `Idempotency-Key` header |
| --- | --- |
| Function not idempotent | Refused with `400 E_HTTP_IDEMPOTENCY_UNSUPPORTED`. |
| `idempotent: true`, non-`GET` operation | Accepted (`optional` by default). |
| `idempotency: 'required'` | Missing header refused with `428 E_HTTP_IDEMPOTENCY_REQUIRED`. |

A key is 1 to 255 visible ASCII characters. It is scoped to the operation, company and actor, so two callers or
two operations never share one. Repeating a request with the same key replays the first result; reusing the key
with a different request answers `409 E_IDEMPOTENCY_CONFLICT`, and a request still running answers
`409 E_IDEMPOTENCY_IN_FLIGHT`. Declaring `idempotency` on a function that is not idempotent, or on a `GET`
operation, is refused at composition.

### Errors

Every failure uses one envelope:

```jsonc
// File: example response body
{
  "error": {
    "code": "E_HTTP_INVALID_REQUEST",
    "message": "the request is invalid",
    "requestId": "8f0c6a8e-5b7e-4f39-9a51-3cc0e5b0d4a1",
    "fields": {
      "limit": [
        { "field": "limit", "code": "type", "messageKey": "validation.type", "params": { "expected": "int?" } }
      ]
    }
  }
}
```

`fields` appears on validation failures and is keyed by input name; `""` holds issues about the request as a
whole, such as a body that is not JSON. Every response carries an `x-request-id` header with the same id. It is
also the function call's correlation id, so a client report can be joined to the server log.

| Status | Code | Cause |
| --- | --- | --- |
| `400` | `E_HTTP_IDEMPOTENCY_UNSUPPORTED` | An idempotency key on an operation that does not accept one. |
| `401` | `E_HTTP_UNAUTHENTICATED` | A `required` operation without a request identity. |
| `403` | `E_FN_NOT_PERMITTED`, `E_HTTP_CSRF` | The caller may not call the function, or a cookie request came from another site. |
| `404` | `E_NOT_FOUND` | The function reported a missing record. |
| `405` | `E_HTTP_METHOD` | Another method on the operation's path, with an `Allow` header. |
| `409` | `E_IDEMPOTENCY_CONFLICT`, `E_IDEMPOTENCY_IN_FLIGHT` | An idempotency key reused or still running. |
| `413` | `E_PAYLOAD_TOO_LARGE` | The body exceeds `maxBodyBytes`. |
| `415` | `E_HTTP_CONTENT_TYPE` | A body that is not JSON. |
| `422` | `E_HTTP_INVALID_REQUEST`, `E_INVALID_INPUT`, or the function's validation code | The request does not match the contract or the function refused its input. |
| `428` | `E_HTTP_IDEMPOTENCY_REQUIRED` | A missing key where one is required. |
| `4xx` | Declared business code | An error the binding maps in `errors`. |
| `500` | `E_INTERNAL` | Anything else. |

A function reports a business failure by throwing a `KetError` with its code. Map it with
`errors: { E_OUT_OF_STOCK: 409 }`, or `{ status, messageKey }` to translate the message for the request's locale;
the key belongs to the routing module's message catalogue. A business code must match `E_[A-Z0-9_]+`, map to a
`4xx` status, and cannot be a framework code or start with `E_HTTP_`.

The error's own message and hint never leave the server: they are written for the log and may name internals. A
client sees the translated declared message, the fixed message for a framework code, or the HTTP reason phrase. An
error the binding does not declare answers `500 E_INTERNAL` and is logged as `http_binding_failed`.

### Composition checks

Mistakes visible from the declaration alone are thrown by `httpRoutes()` where they were written. Everything that
needs the composed functions, routes, or messages is reported by composition:

| Code | Raised when |
| --- | --- |
| `E_HTTP_BINDING_PROFILE` | `httpRoutes()` has no valid lowercase profile name. |
| `E_HTTP_BINDING_KEY` | A key is not `"METHOD /path"`, the prefix is malformed, or an endpoint names no function. |
| `E_HTTP_BINDING_METHOD` | A method other than `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`. |
| `E_HTTP_BINDING_METHOD_CONFLICT` | Two endpoints of one call share a path. |
| `E_HTTP_BINDING_FUNCTION` | The function is unknown, is a provision function, or has an unreadable input type. |
| `E_HTTP_BINDING_DEPENDENCY` | The routing module does not depend on the function's module. |
| `E_HTTP_BINDING_PUBLIC` | `auth` is unknown, or a public operation publishes a function that is not `anonymous`. |
| `E_HTTP_BINDING_GET_MUTATES` | A `GET` operation publishes a function with write or enqueue effects. |
| `E_HTTP_BINDING_PARAM` | A placeholder has no matching input, reads an optional or non-scalar input, or `maxBodyBytes` is invalid. |
| `E_HTTP_BINDING_BIND` | A bound input is unknown, not an id, required when the identity may lack it, or `actor` on a public operation. |
| `E_HTTP_BINDING_QUERY_TYPE` | A query string would have to carry a `json` input. |
| `E_HTTP_BINDING_SCHEMA` | A schema override widens the type, uses an unsupported keyword, or describes an unknown or bound field. |
| `E_HTTP_BINDING_RETURNS` | `returns` is missing, contradicts the function, or lacks output fields; or `status` or `envelope` is invalid. |
| `E_HTTP_BINDING_IDEMPOTENCY` | `idempotency` on a function that is not idempotent, or on `GET`. |
| `E_HTTP_BINDING_ERROR` | An error mapping uses a reserved code, a non-`4xx` status, or a message key the module lacks. |
| `E_HTTP_OPERATION_ID` | An operation id outside the profile or with unsupported characters. |
| `E_HTTP_OPERATION_DUPLICATE` | A binding shares its operation id with another operation of the same profile. |
| `E_HTTP_BINDING_FORGED` | A route carries a binding without the handler `httpRoutes()` made for its path, or also declares a contract or drops `anonymous`. |

A binding derives its own contract, so a route cannot carry both a binding and a handwritten `contract`.

### Limits

- A path publishes one operation. Give a second operation its own path, such as `POST /orders/{id}/cancel`.
- Bindings speak JSON only. Multipart uploads, streamed or binary responses, custom response headers, and cookies
  belong in a handwritten route.
- A binding does not change the function's `exposure`. Whether `/_ket/fn` also reaches the function is decided by
  the function, as before.

## Handwritten route contracts

The object form of a route also accepts an `HttpRouteContract` written by hand, for routes a binding cannot
express:

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
| `auth` | Authentication policy. `public` operations need no credential; any other value is interpreted by the facade. |
| `credentials` | Additional security scheme names documented for a route that resolves another trust boundary. |
| `capability` | Stable capability key and action advertised to clients. |
| `request` | JSON Schema for path parameters, query parameters, headers, and JSON body. |
| `responses` | JSON Schema keyed by HTTP status. |
| `idempotent` | Signals that the operation uses a caller-provided idempotency key. |

Contract schemas are JSON Schema fragments. They describe the HTTP boundary; domain function input and output
signatures remain the authoritative server-side business contract. Nothing checks a handwritten handler against
its contract, which is why a binding is preferred wherever one fits.

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

Bindings follow the same rules: an extension passes `through: '<owner>'` in its `httpRoutes()` group.

Composition rejects overlapping reservations, direct route bypasses, and incompatible extension versions. The
resulting `Manifest.routePrefixes` retains the owner of every namespace.

## Generating OpenAPI

The CLI reads the compiled workspace, selects a composed deployment and writes its contract without booting
the server or datastore:

```sh
# Run from: shop
npm run build
npx ket openapi --deployment shop --profile shop --options openapi-options.json --out openapi/shop.json
```

Omit `--out` to print only JSON to stdout. The profile defaults to the deployment name; `--profile` overrides
the options file's profile. `info` defaults to the title `<deployment> API` and the current project's
`package.json` version (or `0.0.0` when no version is declared). The options file is ordinary JSON using
`HttpOpenApiOptions` keys: `info`, `servers`, `securitySchemes`, `security`, and optionally `profile`.

For the protected Shop operations above, write this JSON file (without the location comment):

```jsonc
// File: shop/openapi-options.json
{
  "info": { "title": "Shop API", "version": "1.0.0" },
  "servers": [{ "url": "https://shop.example.com" }],
  "securitySchemes": { "bearerAuth": { "type": "http", "scheme": "bearer" } },
  "security": [{ "bearerAuth": [] }]
}
```

Invalid options or missing security exit with a nonzero status before writing the document. Generating the
contract does not mount an endpoint or select an authentication implementation.

`httpOpenApiDocument()` builds an OpenAPI 3.1 document for one profile from a composed manifest, covering bindings
and handwritten contracts alike:

```ts
// File: tools/openapi.ts
import { writeFileSync } from 'node:fs'
import { compose, httpOpenApiDocument } from '@ketvietlab/ketjs'
import { app } from '../src/app.ts'

const manifest = compose(app.modules, { headless: true })
const document = httpOpenApiDocument(manifest, {
  profile: 'shop',
  info: { title: 'Shop API', version: '1.0.0' },
  servers: [{ url: 'https://shop.example.com' }],
  securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
  security: [{ bearerAuth: [] }],
})

writeFileSync('openapi/shop.json', `${JSON.stringify(document, null, 2)}\n`)
```

The generator:

- selects routes whose contract has the requested profile and sorts them by path;
- keeps schemas inline, so the same manifest always yields the same document, ready to commit and diff;
- marks path parameters required, and the request body required when it has a required field;
- describes `204` without content;
- gives `public` operations `security: []` and every other operation the `security` option, followed by each
  handwritten contract's `credentials` as alternatives;
- returns a copy, so editing the document never changes the manifest.

It refuses with `E_OPENAPI_SECURITY` rather than omit security: when the profile has a non-public operation and no
`security` was given, or when `security` or `credentials` names a scheme `securitySchemes` does not define.

A project created by `ket new` already has this generator as `tools/openapi.ts`, run by `npm run openapi`
([Quick start](/ketjs/quick-start/#write-the-openapi-document)).

`httpContracts(manifest, { profile })` returns the same sorted `{ path, contract }` entries for a generator that
needs another format.

Generate after composition, not from a handwritten route list. This ensures disabled or absent modules do not
leave stale operations in the document and extension routes appear automatically. Where the document is
published, and which renderer consumes it, remain application decisions.

## Reading the document

[Spec](https://github.com/ketvietlab/ketsuite/tree/develop/packages/ketspec) is a static API reference and try-it
console from KetSuite. A new `ket new` project includes it as a pinned development tool:

```sh
# Run from: shop/
npm run api:docs
```

This runs the project's OpenAPI generator, then builds the reference in `.ket/api-docs`. Serve that directory
with your static host. Its try-it console uses the document's `servers`; without a server it uses the page's
origin. Generate the public server address before hosting documentation on a different origin.

The application owns the document and hosting. KetJS does not mount a documentation route or require Spec at
runtime; another OpenAPI renderer can consume the same file.

## Generic function transport is separate

`/_ket/fn` is the framework's function transport, not an automatic public REST API. `ServeSpec.resolveAudience`
and `allowFor` can classify credentials and prevent a non-staff audience from reaching it. A public facade should
expose selected domain operations through owned routes, preferably function bindings, and attach HTTP contracts
there.

For a concrete implementation of a handwritten facade, see KetSuite's Channel API architecture and generated
Customer API reference.
