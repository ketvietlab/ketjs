import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineApp, defineModule } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { createTestApp } from '@ketvietlab/ketjs/testing'
import {
  activity,
  address,
  calendar,
  company,
  mail,
  mailInbound,
  mailTransport,
  odooCollaborationImport,
  partner,
  storage,
  user,
} from '@ketvietlab/ketsuite'
import { stableTargetId } from '../packages/ketsuite/src/modules/odoo_collaboration_import/index.ts'
import type {
  OdooImportBatch,
  OdooImportReport,
} from '../packages/ketsuite/src/modules/odoo_collaboration_import/index.ts'

const scope = { company: 'acme', branches: null }
const asAdmin = { scope, actor: 'u-admin' }

const fixture = defineModule({
  name: 'odoo_collaboration_import_fixture',
  depends: ['mail'],
  app: true,
  functions: {
    seedThreads: {
      effects: ['write:mail.Thread'],
      handler: (ctx: Ctx) =>
        ctx.tx(async (tx) => {
          await tx.db.insert('mail.Thread', {
            id: 'thread:product:100',
            resModel: 'product.Product',
            resId: 'product-100',
            displayName: 'Desk ODOO-100',
            active: true,
            createdAt: '2026-08-20T00:00:00.000Z',
          })
          await tx.db.insert('mail.Thread', {
            id: 'thread:event:60',
            resModel: 'calendar.Event',
            resId: 'event-60',
            displayName: 'Odoo cutover meeting',
            active: true,
            createdAt: '2026-08-20T00:00:00.000Z',
          })
          return { ok: true }
        }),
    } satisfies FnSpec,
  },
})

