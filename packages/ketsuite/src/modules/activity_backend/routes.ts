import { text } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import { viewerOf } from '../backend/routes.ts'
import { backendPage } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { activitiesScreen } from './screens.ts'

const todayOf = (url: URL): string => {
  const requested = url.searchParams.get('today')
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

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
  '/admin/activities':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const today = todayOf(url)
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action === 'complete')
          await ctx.call(
            'activity.complete',
            { id: form.id ?? '', feedback: form.feedback ?? '', completedDate: form.today ?? today },
            url,
            req,
          )
        else if (form.action === 'reschedule')
          await ctx.call('activity.reschedule', { id: form.id ?? '', dueDate: form.dueDate ?? '' }, url, req)
        else if (form.action === 'cancel') await ctx.call('activity.cancel', { id: form.id ?? '' }, url, req)
        else return text('unknown activity action', { status: 400 })
        return seeOther(`/admin/activities?today=${encodeURIComponent(form.today ?? today)}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const includeDone = url.searchParams.get('done') === '1'
      const result = (await ctx.call('activity.listMy', { today, includeDone }, url, req)) as {
        activities: Array<Record<string, unknown>>
      }
      return backendPage(ctx, req, {
        lang,
        title: _('activity_backend.title'),
        body: activitiesScreen(_, result.activities, await frame(ctx, url, req, lang), today, includeDone),
      })
    },
}
