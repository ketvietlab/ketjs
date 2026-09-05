import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import { outboxScreen } from './screens/index.ts'

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

export const routes = {
  '/admin/outbox':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        if (form.action === 'retry') await ctx.call('mail_transport.retry', { id: form.id ?? '' }, url, req)
        else if (form.action === 'cancel')
          await ctx.call('mail_transport.cancel', { id: form.id ?? '' }, url, req)
        else return text('unknown outbox action', { status: 400 })
        return seeOther(inLocale(url, '/admin/outbox'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const result = (await ctx.call('mail_transport.listOutbox', { limit: 100 }, url, req)) as {
        deliveries: AnyRow[]
      }
      return adminPage(ctx, url, req, {
        title: 'mail_transport_backend.title',
        active: '/admin/outbox',
        body: (_, frame) =>
          outboxScreen(_, frame, {
            rows: result.deliveries,
            action: inLocale(url, '/admin/outbox'),
          }),
      })
    },
}
