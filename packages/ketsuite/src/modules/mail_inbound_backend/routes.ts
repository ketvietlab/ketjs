import { text } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import { viewerOf } from '../backend/routes.ts'
import { backendPage } from '../../ui/index.ts'
import { inboundScreen } from './screens.ts'

const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1], lang: string) => ({
  navigation: req.headers['x-ket-navigation'] === 'fragment-v1',
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
    'sidebar.foot':
      req.headers['x-ket-navigation'] === 'fragment-v1'
        ? undefined
        : await ctx.joint(url, req, 'backend:sidebar.foot', { lang }),
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
      return backendPage(ctx, req, {
        lang,
        title: _('mail_inbound_backend.title'),
        body: inboundScreen(_, result.events, await frame(ctx, url, req, lang)),
      })
    },
}
