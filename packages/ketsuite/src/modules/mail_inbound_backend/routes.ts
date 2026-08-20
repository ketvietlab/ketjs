import { page, text } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import { viewerOf } from '../backend/routes.ts'
import { inboundScreen } from './screens.ts'

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
  '/admin/inbound-email':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const result = (await ctx.call('mail_inbound.listEvents', { limit: 100 }, url, req)) as {
        events: Array<Record<string, unknown>>
      }
      return page({
        body: ctx.document({
          lang,
          title: _('mail_inbound_backend.title'),
          head: await ctx.styles(req),
          body: inboundScreen(_, result.events, await frame(ctx, url, req, lang)),
        }),
      })
    },
}
