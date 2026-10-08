import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bootDeployment,
  defineDeployment,
  defineModule,
  httpRoutes,
  json,
  KetError,
  withHeaders,
} from '@ketvietlab/ketjs'
import type { Ctx } from '@ketvietlab/ketjs'

/**
 * A binding answers HTTP for a server function without a second implementation of
 * what the function decides. These tests drive a real server: what a client sends,
 * what it gets back, and what must never reach it.
 */

let created = 0

const shop = defineModule({
  name: 'shop',
  models: {
    Product: { scope: 'shared', fields: { id: 'id', name: 'text', price: 'decimal' } },
    Order: { scope: 'shared', fields: { id: 'id', note: 'text' } },
  },
  functions: {
    listProducts: {
      anonymous: true,
      input: { search: 'text?', limit: 'int?', inStock: 'bool?' },
      output: { id: 'id', name: 'text', price: 'decimal' },
      returns: 'many',
      effects: ['read:shop.Product'],
      handler: (_ctx: Ctx, input) =>
        [
          { id: 'p1', name: 'Tea', price: 12.5, cost: 3 },
          { id: 'p2', name: 'Coffee', price: '7.25', cost: 2 },
        ]
          .filter((row) => !input['search'] || row.name.includes(String(input['search'])))
          .slice(0, (input['limit'] as number | undefined) ?? 10)
          .map((row) => ({ ...row, inStock: input['inStock'] ?? null })),
    },
    myOrders: {
      input: { userId: 'text', status: 'text?' },
      output: { userId: 'text', status: 'text?' },
      returns: 'many',
      effects: ['read:shop.Order'],
      handler: (_ctx: Ctx, input) => [{ userId: input['userId'], status: input['status'] ?? null }],
    },
    createOrder: {
      input: { lines: 'json', note: 'text?', amount: 'decimal?' },
      output: { id: 'id', count: 'int' },
      returns: 'one',
      idempotent: true,
      effects: ['write:shop.Order'],
      handler: (_ctx: Ctx, input) => {
        if (input['note'] === 'out')
          throw new KetError({ code: 'E_OUT_OF_STOCK', message: 'sku p1 has 0 left', hint: 'restock p1' })
        if (input['note'] === 'boom')
          throw new KetError({ code: 'E_UNMAPPED', message: 'internal detail', hint: 'secret hint' })
        created += 1
        return { id: `o${created}`, count: (input['lines'] as unknown[]).length }
      },
    },
    cancelOrder: {
      input: { id: 'id' },
      returns: 'none',
      effects: ['write:shop.Order'],
      handler: () => ({ cancelled: true }),
    },
    leaky: {
      anonymous: true,
      input: {},
      output: { id: 'id', count: 'int' },
      returns: 'one',
      effects: [],
      handler: () => ({ id: 'x', count: 'card-4242', secret: 's3cret' }),
    },
    forbidden: {
      input: {},
      output: { ok: 'bool' },
      returns: 'one',
      effects: [],
      handler: () => ({ ok: true }),
    },
  },
  routes: {
    '/session/start': {
      anonymous: true,
      handler: (ctx) => async (url, req) => {
        const sessions = await ctx.sessionsOf(url, req)
        const started = await sessions!.start({ userId: 'u1', companies: ['acme'], company: 'acme' })
        return withHeaders(json({ ok: true }), { 'set-cookie': started.cookie })
      },
    },
  },
  messages: { en: { 'error.outOfStock': 'Out of stock' }, vi: { 'error.outOfStock': 'Hết hàng' } },
})

