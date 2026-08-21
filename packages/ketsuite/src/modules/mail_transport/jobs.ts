import { eq, from } from '@ketvietlab/ketjs'
import type { JobContext, JobSpec, Row } from '@ketvietlab/ketjs'
import { deliveryEnvelope } from './operations.ts'

const notificationIds = async (ctx: JobContext, deliveryId: string): Promise<string[]> => {
  const J = ctx.table('mail_transport.DeliveryNotification')
  return (await ctx.db.all(from(J).where(eq(J.deliveryId, deliveryId)))).map((row) =>
    String(row.notificationId),
  )
}

const updateNotifications = async (ctx: JobContext, ids: string[], patch: Row): Promise<void> => {
  for (const id of ids) await ctx.db.update('mail.Notification', { id }, patch)
}

export const jobs: Record<string, JobSpec> = {
  deliver: {
    queue: 'mail',
    input: { deliveryId: 'id', version: 'int' },
    effects: [
      'read:mail_transport.Delivery',
      'write:mail_transport.Delivery',
      'read:mail_transport.DeliveryNotification',
      'write:mail.Notification',
      'transport:send',
    ],
    idempotent: true,
    maxAttempts: 5,
    timeoutMs: 30_000,
    handler: async (ctx: JobContext, args) => {
      const D = ctx.table('mail_transport.Delivery')
      let delivery = await ctx.db.one(from(D).where(eq(D.id, args.deliveryId)))
      if (!delivery || delivery.version !== args.version || delivery.state === 'cancelled') return
      if (delivery.state === 'sent') return
      if (!['queued', 'retryable', 'sending', 'failed'].includes(String(delivery.state)))
        throw new Error(`delivery has invalid state "${String(delivery.state)}"`)

      const attempts = Math.max(Number(delivery.attempts ?? 0), ctx.job.attempt)
      const claimed = await ctx.db.compareAndSet(
        'mail_transport.Delivery',
        { id: delivery.id },
        { state: delivery.state, version: delivery.version },
        { state: 'sending', attempts, updatedAt: new Date().toISOString() },
      )
      if ('dryRun' in claimed || !claimed.matched) {
        delivery = await ctx.db.one(from(D).where(eq(D.id, args.deliveryId)))
        if (!delivery || delivery.state === 'sent' || delivery.state === 'cancelled') return
        throw new Error('delivery claim was lost to another worker')
      }
      delivery = { ...delivery, state: 'sending', attempts }
      const boundNotifications = await notificationIds(ctx, String(delivery.id))
      try {
        const receipt = await ctx.transport.send(deliveryEnvelope(delivery), { signal: ctx.signal })
        const sentAt = receipt.acceptedAt || new Date().toISOString()
        const completed = await ctx.db.compareAndSet(
          'mail_transport.Delivery',
          { id: delivery.id },
          { state: 'sending', version: delivery.version },
          {
            state: 'sent',
            providerMessageId: receipt.providerMessageId,
            acceptedAt: receipt.acceptedAt,
            sentAt,
            lastError: null,
            updatedAt: new Date().toISOString(),
          },
        )
        if ('dryRun' in completed || !completed.matched)
          throw new Error('delivery changed while provider receipt was being persisted')
        await updateNotifications(ctx, boundNotifications, {
          state: 'sent',
          failureReason: null,
        })
      } catch (error) {
        const reason = String(error instanceof Error ? error.message : error).slice(0, 4_000)
        const terminal = ctx.job.attempt >= ctx.job.maxAttempts
        await ctx.db.compareAndSet(
          'mail_transport.Delivery',
          { id: delivery.id },
          { state: 'sending', version: delivery.version },
          {
            state: terminal ? 'failed' : 'retryable',
            lastError: reason,
            updatedAt: new Date().toISOString(),
          },
        )
        await updateNotifications(ctx, boundNotifications, {
          state: terminal ? 'failed' : 'ready',
          failureReason: reason,
        })
        throw error
      }
    },
  },
}
