import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootWorker, defineDeployment, defineModule, memoryTransport } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row, WorkerLog } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import {
  calendar,
  calendarMailTransport,
  company,
  mail,
  mailTransport,
  partner,
  storage,
  user,
} from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'
import { deliveryEnvelope, queueTemplate } from '../packages/ketsuite/src/modules/mail_transport/index.ts'
import { renderTemplate } from '../packages/ketsuite/src/modules/mail_transport/template.ts'

const bridgeEffects = [
  'read:mail_transport.Template',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'read:mail.Message',
  'read:mail.Notification',
  'write:mail_transport.DeliveryNotification',
  'enqueue:mail_transport.deliver',
]

const fixtureBridge = defineModule({
  name: 'mail_transport_fixture',
  depends: ['mail_transport'],
  functions: {
    seedNotification: {
      effects: ['write:mail.Thread', 'write:mail.Message', 'write:mail.Notification', 'read:partner.Partner'],
      handler: (ctx: Ctx) =>
        ctx.tx(async (tx) => {
          await tx.db.insert('mail.Thread', {
            id: 'thread:test',
            resModel: 'mail_transport_fixture.Record',
            resId: 'record-1',
            displayName: 'Transfer WH/OUT/0001',
            active: true,
            createdAt: '2026-08-20T00:00:00.000Z',
          })
          await tx.db.insert('mail.Message', {
            id: 'message:test',
            threadId: 'thread:test',
            kind: 'email',
            direction: 'outgoing',
            subject: 'Delivery failed',
            body: 'Snapshot body',
            externalVisible: true,
            createdAt: '2026-08-20T00:00:00.000Z',
          })
          await tx.db.insert('mail.Notification', {
            id: 'notification:test',
            messageId: 'message:test',
            recipientPartnerId: 'p-attendee',
            channel: 'email',
            state: 'ready',
            createdAt: '2026-08-20T00:00:00.000Z',
          })
          return { ok: true }
        }),
    } satisfies FnSpec,
    queueThenFail: {
      input: { id: 'id', templateId: 'id' },
      effects: bridgeEffects,
      handler: (ctx: Ctx, args) =>
        ctx.tx(async (tx) => {
          await queueTemplate(tx, {
            id: String(args.id),
            templateId: String(args.templateId),
            context: { customer: { name: 'Rollback' } },
            to: [{ address: 'rollback@example.test' }],
          })
          throw new Error('business transaction rejected')
        }),
    } satisfies FnSpec,
  },
})

const scope = { company: 'acme', branches: null }
const asAdmin = { scope, actor: 'u-admin' }

