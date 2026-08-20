import { json, page, text } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import { viewerOf } from '../backend/routes.ts'
import { calendarScreen } from './screens.ts'

const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1], lang: string) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
    'sidebar.foot': await ctx.joint(url, req, 'backend:sidebar.foot', { lang }),
  },
})

export const routes: Record<string, RouteEntry> = {
  '/admin/calendar':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const requested = url.searchParams.get('view')
      const view = requested === 'week' || requested === 'month' ? requested : 'agenda'
      const board = await ctx.joint(url, req, 'calendar_backend:screen.board', { lang, view })
      return page({
        body: ctx.document({
          lang,
          title: _('calendar_backend.title'),
          head: await ctx.styles(req),
          body: calendarScreen(_, board, await frame(ctx, url, req, lang)),
        }),
      })
    },
  '/calendar/rsvp/{token}': {
    anonymous: true,
    handler:
      (ctx: ServeContext): Route =>
      async (url, req, params) => {
        if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
        const state = url.searchParams.get('state') ?? 'accepted'
        const result = await ctx.call('calendar.rsvp', { token: params.token, state }, url, req)
        return json(result)
      },
  },
}
