import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { defineApp, defineModule } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { createTestApp, TestHttpError } from 'ketjs/testing'
import {
  address,
  company,
  mail,
  mailInbound,
  mailTransport,
  partner,
  product,
  stock,
  stockMailInbound,
  storage,
  uom,
  user,
} from 'ketsuite'
import { inboundPlainText } from '../packages/ketsuite/src/modules/mail_inbound/index.ts'

const webhookSecret = 'inbound-provider-secret-for-tests'
const scope = { company: 'acme', branches: null }
const asAdmin = { scope, actor: 'u-admin' }

const fixture = defineModule({
  name: 'mail_inbound_fixture',
  depends: ['mail_inbound'],
  app: true,
  functions: {
    seedOutbound: {
      effects: ['write:mail.Thread', 'write:mail.Message', 'write:mail_transport.Delivery'],
      handler: (ctx: Ctx) =>
        ctx.tx(async (tx) => {
          await tx.db.insert('mail.Thread', {
            id: 'thread:reply',
            resModel: 'mail_inbound_fixture.Record',
            resId: 'record-1',
            displayName: 'Purchase request PR-001',
            active: true,
            createdAt: '2026-08-20T00:00:00.000Z',
          })
          await tx.db.insert('mail.Message', {
            id: 'message:outbound',
            threadId: 'thread:reply',
            kind: 'email',
            direction: 'outgoing',
            subject: 'Purchase request PR-001',
            body: 'Please confirm.',
            externalVisible: true,
            createdAt: '2026-08-20T00:00:00.000Z',
          })
          await tx.db.insert('mail_transport.Delivery', {
            id: 'delivery:outbound',
            messageId: 'message:outbound',
            fromAddress: 'robot@acme.test',
            to: [{ address: 'supplier@example.test' }],
            subject: 'Purchase request PR-001',
            text: 'Please confirm.',
            state: 'sent',
            version: 1,
            idempotencyKey: 'mail:delivery:outbound:v1',
            providerMessageId: 'provider-message-out-1',
            attempts: 1,
            queuedAt: '2026-08-20T00:00:00.000Z',
            acceptedAt: '2026-08-20T00:00:01.000Z',
            sentAt: '2026-08-20T00:00:01.000Z',
            updatedAt: '2026-08-20T00:00:01.000Z',
          })
          return { ok: true }
        }),
    } satisfies FnSpec,
  },
})

const signature = (path: string, timestamp: string, body: string): string =>
  createHmac('sha256', webhookSecret)
    .update(timestamp)
    .update('.')
    .update(path)
    .update('.')
    .update(body)
    .digest('hex')

const sendWebhook = async (
  baseUrl: string,
  path: string,
  payload: Record<string, unknown>,
  options: { signaturePath?: string; signature?: string } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> => {
  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ket-webhook-timestamp': timestamp,
      'x-ket-webhook-signature':
        options.signature ?? signature(options.signaturePath ?? path, timestamp, body),
    },
    body,
  })
  return { response, body: (await response.json()) as Record<string, unknown> }
}

const seedIdentity = async (e2e: Awaited<ReturnType<typeof createTestApp>>): Promise<void> => {
  for (const [id, kind, name, email] of [
    ['p-company', 'company', 'ACME', 'hello@acme.test'],
    ['p-admin', 'person', 'Admin', 'admin@acme.test'],
  ])
    await e2e.fixture.call('partner.savePartner', { id, kind, name, email })
  await e2e.fixture.call('company.saveCompany', {
    id: 'acme',
    partnerId: 'p-company',
    currency: 'VND',
  })
  await e2e.fixture.call('user.createUser', {
    id: 'u-admin',
    login: 'admin',
    password: 'test-password',
    name: 'Admin',
    partnerId: 'p-admin',
    defaultCompanyId: 'acme',
  })
  await e2e.fixture.call('user.grantCompany', {
    id: 'u-admin:acme',
    userId: 'u-admin',
    companyId: 'acme',
  })
}

test('inbound plain text conversion discards active HTML instead of sanitizing it for rendering', () => {
  assert.equal(
    inboundPlainText('', '<p>Hello &amp; welcome</p><script>globalThis.pwned = 1</script>'),
    'Hello & welcome',
  )
})

