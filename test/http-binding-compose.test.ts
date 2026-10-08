import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, defineModule, diffManifests, httpRoutes, json } from '@ketvietlab/ketjs'
import type { HttpEndpoint, HttpRouteGroup, JsonSchema, KetModule, RouteEntry } from '@ketvietlab/ketjs'

/**
 * A binding publishes a server function as an HTTP operation. Composition derives
 * the contract from the function's signature, so what these tests pin is that the
 * derived contract is exact, and that every declaration it cannot honour is refused
 * at build rather than discovered by a client.
 */

const rows = () => []

const catalogue = defineModule({
  name: 'catalogue',
  models: {
    Product: { scope: 'shared', fields: { id: 'id', name: 'text', price: 'decimal' } },
  },
  functions: {
    getProduct: {
      anonymous: true,
      input: { id: 'id' },
      output: { id: 'id', name: 'text', price: 'decimal', note: 'text?' },
      returns: 'one',
      effects: ['read:catalogue.Product'],
      handler: rows,
    },
    listProducts: {
      anonymous: true,
      input: { search: 'text?', limit: 'int?' },
      output: { id: 'id', name: 'text' },
      returns: 'many',
      effects: ['read:catalogue.Product'],
      handler: rows,
    },
    createProduct: {
      input: { name: 'text', price: 'decimal', tags: 'json?', ownerId: 'text?' },
      output: { id: 'id' },
      returns: 'one',
      idempotent: true,
      effects: ['write:catalogue.Product'],
      handler: rows,
    },
    renameProduct: {
      input: { id: 'id', name: 'text' },
      output: { id: 'id' },
      returns: 'one',
      effects: ['write:catalogue.Product'],
      handler: rows,
    },
    removeProduct: {
      input: { id: 'id' },
      returns: 'none',
      effects: ['write:catalogue.Product'],
      handler: rows,
    },
    unbounded: { anonymous: true, input: {}, effects: [], handler: rows },
    uncounted: { anonymous: true, input: {}, output: { id: 'id' }, effects: [], handler: rows },
    search: {
      anonymous: true,
      input: { criteria: 'json' },
      output: { id: 'id' },
      returns: 'many',
      effects: [],
      handler: rows,
    },
  },
})

const api = (endpoints: Record<string, HttpEndpoint>, group: Partial<HttpRouteGroup> = {}, extra = {}) =>
  defineModule({
    name: 'shop_api',
    depends: ['catalogue'],
    routes: httpRoutes({ profile: 'shop', prefix: '/api', ...group }, endpoints),
    messages: { en: { 'error.outOfStock': 'Out of stock' } },
    ...extra,
  })

const build = (...modules: KetModule[]) => compose([catalogue, ...modules], { headless: true })

const refused = (run: () => unknown): string[] => {
  try {
    run()
  } catch (error) {
    const items = (error as { items?: Array<{ code: string }> }).items
    if (items) return items.map((item) => item.code)
    return [(error as { code: string }).code]
  }
  assert.fail('expected composition to refuse')
}

const DECIMAL = { type: 'string', pattern: '^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)$', maxLength: 4096 }

test('binding: a shorthand GET derives params, response and statuses from the function alone', () => {
  const manifest = build(api({ 'GET /products/{id}': 'catalogue.getProduct' }, { auth: 'public' }))
  const route = manifest.routes['/api/products/{id}']!
  assert.equal(route.anonymous, true, 'the route enforces auth itself, so the framework gate stays open')
  assert.deepEqual(route.binding!.inputs, {
    id: { from: 'path', placeholder: 'id', type: 'id', schema: { type: 'string' } },
  })
  const contract = route.contract!
  assert.equal(contract.operationId, 'shop.catalogue.getProduct')
  assert.equal(contract.method, 'GET')
  assert.equal(contract.auth, 'public')
  assert.deepEqual(contract.request, {
    params: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  })
  assert.deepEqual(contract.responses['200'], {
    type: 'object',
    additionalProperties: false,
    properties: {
      data: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          price: DECIMAL,
          note: { type: ['string', 'null'] },
        },
        required: ['id', 'name', 'price'],
      },
    },
    required: ['data'],
  })
  assert.deepEqual(Object.keys(contract.responses), ['200', '400', '403', '404', '422', '500'])
  assert.equal(contract.idempotent, undefined)
  for (const status of ['403', '500']) assert.deepEqual(contract.responses[status]!['required'], ['error'])
})

