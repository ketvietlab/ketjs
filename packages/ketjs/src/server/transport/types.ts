import { KetError } from '../../kernel/errors.ts'

export type TransportAddress = { address: string; name?: string }

export type OutboundMessage = {
  /** Stable across retries; a provider that supports idempotency must use it verbatim. */
  idempotencyKey: string
  from: TransportAddress
  to: TransportAddress[]
  cc?: TransportAddress[]
  bcc?: TransportAddress[]
  replyTo?: TransportAddress
  subject: string
  text: string
  html?: string
  headers?: Record<string, string>
}

export type TransportReceipt = {
  providerMessageId: string
  acceptedAt: string
  accepted: string[]
  rejected: Array<{ address: string; reason: string }>
  /** True when the provider returned the result of an earlier call with the same key. */
  deduplicated: boolean
}

export type OutboundTransport = {
  name: string
  send(message: OutboundMessage, options?: { signal?: AbortSignal }): Promise<TransportReceipt>
  close?(): Promise<void>
}

export type OpenTransport = (
  config: import('../config.ts').RuntimeConfig,
) => OutboundTransport | Promise<OutboundTransport>

export type TransportEffect = 'transport:send'

const noNewline = (label: string, value: string): void => {
  if (value.includes('\r') || value.includes('\n'))
    throw new KetError({
      code: 'E_TRANSPORT_MESSAGE',
      message: `${label} contains a newline`,
      hint: 'transport envelope headers must be single-line values',
    })
}

/** Validate the provider boundary independently of any particular email SDK. */
export function validateOutboundMessage(message: OutboundMessage): void {
  if (!message || typeof message !== 'object')
    throw new KetError({ code: 'E_TRANSPORT_MESSAGE', message: 'outbound message must be an object' })
  if (typeof message.idempotencyKey !== 'string' || !message.idempotencyKey.trim())
    throw new KetError({
      code: 'E_TRANSPORT_MESSAGE',
      message: 'outbound message needs a non-empty idempotencyKey',
    })
  if (message.idempotencyKey.length > 200)
    throw new KetError({
      code: 'E_TRANSPORT_MESSAGE',
      message: 'outbound idempotencyKey exceeds 200 characters',
    })
  noNewline('idempotencyKey', message.idempotencyKey)
  if (typeof message.subject !== 'string' || typeof message.text !== 'string')
    throw new KetError({ code: 'E_TRANSPORT_MESSAGE', message: 'outbound subject and text must be strings' })
  noNewline('subject', message.subject)

  const recipients = [...(message.to ?? []), ...(message.cc ?? []), ...(message.bcc ?? [])]
  if (!recipients.length)
    throw new KetError({
      code: 'E_TRANSPORT_MESSAGE',
      message: 'outbound message needs at least one recipient',
    })
  const addresses = [message.from, ...recipients, ...(message.replyTo ? [message.replyTo] : [])]
  for (const [index, recipient] of addresses.entries()) {
    if (!recipient || typeof recipient.address !== 'string' || !recipient.address.trim())
      throw new KetError({
        code: 'E_TRANSPORT_MESSAGE',
        message: `outbound address ${index} is empty`,
      })
    noNewline(`address ${index}`, recipient.address)
    if (recipient.name !== undefined) noNewline(`address name ${index}`, recipient.name)
  }
  for (const [name, value] of Object.entries(message.headers ?? {})) {
    noNewline('header name', name)
    noNewline(`header ${name}`, value)
  }
}

/** Apply the declared-effect boundary before an external side effect begins. */
export function effectTransport(
  transport: OutboundTransport,
  effects: readonly string[],
  operation: string,
): OutboundTransport {
  return {
    name: transport.name,
    send(message, options) {
      if (!effects.includes('transport:send'))
        throw new KetError({
          code: 'E_EFFECT_NOT_DECLARED',
          message: `"${operation}" attempted transport:send but declares effects [${effects.join(', ') || 'none'}]`,
          hint: 'add "transport:send" to the job effects, or stop sending through the outbound transport',
        })
      validateOutboundMessage(message)
      return transport.send(message, options)
    },
  }
}

/** Default keeps apps without email bootable and fails only if a job actually sends. */
export function unavailableTransport(): OutboundTransport {
  return {
    name: 'unavailable',
    async send() {
      throw new KetError({
        code: 'E_TRANSPORT_UNAVAILABLE',
        message: 'no outbound transport is configured for this app',
        hint: 'provide serve.openTransport in the app deployment',
      })
    },
  }
}
