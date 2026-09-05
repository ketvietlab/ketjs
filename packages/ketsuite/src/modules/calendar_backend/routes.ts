import { json, text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../backend/screen.ts'
import { calendarScreen } from './screens/index.ts'

export const routes: Record<string, RouteEntry> = {
  '/admin/calendar':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const requested = url.searchParams.get('view')
      const view = requested === 'week' || requested === 'month' ? requested : 'agenda'
      const board = await ctx.joint(url, req, 'calendar_backend:screen.board', {
        lang: ctx.localeOf(url, req),
        view,
      })
      return adminPage(ctx, url, req, {
        title: 'calendar_backend.title',
        active: '/admin/calendar',
        body: (_, frame) => calendarScreen(_, board, frame),
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
