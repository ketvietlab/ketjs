---
title: "Expose the Todo API through HTTP"
description: "Build a bounded JSON facade with method handling, domain calls and useful status codes."
stage: "Build the API"
duration: 45
lab: "Node terminal"
order: 19
---

Before you start: complete [Keep related writes atomic](/learn/transactions/), or make sure you can pass its checkpoint.

## Keep transport and business logic separate

The completed lab exposes `GET /api/todos`, `POST /api/todos`, and `PATCH /api/todos/{id}`. The route handles methods and parsing, then calls a named domain function with `ctx.call(name, input, url, req)` so request context is preserved.

Routes receive Node requests. Do not call the browser Fetch API's `request.json()` on an `IncomingMessage`. The lab uses this deliberately small bounded parser:

```ts
// File: learn_api/body.ts
import type { IncomingMessage } from 'node:http'

export async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > 4096) throw new Error('Body too large')
    chunks.push(bytes)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as Record<string, unknown>
}
```

## Wire the routes

Compare the completed workspace with your scaffold. The full route facade is:

```ts
// File: learn_api/ket.workspace.ts
import { defineDeployment, json, withHeaders } from '@ketvietlab/ketjs'
import { readBody } from './body.ts'
import learn_api from './modules/learn_api.ts'

export const deployment = defineDeployment({
  name: 'learn_api', modules: [learn_api], headless: true,
  worker: { queues: { learning: 1 } },
  serve: { routes: ctx => ({
    '/': () => json({ app: 'learn_api', routes: ['/api/todos', '/api/todos/{id}'] }),
    '/api/todos': async (url, req) => {
      if (req.method === 'GET') return json(await ctx.call('learn_api.list', {}, url, req))
      if (req.method !== 'POST') return withHeaders(json({ error: 'Method not allowed' }, { status: 405 }), { Allow: 'GET, POST' })
      let input: Record<string, unknown>
      try { input = await readBody(req) } catch { return json({ error: 'Expected a JSON object under 4 KiB' }, { status: 400 }) }
      return json(await ctx.call('learn_api.create', input, url, req), { status: 201 })
    },
    '/api/todos/{id}': async (url, req, params) => {
      if (req.method !== 'PATCH') return withHeaders(json({ error: 'Method not allowed' }, { status: 405 }), { Allow: 'PATCH' })
      let input: Record<string, unknown>
      try { input = await readBody(req) } catch { return json({ error: 'Expected a JSON object under 4 KiB' }, { status: 400 }) }
      const result = await ctx.call('learn_api.complete', { ...input, id: params.id }, url, req)
      return result === null ? json({ error: 'Todo not found' }, { status: 404 }) : json(result)
    },
  }) },
})
export const deployments = [deployment]
```

## Exercise the contract

POST a task and save the returned ID. GET the collection and find the task. PATCH its ID with `{"done":true}`. Repeat PATCH with an ID that does not exist in this company; it should return 404.

Try DELETE on the collection. The route returns 405 and an `Allow` header rather than silently accepting another method. Try malformed JSON, an array body and a body over 4 KiB; the parser returns a 400 response in this lab. These transport checks happen before the business operation.

The size limit is an application policy for this small JSON endpoint. A file upload requires the streaming/multipart contract from a later lesson, not a larger unbounded JSON buffer.

## Keep the identity boundary explicit

The development header in these curl examples is for local exercises. A production facade must resolve authenticated identity and restrict callable operations. Adding a route does not make arbitrary generic function dispatch an appropriate public API.

## Check the reference implementation

```bash
# Run from: learn_api
npm run learn -- check api
```

The checkpoint starts an isolated deployment and checks the HTTP workflow. It does not depend on your manually running development server.

## Checkpoint

Create, list and complete a task over HTTP. Verify 404, 405, malformed JSON and validation behavior without bypassing domain functions.

## Practice on your own

Add a read-one endpoint using the existing scoped lookup pattern. Define its method, output projection and missing-record behavior before implementing it.

## Reference

For the complete API contract, read [Http](/docs/http/).
