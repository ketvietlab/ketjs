import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import { outboxScreen } from './screens.tsx'

export const routes = {
  '/admin/outbox':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action === 'retry') await ctx.call('mail_transport.retry', { id: form.id ?? '' }, url, req)
        else if (form.action === 'cancel')
          await ctx.call('mail_transport.cancel', { id: form.id ?? '' }, url, req)
        else return text('unknown outbox action', { status: 400 })
        return seeOther('/admin/outbox')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const result = (await ctx.call('mail_transport.listOutbox', { limit: 100 }, url, req)) as {
        deliveries: AnyRow[]
      }
      return adminPage(ctx, url, req, {
        title: 'mail_transport_backend.title',
        body: (_, frame) => outboxScreen(_, result.deliveries, frame),
      })
    },
}
