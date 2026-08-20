import { from, inArray } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'

/**
 * Enrich a concrete Chatter target bridge without making Mail depend on delivery.
 * The bridge already verified the target; this wrapper only joins snapshots by
 * ordinary Message refs and exposes no polymorphic lookup of its own.
 */
export function withDeliveryStatus(functions: Record<string, FnSpec>): Record<string, FnSpec> {
  const timeline = functions.timeline
  if (!timeline) throw new Error('a mail target bridge must expose timeline before delivery enrichment')
  return {
    ...functions,
    timeline: {
      ...timeline,
      effects: [...(timeline.effects ?? []), 'read:mail_transport.Delivery'],
      handler: async (ctx: Ctx, args: Row) => {
        const page = (await timeline.handler(ctx, args)) as { messages?: Row[] }
        const messages = Array.isArray(page.messages) ? page.messages : []
        const messageIds = messages.map((row) => row.id)
        const D = ctx.table('mail_transport.Delivery')
        const deliveries = messageIds.length
          ? await ctx.db.all(from(D).where(inArray(D.messageId, messageIds)))
          : []
        return {
          ...page,
          messages: messages.map((message) => ({
            ...message,
            deliveries: deliveries
              .filter((delivery) => delivery.messageId === message.id)
              .map((delivery) => ({
                id: delivery.id,
                state: delivery.state,
                attempts: delivery.attempts,
                lastError: delivery.lastError,
                providerMessageId: delivery.providerMessageId,
              })),
          })),
        }
      },
    },
  }
}
