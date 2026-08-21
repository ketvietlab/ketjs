import { desc, defineFn, eq, from, inArray, KetError } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { queueTemplate } from './operations.ts'
import { jsonValue, templateKeys } from './template.ts'
import { PROVIDER_EVENT_TYPES } from './types.ts'

const actor = (ctx: Ctx): string => {
  if (!ctx.actor)
    throw new KetError({
      code: 'E_MAIL_ACTOR_REQUIRED',
      module: 'mail_transport',
      message: 'outbox operations require a signed-in user',
    })
  return ctx.actor
}

const saveEffects = ['read:mail_transport.Template', 'write:mail_transport.Template']
const queueEffects = [
  'read:mail_transport.Template',
  'read:mail_transport.Delivery',
  'write:mail_transport.Delivery',
  'read:mail.Message',
  'read:mail.Notification',
  'write:mail_transport.DeliveryNotification',
  'enqueue:mail_transport.deliver',
]

const normalizedKeys = (value: unknown): string[] => {
  const parsed = jsonValue<unknown>(value, [])
  if (!Array.isArray(parsed))
    throw new KetError({
      code: 'E_MAIL_TEMPLATE',
      module: 'mail_transport',
      message: 'allowedKeys must be an array',
    })
  return [...new Set(parsed.map(String))].sort()
}