test('binding: many is a list, query inputs keep their types, and none answers 204', () => {
  const manifest = build(
    api({
      'GET /products': { call: 'catalogue.listProducts', auth: 'public' },
      'DELETE /products/{id}': 'catalogue.removeProduct',
    }),
  )
  const list = manifest.routes['/api/products']!.contract!
  assert.deepEqual(list.request!.query, {
    type: 'object',
    additionalProperties: false,
    properties: { search: { type: 'string' }, limit: { type: 'integer' } },
  })
  assert.equal(
    (list.responses['200']!['properties'] as Record<string, { type: string }>)['data']!.type,
    'array',
  )

  const removal = manifest.routes['/api/products/{id}']!
  assert.equal(removal.binding!.status, 204)
  assert.equal(removal.binding!.result, null)
  assert.deepEqual(removal.contract!.responses['204'], {})
  assert.ok(removal.contract!.responses['401'], 'a required route can answer 401')
  assert.equal(removal.contract!.responses['413'], undefined, 'DELETE carries no body')
})

test('binding: a POST reads the body, defaults an idempotent function to an optional key', () => {
  const manifest = build(
    api({
      'POST /products': {
        call: 'catalogue.createProduct',
        status: 201,
        bind: { ownerId: 'actor' },
        schemas: { input: { tags: { type: 'array', items: { type: 'string', minLength: 1 } } } },
      },
    }),
  )
  const route = manifest.routes['/api/products']!
  assert.equal(route.binding!.idempotency, 'optional')
  assert.equal(route.binding!.inputs['ownerId']!.from, 'identity')
  const contract = route.contract!
  assert.equal(contract.idempotent, true)
  assert.deepEqual(contract.request!.body, {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      price: DECIMAL,
      tags: { type: ['array', 'null'], items: { type: 'string', minLength: 1 } },
    },
    required: ['name', 'price'],
  })
  assert.deepEqual((contract.request!.headers!['properties'] as Record<string, unknown>)['Idempotency-Key'], {
    type: 'string',
    minLength: 1,
    maxLength: 255,
    pattern: '^[\\x21-\\x7E]+$',
  })
  assert.deepEqual(contract.request!.headers!['required'], undefined, 'optional unless required')
  assert.deepEqual(Object.keys(contract.responses), [
    '201',
    '401',
    '403',
    '404',
    '409',
    '413',
    '415',
    '422',
    '500',
  ])
})

test('binding: a function that does not say what it returns is refused, not guessed', () => {
  assert.deepEqual(
    refused(() => build(api({ 'GET /unbounded': { call: 'catalogue.unbounded', auth: 'public' } }))),
    ['E_HTTP_BINDING_RETURNS'],
  )
  assert.deepEqual(
    refused(() => build(api({ 'GET /uncounted': { call: 'catalogue.uncounted', auth: 'public' } }))),
    ['E_HTTP_BINDING_RETURNS'],
  )
  // The binding may supply what the function left out, but never contradict it.
  const manifest = build(
    api({ 'GET /uncounted': { call: 'catalogue.uncounted', auth: 'public', returns: 'many' } }),
  )
  assert.equal(manifest.routes['/api/uncounted']!.binding!.returns, 'many')
  assert.deepEqual(
    refused(() =>
      build(api({ 'GET /products': { call: 'catalogue.listProducts', auth: 'public', returns: 'one' } })),
    ),
    ['E_HTTP_BINDING_RETURNS'],
  )
})

test('binding: what a request cannot honestly carry is refused at composition', () => {
  const cases: Array<[Record<string, HttpEndpoint>, string]> = [
    [{ 'GET /search': { call: 'catalogue.search', auth: 'public' } }, 'E_HTTP_BINDING_QUERY_TYPE'],
    [{ 'POST /products': { call: 'catalogue.createProduct', auth: 'public' } }, 'E_HTTP_BINDING_PUBLIC'],
    [{ 'GET /products/{id}/remove': 'catalogue.removeProduct' }, 'E_HTTP_BINDING_GET_MUTATES'],
    [
      { 'GET /products/{id}': { call: 'catalogue.getProduct', auth: 'public', bind: { id: 'actor' } } },
      'E_HTTP_BINDING_BIND',
    ],
    [
      { 'POST /products/{id}/rename': { call: 'catalogue.renameProduct', idempotency: 'required' } },
      'E_HTTP_BINDING_IDEMPOTENCY',
    ],
    [{ 'GET /items/{slug}': { call: 'catalogue.getProduct', auth: 'public' } }, 'E_HTTP_BINDING_PARAM'],
    [{ 'GET /missing': 'catalogue.nothing' }, 'E_HTTP_BINDING_FUNCTION'],
    [
      { 'GET /products/{id}': { call: 'catalogue.getProduct', auth: 'public', operationId: 'other.get' } },
      'E_HTTP_OPERATION_ID',
    ],
  ]
  for (const [endpoints, code] of cases)
    assert.deepEqual(
      refused(() => build(api(endpoints))),
      [code],
      code,
    )
})

