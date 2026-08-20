import { page, text } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import { viewerOf } from '../backend/routes.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { inboxScreen } from './screens.ts'

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
  '/admin/inbox':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        await ctx.call(
          'mail.markInboxRead',
          { id: form.id ?? '', readAt: new Date().toISOString() },
          url,
          req,
        )
        return seeOther('/admin/inbox')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('mail.listInbox', { limit: 100 }, url, req)) as Array<
        Record<string, unknown>
      >
      return page({
        body: ctx.document({
          lang,
          title: _('mail_backend.inbox.title'),
          head: await ctx.styles(req),
          body: inboxScreen(_, rows, await frame(ctx, url, req, lang)),
        }),
      })
    },
}
