import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { jobs } from './jobs.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'
import { routes } from './routes.ts'

export default defineModule({
  name: 'mail_inbound',
  version: '0.1.0',
  depends: ['mail', 'mail_transport'],
  app: true,
  title: 'Email đến',
  summary: 'Webhook ký HMAC, reply routing, alias và chẩn đoán email đến.',
  category: 'Năng suất',
  models,
  relations,
  functions,
  jobs,
  routes,
  messages: {
    vi: {
      'app.title': 'Email đến',
      'app.summary': 'Webhook ký HMAC, reply routing, alias và chẩn đoán email đến.',
      'app.category': 'Năng suất',
    },
    en: {
      'app.title': 'Inbound email',
      'app.summary': 'HMAC-signed webhooks, reply routing, aliases and diagnostics.',
      'app.category': 'Productivity',
    },
  },
})

export { functions, inboundInput, inboundMutationEffects, inboundOutput } from './functions.ts'
export { jobs } from './jobs.ts'
export {
  attachmentIdsForEvents,
  inboundPlainText,
  receiveInbound,
  tokenDigest,
} from './operations.ts'
export type { AliasResolver } from './operations.ts'
export { routes, signedInboundRoute } from './routes.ts'
export { INBOUND_KINDS, INBOUND_STATES } from './types.ts'
export type {
  InboundAttachment,
  InboundInput,
  InboundKind,
  InboundResult,
  InboundState,
} from './types.ts'
