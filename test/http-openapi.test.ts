import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compose,
  defineModule,
  httpContracts,
  httpOpenApiDocument,
  httpRoutes,
  json,
} from '@ketvietlab/ketjs'

/**
 * The document is generated from the composed manifest, so it holds exactly the
 * operations that shipped. These tests pin the mapping, the security rules and the
 * determinism a committed, diffed document depends on.
 */

const rows = () => []

const catalogue = defineModule({
  name: 'catalogue',
  models: { Product: { scope: 'shared', fields: { id: 'id', name: 'text' } } },
  functions: {
    listProducts: {
      anonymous: true,
      input: { search: 'text?' },
      output: { id: 'id', name: 'text' },
      returns: 'many',
      effects: ['read:catalogue.Product'],
      handler: rows,
    },
    createProduct: {
      input: { name: 'text' },
      output: { id: 'id' },
      returns: 'one',
      idempotent: true,
      effects: ['write:catalogue.Product'],
      handler: rows,
    },
    removeProduct: {
      input: { id: 'id' },
      returns: 'none',
      effects: ['write:catalogue.Product'],
      handler: rows,
    },
  },
})

const shopApi = defineModule({
  name: 'shop_api',
  depends: ['catalogue'],
  routes: httpRoutes(
    { profile: 'shop', prefix: '/api' },
    {
      'GET /products': { call: 'catalogue.listProducts', auth: 'public', summary: 'List products.' },
      'POST /products/new': { call: 'catalogue.createProduct', status: 201, idempotency: 'required' },
      'DELETE /products/{id}': 'catalogue.removeProduct',
    },
  ),
})

const handwritten = (credentials?: string[]) =>
  defineModule({
    name: 'legacy_api',
    routes: {
      '/api/legacy': {
        anonymous: true,
        contract: {
          profile: 'shop',
          method: 'GET',
          operationId: 'shop.legacy',
          auth: 'partner',
          ...(credentials ? { credentials } : {}),
          request: { query: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
          responses: { '200': { type: 'object' } },
        },
        handler: () => () => json({}),
      },
      '/internal/ping': {
        anonymous: true,
        contract: {
          profile: 'internal',
          method: 'GET',
          operationId: 'internal.ping',
          responses: { '200': {} },
        },
        handler: () => () => json({}),
      },
    },
  })

const options = {
  profile: 'shop',
  info: { title: 'Shop API', version: '1.0.0' },
  servers: [{ url: 'https://shop.example.com' }],
  securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer' },
    partnerKey: { type: 'apiKey', in: 'header', name: 'X-Partner-Key' },
  },
  security: [{ bearerAuth: [] }],
}

type Operation = {
  operationId: string
  parameters?: Array<{ name: string; in: string; required: boolean }>
  requestBody?: { required: boolean; content: Record<string, unknown> }
  responses: Record<string, { content?: Record<string, unknown> }>
  security: unknown[]
}

test('openapi: contracts are selected by profile and sorted by path', () => {
  const manifest = compose([catalogue, shopApi, handwritten()], { headless: true })
  assert.deepEqual(
    httpContracts(manifest, { profile: 'shop' }).map((entry) => [entry.path, entry.contract.operationId]),
    [
      ['/api/legacy', 'shop.legacy'],
      ['/api/products', 'shop.catalogue.listProducts'],
      ['/api/products/new', 'shop.catalogue.createProduct'],
      ['/api/products/{id}', 'shop.catalogue.removeProduct'],
    ],
  )
})

test('openapi: a 3.1 document maps parameters, bodies, statuses and security', () => {
  const manifest = compose([catalogue, shopApi, handwritten(['partnerKey'])], { headless: true })
  const document = httpOpenApiDocument(manifest, options)
  assert.equal(document['openapi'], '3.1.0')
  assert.deepEqual(document['servers'], options.servers)
  assert.deepEqual(document['components'], { securitySchemes: options.securitySchemes })
  const paths = document['paths'] as Record<string, Record<string, Operation>>
  assert.deepEqual(Object.keys(paths), [
    '/api/legacy',
    '/api/products',
    '/api/products/new',
    '/api/products/{id}',
  ])
  assert.equal(paths['/internal/ping'], undefined, 'another profile stays out')

  const list = paths['/api/products']!['get']!
  assert.equal((list as Operation & { summary: string }).summary, 'List products.')
  assert.deepEqual(list.security, [], 'a public operation needs no credential')
  assert.deepEqual(list.parameters, [
    { name: 'search', in: 'query', required: false, schema: { type: 'string' } },
  ])

  const create = paths['/api/products/new']!['post']!
  assert.deepEqual(create.security, [{ bearerAuth: [] }])
  assert.deepEqual(
    create.parameters!.map((p) => [p.name, p.in, p.required]),
    [['Idempotency-Key', 'header', true]],
  )
  assert.equal(create.requestBody!.required, true)
  assert.ok(create.requestBody!.content['application/json'])
  assert.deepEqual(Object.keys(create.responses), [
    '201',
    '401',
    '403',
    '404',
    '409',
    '413',
    '415',
    '422',
    '428',
    '500',
  ])

  const removal = paths['/api/products/{id}']!['delete']!
  assert.deepEqual(
    removal.parameters!.map((p) => [p.name, p.in, p.required]),
    [['id', 'path', true]],
  )
  assert.equal(removal.responses['204']!.content, undefined, '204 has no body')

  const legacy = paths['/api/legacy']!['get']!
  assert.deepEqual(legacy.security, [{ bearerAuth: [] }, { partnerKey: [] }])
  assert.deepEqual(
    legacy.parameters!.map((p) => [p.name, p.in, p.required]),
    [['q', 'query', true]],
  )
})

test('openapi: the same manifest always yields the same document, and it is a copy', () => {
  const manifest = compose([catalogue, shopApi], { headless: true })
  const first = httpOpenApiDocument(manifest, options)
  assert.equal(JSON.stringify(first), JSON.stringify(httpOpenApiDocument(manifest, options)))
  const paths = first['paths'] as Record<string, Record<string, Operation>>
  paths['/api/products']!['get']!.operationId = 'edited'
  assert.equal(manifest.routes['/api/products']!.contract!.operationId, 'shop.catalogue.listProducts')
})

test('openapi: security that cannot be honoured is refused rather than omitted', () => {
  const manifest = compose([catalogue, shopApi, handwritten(['partnerKey'])], { headless: true })
  const code = (run: () => unknown) => {
    try {
      run()
    } catch (error) {
      return (error as { code: string }).code
    }
    return null
  }
  assert.equal(
    code(() => httpOpenApiDocument(manifest, { ...options, security: undefined })),
    'E_OPENAPI_SECURITY',
  )
  assert.equal(
    code(() => httpOpenApiDocument(manifest, { ...options, security: [{ missing: [] }] })),
    'E_OPENAPI_SECURITY',
  )
  assert.equal(
    code(() =>
      httpOpenApiDocument(manifest, { ...options, securitySchemes: { bearerAuth: { type: 'http' } } }),
    ),
    'E_OPENAPI_SECURITY',
    'a documented credential needs its scheme',
  )
  // A profile of public operations needs no security at all.
  const publicOnly = compose(
    [
      catalogue,
      defineModule({
        name: 'public_api',
        depends: ['catalogue'],
        routes: httpRoutes(
          { profile: 'public', auth: 'public' },
          { 'GET /products': 'catalogue.listProducts' },
        ),
      }),
    ],
    { headless: true },
  )
  assert.equal(
    code(() => httpOpenApiDocument(publicOnly, { profile: 'public', info: options.info })),
    null,
  )
})