const batch = (runId: string): OdooImportBatch => ({
  runId,
  sourceId: 'odoo-prod',
  sourceName: 'Odoo production',
  databaseUuid: 'f1b7d6ef-odoo-production',
  odooVersion: '19.0',
  mode: 'snapshot',
  cursor: 'snapshot:2026-08-20T02:00:00Z',
  bindings: [
    {
      sourceModel: 'product.product',
      sourceId: 100,
      targetModel: 'mail.Thread',
      targetId: 'thread:product:100',
    },
    {
      sourceModel: 'calendar.event',
      sourceId: 60,
      targetModel: 'mail.Thread',
      targetId: 'thread:event:60',
    },
    { sourceModel: 'res.partner', sourceId: 7, targetModel: 'partner.Partner', targetId: 'p-contact' },
    { sourceModel: 'res.users', sourceId: 5, targetModel: 'user.User', targetId: 'u-admin' },
  ],
  rows: [
    {
      model: 'mail.message.subtype',
      id: 1,
      values: { name: 'Discussions', code: 'mail.mt_comment', defaultFollower: true, active: true },
    },
    {
      model: 'mail.activity.type',
      id: 2,
      values: { name: 'To Do', category: 'default', defaultDelayDays: 2, sequence: 10, active: true },
    },
    {
      model: 'mail.message',
      id: 10,
      values: {
        resModel: 'product.product',
        resId: 100,
        subtypeId: 1,
        authorPartnerId: 7,
        authorUserId: 5,
        messageType: 'comment',
        direction: 'internal',
        body: '<p>Imported <strong>safely</strong>.</p><script>bad()</script>',
        date: '2026-08-19 07:30:00',
        externalVisible: true,
      },
    },
    {
      model: 'mail.followers',
      id: 20,
      values: {
        resModel: 'product.product',
        resId: 100,
        partnerId: 7,
        subtypeIds: [1],
        createdAt: '2026-08-19 07:31:00',
      },
    },
    {
      model: 'mail.notification',
      id: 30,
      values: {
        messageId: 10,
        partnerId: 7,
        userId: 5,
        notificationType: 'inbox',
        notificationStatus: 'sent',
        createdAt: '2026-08-19 07:32:00',
      },
    },
    {
      model: 'mail.tracking.value',
      id: 31,
      values: { messageId: 10, fieldName: 'list_price', oldValue: 100, newValue: 125 },
    },
    {
      model: 'mail.activity',
      id: 40,
      values: {
        resModel: 'product.product',
        resId: 100,
        activityTypeId: 2,
        userId: 5,
        createUid: 5,
        summary: 'Review imported product',
        note: '<p>Check the migrated chatter.</p>',
        dateDeadline: '2026-08-25',
        active: true,
        createdAt: '2026-08-19 07:33:00',
        updatedAt: '2026-08-19 07:34:00',
      },
    },
    {
      model: 'mail.activity.plan',
      id: 3,
      values: { name: 'Product launch', description: 'Imported plan', active: true },
    },
    {
      model: 'mail.activity.plan.template',
      id: 4,
      values: {
        planId: 3,
        activityTypeId: 2,
        interval: 5,
        responsibleType: 'specific',
        userId: 5,
        summary: 'Approve launch',
        sequence: 10,
      },
    },
    {
      model: 'calendar.recurrence',
      id: 50,
      values: {
        rruleType: 'weekly',
        interval: 1,
        weekdays: ['MO', 'WE'],
        count: 4,
        tz: 'Europe/Paris',
        active: true,
      },
    },
    {
      model: 'calendar.event',
      id: 60,
      values: {
        userId: 5,
        name: 'Odoo cutover meeting',
        description: '<p>Review <em>delta</em> import.</p>',
        start: '2026-10-25 00:30:00',
        stop: '2026-10-25 01:30:00',
        tz: 'Europe/Paris',
        recurrenceId: 50,
        privacy: 'private',
        showAs: 'busy',
        active: true,
        createdAt: '2026-08-19 08:00:00',
        updatedAt: '2026-08-19 08:01:00',
      },
    },
    {
      model: 'calendar.attendee',
      id: 70,
      values: {
        eventId: 60,
        partnerId: 7,
        email: 'contact@example.test',
        name: 'Contact',
        state: 'accepted',
      },
    },
    {
      model: 'calendar.alarm',
      id: 80,
      values: { eventId: 60, alarmType: 'notification', offsetMinutes: 30, version: 1, active: true },
    },
    { model: 'calendar.event.type', id: 90, values: { name: 'Migration', color: '#6d5dfc', active: true } },
    { model: 'calendar.event.type.rel', id: 91, values: { eventId: 60, tagId: 90 } },
    {
      model: 'ir.attachment',
      id: 100,
      values: {
        name: 'migration.txt',
        resModel: 'mail.message',
        resId: 10,
        kind: 'stored',
        storeKey: `blobs/acme/aa/${'a'.repeat(64)}`,
        mimetype: 'text/plain',
        size: 16,
        checksum: 'a'.repeat(64),
        public: false,
        createdAt: '2026-08-19 07:35:00',
      },
    },
    {
      model: 'mail.template',
      id: 110,
      values: {
        name: 'Odoo legacy template',
        emailFrom: 'robot@example.test',
        subject: 'Hello {{ object.name }}',
        bodyHtml: '<p>Hello <t t-out="object.name"/></p>',
        allowedKeys: [],
        active: true,
        createdAt: '2026-08-19 09:00:00',
        updatedAt: '2026-08-19 09:00:00',
      },
    },
    {
      model: 'mail.alias',
      id: 120,
      values: {
        aliasName: 'receipts',
        name: 'Supplier receipts',
        bridge: 'stock.receipt',
        domainId: 119,
        defaults: { pickingTypeId: 'wh:incoming', apiToken: 'must-not-be-imported' },
        active: true,
        createdAt: '2026-08-19 09:10:00',
        updatedAt: '2026-08-19 09:10:00',
      },
    },
    {
      model: 'mail.alias.domain',
      id: 119,
      values: {
        name: 'inbound.example.test',
        active: true,
        createdAt: '2026-08-19 09:05:00',
        updatedAt: '2026-08-19 09:05:00',
      },
    },
    {
      model: 'mail.mail',
      id: 130,
      values: {
        messageId: 10,
        state: 'outgoing',
        emailFrom: 'robot@example.test',
        recipientEmails: [{ address: 'contact@example.test', name: 'Contact' }],
        subject: 'Pending imported delivery',
        text: 'This delivery was pending at freeze time.',
        createdAt: '2026-08-19 09:20:00',
        updatedAt: '2026-08-19 09:20:00',
      },
    },
    {
      model: 'mail.mail',
      id: 131,
      values: {
        messageId: 10,
        state: 'exception',
        emailFrom: 'robot@example.test',
        recipientEmails: [{ address: 'contact@example.test' }],
        subject: 'Failed imported delivery',
        text: 'This delivery failed before cutover.',
        failureReason: 'Odoo SMTP timeout',
        attempts: 3,
        createdAt: '2026-08-19 09:21:00',
        updatedAt: '2026-08-19 09:22:00',
      },
    },
    {
      model: 'mail.mail',
      id: 132,
      values: {
        messageId: 10,
        state: 'sent',
        emailFrom: 'robot@example.test',
        recipientEmails: [{ address: 'contact@example.test' }],
        subject: 'Already sent',
        text: 'Must not be re-queued.',
        createdAt: '2026-08-19 09:23:00',
      },
    },
    {
      model: 'mail.message',
      id: 998,
      values: {
        resModel: 'product.product',
        resId: 100,
        authorPartnerId: 404,
        bodyText: 'Missing partner must be reported.',
        date: '2026-08-19 10:00:00',
      },
    },
    {
      model: 'mail.message',
      id: 999,
      values: {
        resModel: 'product.product',
        resId: 404,
        bodyText: 'Missing target must be reported.',
        date: '2026-08-19 10:01:00',
      },
    },
  ],
})

