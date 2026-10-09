---
title: Spec
description: Turn an OpenAPI document into a readable API reference and an interactive request console, with the Két design system.
---

**Spec** is the API documentation UI from KétSuite: an alternative to Swagger UI or Redoc for OpenAPI 3.0 and 3.1 documents. It groups operations, explains their input and response schemas, and lets a reader try a request from the browser.

The npm package is [`@ketvietlab/ketspec`](https://www.npmjs.com/package/@ketvietlab/ketspec). Its current version is **0.1.41**; KetJS has its own version, **0.4.0**. Spec uses the public Két Design System, supports English and Vietnamese, and includes light and dark themes and a responsive layout.

## What Spec does

- Browse operations by tag, search by method, path or operation ID, and share a link to one operation.
- Inspect path, query, header and body inputs, response schemas, enums, constraints and recursive references.
- See authentication alternatives, idempotency and KetJS permission metadata alongside the operation.
- Enter credentials once, fill in a request, inspect the redacted curl preview and view its status, headers, body and duration.
- Identify unresolved references, duplicate operation IDs and malformed operations on the overview.

Spec consumes a contract; the API server enforces it. It does not add routes, authentication or JSON-RPC to your application. With KetJS, [HTTP function bindings](/docs/openapi/#function-bindings) expose ordinary HTTP endpoints and generate their OpenAPI contract. Spec also accepts documents produced by other frameworks.

<span id="start-with-ketjs-0-3-0"></span>

## Start with KetJS 0.4.0

New KetJS projects already include Spec and an OpenAPI exporter:

```bash
# Run from: projects
npx -y @ketvietlab/ketjs@0.4.0 new notes
cd notes
npm install
npm run api:docs
```

`api:docs` builds the application, exports `openapi/notes.json`, and generates the reference in `.ket/api-docs/`. Publish that directory on a static host or serve it locally with an HTTP static file server. No running API or database is needed to generate or read the reference; **Try it** needs the API to be reachable.

Run `npm run dev` from `notes/` to start the scaffold's API at `http://127.0.0.1:3000`. Select that server in Spec before sending a request. When the reference and API have different origins, configure the API's CORS policy to allow the reference origin.

To regenerate only the contract, run `npm run openapi`. Existing applications can use [HTTP contracts and OpenAPI](/docs/openapi/) and the [CLI export command](/docs/cli-config/) before adding Spec.

## Use any OpenAPI document

Install the published CLI in the project that owns your document:

```bash
# Run from: notes
npm install --save-dev @ketvietlab/ketspec@0.1.41
npx ketspec build openapi/notes.json --out .ket/api-docs --lang en --theme light
```

Use `--lang vi` for Vietnamese or `--theme dark` for the initial dark theme. Readers can switch the theme in the UI.

The generated `index.html` embeds the document and renders its overview before JavaScript runs. The accompanying `assets/` directory contains the self-contained browser bundle, design-system stylesheet, Spec stylesheet and logos. Deploy the **whole output directory**; it has no server dependency.

Operation selection, groups and search use query parameters (`?operation=`, `?group=`, `?q=`). The same output can be hosted at `/` or under a path such as `/reference/`, without application route rewrites.

## Render inside an application

For a host that needs its own server route, `renderSpecPage()` returns the complete HTML document. This example uses the assets emitted by the CLI above, served under `/spec/assets/`:

```ts
// File: notes/src/api-reference.ts
import { readFileSync } from 'node:fs'
import { renderSpecPage } from '@ketvietlab/ketspec'

const document = JSON.parse(readFileSync('openapi/notes.json', 'utf8'))

export function apiReference(request: Request): Response {
  const html = renderSpecPage({
    document,
    url: request.url,
    locale: 'en',
    assets: {
      script: '/spec/assets/ketspec.mjs',
      designSystemStyles: '/spec/assets/design-system.css',
      styles: '/spec/assets/ketspec.css',
      logo: '/spec/assets/logo-light.svg',
      logoDark: '/spec/assets/logo-dark.svg',
      favicon: '/spec/assets/mark.svg',
    },
  })
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
```

Register `apiReference` in your host's route layer and serve those asset paths. To load a document in the browser instead of embedding it, replace `document` with `specUrl: '/openapi.json'`. The browser bundle does not need a KetJS `/_ket/view/` route. Hosts that compose their own page can use the exported `mountSpec` runtime; see the [package README](https://github.com/ketvietlab/ketsuite/tree/master/packages/ketspec).

## Try requests safely

**Sign in** opens a credential dialog for the schemes declared in the document: bearer, basic authentication or API keys. Credentials stay in memory; Spec does not persist them in storage or URLs, and the curl preview redacts them. Cookie authentication uses the browser's cookies. The API still decides whether any request is authorized.

Mutating requests require confirmation. An operation that declares `Idempotency-Key` receives a generated key for retries. Missing required inputs, invalid JSON and invalid header values are shown on their fields before a request is sent.

Requests go directly from the reader's browser to the API. Spec reports network failures, timeouts and cancellation; a cancelled or timed-out mutation may already have reached the server. CORS and the server's permissions remain part of the API configuration.

## Next steps

- [Declare HTTP contracts and generate OpenAPI](/docs/openapi/).
- [Create and run a KetJS application](/docs/quick-start/).
- [Review the KetJS 0.4.0 release](/docs/release-notes/).
- [Read Spec's package documentation](https://github.com/ketvietlab/ketsuite/tree/master/packages/ketspec).
