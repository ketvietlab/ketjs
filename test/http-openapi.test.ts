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
  requestBody?: { required: boolean; content: Record<string, unknown>; 'x-max-body-bytes'?: number }
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

test('openapi: every response declares the X-Request-Id header the binding sends', () => {
  const manifest = compose([catalogue, shopApi, handwritten()], { headless: true })
  const paths = httpOpenApiDocument(manifest, options)['paths'] as Record<
    string,
    Record<string, { responses: Record<string, { headers?: Record<string, unknown> }> }>
  >
  const responses = Object.values(paths).flatMap((methods) =>
    Object.values(methods).flatMap((operation) => Object.entries(operation.responses)),
  )
  assert.ok(responses.length > 4)
  for (const [status, response] of responses)
    assert.ok(response.headers?.['X-Request-Id'], `status ${status} declares X-Request-Id`)
})

test('openapi: multipart metadata survives composition without changing JSON defaults', () => {
  const body = {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  }
  const upload = (
    bodyMediaType?: 'application/json' | 'multipart/form-data',
    maxBodyBytes?: number,
    hasBody = true,
  ) =>
    compose(
      [
        defineModule({
          name: 'uploads',
          routes: {
            '/upload': {
              anonymous: true,
              contract: {
                profile: 'shop',
                method: 'POST',
                operationId: 'shop.upload',
                auth: 'public',
                request: {
                  ...(hasBody ? { body } : {}),
                  ...(bodyMediaType ? { bodyMediaType } : {}),
                  ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
                },
                responses: { '200': { type: 'object' } },
              },
              handler: () => () => json({}),
            },
          },
        }),
      ],
      { headless: true },
    )
  const requestBody = (manifest: ReturnType<typeof compose>) =>
    (httpOpenApiDocument(manifest, options).paths as Record<string, Record<string, Operation>>)['/upload']!
      .post!.requestBody
  const legacy = requestBody(upload())
  assert.deepEqual(legacy, { required: true, content: { 'application/json': { schema: body } } })
  assert.deepEqual(requestBody(upload('application/json')), legacy)
  // The encoded request budget includes 64 KiB overhead in addition to a 5 MiB file.
  const maxBodyBytes = 5 * 1024 * 1024 + 64 * 1024
  const manifest = upload('multipart/form-data', maxBodyBytes)
  assert.equal(httpContracts(manifest, options)[0]!.contract.request!.bodyMediaType, 'multipart/form-data')
  assert.deepEqual(requestBody(manifest), {
    required: true,
    content: { 'multipart/form-data': { schema: body } },
    'x-max-body-bytes': maxBodyBytes,
  })
  for (const limit of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => requestBody(upload('multipart/form-data', limit)), { code: 'E_OPENAPI_REQUEST' })
  assert.equal(requestBody(upload('application/json', 1))!['x-max-body-bytes'], 1)
  assert.throws(() => requestBody(upload('multipart/form-data', 1024, false)), { code: 'E_OPENAPI_REQUEST' })
  assert.equal(requestBody(upload(undefined, undefined, false)), undefined)
})
