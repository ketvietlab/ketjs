import { validateOutboundMessage } from './types.ts'
import type { OutboundMessage, OutboundTransport, TransportReceipt } from './types.ts'

export type MemoryTransport = OutboundTransport & {
  deliveries(): Array<{ message: OutboundMessage; receipt: TransportReceipt }>
  attempts(idempotencyKey: string): number
}

/** Deterministic provider double with retry failure injection and provider-side deduplication. */
export function memoryTransport(
  options: { now?: () => Date; fail?: (message: OutboundMessage, attempt: number) => Error | null } = {},
): MemoryTransport {
  const receipts = new Map<string, { message: OutboundMessage; receipt: TransportReceipt }>()
  const attemptCounts = new Map<string, number>()
  const now = options.now ?? (() => new Date())
  return {
    name: 'memory',
    async send(message, sendOptions) {
      validateOutboundMessage(message)
      if (sendOptions?.signal?.aborted) throw sendOptions.signal.reason ?? new Error('transport send aborted')
      const attempt = (attemptCounts.get(message.idempotencyKey) ?? 0) + 1
      attemptCounts.set(message.idempotencyKey, attempt)
      const previous = receipts.get(message.idempotencyKey)
      if (previous) return { ...previous.receipt, deduplicated: true }
      const failure = options.fail?.(message, attempt)
      if (failure) throw failure
      const accepted = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].map(
        (recipient) => recipient.address,
      )
      const receipt: TransportReceipt = {
        providerMessageId: `memory:${message.idempotencyKey}`,
        acceptedAt: now().toISOString(),
        accepted,
        rejected: [],
        deduplicated: false,
      }
      receipts.set(message.idempotencyKey, { message: structuredClone(message), receipt })
      return receipt
    },
    deliveries: () => [...receipts.values()].map((delivery) => structuredClone(delivery)),
    attempts: (idempotencyKey) => attemptCounts.get(idempotencyKey) ?? 0,
  }
}
