import { json, text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { viewerOf } from '../backend/routes.ts'
import { backendPage } from '../../ui/index.ts'
import { calendarScreen } from './screens.tsx'

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
      return backendPage(ctx, req, {
        lang,
        title: _('calendar_backend.title'),
        body: calendarScreen(_, board, await frame(ctx, url, req, lang)),
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
