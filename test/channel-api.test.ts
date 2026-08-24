import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, defineModule, text } from '@ketvietlab/ketjs'
import { openApiDocument } from '@ketvietlab/ketsuite'
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

test('channel api: the staff document names the credential staff routes accept', () => {
  const document = openApiDocument(compose(ketsuite.modules, { headless: true }), 'staff')
  // Staff callers arrive with the verified session cookie and nothing else. A
  // profile whose security block is empty generates a client that sends no
  // credential at all, which is the one way a published document can be wrong
  // and still look complete.
  assert.deepEqual(document.components.securitySchemes, {
    staffCookie: { type: 'apiKey', in: 'cookie', name: 'ket_session' },
  })
  const orders = document.paths['/sales/orders']?.get as Record<string, unknown>
  assert.deepEqual(orders.security, [{ staffCookie: [] }])
  assert.deepEqual(orders['x-ket-capability'], { key: 'sales.orders', action: 'read' })
  for (const [path, entry] of Object.entries(document.paths))
    for (const [method, operation] of Object.entries(entry as Record<string, { security?: unknown[] }>))
      assert.ok(operation.security?.length, `${method} ${path} publishes no credential`)
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
