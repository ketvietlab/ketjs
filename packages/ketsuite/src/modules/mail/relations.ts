import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'mail.Thread': {
    messages: { hasMany: 'mail.Message', by: 'threadId' },
    followers: { hasMany: 'mail.Follower', by: 'threadId' },
  },
  'mail.Message': {
    thread: { belongsTo: 'mail.Thread', by: 'threadId' },
    parent: { belongsTo: 'mail.Message', by: 'parentId' },
    subtype: { belongsTo: 'mail.Subtype', by: 'subtypeId' },
    mentions: { hasMany: 'mail.Mention', by: 'messageId' },
    notifications: { hasMany: 'mail.Notification', by: 'messageId' },
    trackingValues: { hasMany: 'mail.TrackingValue', by: 'messageId' },
    attachments: { hasMany: 'mail.MessageAttachment', by: 'messageId' },
  },
  'mail.Follower': {
    thread: { belongsTo: 'mail.Thread', by: 'threadId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    subtypes: { hasMany: 'mail.FollowerSubtype', by: 'followerId' },
  },
  'mail.FollowerSubtype': {
    follower: { belongsTo: 'mail.Follower', by: 'followerId' },
    subtype: { belongsTo: 'mail.Subtype', by: 'subtypeId' },
  },
  'mail.Mention': {
    message: { belongsTo: 'mail.Message', by: 'messageId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
  },
  'mail.Notification': {
    message: { belongsTo: 'mail.Message', by: 'messageId' },
    partner: { belongsTo: 'partner.Partner', by: 'recipientPartnerId' },
    user: { belongsTo: 'user.User', by: 'recipientUserId' },
  },
  'mail.TrackingValue': {
    message: { belongsTo: 'mail.Message', by: 'messageId' },
  },
  'mail.MessageAttachment': {
    message: { belongsTo: 'mail.Message', by: 'messageId' },
    attachment: { belongsTo: 'storage.Attachment', by: 'attachmentId' },
  },
}
