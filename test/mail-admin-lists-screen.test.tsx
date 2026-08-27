import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { inboxScreen } from '../packages/ketsuite/src/modules/mail_backend/screens/index.ts'
import { inboundScreen } from '../packages/ketsuite/src/modules/mail_inbound_backend/screens/index.ts'
import { outboxScreen } from '../packages/ketsuite/src/modules/mail_transport_backend/screens/index.ts'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

test('inbox uses ListPage and a route-owned mark-read action', () => {
  const html = renderToString(
    inboxScreen(
      translate,
      {},
      {
        rows: [
          {
            id: 'message/a',
            subject: 'Inventory changed',
            kind: 'comment',
            body: 'Please review the new quantity.',
            createdAt: '2026-08-27T08:00:00.000Z',
          },
        ],
        action: '/admin/inbox?lang=en',
      },
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /action="\/admin\/inbox\?lang=en"/)
  assert.match(html, /name="action" value="read"/)
  assert.match(html, /name="id" value="message\/a"/)
})

test('inbound email log uses ListPage and retains diagnostic state', () => {
  const html = renderToString(
    inboundScreen(
      translate,
      {},
      {
        rows: [
          {
            id: 'event/a',
            providerEventId: 'provider/a',
            subject: 'Re: Order',
            fromAddress: 'buyer@example.com',
            provider: 'smtp',
            kind: 'reply',
            state: 'failed',
            diagnostic: 'Target was not found',
          },
        ],
      },
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /mail_inbound_backend\.state\.failed/)
  assert.match(html, /Target was not found/)
})

test('outbox uses ListPage and route-owned retry and cancel actions', () => {
  const html = renderToString(
    outboxScreen(
      translate,
      {},
      {
        rows: [
          {
            id: 'delivery/failed',
            subject: 'Failed delivery',
            to: JSON.stringify([{ address: 'buyer@example.com' }]),
            state: 'failed',
            attempts: 2,
            lastError: 'Connection refused',
          },
          {
            id: 'delivery/queued',
            subject: 'Queued delivery',
            to: JSON.stringify([{ address: 'vendor@example.com' }]),
            state: 'queued',
            attempts: 0,
            text: 'Waiting to send',
          },
        ],
        action: '/admin/outbox?lang=en',
      },
    ),
  )

  assert.match(html, /data-ui="list-page"/)
  assert.equal((html.match(/action="\/admin\/outbox\?lang=en"/g) ?? []).length, 2)
  assert.match(html, /name="action" value="retry"/)
  assert.match(html, /name="action" value="cancel"/)
})
