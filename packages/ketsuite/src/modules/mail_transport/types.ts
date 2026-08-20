export const DELIVERY_STATES = ['queued', 'sending', 'retryable', 'sent', 'failed', 'cancelled'] as const

export const PROVIDER_EVENT_TYPES = ['accepted', 'delivered', 'bounced', 'complained'] as const

export type DeliveryState = (typeof DELIVERY_STATES)[number]
export type ProviderEventType = (typeof PROVIDER_EVENT_TYPES)[number]

export type MailAddress = { address: string; name?: string }