const seedIdentity = async (e2e: Awaited<ReturnType<typeof createTestDeployment>>): Promise<void> => {
  for (const [id, name, email] of [
    ['p-company', 'ACME', 'hello@acme.test'],
    ['p-admin', 'Admin', 'admin@acme.test'],
    ['p-attendee', 'Nguyễn An', 'an@example.test'],
  ])
    await e2e.fixture.call('partner.savePartner', {
      id,
      kind: id === 'p-company' ? 'company' : 'person',
      name,
      email,
    })
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

const templateInput = (subjectTemplate = 'Xin chào {{ customer.name }}') => ({
  id: 'template:test',
  name: 'Transactional test',
  fromAddress: 'robot@acme.test',
  fromName: 'KetSuite',
  replyTo: 'support@acme.test',
  subjectTemplate,
  textTemplate: 'Đơn của {{ customer.name }} đã sẵn sàng.',
  htmlTemplate: '<p>Đơn của <strong>{{ customer.name }}</strong> đã sẵn sàng.</p>',
  allowedKeys: ['customer.name'],
  active: true,
})

test('mail template: allowlist and HTML escaping reject data/code confusion', () => {
  assert.equal(
    renderTemplate(
      '<p>{{ customer.name }}</p>',
      { customer: { name: '<script>x</script>' } },
      ['customer.name'],
      'html',
    ),
    '<p>&lt;script&gt;x&lt;/script&gt;</p>',
  )
  assert.throws(
    () => renderTemplate('{{ secret }}', { secret: 'leak' }, ['customer.name']),
    (error: unknown) => (error as { code?: string }).code === 'E_MAIL_TEMPLATE',
  )
})

test('mail transport: transactional snapshots survive edits, retries, accepted-crash replay and terminal failure', async () => {
  const provider = memoryTransport({
    now: () => new Date('2026-08-20T12:00:00.000Z'),
    fail: (message, attempt) => {
      if (message.idempotencyKey === 'mail:d-retry:v1' && attempt === 1)
        return new Error('provider temporarily unavailable')
      if (message.idempotencyKey === 'mail:d-failed:v1') return new Error('mailbox rejected')
      return null
    },
  })
  const app = defineDeployment({
    name: 'mail_transport_e2e',
    modules: [address, partner, company, storage, user, mail, mailTransport, fixtureBridge],
    headless: true,
    worker: { queues: { mail: 1 } },
    serve: {
      openTransport: () => provider,
      sessions: { anonymous: { company: 'acme' } },
    },
  })
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await seedIdentity(e2e)
    await e2e.fixture.call('mail_transport.saveTemplate', templateInput(), asAdmin)
    await e2e.fixture.call('mail_transport_fixture.seedNotification', {}, asAdmin)

    for (const [id, name, extra] of [
      ['d-snapshot', '<script>old</script>', {}],
      ['d-retry', 'Retry customer', {}],
      [
        'd-failed',
        'Rejected customer',
        { messageId: 'message:test', notificationIds: ['notification:test'] },
      ],
      ['d-crash', 'Crash window', {}],
    ] as const)
      await e2e.fixture.call(
        'mail_transport.queueTemplate',
        {
          id,
          templateId: 'template:test',
          context: { customer: { name } },
          to: [{ address: `${id}@example.test`, name }],
          ...extra,
        },
        asAdmin,
      )

    await e2e.fixture.call(
      'mail_transport.saveTemplate',
      templateInput('NỘI DUNG MỚI {{ customer.name }}'),
      asAdmin,
    )

    const before = await e2e.fixture.call<{ deliveries: Row[] }>(
      'mail_transport.listOutbox',
      { limit: 100 },
      asAdmin,
    )
    const crash = before.value.deliveries.find((row) => row.id === 'd-crash')!
    await provider.send(deliveryEnvelope(crash))

    await assert.rejects(
      () =>
        e2e.fixture.call(
          'mail_transport_fixture.queueThenFail',
          { id: 'd-rollback', templateId: 'template:test' },
          asAdmin,
        ),
      /business transaction rejected/,
    )

    const logs: WorkerLog[] = []
    const worker = await bootWorker(app, {
      env: e2e.env,
      // Put zero-jitter retry timestamps safely in the past relative to the
      // queue adapter's real clock so one deterministic drain covers all attempts.
      now: () => new Date('2020-01-01T00:00:00.000Z'),
      random: () => 0,
      log: (entry) => logs.push(entry),
    })
    try {
      assert.equal(await worker.drain(), 9)
    } finally {
      await worker.close()
    }

    const outbox = await e2e.fixture.call<{ deliveries: Row[] }>(
      'mail_transport.listOutbox',
      { limit: 100 },
      asAdmin,
    )
    const byId = new Map(outbox.value.deliveries.map((row) => [String(row.id), row]))
    assert.equal(byId.get('d-snapshot')?.state, 'sent')
    assert.equal(byId.get('d-snapshot')?.subject, 'Xin chào <script>old</script>')
    assert.match(String(byId.get('d-snapshot')?.html), /&lt;script&gt;old&lt;\/script&gt;/)
    assert.equal(byId.get('d-retry')?.state, 'sent')
    assert.equal(byId.get('d-retry')?.attempts, 2)
    assert.equal(byId.get('d-failed')?.state, 'failed')
    assert.equal(byId.get('d-failed')?.attempts, 5)
    assert.match(String(byId.get('d-failed')?.lastError), /mailbox rejected/)
    assert.equal(byId.get('d-crash')?.state, 'sent')
    assert.equal(byId.has('d-rollback'), false)

    assert.equal(provider.attempts('mail:d-retry:v1'), 2)
    assert.equal(provider.attempts('mail:d-crash:v1'), 2)
    assert.equal(
      provider.deliveries().filter((row) => row.message.idempotencyKey === 'mail:d-crash:v1').length,
      1,
    )
    assert.equal(
      provider.deliveries().find((row) => row.message.idempotencyKey === 'mail:d-snapshot:v1')?.message
        .subject,
      'Xin chào <script>old</script>',
    )
    assert.ok(logs.some((entry) => entry.event === 'retrying'))
    assert.ok(logs.some((entry) => entry.event === 'discarded'))

    const providerEvent = {
      id: 'provider-event:bounce-1',
      provider: 'memory',
      providerEventId: 'bounce-1',
      type: 'bounced',
      providerMessageId: String(byId.get('d-snapshot')?.providerMessageId),
      payload: { reason: '550 mailbox became unavailable' },
      occurredAt: '2026-08-20T12:05:00.000Z',
    }
    const reconciled = await e2e.fixture.call<{ duplicate: boolean; state: string }>(
      'mail_transport.recordProviderEvent',
      providerEvent,
      asAdmin,
    )
    const duplicate = await e2e.fixture.call<{ duplicate: boolean; state: string }>(
      'mail_transport.recordProviderEvent',
      { ...providerEvent, id: 'provider-event:duplicate-body' },
      asAdmin,
    )
    assert.deepEqual(
      [reconciled.value.duplicate, reconciled.value.state, duplicate.value.duplicate],
      [false, 'failed', true],
    )

    await e2e.fixture.withTenant('', async ({ adapter }) => {
      const notifications = await adapter.all(
        'SELECT state, failureReason FROM mail_notification WHERE id = ?',
        ['notification:test'],
      )
      assert.equal(notifications[0]?.state, 'failed')
      assert.match(String(notifications[0]?.failureReason), /mailbox rejected/)
      const rolledBackJobs = await adapter.all('SELECT id FROM ket_job WHERE unique_key = ?', [
        'delivery:d-rollback:v1',
      ])
      assert.equal(rolledBackJobs.length, 0)
      const events = await adapter.all(
        'SELECT id FROM mail_transport_provider_event WHERE providerEventId = ?',
        ['bounce-1'],
      )
      assert.equal(events.length, 1)
    })
  } finally {
    await e2e.close()
  }
})