test('inbound email: signed reply/reference/bounce routing, attachment storage, dedupe and stock alias work end to end', async () => {
  const app = defineApp({
    name: 'mail_inbound_e2e',
    modules: [
      address,
      partner,
      company,
      storage,
      user,
      mail,
      mailTransport,
      mailInbound,
      uom,
      product,
      stock,
      stockMailInbound,
      fixture,
    ],
    headless: true,
    worker: { queues: { maintenance: 1 } },
    serve: {
      bootstrap: ['mail_inbound_fixture', 'stock_mail_inbound'],
      sessions: { anonymous: { company: 'acme' } },
    },
  })
  const e2e = await createTestApp(app, {
    env: { KET_WEBHOOK_SECRET: webhookSecret },
  })
  try {
    await seedIdentity(e2e)
    await e2e.fixture.call('mail_inbound_fixture.seedOutbound', {}, asAdmin)
    const replyToken = await e2e.fixture.call<{ token: string }>(
      'mail_inbound.createReplyToken',
      {
        id: 'reply-token:1',
        threadId: 'thread:reply',
        parentMessageId: 'message:outbound',
        expiresAt: '2027-08-20T00:00:00.000Z',
      },
      asAdmin,
    )

    await assert.rejects(
      () =>
        e2e.client.call('mail_inbound.receiveReply', {
          provider: 'test',
          providerEventId: 'bypass',
          kind: 'message',
          recipients: [],
          receivedAt: '2026-08-20T01:00:00.000Z',
        }),
      (error: unknown) => {
        assert.ok(error instanceof TestHttpError)
        assert.equal(error.status, 400)
        assert.equal((error.body as { code?: string }).code, 'E_FN_NOT_PERMITTED')
        return true
      },
    )

    const invalid = await sendWebhook(
      e2e.baseUrl,
      '/mail/inbound/reply',
      { provider: 'test', providerEventId: 'bad-signature' },
      { signature: '0'.repeat(64) },
    )
    assert.equal(invalid.response.status, 401)
    assert.equal(invalid.body.code, 'E_INBOUND_SIGNATURE')

    const tokenPayload = {
      provider: 'test',
      providerEventId: 'reply-token-event',
      kind: 'message',
      fromAddress: 'supplier@example.test',
      recipients: ['reply@acme.test'],
      subject: 'Re: Purchase request PR-001',
      html: '<p>Hello &amp; welcome</p><script>globalThis.pwned = 1</script>',
      replyToken: replyToken.value.token,
      attachments: [
        {
          name: 'confirmation.txt',
          mimetype: 'text/plain',
          contentBase64: Buffer.from('confirmed attachment').toString('base64'),
        },
      ],
      receivedAt: '2026-08-20T01:00:00.000Z',
    }
    const accepted = await sendWebhook(e2e.baseUrl, '/mail/inbound/reply', tokenPayload)
    assert.equal(accepted.response.status, 202)
    assert.equal(accepted.body.state, 'processed')
    assert.equal(accepted.body.messageId, 'inbound:test:reply-token-event')
    const replay = await sendWebhook(e2e.baseUrl, '/mail/inbound/reply', tokenPayload)
    assert.equal(replay.body.duplicate, true)

    const referenced = await sendWebhook(e2e.baseUrl, '/mail/inbound/reply', {
      provider: 'test',
      providerEventId: 'reply-reference-event',
      kind: 'message',
      fromAddress: 'supplier@example.test',
      recipients: ['catchall@acme.test'],
      subject: 'Re: reference route',
      text: 'Routed from provider References.',
      references: ['provider-message-out-1'],
      receivedAt: '2026-08-20T01:02:00.000Z',
    })
    assert.equal(referenced.body.state, 'processed')
    assert.equal(referenced.body.threadId, 'thread:reply')

    const invalidToken = await sendWebhook(e2e.baseUrl, '/mail/inbound/reply', {
      provider: 'test',
      providerEventId: 'invalid-token-event',
      kind: 'message',
      fromAddress: 'attacker@example.test',
      recipients: ['reply@acme.test'],
      text: 'Must not fall back to a guessed reference.',
      replyToken: 'invalid-token',
      references: ['provider-message-out-1'],
      receivedAt: '2026-08-20T01:03:00.000Z',
    })
    assert.equal(invalidToken.response.status, 202)
    assert.equal(invalidToken.body.state, 'failed')

    const wrongPath = await sendWebhook(
      e2e.baseUrl,
      '/mail/inbound/stock/receipts',
      {
        provider: 'test',
        providerEventId: 'path-replay',
        kind: 'message',
        recipients: ['receipts@acme.test'],
        text: 'Cross-endpoint replay must fail.',
        receivedAt: '2026-08-20T01:04:00.000Z',
      },
      { signaturePath: '/mail/inbound/reply' },
    )
    assert.equal(wrongPath.response.status, 401)

    await e2e.fixture.call('stock.saveWarehouse', { id: 'wh', name: 'Main warehouse', code: 'WH' }, asAdmin)
    await e2e.fixture.call(
      'mail_inbound.saveAlias',
      {
        id: 'alias:receipts',
        localPart: 'receipts',
        name: 'Supplier receipts',
        bridge: 'stock.receipt',
        defaults: { pickingTypeId: 'wh:incoming' },
        active: true,
      },
      asAdmin,
    )
    const alias = await sendWebhook(e2e.baseUrl, '/mail/inbound/stock/receipts', {
      provider: 'test',
      providerEventId: 'stock-alias-event',
      kind: 'message',
      fromAddress: 'supplier@example.test',
      recipients: ['receipts@acme.test'],
      subject: 'ASN 2026-0084',
      text: 'Twelve jackets are arriving tomorrow.',
      receivedAt: '2026-08-20T01:05:00.000Z',
    })
    assert.equal(alias.body.state, 'processed')
    assert.equal(alias.body.targetId, 'inbound:test:stock-alias-event:picking')

    const bounce = await sendWebhook(e2e.baseUrl, '/mail/inbound/reply', {
      provider: 'test',
      providerEventId: 'bounce-event',
      kind: 'bounce',
      recipients: ['bounce@acme.test'],
      text: '550 supplier mailbox rejected the request',
      references: ['provider-message-out-1'],
      receivedAt: '2026-08-20T01:06:00.000Z',
    })
    assert.equal(bounce.body.state, 'processed')

    await e2e.fixture.withTenant('', async ({ adapter }) => {
      const messages = await adapter.all(
        `SELECT id, threadId, parentId, direction, body
         FROM mail_message WHERE id LIKE 'inbound:%' ORDER BY id`,
      )
      assert.equal(messages.length, 3)
      const tokenReply = messages.find((row) => row.id === 'inbound:test:reply-token-event')
      assert.equal(tokenReply?.threadId, 'thread:reply')
      assert.equal(tokenReply?.parentId, 'message:outbound')
      assert.equal(tokenReply?.direction, 'incoming')
      assert.equal(tokenReply?.body, 'Hello & welcome')
      const picking = await adapter.all('SELECT state, name FROM stock_picking WHERE id = ?', [
        'inbound:test:stock-alias-event:picking',
      ])
      assert.equal(picking.length, 1)
      assert.equal(picking[0]?.state, 'draft')
      assert.equal(picking[0]?.name, 'ASN 2026-0084')
      const delivery = await adapter.all(
        'SELECT state, lastError FROM mail_transport_delivery WHERE id = ?',
        ['delivery:outbound'],
      )
      assert.equal(delivery[0]?.state, 'failed')
      assert.match(String(delivery[0]?.lastError), /550 supplier mailbox/)
      const events = await adapter.all(
        'SELECT providerEventId, state, diagnostic FROM mail_inbound_inbound_event ORDER BY providerEventId',
      )
      assert.equal(events.filter((row) => row.providerEventId === 'reply-token-event').length, 1)
      assert.equal(events.find((row) => row.providerEventId === 'invalid-token-event')?.state, 'failed')
    })

    await e2e.client.login({ login: 'admin', password: 'test-password' })
    const attachment = await e2e.client.get('/files/inbound%3Atest%3Areply-token-event%3Aattachment%3A1')
    assert.equal(attachment.status, 200)
    assert.equal(await attachment.text(), 'confirmed attachment')

    await e2e.fixture.call('mail_inbound.requestRetention', { cutoff: '2099-01-01T00:00:00.000Z' }, asAdmin)
    assert.equal(await e2e.drainJobs(), 1)
    const after = await e2e.fixture.call<{ events: Row[] }>(
      'mail_inbound.listEvents',
      { limit: 100 },
      asAdmin,
    )
    assert.ok(after.value.events.every((row) => row.state === 'processed'))
  } finally {
    await e2e.close()
  }
})
