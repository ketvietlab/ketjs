import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'mail_inbound.InboundEvent': {
    alias: { belongsTo: 'mail_inbound.Alias', by: 'aliasId' },
    thread: { belongsTo: 'mail.Thread', by: 'threadId' },
    message: { belongsTo: 'mail.Message', by: 'messageId' },
  },
  'mail_inbound.ReplyToken': {
    thread: { belongsTo: 'mail.Thread', by: 'threadId' },
    parentMessage: { belongsTo: 'mail.Message', by: 'parentMessageId' },
  },
  'mail_inbound.Alias': {
    domain: { belongsTo: 'mail_inbound.AliasDomain', by: 'domainId' },
    events: { hasMany: 'mail_inbound.InboundEvent', by: 'aliasId' },
  },
  'mail_inbound.AliasDomain': {
    aliases: { hasMany: 'mail_inbound.Alias', by: 'domainId' },
  },
}
