import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import { inboundScreen } from './screens/index.ts'

export const routes = {
  '/admin/inbound-email':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const result = (await ctx.call('mail_inbound.listEvents', { limit: 100 }, url, req)) as {
        events: AnyRow[]
      }
      return adminPage(ctx, url, req, {
        title: 'mail_inbound_backend.title',
        active: '/admin/inbound-email',
        body: (_, frame) => inboundScreen(_, frame, { rows: result.events }),
      })
    },
}
