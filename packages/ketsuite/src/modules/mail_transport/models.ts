import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Template: {
    scope: 'company',
    fields: {
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
      version: 'int',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: { name: { fields: ['companyId', 'name'], unique: true } },
  },

  /** Immutable envelope/body snapshot consumed by the durable mail queue. */
  Delivery: {
    scope: 'company',
    fields: {
      id: 'id',
      templateId: 'ref:mail_transport.Template?',
      templateVersion: 'int?',
      messageId: 'ref:mail.Message?',
      fromAddress: 'text',
      fromName: 'text?',
      to: 'json',
      cc: 'json?',
      bcc: 'json?',
      replyTo: 'text?',
      subject: 'text',
      text: 'text',
      html: 'text?',
      headers: 'json?',
      state: 'text',
      version: 'int',
      idempotencyKey: 'text',
      providerMessageId: 'text?',
      attempts: 'int',
      lastError: 'text?',
      queuedAt: 'datetime',
      acceptedAt: 'datetime?',
      sentAt: 'datetime?',
      updatedAt: 'datetime',
    },
    indexes: {
      state: { fields: ['companyId', 'state', 'queuedAt'] },
      idempotency: { fields: ['companyId', 'idempotencyKey'], unique: true },
      provider: { fields: ['companyId', 'providerMessageId'] },
      message: { fields: ['companyId', 'messageId'] },
    },
  },

  DeliveryNotification: {
    scope: 'company',
    fields: {
      id: 'id',
      deliveryId: 'ref:mail_transport.Delivery',
      notificationId: 'ref:mail.Notification',
    },
    indexes: {
      identity: { fields: ['companyId', 'deliveryId', 'notificationId'], unique: true },
      notification: { fields: ['companyId', 'notificationId'], unique: true },
    },
  },

  ProviderEvent: {
    scope: 'company',
    fields: {
      id: 'id',
      provider: 'text',
      providerEventId: 'text',
      type: 'text',
      deliveryId: 'ref:mail_transport.Delivery?',
      providerMessageId: 'text?',
      payload: 'json',
      occurredAt: 'datetime',
      createdAt: 'datetime',
    },
    indexes: {
      provider_event: { fields: ['companyId', 'provider', 'providerEventId'], unique: true },
      delivery: { fields: ['companyId', 'deliveryId', 'occurredAt'] },
    },
  },
}
