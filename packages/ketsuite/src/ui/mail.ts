import { each, html, signal } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import { createChatterView, createInboxIndicatorView } from './client/mail-view.mjs'

export const HOOKS = [
  'chatter',
  'chatter-head',
  'chatter-heading',
  'chatter-title',
  'chatter-followers',
  'chatter-follow',
  'chatter-composer',
  'chatter-kinds',
  'chatter-kind',
  'chatter-body',
  'chatter-compose-actions',
  'chatter-attachment',
  'chatter-send',
  'chatter-error',
  'chatter-timeline',
  'chatter-loading',
  'chatter-empty',
  'chatter-message',
  'chatter-message-head',
  'chatter-author',
  'chatter-time',
  'chatter-message-body',
  'chatter-deliveries',
  'chatter-delivery',
  'chatter-attachments',
  'chatter-more',
  'mail-indicator',
  'mail-indicator-icon',
  'mail-indicator-count',
] as const

const runtime = { each, html, signal }
const props = { resModel: 'product.Template', resId: 'contract', lang: 'en' }

/** Every conditional shape this browser component can emit, for the UI/CSS contract test. */
export const mailContractCases = (): TemplateResult[] => [
  createChatterView(runtime, props)(),
  createChatterView(runtime, props, { status: 'error', error: 'Request failed' })(),
  createChatterView(runtime, props, { status: 'ready' })(),
  createChatterView(runtime, props, {
    status: 'ready',
    page: {
      threadId: 'thread',
      displayName: 'Product',
      total: 2,
      followers: [{ id: 'follower' }],
      following: true,
      messages: [
        {
          id: 'message',
          kind: 'note',
          authorName: 'Author',
          createdAt: '2026-08-20T00:00:00.000Z',
          body: 'Body',
          attachments: [{ id: 'attachment', name: 'brief.pdf', href: '/files/attachment' }],
          deliveries: [
            { id: 'delivery-sent', state: 'sent', attempts: 1 },
            { id: 'delivery-failed', state: 'failed', attempts: 5, lastError: 'Mailbox rejected' },
          ],
        },
      ],
    },
  })(),
  createInboxIndicatorView(runtime, { lang: 'en' }, 2)(),
]
