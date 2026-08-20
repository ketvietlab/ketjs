import { page, text } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import { outboxScreen } from './screens.ts'

const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1], lang: string) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
    'sidebar.foot': await ctx.joint(url, req, 'backend:sidebar.foot', { lang }),
  },
})

export const routes = {
  '/admin/outbox':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
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
        deliveries: Array<Record<string, unknown>>
      }
      return page({
        body: ctx.document({
          lang,
          title: _('mail_transport_backend.title'),
          head: await ctx.styles(req),
          body: outboxScreen(_, result.deliveries, await frame(ctx, url, req, lang)),
        }),
      })
    },
}
