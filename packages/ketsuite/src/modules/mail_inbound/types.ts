export const INBOUND_KINDS = ['message', 'bounce'] as const
export const INBOUND_STATES = ['processed', 'pending_alias', 'failed', 'ignored'] as const

export type InboundKind = (typeof INBOUND_KINDS)[number]
export type InboundState = (typeof INBOUND_STATES)[number]

export type InboundAttachment = {
  id: string
  name: string
  storeKey: string
  mimetype: string
  size: number
  checksum: string
  createdAt: string
}

export type InboundInput = {
  provider: string
  providerEventId: string
  kind: string
  fromAddress?: string
  recipients: unknown
  subject?: string
  text?: string
  html?: string
  references?: unknown
  replyToken?: string
  alias?: string
  attachments?: unknown
  receivedAt: string
}

export type InboundResult = {
  id: string
  duplicate: boolean
  state: string
  threadId?: string
  messageId?: string
  targetId?: string
}
