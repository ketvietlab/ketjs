import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  AliasDomain: {
    scope: 'company',
    fields: {
      id: 'id',
      name: 'text',
      active: 'bool',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: { name: { fields: ['companyId', 'name'], unique: true } },
  },

  InboundEvent: {
    scope: 'company',
    fields: {
      id: 'id',
      provider: 'text',
      providerEventId: 'text',
      kind: 'text',
      fromAddress: 'text?',
      recipients: 'json',
      subject: 'text?',
      references: 'json',
      aliasId: 'ref:mail_inbound.Alias?',
      threadId: 'ref:mail.Thread?',
      messageId: 'ref:mail.Message?',
      state: 'text',
      diagnostic: 'text?',
      attempts: 'int',
      receivedAt: 'datetime',
      processedAt: 'datetime?',
    },
    indexes: {
      provider_event: { fields: ['companyId', 'provider', 'providerEventId'], unique: true },
      state_received: { fields: ['companyId', 'state', 'receivedAt'] },
      thread: { fields: ['companyId', 'threadId', 'receivedAt'] },
    },
  },

  ReplyToken: {
    scope: 'company',
    fields: {
      id: 'id',
      tokenDigest: 'text',
      threadId: 'ref:mail.Thread',
      parentMessageId: 'ref:mail.Message?',
      active: 'bool',
      expiresAt: 'datetime',
      createdAt: 'datetime',
    },
    indexes: { digest: { fields: ['companyId', 'tokenDigest'], unique: true } },
  },

  Alias: {
    scope: 'company',
    fields: {
      id: 'id',
      domainId: 'ref:mail_inbound.AliasDomain?',
      localPart: 'text',
      name: 'text',
      bridge: 'text',
      defaults: 'json',
      active: 'bool',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: { local_part: { fields: ['companyId', 'localPart'], unique: true } },
  },
}
