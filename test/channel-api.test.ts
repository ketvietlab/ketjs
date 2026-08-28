import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, defineModule, text, type Row } from '@ketvietlab/ketjs'
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

test('channel api: POS publishes revisioned shift and cart commands', () => {
  const document = openApiDocument(compose(ketsuite.modules, { headless: true }), 'pos')
  const expected = [
    ['/shifts', 'post', 'pos.shifts.create'],
    ['/shifts/{id}', 'get', 'pos.shifts.get'],
    ['/shifts/{id}/open', 'post', 'pos.shifts.open'],
    ['/shifts/{id}/cash-movements', 'post', 'pos.shifts.cashMovements.create'],
    ['/shifts/{id}/cash-movements/{movementId}/reverse', 'post', 'pos.shifts.cashMovements.reverse'],
    ['/shifts/{id}/variance/recount', 'post', 'pos.shifts.variance.recount'],
    ['/shifts/{id}/variance/approve', 'post', 'pos.shifts.variance.approve'],
    ['/orders', 'post', 'pos.orders.create'],
    ['/orders/{id}/detail', 'get', 'pos.orders.get'],
    ['/orders/{id}/return-eligibility', 'get', 'pos.orders.returnEligibility'],
    ['/orders/{id}/returns', 'post', 'pos.orders.returns.create'],
    ['/orders/{id}/lines', 'post', 'pos.orders.lines.add'],
    ['/orders/{id}/lines/{lineId}/update', 'patch', 'pos.orders.lines.update'],
    ['/orders/{id}/lines/{lineId}/lot-availability', 'get', 'pos.orders.lines.lotAvailability'],
    ['/orders/{id}/lines/{lineId}/lot-selections', 'put', 'pos.orders.lines.lots.select'],
    ['/orders/{id}/lines/{lineId}/discount', 'post', 'pos.orders.lines.discount'],
    ['/orders/{id}/lines/{lineId}/price-override', 'post', 'pos.orders.lines.priceOverride'],
    ['/orders/{id}/lines/{lineId}/remove', 'delete', 'pos.orders.lines.remove'],
    ['/orders/{id}/tenders', 'post', 'pos.orders.tenders.add'],
    ['/orders/{id}/tenders/{tenderId}/void', 'post', 'pos.orders.tenders.void'],
    ['/orders/{id}/loyalty', 'get', 'pos.orders.loyalty.evaluate'],
    ['/orders/{id}/loyalty/codes', 'post', 'pos.orders.loyalty.codes.apply'],
    ['/orders/{id}/loyalty/rewards', 'post', 'pos.orders.loyalty.rewards.apply'],
    ['/orders/{id}/loyalty/rewards/{programId}', 'delete', 'pos.orders.loyalty.rewards.remove'],
    ['/orders/{id}/finalize', 'post', 'pos.orders.finalize'],
  ] as const
  for (const [path, method, operationId] of expected) {
    const operation = document.paths[path]?.[method] as Record<string, unknown> | undefined
    assert.equal(operation?.operationId, operationId)
    assert.deepEqual(operation?.security, [{ posBearer: [] }])
  }
  const addLine = document.paths['/orders/{id}/lines']?.post as Record<string, unknown>
  const requestBody = addLine.requestBody as {
    content: { 'application/json': { schema: { required?: string[] } } }
  }
  assert.deepEqual(requestBody.content['application/json'].schema.required, [
    'expectedRevision',
    'productId',
    'uomId',
    'quantity',
    'quoteRevision',
  ])
  const selectLots = document.paths['/orders/{id}/lines/{lineId}/lot-selections']?.put as Row
  const selectLotsBody = (selectLots.requestBody as Row).content as Row
  const selectLotsSchema = (selectLotsBody['application/json'] as Row).schema as Row
  assert.deepEqual(selectLotsSchema.required, ['expectedRevision', 'selections'])
  const selectionItem = (((selectLotsSchema.properties as Row).selections as Row).items as Row)
    .properties as Row
  assert.deepEqual(selectionItem.stockRevision, { type: 'string' })
  const createReturn = document.paths['/orders/{id}/returns']?.post as Row
  const createReturnBody = (createReturn.requestBody as Row).content as Row
  const createReturnSchema = (createReturnBody['application/json'] as Row).schema as Row
  assert.deepEqual(createReturnSchema.required, ['shiftId', 'expectedRevision', 'lines'])
  assert.equal(((createReturnSchema.properties as Row).lines as Row).minItems, 1)
  const loyalty = document.paths['/orders/{id}/loyalty']?.get
  assert.ok(loyalty)
  assert.deepEqual((loyalty as Record<string, unknown>)['x-ket-capability'], {
    key: 'pos.loyalty',
    action: 'read',
  })
  const removeReward = document.paths['/orders/{id}/loyalty/rewards/{programId}']?.delete as Record<
    string,
    unknown
  >
  const parameters = removeReward.parameters as Array<Record<string, unknown>>
  assert.deepEqual(
    parameters.find((parameter) => parameter.in === 'header'),
    { name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } },
  )
  assert.equal(removeReward.requestBody, undefined)
  const loyaltyResponse = ((loyalty as Record<string, unknown>).responses as Record<string, Row>)['200']
  const loyaltySchema = ((loyaltyResponse.content as Row)['application/json'] as Row).schema as Row
  const loyaltyData = (loyaltySchema.properties as Row).data as Row
  const programs = ((loyaltyData.properties as Row).programs as Row).items as Row
  const rewards = ((programs.properties as Row).rewards as Row).items as Row
  assert.deepEqual((rewards.properties as Row).discountAmount, { type: 'string' })
  const withoutAdapter = openApiDocument(
    compose(
      ketsuite.modules.filter((module) => !['loyalty_pos', 'loyalty_backend'].includes(module.name)),
      { headless: true },
    ),
    'pos',
  )
  assert.equal(withoutAdapter.paths['/orders/{id}/loyalty'], undefined)
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
