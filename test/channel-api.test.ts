import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, defineModule, text } from '@ketvietlab/ketjs'
import { channelCommandId, defineChannelRoute, openApiDocument } from '@ketvietlab/ketsuite'
import type { PosIdentity } from '@ketvietlab/ketsuite'
import { ketsuite } from '@ketvietlab/ketsuite/deployment'
import { migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'

const route = () => () => async () => text('ok')

test('channel api: reserved prefixes reject bypasses and accept published contributions', () => {
  const owner = defineModule({ name: 'channel_api', version: '1.0.0', reserves: ['/api/customer/v1/'] })
  const bypass = defineModule({
    name: 'bypass',
    routes: { '/api/customer/v1/orders': route() },
  })
  assert.throws(() => compose([owner, bypass]), /inside the prefix reserved by "channel_api"/)

  const extension = defineModule({
    name: 'extension',
    depends: ['channel_api'],
    compatible: { channel_api: '^1' },
    routes: {
      '/api/customer/v1/orders': {
        through: 'channel_api',
        anonymous: true,
        handler: route(),
      },
    },
  })
  const manifest = compose([owner, extension])
  assert.equal(manifest.routes['/api/customer/v1/orders']?.through, 'channel_api')
  assert.equal(manifest.routes['/api/customer/v1/orders']?.by, 'extension')
})

test('channel api: extension version skew fails at compose time', () => {
  const owner = defineModule({ name: 'channel_api', version: '2.0.0' })
  const extension = defineModule({
    name: 'private_extension',
    depends: ['channel_api'],
    compatible: { channel_api: '^1' },
  })
  assert.throws(() => compose([owner, extension]), /requires "channel_api" \^1/)
})

test('channel api: OpenAPI is generated from composed route contracts', () => {
  const manifest = compose(ketsuite.modules, { headless: true })
  const document = openApiDocument(manifest, 'customer')
  assert.equal(document.openapi, '3.1.0')
  assert.ok(document.paths['/bootstrap'])
  assert.ok(document.paths['/hospitality/bookings'])
  const booking = document.paths['/hospitality/bookings']?.post as Record<string, unknown>
  assert.equal(booking.operationId, 'customer.hospitality.bookings.create')
  assert.equal(booking['x-ket-auth'], 'customer')
  assert.deepEqual(booking.security, [{ bearer: [] }, { customerCookie: [] }])
  assert.deepEqual(booking['x-ket-capability'], {
    key: 'website_hospitality.bookings',
    action: 'create',
  })
})

test('channel api: the staff document names both credential presentations', () => {
  const document = openApiDocument(compose(ketsuite.modules, { headless: true }), 'staff')
  assert.deepEqual(document.components.securitySchemes, {
    staffBearer: { type: 'http', scheme: 'bearer' },
    staffCookie: { type: 'apiKey', in: 'cookie', name: 'ket_session' },
  })
  const orders = document.paths['/sales/orders']?.get as Record<string, unknown>
  assert.deepEqual(orders.security, [{ staffBearer: [] }, { staffCookie: [] }])
  assert.deepEqual(orders['x-ket-capability'], { key: 'sales.orders', action: 'read' })
  for (const [path, entry] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(entry as Record<string, { security?: unknown[] }>))
      assert.ok(operation.security?.length, `${method} ${path} publishes no credential`)
})

test('channel api: core and attendance staff responses publish concrete client models', () => {
  const document = openApiDocument(compose(ketsuite.modules, { headless: true }), 'staff')
  const dataSchema = (path: string, method: 'get' | 'post', status: string) => {
    const operation = document.paths[path]?.[method] as Record<string, unknown>
    const responses = operation.responses as Record<string, Record<string, unknown>>
    const content = responses[status]?.content as Record<string, Record<string, unknown>>
    const envelope = content['application/json']?.schema as Record<string, unknown>
    return (envelope.properties as Record<string, unknown>).data as Record<string, unknown>
  }

  for (const [path, method, status] of [
    ['/bootstrap', 'get', '200'],
    ['/me', 'get', '200'],
    ['/attendance/status', 'get', '200'],
    ['/attendance/records', 'get', '200'],
    ['/attendance/check-in', 'post', '201'],
    ['/attendance/check-out', 'post', '201'],
  ] as const) {
    const schema = dataSchema(path, method, status)
    assert.notDeepEqual(schema, {}, `${method.toUpperCase()} ${path} has an untyped success response`)
    assert.ok(schema.type, `${method.toUpperCase()} ${path} has no concrete data type`)
  }

  assert.deepEqual(dataSchema('/attendance/status', 'get', '200').required, ['onClock'])
  assert.equal(dataSchema('/attendance/records', 'get', '200').type, 'array')
  assert.deepEqual(dataSchema('/attendance/check-in', 'post', '201').required, [
    'kind',
    'occurredAt',
    'sessionId',
  ])
})

test('channel api: warehouse completion and hospitality responses publish concrete client models', () => {
  const document = openApiDocument(compose(ketsuite.modules, { headless: true }), 'staff')
  const cases = [
    ['/warehouse/pickings/{id}/complete', 'post'],
    ['/hospitality/context', 'get'],
    ['/hospitality/front-desk/today', 'get'],
    ['/hospitality/reservations/{id}', 'get'],
    ['/hospitality/stays/{id}', 'get'],
    ['/hospitality/folios/{id}', 'get'],
    ['/hospitality/operations/context', 'get'],
  ] as const

  for (const [path, method] of cases) {
    const operation = document.paths[path]?.[method] as Record<string, unknown>
    const responses = operation.responses as Record<string, Record<string, unknown>>
    const content = responses['200']?.content as Record<string, Record<string, unknown>>
    const envelope = content['application/json']?.schema as Record<string, unknown>
    const data = (envelope.properties as Record<string, unknown>).data as Record<string, unknown>
    assert.equal(data.type, 'object', `${method.toUpperCase()} ${path} has no object data model`)
    assert.ok(data.properties, `${method.toUpperCase()} ${path} has no typed properties`)
  }
})

test('channel api: POS routes publish Bearer auth and receive server-resolved device scope', () => {
  const owner = defineModule({
    name: 'channel_api',
    version: '1.0.0',
    reserves: ['/api/pos/v1/'],
  })
  const pos = defineModule({
    name: 'pos_contract_probe',
    depends: ['channel_api'],
    compatible: { channel_api: '^1' },
    routes: Object.fromEntries([
      defineChannelRoute({
        profile: 'pos',
        method: 'GET',
        path: 'me',
        operationId: 'pos.me',
        auth: 'required',
        responses: { '200': { type: 'object' } },
        handler: (_ctx, _url, _req, _params, request) => ({
          data: {
            deviceId: request.identity!.deviceId,
            companyId: request.identity!.companyId,
            posConfigId: request.identity!.posConfigId,
          },
        }),
      }),
    ]),
  })

  const document = openApiDocument(compose([owner, pos]), 'pos')
  assert.deepEqual(document.components.securitySchemes, {
    posBearer: { type: 'http', scheme: 'bearer' },
    operatorBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  })
  assert.deepEqual((document.paths['/me']!.get as Record<string, unknown>).security, [{ posBearer: [] }])
})

test('channel api: a POS enrollment route can publish the upstream operator credential', () => {
  const owner = defineModule({ name: 'channel_api', version: '1.0.0', reserves: ['/api/pos/v1/'] })
  const enrollment = defineModule({
    name: 'pos_enrollment_probe',
    depends: ['channel_api'],
    compatible: { channel_api: '^1' },
    routes: Object.fromEntries([
      defineChannelRoute({
        profile: 'pos',
        method: 'POST',
        path: 'devices',
        operationId: 'pos.devices.activate',
        auth: 'public',
        credentials: ['operatorBearer'],
        responses: { '200': { type: 'object' } },
        handler: () => ({ data: {} }),
      }),
    ]),
  })
  const operation = openApiDocument(compose([owner, enrollment]), 'pos').paths['/devices']?.post as Record<
    string,
    unknown
  >
  assert.deepEqual(operation.security, [{ operatorBearer: [] }])
})

test('idempotency: a POS command key is scoped by company, configuration and device', () => {
  const identity: PosIdentity = {
    operatorId: 'user-1',
    deviceId: 'device-1',
    companyId: 'company-1',
    posConfigId: 'config-1',
    grantId: 'grant-1',
    sessionId: 'session-1',
    securityVersion: 1,
    presentation: 'bearer',
  }
  const first = channelCommandId('pos', identity, 'command-1')
  assert.equal(first, channelCommandId('pos', identity, 'command-1'))
  assert.notEqual(first, channelCommandId('pos', { ...identity, deviceId: 'device-2' }, 'command-1'))
  assert.notEqual(first, channelCommandId('pos', { ...identity, posConfigId: 'config-2' }, 'command-1'))
  assert.notEqual(first, channelCommandId('pos', { ...identity, companyId: 'company-2' }, 'command-1'))
})

test('idempotency: the same caller key with a different body is a conflict', async () => {
  const command = defineModule({
    name: 'command',
    models: { Entry: { scope: 'shared', fields: { id: 'id', value: 'text' } } },
    functions: {
      save: {
        input: { id: 'id', value: 'text' },
        output: { id: 'id', value: 'text' },
        effects: ['write:command.Entry'],
        idempotent: true,
        handler: async (ctx, args) => {
          await ctx.db.insert('command.Entry', args)
          return args
        },
      },
    },
  })
  const manifest = compose([command])
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions([command])
  try {
    await callFn(
      'command.save',
      { id: 'a', value: 'first' },
      {
        adapter: db,
        manifest,
        idempotencyKey: 'request-1',
        idempotencyNamespace: 'customer:realm:account',
      },
    )
    await assert.rejects(
      () =>
        callFn(
          'command.save',
          { id: 'b', value: 'second' },
          {
            adapter: db,
            manifest,
            idempotencyKey: 'request-1',
            idempotencyNamespace: 'customer:realm:account',
          },
        ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'E_IDEMPOTENCY_CONFLICT')
        return true
      },
    )
  } finally {
    await db.close()
  }
})