test('calendar email producer creates one immutable RSVP delivery per attendee', async () => {
  const provider = memoryTransport({ now: () => new Date('2026-08-20T12:00:00.000Z') })
  const app = defineDeployment({
    name: 'calendar_mail_transport_e2e',
    modules: [address, partner, company, storage, user, mail, mailTransport, calendar, calendarMailTransport],
    headless: true,
    worker: { queues: { default: 1, mail: 1 } },
    serve: {
      openTransport: () => provider,
      sessions: { anonymous: { company: 'acme' } },
    },
  })
  const e2e = await createTestDeployment(app, { worker: false })
  try {
    await seedIdentity(e2e)
    await e2e.fixture.call(
      'mail_transport.saveTemplate',
      {
        id: 'template:calendar',
        name: 'Calendar invitation',
        fromAddress: 'calendar@acme.test',
        subjectTemplate: 'Lời mời: {{ event.name }}',
        textTemplate: '{{ attendee.name }} — {{ event.when }} — {{ attendee.rsvpUrl }}',
        htmlTemplate: '<p>{{ attendee.name }}</p><a href="{{ attendee.rsvpUrl }}">RSVP</a>',
        allowedKeys: ['event.name', 'event.when', 'attendee.name', 'attendee.rsvpUrl'],
        active: true,
      },
      asAdmin,
    )
    await e2e.fixture.call(
      'calendar.saveEvent',
      {
        id: 'event:1',
        name: 'Kiểm kê kho',
        allDay: false,
        startAt: '2026-08-21T02:00:00.000Z',
        stopAt: '2026-08-21T03:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        privacy: 'public',
        attendees: [{ id: 'attendee:1', partnerId: 'p-attendee' }],
        reminders: [],
      },
      asAdmin,
    )
    const produced = await e2e.fixture.call<{ deliveryIds: string[] }>(
      'calendar_mail_transport.sendInvitations',
      { eventId: 'event:1', templateId: 'template:calendar', baseUrl: 'https://suite.example.test' },
      asAdmin,
    )
    assert.deepEqual(produced.value.deliveryIds, ['calendar:event:1:v1:attendee:1'])

    const worker = await bootWorker(app, {
      env: e2e.env,
      now: () => new Date('2020-01-01T00:00:00.000Z'),
      random: () => 0,
      log: () => {},
    })
    try {
      assert.equal(await worker.drain(), 1)
    } finally {
      await worker.close()
    }
    assert.equal(provider.deliveries().length, 1)
    const sent = provider.deliveries()[0]!.message
    assert.equal(sent.to[0]?.address, 'an@example.test')
    assert.equal(sent.subject, 'Lời mời: Kiểm kê kho')
    assert.match(sent.text, /https:\/\/suite\.example\.test\/calendar\/rsvp\//)
  } finally {
    await e2e.close()
  }
})