export const functions: Record<string, FnSpec> = {
  saveTemplate: defineFn({
    input: {
      id: 'id',
      name: 'text',
      fromAddress: 'text',
      fromName: 'text?',
      replyTo: 'text?',
      subjectTemplate: 'text',
      textTemplate: 'text',
      htmlTemplate: 'text?',
      allowedKeys: 'json',
      active: 'bool',
    },
    output: { id: 'id', version: 'int' },
    effects: saveEffects,
    idempotent: true,
    agent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        actor(tx)
        const name = String(args.name).trim()
        const fromAddress = String(args.fromAddress).trim()
        if (!name) throw new Error('template name cannot be empty')
        if (!fromAddress.includes('@') || /[\r\n]/.test(fromAddress))
          throw new Error('template sender must be a safe email address')
        for (const value of [args.fromName, args.replyTo, args.subjectTemplate])
          if (String(value ?? '').match(/[\r\n]/))
            throw new Error('mail envelope values cannot contain newlines')
        if (args.replyTo && !String(args.replyTo).includes('@'))
          throw new Error('template reply-to must be an email address')
        const allowedKeys = normalizedKeys(args.allowedKeys)
        const usedKeys = templateKeys(
          [args.subjectTemplate, args.textTemplate, args.htmlTemplate ?? ''].map(String).join('\n'),
        )
        const forbidden = usedKeys.filter((key) => !allowedKeys.includes(key))
        if (forbidden.length) throw new Error(`template key(s) not allowlisted: ${forbidden.join(', ')}`)
        const T = tx.table('mail_transport.Template')
        const existing = await tx.db.one(from(T).where(eq(T.id, args.id)))
        const now = new Date().toISOString()
        const version = Number(existing?.version ?? 0) + 1
        const row: Row = {
          id: args.id,
          name,
          fromAddress,
          ...(args.fromName ? { fromName: String(args.fromName).trim() } : {}),
          ...(args.replyTo ? { replyTo: String(args.replyTo).trim() } : {}),
          subjectTemplate: args.subjectTemplate,
          textTemplate: args.textTemplate,
          ...(args.htmlTemplate ? { htmlTemplate: args.htmlTemplate } : {}),
          allowedKeys,
          active: args.active,
          version,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        if (existing) await tx.db.update('mail_transport.Template', { id: args.id }, row)
        else await tx.db.insert('mail_transport.Template', row)
        return { id: args.id, version }
      }),
  }),

  queueTemplate: defineFn({
    input: {
      id: 'id',
      templateId: 'id',
      context: 'json',
      to: 'json',
      cc: 'json?',
      bcc: 'json?',
      headers: 'json?',
      messageId: 'id?',
      notificationIds: 'json?',
    },
    output: { delivery: 'json' },
    effects: queueEffects,
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => ({
        delivery: await queueTemplate(tx, {
          id: String(args.id),
          templateId: String(args.templateId),
          context: args.context,
          to: args.to,
          cc: args.cc,
          bcc: args.bcc,
          headers: args.headers,
          messageId: args.messageId ? String(args.messageId) : undefined,
          notificationIds: args.notificationIds,
        }),
      })),
  }),

  listOutbox: defineFn({
    input: { state: 'text?', limit: 'int?' },
    output: { deliveries: 'json' },
    effects: [
      'read:mail_transport.Delivery',
      'read:mail_transport.Template',
      'read:mail_transport.DeliveryNotification',
      'read:mail.Notification',
      'read:mail.Message',
      'read:mail.Thread',
    ],
    handler: async (ctx: Ctx, args) => {
      actor(ctx)
      const D = ctx.table('mail_transport.Delivery')
      const all = await ctx.db.all(from(D).orderBy(desc(D.queuedAt), desc(D.id)))
      const rows = all
        .filter((row) => !args.state || row.state === args.state)
        .slice(0, Math.max(1, Math.min(200, Number(args.limit ?? 100))))
      const templateIds = [...new Set(rows.flatMap((row) => (row.templateId ? [row.templateId] : [])))]
      const T = ctx.table('mail_transport.Template')
      const templates = templateIds.length ? await ctx.db.all(from(T).where(inArray(T.id, templateIds))) : []
      const templateById = new Map(templates.map((row) => [String(row.id), row]))
      const messageIds = [...new Set(rows.flatMap((row) => (row.messageId ? [row.messageId] : [])))]
      const M = ctx.table('mail.Message')
      const messages = messageIds.length ? await ctx.db.all(from(M).where(inArray(M.id, messageIds))) : []
      const threadIds = [...new Set(messages.map((row) => row.threadId))]
      const H = ctx.table('mail.Thread')
      const threads = threadIds.length ? await ctx.db.all(from(H).where(inArray(H.id, threadIds))) : []
      const threadById = new Map(threads.map((row) => [String(row.id), row]))
      const messageById = new Map(messages.map((row) => [String(row.id), row]))
      return {
        deliveries: rows.map((row) => {
          const message = messageById.get(String(row.messageId ?? ''))
          return {
            ...row,
            templateName: templateById.get(String(row.templateId ?? ''))?.name ?? null,
            targetName: message ? (threadById.get(String(message.threadId))?.displayName ?? null) : null,
          }
        }),
      }
    },
  }),

  recordProviderEvent: defineFn({
    input: {
      id: 'id',
      provider: 'text',
      providerEventId: 'text',
      type: 'text',
      providerMessageId: 'text',
      payload: 'json',
      occurredAt: 'datetime',
    },
    output: { id: 'id', duplicate: 'bool', deliveryId: 'id?', state: 'text?' },
    effects: [
      'read:mail_transport.ProviderEvent',
      'write:mail_transport.ProviderEvent',
      'read:mail_transport.Delivery',
      'write:mail_transport.Delivery',
      'read:mail_transport.DeliveryNotification',
      'write:mail.Notification',
    ],
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        actor(tx)
        if (!PROVIDER_EVENT_TYPES.includes(String(args.type) as never))
          throw new KetError({
            code: 'E_MAIL_PROVIDER_EVENT',
            module: 'mail_transport',
            message: `unknown provider event "${String(args.type)}"`,
          })
        const P = tx.table('mail_transport.ProviderEvent')
        const existing = await tx.db.one(
          from(P).where(eq(P.provider, args.provider), eq(P.providerEventId, args.providerEventId)),
        )
        if (existing) {
          const D = tx.table('mail_transport.Delivery')
          const delivery = existing.deliveryId
            ? await tx.db.one(from(D).where(eq(D.id, existing.deliveryId)))
            : null
          return {
            id: existing.id,
            duplicate: true,
            ...(delivery ? { deliveryId: delivery.id, state: delivery.state } : {}),
          }
        }
        const D = tx.table('mail_transport.Delivery')
        const delivery = await tx.db.one(from(D).where(eq(D.providerMessageId, args.providerMessageId)))
        await tx.db.insert('mail_transport.ProviderEvent', {
          id: args.id,
          provider: String(args.provider),
          providerEventId: String(args.providerEventId),
          type: String(args.type),
          ...(delivery ? { deliveryId: delivery.id } : {}),
          providerMessageId: String(args.providerMessageId),
          payload: args.payload,
          occurredAt: args.occurredAt,
          createdAt: new Date().toISOString(),
        })
        if (!delivery) return { id: args.id, duplicate: false }
        let state = String(delivery.state)
        if (args.type === 'bounced' || args.type === 'complained') {
          state = 'failed'
          const detail = jsonValue<Record<string, unknown>>(args.payload, {})
          const reason = String(detail.reason ?? `provider reported ${String(args.type)}`).slice(0, 4_000)
          await tx.db.update(
            'mail_transport.Delivery',
            { id: delivery.id },
            { state, lastError: reason, updatedAt: new Date().toISOString() },
          )
          const J = tx.table('mail_transport.DeliveryNotification')
          const joins = await tx.db.all(from(J).where(eq(J.deliveryId, delivery.id)))
          for (const join of joins)
            await tx.db.update(
              'mail.Notification',
              { id: join.notificationId },
              { state: 'failed', failureReason: reason },
            )
        }
        return { id: args.id, duplicate: false, deliveryId: delivery.id, state }
      }),
  }),

  retry: defineFn({
    input: { id: 'id' },
    output: { id: 'id', state: 'text' },
    effects: [
      'read:mail_transport.Delivery',
      'write:mail_transport.Delivery',
      'enqueue:mail_transport.deliver',
    ],
    idempotent: true,
    handler: (ctx: Ctx, args) =>
      ctx.tx(async (tx) => {
        actor(tx)
        const D = tx.table('mail_transport.Delivery')
        const row = await tx.db.one(from(D).where(eq(D.id, args.id)))
        if (!row) throw new Error(`delivery "${String(args.id)}" does not exist`)
        if (row.state === 'sent') return { id: row.id, state: row.state }
        if (row.state === 'cancelled') throw new Error('cancelled delivery cannot be retried')
        await tx.db.update(
          'mail_transport.Delivery',
          { id: row.id },
          { state: 'queued', lastError: null, updatedAt: new Date().toISOString() },
        )
        await tx.jobs.enqueue(
          'mail_transport.deliver',
          { deliveryId: row.id, version: row.version },
          { uniqueKey: `delivery:${String(row.id)}:v${String(row.version)}` },
        )
        return { id: row.id, state: 'queued' }
      }),
  }),

  cancel: defineFn({
    input: { id: 'id' },
    output: { id: 'id', state: 'text' },
    effects: ['read:mail_transport.Delivery', 'write:mail_transport.Delivery'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      actor(ctx)
      const D = ctx.table('mail_transport.Delivery')
      const row = await ctx.db.one(from(D).where(eq(D.id, args.id)))
      if (!row) throw new Error(`delivery "${String(args.id)}" does not exist`)
      if (row.state === 'sent') throw new Error('sent delivery cannot be cancelled')
      if (row.state !== 'cancelled')
        await ctx.db.update(
          'mail_transport.Delivery',
          { id: row.id },
          { state: 'cancelled', version: Number(row.version) + 1, updatedAt: new Date().toISOString() },
        )
      return { id: row.id, state: 'cancelled' }
    },
  }),
}