test('binding: params rename a placeholder, and a bound input never appears in the request', () => {
  const manifest = build(
    api({
      'POST /products/{productId}/rename': { call: 'catalogue.renameProduct', params: { id: 'productId' } },
    }),
  )
  const contract = manifest.routes['/api/products/{productId}/rename']!.contract!
  assert.deepEqual(Object.keys(contract.request!.params!['properties'] as object), ['productId'])
  assert.deepEqual(Object.keys(contract.request!.body!['properties'] as object), ['name'])
})

test('binding: a schema may narrow a scalar or describe json, and nothing else', () => {
  const narrowed = build(
    api({
      'GET /products': {
        call: 'catalogue.listProducts',
        auth: 'public',
        schemas: { input: { limit: { minimum: 1, maximum: 100, description: 'Page size.' } } },
      },
    }),
  )
  assert.deepEqual(narrowed.routes['/api/products']!.binding!.inputs['limit'], {
    from: 'query',
    type: 'int?',
    schema: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size.' },
  })

  const bad: Array<{ input?: Record<string, JsonSchema>; output?: Record<string, JsonSchema> }> = [
    { input: { limit: { type: 'string' } } },
    { input: { limit: { enum: [1, 'two'] } } },
    { input: { limit: { examples: [0], minimum: 1 } } },
    { input: { tags: { $ref: '#/x' } } },
    { input: { tags: { oneOf: [] } } },
    { input: { tags: { type: 'string' } } },
    { input: { ownerId: { minLength: 1 } } },
    { input: { nope: {} } },
    { output: { nope: {} } },
  ]
  for (const schemas of bad) {
    const endpoint: Record<string, HttpEndpoint> =
      schemas.input && 'limit' in schemas.input
        ? { 'GET /products': { call: 'catalogue.listProducts', auth: 'public', schemas } }
        : { 'POST /products': { call: 'catalogue.createProduct', bind: { ownerId: 'actor' }, schemas } }
    assert.deepEqual(
      refused(() => build(api(endpoint))),
      ['E_HTTP_BINDING_SCHEMA'],
      JSON.stringify(schemas),
    )
  }
})

test('binding: operation ids are unique per profile across bindings and handwritten contracts', () => {
  assert.deepEqual(
    refused(() =>
      build(
        api({
          'GET /products/{id}': { call: 'catalogue.getProduct', auth: 'public' },
          'GET /items/{id}': { call: 'catalogue.getProduct', auth: 'public' },
        }),
      ),
    ),
    ['E_HTTP_OPERATION_DUPLICATE'],
  )
  const handwritten = defineModule({
    name: 'legacy_api',
    routes: {
      '/legacy': {
        anonymous: true,
        contract: { profile: 'shop', method: 'GET', operationId: 'shop.catalogue.getProduct', responses: {} },
        handler: () => () => json({}),
      },
    },
  })
  assert.deepEqual(
    refused(() =>
      build(api({ 'GET /products/{id}': { call: 'catalogue.getProduct', auth: 'public' } }), handwritten),
    ),
    ['E_HTTP_OPERATION_DUPLICATE'],
  )
  // A distinct id resolves it.
  const manifest = build(
    api({
      'GET /products/{id}': { call: 'catalogue.getProduct', auth: 'public' },
      'GET /items/{id}': { call: 'catalogue.getProduct', auth: 'public', operationId: 'shop.items.get' },
    }),
  )
  assert.equal(manifest.routes['/api/items/{id}']!.contract!.operationId, 'shop.items.get')
})

test('binding: business errors map to 4xx statuses with module-local messages', () => {
  const manifest = build(
    api(
      { 'POST /products': { call: 'catalogue.createProduct', errors: { E_DUPLICATE_SKU: 409 } } },
      { errors: { E_OUT_OF_STOCK: { status: 409, messageKey: 'error.outOfStock' } } },
    ),
  )
  assert.deepEqual(manifest.routes['/api/products']!.binding!.errors, {
    E_OUT_OF_STOCK: { status: 409, messageKey: 'shop_api.error.outOfStock' },
    E_DUPLICATE_SKU: { status: 409, messageKey: null },
  })
  const invalid: Array<Record<string, number | { status: number; messageKey?: string }>> = [
    { E_FN_NOT_PERMITTED: 404 },
    { E_HTTP_CSRF: 400 },
    { E_OUTPUT_NOT_SHAPED: 409 },
    { E_FINE: 500 },
    { E_FINE: { status: 409, messageKey: 'error.missing' } },
  ]
  for (const errors of invalid)
    assert.deepEqual(
      refused(() => build(api({ 'POST /products': { call: 'catalogue.createProduct', errors } }))),
      ['E_HTTP_BINDING_ERROR'],
      JSON.stringify(errors),
    )
})

