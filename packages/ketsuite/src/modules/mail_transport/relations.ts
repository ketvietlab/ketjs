import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'mail_transport.Template': {
    deliveries: { hasMany: 'mail_transport.Delivery', by: 'templateId' },
  },
  'mail_transport.Delivery': {
    template: { belongsTo: 'mail_transport.Template', by: 'templateId' },
    message: { belongsTo: 'mail.Message', by: 'messageId' },
    notifications: { hasMany: 'mail_transport.DeliveryNotification', by: 'deliveryId' },
    events: { hasMany: 'mail_transport.ProviderEvent', by: 'deliveryId' },
  },
  'mail_transport.DeliveryNotification': {
    delivery: { belongsTo: 'mail_transport.Delivery', by: 'deliveryId' },
    notification: { belongsTo: 'mail.Notification', by: 'notificationId' },
  },
  'mail_transport.ProviderEvent': {
    delivery: { belongsTo: 'mail_transport.Delivery', by: 'deliveryId' },
  },
}
