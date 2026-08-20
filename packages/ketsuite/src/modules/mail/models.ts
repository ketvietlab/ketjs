import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
  /** The one explicit polymorphic boundary; everything below uses ordinary refs. */
  Thread: {
    scope: 'company',
    fields: {
      id: 'id',
      resModel: 'text',
      resId: 'text',
      displayName: 'text',
      active: 'bool',
      createdAt: 'datetime',
    },
    indexes: {
      target: { fields: ['companyId', 'resModel', 'resId'], unique: true },
      active_target: { fields: ['companyId', 'active', 'resModel'] },
    },
  },

  Subtype: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      name: 'text',
      defaultFollower: 'bool',
      internalOnly: 'bool',
      active: 'bool',
    },
    indexes: { code: { fields: ['companyId', 'code'], unique: true } },
  },

  Message: {
    scope: 'company',
    fields: {
      id: 'id',
      threadId: 'ref:mail.Thread',
      parentId: 'ref:mail.Message?',
      subtypeId: 'ref:mail.Subtype?',
      authorPartnerId: 'ref:partner.Partner?',
      authorUserId: 'ref:user.User?',
      emailFrom: 'text?',
      kind: 'text',
      direction: 'text',
      subject: 'text?',
      /** Escaped plain text in the first slice; never untrusted HTML. */
      body: 'text',
      externalVisible: 'bool',
      createdAt: 'datetime',
      editedAt: 'datetime?',
    },
    indexes: {
      timeline: { fields: ['companyId', 'threadId', 'createdAt', 'id'] },
      parent: { fields: ['companyId', 'parentId'] },
    },
  },

  Follower: {
    scope: 'company',
    fields: {
      id: 'id',
      threadId: 'ref:mail.Thread',
      partnerId: 'ref:partner.Partner',
      createdAt: 'datetime',
    },
    indexes: { identity: { fields: ['companyId', 'threadId', 'partnerId'], unique: true } },
  },

  FollowerSubtype: {
    scope: 'company',
    fields: {
      id: 'id',
      followerId: 'ref:mail.Follower',
      subtypeId: 'ref:mail.Subtype',
    },
    indexes: { identity: { fields: ['companyId', 'followerId', 'subtypeId'], unique: true } },
  },

  Mention: {
    scope: 'company',
    fields: {
      id: 'id',
      messageId: 'ref:mail.Message',
      partnerId: 'ref:partner.Partner',
    },
    indexes: { identity: { fields: ['companyId', 'messageId', 'partnerId'], unique: true } },
  },

  Notification: {
    scope: 'company',
    fields: {
      id: 'id',
      messageId: 'ref:mail.Message',
      recipientPartnerId: 'ref:partner.Partner',
      recipientUserId: 'ref:user.User?',
      channel: 'text',
      state: 'text',
      readAt: 'datetime?',
      failureReason: 'text?',
      createdAt: 'datetime',
    },
    indexes: {
      recipient_unread: { fields: ['companyId', 'recipientUserId', 'readAt', 'createdAt'] },
      message_recipient: {
        fields: ['companyId', 'messageId', 'recipientPartnerId', 'recipientUserId', 'channel'],
        unique: true,
      },
    },
  },

  TrackingValue: {
    scope: 'company',
    fields: {
      id: 'id',
      messageId: 'ref:mail.Message',
      field: 'text',
      oldValue: 'json?',
      newValue: 'json?',
    },
    indexes: { message: { fields: ['companyId', 'messageId'] } },
  },

  MessageAttachment: {
    scope: 'company',
    fields: {
      id: 'id',
      messageId: 'ref:mail.Message',
      attachmentId: 'ref:storage.Attachment',
    },
    indexes: { identity: { fields: ['companyId', 'messageId', 'attachmentId'], unique: true } },
  },
}