test('Odoo 19 collaboration snapshot previews, imports idempotently and reports unresolved rows', async () => {
  const app = defineApp({
    name: 'odoo_collaboration_import_e2e',
    modules: [
      address,
      partner,
      company,
      storage,
      user,
      mail,
      mailTransport,
      mailInbound,
      activity,
      calendar,
      odooCollaborationImport,
      fixture,
    ],
    headless: true,
    worker: { queues: { mail: 1 } },
    serve: {
      bootstrap: [
        'partner',
        'company',
        'storage',
        'user',
        'mail',
        'mail_transport',
        'mail_inbound',
        'activity',
        'calendar',
        'odoo_collaboration_import',
        'odoo_collaboration_import_fixture',
      ],
    },
  })
  const e2e = await createTestApp(app)
  try {
    await e2e.fixture.call('partner.savePartner', {
      id: 'p-company',
      kind: 'company',
      name: 'ACME',
      email: 'hello@acme.test',
    })
    await e2e.fixture.call('partner.savePartner', {
      id: 'p-contact',
      kind: 'person',
      name: 'Contact',
      email: 'contact@example.test',
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
      partnerId: 'p-contact',
      defaultCompanyId: 'acme',
    })
    await e2e.fixture.call('user.grantCompany', {
      id: 'u-admin:acme',
      userId: 'u-admin',
      companyId: 'acme',
    })
    await e2e.fixture.call('odoo_collaboration_import_fixture.seedThreads', {}, asAdmin)

    const preview = await e2e.fixture.call<{ report: OdooImportReport }>(
      'odoo_collaboration_import.previewBatch',
      { batch: batch('preview-only') },
      asAdmin,
    )
    assert.equal(preview.value.report.errors, 2)
    assert.equal(preview.value.report.counts['mail.message']?.unresolved, 2)

    await e2e.fixture.withTenant('', async ({ adapter }) => {
      assert.equal((await adapter.all('SELECT id FROM odoo_collaboration_import_run')).length, 0)
      assert.equal((await adapter.all('SELECT id FROM mail_message')).length, 0)
    })

    const first = await e2e.fixture.call<{ report: OdooImportReport }>(
      'odoo_collaboration_import.importBatch',
      { batch: batch('snapshot-1') },
      asAdmin,
    )
    assert.equal(first.value.report.errors, 2)
    assert.equal(first.value.report.warnings, 3)
    assert.ok(first.value.report.timezoneConversions >= 10)
    assert.equal(first.value.report.counts['mail.message']?.inserted, 1)

    const second = await e2e.fixture.call<{ report: OdooImportReport }>(
      'odoo_collaboration_import.importBatch',
      { batch: batch('snapshot-2') },
      asAdmin,
    )
    assert.equal(second.value.report.counts['mail.message']?.skipped, 1)
    assert.equal(second.value.report.counts['mail.message']?.unresolved, 2)
    assert.equal(second.value.report.errors, 2)
    assert.equal(second.value.report.totals.inserted, 0)
    assert.equal(second.value.report.totals.updated, 0)

    const databaseUuid = batch('unused').databaseUuid
    const messageId = stableTargetId(databaseUuid, 'mail.message', '10')
    const eventId = stableTargetId(databaseUuid, 'calendar.event', '60')
    const templateId = stableTargetId(databaseUuid, 'mail.template', '110')
    const aliasId = stableTargetId(databaseUuid, 'mail.alias', '120')
    await e2e.fixture.withTenant('', async ({ adapter }) => {
      const messages = await adapter.all('SELECT id, body, createdAt FROM mail_message')
      assert.equal(messages.length, 1)
      assert.equal(messages[0]?.id, messageId)
      assert.equal(messages[0]?.body, 'Imported safely .')
      assert.equal(messages[0]?.createdAt, '2026-08-19T07:30:00.000Z')
      assert.equal((await adapter.all('SELECT id FROM mail_follower')).length, 1)
      assert.equal((await adapter.all('SELECT id FROM mail_notification')).length, 1)
      assert.equal((await adapter.all('SELECT id FROM mail_tracking_value')).length, 1)
      assert.equal((await adapter.all('SELECT id FROM activity_activity')).length, 1)
      assert.equal((await adapter.all('SELECT id FROM activity_plan')).length, 1)
      assert.equal((await adapter.all('SELECT id FROM activity_plan_step')).length, 1)
      assert.equal((await adapter.all('SELECT id FROM calendar_event')).length, 1)
      assert.equal((await adapter.all('SELECT id FROM calendar_attendee')).length, 1)
      assert.equal((await adapter.all('SELECT id FROM calendar_reminder')).length, 1)
      assert.equal((await adapter.all('SELECT id FROM calendar_event_tag')).length, 1)
      assert.equal((await adapter.all('SELECT id FROM mail_message_attachment')).length, 1)
      const event = await adapter.all('SELECT id, startAt, timezone FROM calendar_event WHERE id = ?', [
        eventId,
      ])
      assert.equal(event[0]?.startAt, '2026-10-25T00:30:00.000Z')
      assert.equal(event[0]?.timezone, 'Europe/Paris')
      const template = await adapter.all('SELECT active FROM mail_transport_template WHERE id = ?', [
        templateId,
      ])
      assert.equal(template[0]?.active, 0)
      const alias = await adapter.all('SELECT defaults FROM mail_inbound_alias WHERE id = ?', [aliasId])
      assert.deepEqual(JSON.parse(String(alias[0]?.defaults)), { pickingTypeId: 'wh:incoming' })
      assert.equal((await adapter.all('SELECT id FROM mail_inbound_alias_domain')).length, 1)
      const deliveries = await adapter.all(
        'SELECT state, lastError FROM mail_transport_delivery ORDER BY state',
      )
      assert.equal(deliveries.length, 2)
      assert.deepEqual(
        deliveries.map((row) => row.state),
        ['failed', 'queued'],
      )
      assert.equal(
        (await adapter.all("SELECT id FROM ket_job WHERE job = 'mail_transport.deliver'")).length,
        1,
      )
      assert.equal((await adapter.all('SELECT id FROM odoo_collaboration_import_map')).length, 25)
      assert.equal((await adapter.all('SELECT id FROM odoo_collaboration_import_run')).length, 2)
    })

    const replay = await e2e.fixture.call<{ report: OdooImportReport }>(
      'odoo_collaboration_import.importBatch',
      { batch: batch('snapshot-2') },
      asAdmin,
    )
    assert.equal(replay.value.report.batchChecksum, second.value.report.batchChecksum)

    const manifest = await e2e.fixture.call<{ manifest: { readOnly: boolean; targets: unknown[] } }>(
      'odoo_collaboration_import.rollbackManifest',
      { runId: 'snapshot-1' },
      asAdmin,
    )
    assert.equal(manifest.value.manifest.readOnly, true)
    assert.ok(manifest.value.manifest.targets.length > 10)

    const badDelta = {
      ...batch('delta-bad'),
      mode: 'delta' as const,
      previousCursor: 'wrong',
      cursor: 'delta:1',
    }
    await assert.rejects(() =>
      e2e.fixture.call('odoo_collaboration_import.importBatch', { batch: badDelta }, asAdmin),
    )
  } finally {
    await e2e.close()
  }
})