test('binding: httpRoutes refuses what the declaration alone shows is wrong', () => {
  const codeOf = (run: () => unknown) => refused(run)[0]
  assert.equal(
    codeOf(() =>
      httpRoutes({ profile: 'shop' }, { 'GET /products/{id}': 'a.b', 'DELETE /products/{id}': 'a.c' }),
    ),
    'E_HTTP_BINDING_METHOD_CONFLICT',
  )
  assert.equal(
    codeOf(() => httpRoutes({ profile: 'shop' }, { '/products': 'a.b' })),
    'E_HTTP_BINDING_KEY',
  )
  assert.equal(
    codeOf(() => httpRoutes({ profile: 'shop' }, { 'HEAD /products': 'a.b' })),
    'E_HTTP_BINDING_METHOD',
  )
  assert.equal(
    codeOf(() => httpRoutes({ profile: 'Shop API' }, {})),
    'E_HTTP_BINDING_PROFILE',
  )
})

test('binding: a route carrying a binding httpRoutes() did not make is forged', () => {
  const real = httpRoutes(
    { profile: 'shop' },
    { 'GET /products/{id}': { call: 'catalogue.getProduct', auth: 'public' } },
  )
  const entry = real['/products/{id}'] as Exclude<RouteEntry, (...args: never[]) => unknown>
  const forge = (routes: Record<string, RouteEntry>) =>
    refused(() => build(defineModule({ name: 'forger', depends: ['catalogue'], routes })))
  // A plain handler cannot borrow a binding's contract.
  assert.deepEqual(forge({ '/products/{id}': { ...entry, handler: () => () => json({}) } }), [
    'E_HTTP_BINDING_FORGED',
  ])
  // A binding derives its contract; it cannot also declare one.
  assert.deepEqual(
    forge({
      '/products/{id}': {
        ...entry,
        contract: { profile: 'shop', method: 'GET', operationId: 'shop.x', responses: {} },
      },
    }),
    ['E_HTTP_BINDING_FORGED'],
  )
  // A binding handler moved to another path serves the wrong operation.
  assert.deepEqual(forge({ '/elsewhere/{id}': entry }), ['E_HTTP_BINDING_FORGED'])
})

test('binding: prefix ownership applies to bindings exactly as to handwritten routes', () => {
  const owner = defineModule({ name: 'gateway', reserves: ['/api/'] })
  assert.deepEqual(
    refused(() =>
      build(owner, api({ 'GET /products/{id}': { call: 'catalogue.getProduct', auth: 'public' } })),
    ),
    ['E_ROUTE_RESERVED'],
  )
  const contributed = build(
    owner,
    api(
      { 'GET /products/{id}': { call: 'catalogue.getProduct', auth: 'public' } },
      { through: 'gateway' },
      { depends: ['catalogue', 'gateway'] },
    ),
  )
  assert.equal(contributed.routes['/api/products/{id}']!.through, 'gateway')
})

test('binding: a function must depend on the module it publishes', () => {
  const stranger = defineModule({
    name: 'stranger_api',
    routes: httpRoutes(
      { profile: 'shop' },
      { 'GET /products/{id}': { call: 'catalogue.getProduct', auth: 'public' } },
    ),
  })
  assert.deepEqual(
    refused(() => build(stranger)),
    ['E_HTTP_BINDING_DEPENDENCY'],
  )
})

test('returns: recorded only when declared, validated, and a change is breaking', () => {
  const manifest = build()
  assert.equal(manifest.functions['catalogue.getProduct']!.returns, 'one')
  assert.equal(
    'returns' in manifest.functions['catalogue.uncounted']!,
    false,
    'an undeclared returns adds no key',
  )

  const declaring = (returns: unknown, output: Record<string, string> = { id: 'id' }) =>
    defineModule({
      name: 'counted',
      functions: { f: { input: {}, output, returns: returns as 'one', effects: [], handler: rows } },
    })
  assert.deepEqual(
    refused(() => build(declaring('some'))),
    ['E_FUNCTION_RETURNS'],
  )
  assert.deepEqual(
    refused(() => build(declaring('none'))),
    ['E_FUNCTION_RETURNS'],
  )

  const before = build(declaring('one'))
  const after = build(declaring('many'))
  assert.deepEqual(
    diffManifests(before, after)
      .filter((item) => item.code === 'RETURNS_CHANGED')
      .map((item) => item.severity),
    ['breaking'],
  )
  assert.deepEqual(
    diffManifests(build(declaring(undefined)), before).filter((item) => item.code === 'RETURNS_CHANGED'),
    [],
    'declaring returns for the first time breaks nobody',
  )
})
