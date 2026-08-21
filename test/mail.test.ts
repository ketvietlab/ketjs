import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  callFn,
  compose,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Ctx, Row } from '@ketvietlab/ketjs'
import { company, mail, partner, storage, user } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'
import {
  ensureThread,
  followThread,
  listFollowers,
  listTimeline,
  postMessage,
  unfollowThread,
} from '../packages/ketsuite/src/modules/mail/index.ts'

const bridge = defineModule({
  name: 'mail_test_bridge',
  depends: ['mail'],
  functions: {
    setup: {
      input: {
        threadId: 'id',
        resModel: 'text',
        resId: 'id',
        displayName: 'text',
        followers: 'json?',
        subtypeIds: 'json?',
      },
      effects: [
        'read:mail.Thread',
        'write:mail.Thread',
        'read:partner.Partner',
        'read:mail.Follower',
        'write:mail.Follower',
        'read:mail.Subtype',
        'write:mail.FollowerSubtype',
      ],
      handler: (ctx: Ctx, args) =>
        ctx.tx(async (tx) => {
          const thread = await ensureThread(tx, {
            id: String(args.threadId),
            resModel: String(args.resModel),
            resId: String(args.resId),
            displayName: String(args.displayName),
            createdAt: '2026-08-20T08:00:00.000Z',
          })
          for (const partnerId of (args.followers ?? []) as string[])
            await followThread(tx, {
              id: `${String(thread.id)}:${partnerId}`,
              threadId: String(thread.id),
              partnerId,
              subtypeIds: (args.subtypeIds ?? []) as string[],
              createdAt: '2026-08-20T08:00:00.000Z',
            })
          return thread
        }),
    },
    post: {
      input: {
        id: 'id',
        threadId: 'id',
        kind: 'text',
        subtypeId: 'id?',
        body: 'text',
        authorPartnerId: 'id?',
        authorUserId: 'id?',
        mentions: 'json?',
        confirmExternalMentions: 'bool?',
      },
      effects: [
        'read:mail.Thread',
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
        ctx.tx((tx) =>
          postMessage(tx, {
            id: String(args.id),
            threadId: String(args.threadId),
            kind: String(args.kind) as 'comment' | 'note' | 'system' | 'email',
            ...(args.subtypeId ? { subtypeId: String(args.subtypeId) } : {}),
            body: String(args.body),
            ...(args.authorPartnerId ? { authorPartnerId: String(args.authorPartnerId) } : {}),
            ...(args.authorUserId ? { authorUserId: String(args.authorUserId) } : {}),
            mentionPartnerIds: (args.mentions ?? []) as string[],
            confirmExternalMentions: args.confirmExternalMentions === true,
            createdAt: `2026-08-20T08:${String(args.id).replace(/\D/g, '').padStart(2, '0')}:00.000Z`,
          }),
        ),
    },
    timeline: {
      input: { threadId: 'id' },
      effects: ['read:mail.Thread', 'read:mail.Message'],
      handler: (ctx: Ctx, args) => listTimeline(ctx, String(args.threadId)),
    },
    followers: {
      input: { threadId: 'id' },
      effects: ['read:mail.Follower'],
      handler: (ctx: Ctx, args) => listFollowers(ctx, String(args.threadId)),
    },
    unfollow: {
      input: { threadId: 'id', partnerId: 'id' },
      effects: ['read:mail.Follower', 'write:mail.Follower', 'write:mail.FollowerSubtype'],
      handler: (ctx: Ctx, args) =>
        ctx.tx((tx) => unfollowThread(tx, String(args.threadId), String(args.partnerId))),
    },
  },
})

const modules = [address, partner, company, storage, user, mail, bridge]
const manifest = compose(modules, { headless: true })
const acme = { company: 'acme', branches: null }
const beta = { company: 'beta', branches: null }

const call = (
  adapter: Adapter,
  name: string,
  args: Record<string, unknown> = {},
  options: { scope?: typeof acme; actor?: string } = {},
) =>
  callFn(name, args, {
    adapter,
    manifest,
    scope: options.scope ?? acme,
    actor: options.actor ?? null,
  })

async function boot(): Promise<Adapter> {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  for (const [id, name] of [
    ['p-author', 'Author'],
    ['p-internal', 'Internal recipient'],
    ['p-external', 'External recipient'],
  ])
    await call(adapter, 'partner.savePartner', { id, kind: 'person', name, email: `${id}@example.test` })
  for (const [id, partnerId] of [
    ['u-author', 'p-author'],
    ['u-internal', 'p-internal'],
  ])
    await call(adapter, 'user.createUser', {
      id,
      partnerId,
      login: id,
      password: 'test-password',
      name: id,
    })
  for (const [id, code, internalOnly] of [
    ['st-update', 'update', false],
    ['st-other', 'other', false],
    ['st-secret', 'secret', true],
  ] as const)
    await call(adapter, 'mail.saveSubtype', {
      id,
      code,
      name: code,
      defaultFollower: false,
      internalOnly,
      active: true,
    })
  return adapter
}

test('mail: a target has one company-scoped thread and follower subscriptions are explicit', async () => {
  const adapter = await boot()
  try {
    const first = await call(adapter, 'mail_test_bridge.setup', {
      threadId: 'thread-acme',
      resModel: 'stock.Picking',
      resId: 'pick-1',
      displayName: 'WH/OUT/0001',
      followers: ['p-author', 'p-internal', 'p-external'],
      subtypeIds: ['st-update'],
    })
    const repeated = await call(adapter, 'mail_test_bridge.setup', {
      threadId: 'ignored-racing-id',
      resModel: 'stock.Picking',
      resId: 'pick-1',
      displayName: 'WH/OUT/0001 renamed',
    })
    assert.equal((first.value as Row).id, 'thread-acme')
    assert.equal((repeated.value as Row).id, 'thread-acme')
    assert.equal((repeated.value as Row).displayName, 'WH/OUT/0001 renamed')
    assert.equal(
      ((await call(adapter, 'mail_test_bridge.followers', { threadId: 'thread-acme' })).value as Row[])
        .length,
      3,
    )

    const other = await call(
      adapter,
      'mail_test_bridge.setup',
      {
        threadId: 'thread-beta',
        resModel: 'stock.Picking',
        resId: 'pick-1',
        displayName: 'BETA/OUT/0001',
      },
      { scope: beta },
    )
    assert.equal((other.value as Row).id, 'thread-beta')
    await assert.rejects(
      () => call(adapter, 'mail_test_bridge.timeline', { threadId: 'thread-beta' }),
      (error: unknown) => (error as { code?: string }).code === 'E_MAIL_THREAD_NOT_FOUND',
    )
  } finally {
    await adapter.close()
  }
})

test('mail: subtype fan-out excludes the author and does not notify unsubscribed followers', async () => {
  const adapter = await boot()
  try {
    await call(adapter, 'mail_test_bridge.setup', {
      threadId: 'thread-acme',
      resModel: 'stock.Picking',
      resId: 'pick-1',
      displayName: 'WH/OUT/0001',
      followers: ['p-author', 'p-internal', 'p-external'],
      subtypeIds: ['st-update'],
    })
    const posted = (
      await call(adapter, 'mail_test_bridge.post', {
        id: 'm1',
        threadId: 'thread-acme',
        kind: 'comment',
        subtypeId: 'st-update',
        body: 'Transfer is ready',
        authorPartnerId: 'p-author',
        authorUserId: 'u-author',
      })
    ).value as { notifications: Row[]; recipientPartnerIds: string[] }
    assert.deepEqual(posted.recipientPartnerIds, ['p-external', 'p-internal'])
    assert.deepEqual(posted.notifications.map((row) => `${row.channel}:${row.recipientPartnerId}`).sort(), [
      'email:p-external',
      'inbox:p-internal',
    ])

    const unsubscribed = (
      await call(adapter, 'mail_test_bridge.post', {
        id: 'm2',
        threadId: 'thread-acme',
        kind: 'comment',
        subtypeId: 'st-other',
        body: 'Other event',
        authorPartnerId: 'p-author',
      })
    ).value as { notifications: Row[] }
    assert.deepEqual(unsubscribed.notifications, [])
  } finally {
    await adapter.close()
  }
})

test('mail: internal notes require explicit confirmation before disclosing an external mention', async () => {
  const adapter = await boot()
  try {
    await call(adapter, 'mail_test_bridge.setup', {
      threadId: 'thread-acme',
      resModel: 'stock.Picking',
      resId: 'pick-1',
      displayName: 'WH/OUT/0001',
      followers: ['p-internal', 'p-external'],
      subtypeIds: ['st-update'],
    })
    await assert.rejects(
      () =>
        call(adapter, 'mail_test_bridge.post', {
          id: 'm3',
          threadId: 'thread-acme',
          kind: 'note',
          body: 'Internal note with external mention',
          authorPartnerId: 'p-author',
          mentions: ['p-external'],
        }),
      (error: unknown) => (error as { code?: string }).code === 'E_MAIL_EXTERNAL_CONFIRMATION',
    )
    assert.equal((await adapter.all('SELECT * FROM mail_message WHERE id = ?', ['m3'])).length, 0)

    const internal = (
      await call(adapter, 'mail_test_bridge.post', {
        id: 'm4',
        threadId: 'thread-acme',
        kind: 'note',
        body: 'Internal only',
        authorPartnerId: 'p-author',
      })
    ).value as { notifications: Row[] }
    assert.deepEqual(
      internal.notifications.map((row) => row.recipientPartnerId),
      ['p-internal'],
    )

    const confirmed = (
      await call(adapter, 'mail_test_bridge.post', {
        id: 'm5',
        threadId: 'thread-acme',
        kind: 'note',
        body: 'Disclose after confirmation',
        authorPartnerId: 'p-author',
        mentions: ['p-external'],
        confirmExternalMentions: true,
      })
    ).value as { message: Row; notifications: Row[] }
    assert.equal(confirmed.message.externalVisible, true)
    assert.deepEqual(
      confirmed.notifications.map((row) => `${row.channel}:${row.recipientPartnerId}`).sort(),
      ['email:p-external', 'inbox:p-internal'],
    )
  } finally {
    await adapter.close()
  }
})

test('mail: inbox is actor-owned, unread state is durable and timeline remains target-gated', async () => {
  const adapter = await boot()
  try {
    await call(adapter, 'mail_test_bridge.setup', {
      threadId: 'thread-acme',
      resModel: 'stock.Picking',
      resId: 'pick-1',
      displayName: 'WH/OUT/0001',
      followers: ['p-internal'],
      subtypeIds: ['st-update'],
    })
    await call(adapter, 'mail_test_bridge.post', {
      id: 'm6',
      threadId: 'thread-acme',
      kind: 'comment',
      subtypeId: 'st-update',
      body: '<script>alert(1)</script>',
      authorPartnerId: 'p-author',
    })

    assert.deepEqual((await call(adapter, 'mail.countUnread', {}, { actor: 'u-internal' })).value, {
      count: 1,
    })
    const inbox = (await call(adapter, 'mail.listInbox', {}, { actor: 'u-internal' })).value as Row[]
    assert.equal(inbox.length, 1)
    assert.equal(
      inbox[0]!.body,
      '<script>alert(1)</script>',
      'plain text is stored verbatim for escaped rendering',
    )
    const notificationId = String(inbox[0]!.id)

    await assert.rejects(
      () =>
        call(
          adapter,
          'mail.markInboxRead',
          { id: notificationId, readAt: '2026-08-20T09:00:00.000Z' },
          { actor: 'u-author' },
        ),
      (error: unknown) => (error as { code?: string }).code === 'E_MAIL_NOTIFICATION_NOT_FOUND',
    )
    await call(
      adapter,
      'mail.markInboxRead',
      { id: notificationId, readAt: '2026-08-20T09:00:00.000Z' },
      { actor: 'u-internal' },
    )
    assert.deepEqual((await call(adapter, 'mail.countUnread', {}, { actor: 'u-internal' })).value, {
      count: 0,
    })

    const timeline = (await call(adapter, 'mail_test_bridge.timeline', { threadId: 'thread-acme' }))
      .value as Row[]
    assert.deepEqual(
      timeline.map((row) => row.id),
      ['m6'],
    )
    assert.equal(
      (await call(adapter, 'mail_test_bridge.unfollow', { threadId: 'thread-acme', partnerId: 'p-internal' }))
        .value,
      1,
    )
  } finally {
    await adapter.close()
  }
})
