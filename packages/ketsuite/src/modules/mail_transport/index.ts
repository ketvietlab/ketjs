import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { jobs } from './jobs.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'mail_transport',
  version: '0.1.0',
  depends: ['mail'],
  app: true,
  title: 'Gửi email',
  summary: 'Template an toàn, transactional outbox và trạng thái gửi qua durable queue.',
  category: 'Năng suất',
  models,
  relations,
  functions,
  jobs,
  messages: {
    vi: {
      'app.title': 'Gửi email',
      'app.summary': 'Template an toàn, transactional outbox và trạng thái gửi qua durable queue.',
      'app.category': 'Năng suất',
    },
    en: {
      'app.title': 'Email delivery',
      'app.summary': 'Safe templates, a transactional outbox and durable delivery state.',
      'app.category': 'Productivity',
    },
  },
})

export { functions } from './functions.ts'
export { jobs } from './jobs.ts'
export { assertDeliveryState, deliveryEnvelope, queueTemplate } from './operations.ts'
export type { QueueTemplateInput } from './operations.ts'
export { jsonValue, renderTemplate, templateKeys } from './template.ts'
export { withDeliveryStatus } from './target.ts'
export { DELIVERY_STATES, PROVIDER_EVENT_TYPES } from './types.ts'
export type { DeliveryState, MailAddress, ProviderEventType } from './types.ts'
