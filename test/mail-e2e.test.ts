import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineApp, defineModule, eq, from, KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { createTestApp, TestHttpError } from '@ketvietlab/ketjs/testing'
import { company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'
import { ensureThread, followThread, postMessage } from '../packages/ketsuite/src/modules/mail/index.ts'

const recordBridge = defineModule({
  name: 'mail_e2e_bridge',
  depends: ['mail'],
  app: true,
  models: {
    Record: { scope: 'company', fields: { id: 'id', name: 'text' } },
  },
  functions: {
    saveRecord: {
      input: { id: 'id', name: 'text' },
      effects: ['write:mail_e2e_bridge.Record'],
      idempotent: true,
      handler: (ctx: Ctx, args) => ctx.db.insertIfAbsent('mail_e2e_bridge.Record', args),
    },
    prepare: {
      input: { recordId: 'id', threadId: 'id', followerId: 'id' },
      effects: [
        'read:mail_e2e_bridge.Record',
        'read:mail.Thread',
        'write:mail.Thread',
        'read:partner.Partner',
        'read:mail.Follower',
        'write:mail.Follower',
      ],
      handler: (ctx: Ctx, args) =>
        ctx.tx(async (tx) => {
          const R = tx.table('mail_e2e_bridge.Record')
          const record = await tx.db.one(from(R).where(eq(R.id, args.recordId)))
          if (!record)
            throw new KetError({
              code: 'E_MAIL_E2E_TARGET',
              message: 'record is outside this company or missing',
            })
          const thread = await ensureThread(tx, {
            id: String(args.threadId),
            resModel: 'mail_e2e_bridge.Record',
            resId: String(record.id),
            displayName: String(record.name),
          })
          await followThread(tx, {
            id: `${String(thread.id)}:${String(args.followerId)}`,
            threadId: String(thread.id),
            partnerId: String(args.followerId),
          })
          return { threadId: thread.id }
        }),
    },
    post: {
      input: { id: 'id', recordId: 'id', body: 'text' },
      output: { id: 'id', threadId: 'id', body: 'text' },
      effects: [
        'read:mail_e2e_bridge.Record',
        'read:mail.Thread',
        'write:mail.Thread',
        'read:mail.Message',
        'write:mail.Message',
        'read:mail.Subtype',
        'read:partner.Partner',
        'read:user.User',
        'read:mail.Follower',
        'read:mail.FollowerSubtype',
        'read:storage.Attachment',
        'write:mail.Mention',
        'write:mail.MessageAttachment',
        'write:mail.TrackingValue',
        'write:mail.Notification',
      ],
      handler: (ctx: Ctx, args) =>
        ctx.tx(async (tx) => {
          const R = tx.table('mail_e2e_bridge.Record')
          const record = await tx.db.one(from(R).where(eq(R.id, args.recordId)))
          if (!record)
            throw new KetError({
              code: 'E_MAIL_E2E_TARGET',
              message: 'record is outside this company or missing',
            })
          const thread = await ensureThread(tx, {
            id: `thread:${String(record.id)}`,
            resModel: 'mail_e2e_bridge.Record',
            resId: String(record.id),
            displayName: String(record.name),
          })
          const posted = await postMessage(tx, {
            id: String(args.id),
            threadId: String(thread.id),
            kind: 'comment',
            body: String(args.body),
            ...(ctx.actor ? { authorUserId: ctx.actor } : {}),
          })
          return posted.message
        }),
    },
  },
})

const app = defineApp({
  name: 'mail_headless_e2e',
  modules: [address, partner, company, storage, user, mail, recordBridge],
  headless: true,
  serve: {
    bootstrap: ['mail_e2e_bridge'],
    sessions: { anonymous: { company: 'acme' } },
  },
})

test('mail headless E2E: authenticated post crosses HTTP and reaches the recipient inbox', async () => {
  const e2e = await createTestApp(app, { worker: false })
  try {
    for (const [id, name] of [
      ['p-company', 'ACME'],
      ['p-author', 'Author'],
      ['p-recipient', 'Recipient'],
    ])
      await e2e.fixture.call('partner.savePartner', {
        id,
        kind: id === 'p-company' ? 'company' : 'person',
        name,
        email: `${id}@example.test`,
      })
    await e2e.fixture.call('company.saveCompany', {
      id: 'acme',
      partnerId: 'p-company',
      currency: 'VND',
    })
    for (const [id, partnerId] of [
      ['u-author', 'p-author'],
      ['u-recipient', 'p-recipient'],
    ]) {
      await e2e.fixture.call('user.createUser', {
        id,
        login: id,
        password: 'test-password',
        name: id,
        partnerId,
        defaultCompanyId: 'acme',
      })
      await e2e.fixture.call('user.grantCompany', {
        id: `${id}:acme`,
        userId: id,
        companyId: 'acme',
      })
    }
    await e2e.fixture.call(
      'mail_e2e_bridge.saveRecord',
      { id: 'r1', name: 'Transfer WH/OUT/0001' },
      {
        scope: { company: 'acme', branches: null },
      },
    )
    await e2e.fixture.call(
      'mail_e2e_bridge.prepare',
      { recordId: 'r1', threadId: 'thread:r1', followerId: 'p-recipient' },
      { scope: { company: 'acme', branches: null } },
    )

    await assert.rejects(
      () => e2e.client.call('mail_e2e_bridge.post', { id: 'm1', recordId: 'r1', body: 'closed' }),
      (error: unknown) => {
        assert.ok(error instanceof TestHttpError)
        assert.equal((error.body as { code?: string }).code, 'E_FN_NOT_PERMITTED')
        return true
      },
    )
    await e2e.client.login({ login: 'u-author', password: 'test-password' })
    const posted = await e2e.client.call<Row>('mail_e2e_bridge.post', {
      id: 'm1',
      recordId: 'r1',
      body: '<b>Ready to ship</b>',
    })
    assert.deepEqual(posted.value, { id: 'm1', threadId: 'thread:r1', body: '<b>Ready to ship</b>' })

    const recipient = e2e.client.anonymous()
    await recipient.login({ login: 'u-recipient', password: 'test-password' })
    const inbox = await recipient.call<Row[]>('mail.listInbox')
    assert.equal(inbox.value.length, 1)
    assert.equal(inbox.value[0]!.messageId, 'm1')
    assert.equal(inbox.value[0]!.body, '<b>Ready to ship</b>')

    await e2e.fixture.withTenant('', async ({ adapter }) => {
      const rows = await adapter.all(
        'SELECT "resModel", "resId", "companyId" FROM mail_thread WHERE id = ?',
        ['thread:r1'],
      )
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.resModel, 'mail_e2e_bridge.Record')
      assert.equal(rows[0]!.resId, 'r1')
      assert.equal(rows[0]!.companyId, 'acme')
    })
  } finally {
    await e2e.close()
  }
})