const api = defineModule({
  name: 'shop_api',
  depends: ['shop'],
  routes: httpRoutes(
    {
      profile: 'shop',
      prefix: '/api',
      errors: { E_OUT_OF_STOCK: { status: 409, messageKey: 'error.outOfStock' } },
    },
    {
      'GET /products': { call: 'shop.listProducts', auth: 'public' },
      'GET /me/orders': { call: 'shop.myOrders', bind: { userId: 'actor' } },
      'POST /orders': {
        call: 'shop.createOrder',
        status: 201,
        idempotency: 'required',
        schemas: {
          input: {
            lines: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['sku', 'quantity'],
                properties: {
                  sku: { type: 'string', minLength: 1 },
                  quantity: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
      },
      'POST /orders/{id}/cancel': 'shop.cancelOrder',
      'GET /leaky': { call: 'shop.leaky', auth: 'public' },
      'GET /forbidden': 'shop.forbidden',
    },
  ),
  messages: { en: { 'error.outOfStock': 'Out of stock' }, vi: { 'error.outOfStock': 'Hết hàng' } },
})

const users: Record<string, string> = { 'Bearer u1': 'u1', 'Bearer u2': 'u2' }

const boot = async (records: unknown[] = []) =>
  bootDeployment(
    defineDeployment({
      name: 'binding_runtime',
      modules: [shop, api],
      headless: true,
      serve: {
        sessions: { secret: 'test' },
        resolveIdentity: async ({ req }) => {
          const userId = users[String(req.headers.authorization)]
          return userId ? { userId, companies: ['acme'], company: 'acme' } : null
        },
        permissions: async (_ctx, userId) =>
          userId === 'u1' ? ['shop.myOrders', 'shop.createOrder', 'shop.cancelOrder'] : [],
      },
    }),
    {
      env: { KET_SQLITE: ':memory:' },
      port: 0,
      log: () => {},
      openLog: () => ({
        name: 'capture',
        write: (batch) => {
          records.push(...batch)
        },
      }),
    },
  )

type Envelope = {
  error: { code: string; message: string; requestId: string; fields?: Record<string, unknown[]> }
}

const bearer = { authorization: 'Bearer u1' }
const jsonBody = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

test('binding runtime: a public GET parses the query, normalizes decimals and projects', async (t) => {
  const booted = await boot()
  t.after(() => booted.close())
  const at = `http://127.0.0.1:${booted.port}/api`

  const listed = await fetch(`${at}/products?limit=1&inStock=true`)
  assert.equal(listed.status, 200)
  assert.match(listed.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/)
  assert.deepEqual(await listed.json(), { data: [{ id: 'p1', name: 'Tea', price: '12.5' }] })

  const all = (await fetch(`${at}/products`).then((r) => r.json())) as { data: Array<{ price: string }> }
  assert.deepEqual(
    all.data.map((row) => row.price),
    ['12.5', '7.25'],
    'a decimal computed as a number reaches the client as its exact text',
  )
})

test('binding runtime: the query string is strict', async (t) => {
  const booted = await boot()
  t.after(() => booted.close())
  const at = `http://127.0.0.1:${booted.port}/api`
  const issues = async (query: string) => {
    const response = await fetch(`${at}/products?${query}`)
    assert.equal(response.status, 422, query)
    const { error } = (await response.json()) as Envelope
    assert.equal(error.code, 'E_HTTP_INVALID_REQUEST')
    return Object.fromEntries(
      Object.entries(error.fields!).map(([field, list]) => [
        field,
        (list as Array<{ code: string }>)[0]!.code,
      ]),
    )
  }
  assert.deepEqual(await issues('limit=1&limit=2'), { limit: 'repeated' })
  assert.deepEqual(await issues('page=2'), { page: 'unknown' })
  assert.deepEqual(await issues('limit=1.5'), { limit: 'type' })
  assert.deepEqual(await issues('limit=9007199254740993'), { limit: 'type' })
  assert.deepEqual(await issues('inStock=1'), { inStock: 'type' })
})

test('binding runtime: required auth answers 401 in the envelope, and bound inputs come from the identity', async (t) => {
  const booted = await boot()
  t.after(() => booted.close())
  const at = `http://127.0.0.1:${booted.port}/api`

  const stranger = await fetch(`${at}/me/orders`, { headers: { accept: 'text/html' } })
  assert.equal(stranger.status, 401, 'an API answers 401, never a sign-in redirect')
  assert.equal(((await stranger.json()) as Envelope).error.code, 'E_HTTP_UNAUTHENTICATED')

  const mine = await fetch(`${at}/me/orders?status=open`, { headers: bearer })
  assert.equal(mine.status, 200)
  assert.equal(mine.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await mine.json(), { data: [{ userId: 'u1', status: 'open' }] })

  const spoofed = await fetch(`${at}/me/orders?userId=u2`, { headers: bearer })
  assert.equal(spoofed.status, 422)
  assert.deepEqual(Object.keys(((await spoofed.json()) as Envelope).error.fields!), ['userId'])
})

test('binding runtime: a function the caller may not call is 403, decided by the runtime', async (t) => {
  const booted = await boot()
  t.after(() => booted.close())
  const at = `http://127.0.0.1:${booted.port}/api`
  const refused = await fetch(`${at}/forbidden`, { headers: bearer })
  assert.equal(refused.status, 403)
  assert.equal(((await refused.json()) as Envelope).error.code, 'E_FN_NOT_PERMITTED')
  const other = await fetch(`${at}/me/orders`, { headers: { authorization: 'Bearer u2' } })
  assert.equal(other.status, 403)
})

test('binding runtime: the JSON body is checked before the function runs', async (t) => {
  const booted = await boot()
  t.after(() => booted.close())
  const at = `http://127.0.0.1:${booted.port}/api`
  const key = { ...bearer, 'idempotency-key': 'body-checks' }
  const before = created

  const plain = await fetch(`${at}/orders`, {
    method: 'POST',
    headers: { ...key, 'content-type': 'text/plain' },
    body: '{}',
  })
  assert.equal(plain.status, 415)

  const rounded = await fetch(
    `${at}/orders`,
    jsonBody({ lines: [{ sku: 'p1', quantity: 1 }], amount: 1.1 }, key),
  )
  assert.equal(rounded.status, 422)
  const roundedFields = ((await rounded.json()) as Envelope).error.fields!
  assert.equal((roundedFields['amount']![0] as { code: string }).code, 'decimal')

  const shaped = await fetch(`${at}/orders`, jsonBody({ lines: [{ sku: 'p1', quantity: 0 }] }, key))
  assert.equal(shaped.status, 422)
  assert.deepEqual(((await shaped.json()) as Envelope).error.fields!['lines'], [
    { field: 'lines', code: 'minimum', messageKey: 'validation.minimum', params: { pointer: '/0/quantity' } },
  ])

  const missing = await fetch(`${at}/orders`, jsonBody({}, key))
  assert.equal(missing.status, 422)
  assert.equal(
    ((await missing.json()) as Envelope).error.code,
    'E_INVALID_INPUT',
    'the runtime still validates',
  )

  const pathField = await fetch(`${at}/orders/o1/cancel`, jsonBody({ id: 'o2' }, bearer))
  assert.equal(pathField.status, 422)
  assert.equal(created, before, 'no refused request reached the handler')

  const cancelled = await fetch(`${at}/orders/o1/cancel`, jsonBody({}, bearer))
  assert.equal(cancelled.status, 204)
  assert.equal(await cancelled.text(), '')
})

test('binding runtime: an idempotency key replays once and refuses a different request', async (t) => {
  const booted = await boot()
  t.after(() => booted.close())
  const at = `http://127.0.0.1:${booted.port}/api`
  const order = { lines: [{ sku: 'p1', quantity: 2 }] }

  const missing = await fetch(`${at}/orders`, jsonBody(order, bearer))
  assert.equal(missing.status, 428)

  const before = created
  const first = await fetch(`${at}/orders`, jsonBody(order, { ...bearer, 'idempotency-key': 'k-1' }))
  assert.equal(first.status, 201)
  const firstBody = await first.json()
  const again = await fetch(`${at}/orders`, jsonBody(order, { ...bearer, 'idempotency-key': 'k-1' }))
  assert.equal(again.status, 201)
  assert.deepEqual(await again.json(), firstBody)
  assert.equal(created, before + 1, 'the retry was answered from the record')

  const changed = await fetch(
    `${at}/orders`,
    jsonBody({ lines: [{ sku: 'p2', quantity: 1 }] }, { ...bearer, 'idempotency-key': 'k-1' }),
  )
  assert.equal(changed.status, 409)
  assert.equal(((await changed.json()) as Envelope).error.code, 'E_IDEMPOTENCY_CONFLICT')

  const blank = await fetch(`${at}/orders`, jsonBody(order, { ...bearer, 'idempotency-key': 'has space' }))
  assert.equal(blank.status, 422)

  const unsupported = await fetch(`${at}/products`, { headers: { 'idempotency-key': 'k-2' } })
  assert.equal(unsupported.status, 400)
  assert.equal(((await unsupported.json()) as Envelope).error.code, 'E_HTTP_IDEMPOTENCY_UNSUPPORTED')
})

test('binding runtime: errors carry a code, a safe message and a request id, never internals', async (t) => {
  const records: unknown[] = []
  const booted = await boot(records)
  t.after(() => booted.close())
  const at = `http://127.0.0.1:${booted.port}/api`
  const order = (note: string, key: string, headers: Record<string, string> = {}) =>
    fetch(
      `${at}/orders`,
      jsonBody(
        { lines: [{ sku: 'p1', quantity: 1 }], note },
        { ...bearer, 'idempotency-key': key, ...headers },
      ),
    )

  const declared = await order('out', 'e-1', { 'accept-language': 'en' })
  assert.equal(declared.status, 409)
  const body = (await declared.json()) as Envelope
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message', 'requestId'])
  assert.equal(body.error.code, 'E_OUT_OF_STOCK')
  assert.equal(body.error.message, 'Out of stock')
  assert.equal(body.error.requestId, declared.headers.get('x-request-id'))
  const translated = (await (await order('out', 'e-2', { 'accept-language': 'vi' })).json()) as Envelope
  assert.equal(translated.error.message, 'Hết hàng')

  const unmapped = await order('boom', 'e-3')
  assert.equal(unmapped.status, 500)
  const text = await unmapped.text()
  assert.deepEqual(JSON.parse(text).error.code, 'E_INTERNAL')
  for (const leak of ['E_UNMAPPED', 'internal detail', 'secret hint', 'stack'])
    assert.ok(!text.includes(leak), leak)

  const wrongMethod = await fetch(`${at}/products`, { method: 'PUT' })
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'GET')
})

test('binding runtime: output that breaks the contract is a 500 that logs where, not what', async (t) => {
  const records: unknown[] = []
  const booted = await boot(records)
  t.after(() => booted.close())
  const response = await fetch(`http://127.0.0.1:${booted.port}/api/leaky`)
  assert.equal(response.status, 500)
  const text = await response.text()
  assert.ok(!text.includes('card-4242') && !text.includes('s3cret'))
  const logged = JSON.stringify(records)
  assert.match(logged, /http_binding_output/)
  assert.match(logged, /"pointer":"\/count"/)
  assert.ok(!logged.includes('card-4242'), 'the offending value is never logged')
})

test('binding runtime: a cookie session must come from this origin; a bearer token need not', async (t) => {
  const booted = await boot()
  t.after(() => booted.close())
  const origin = `http://127.0.0.1:${booted.port}`
  const cookie = (await fetch(`${origin}/session/start`)).headers.get('set-cookie')!.split(';')[0]!
  const order = (headers: Record<string, string>, key: string) =>
    fetch(
      `${origin}/api/orders`,
      jsonBody({ lines: [{ sku: 'p1', quantity: 1 }] }, { 'idempotency-key': key, ...headers }),
    )

  const crossSite = await order({ cookie, origin: 'https://evil.example' }, 'c-1')
  assert.equal(crossSite.status, 403)
  assert.equal(((await crossSite.json()) as Envelope).error.code, 'E_HTTP_CSRF')
  assert.equal(
    (await order({ cookie }, 'c-2')).status,
    403,
    'no Origin and no Sec-Fetch-Site is not same-origin',
  )
  assert.equal((await order({ cookie, origin }, 'c-3')).status, 201)
  assert.equal((await order({ cookie, 'sec-fetch-site': 'same-origin' }, 'c-4')).status, 201)
  assert.equal((await order({ ...bearer, origin: 'https://partner.example' }, 'c-5')).status, 201)
})

test('binding runtime: a deployment with no authentication cannot boot a required binding', async () => {
  await assert.rejects(
    () =>
      bootDeployment(defineDeployment({ name: 'open', modules: [shop, api], headless: true }), {
        env: { KET_LOG: 'null', KET_SQLITE: ':memory:' },
        port: 0,
        log: () => {},
      }),
    (error: unknown) => (error as { code?: string }).code === 'E_HTTP_BINDING_AUTH_UNAVAILABLE',
  )
})
