import { text } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'
import { viewerOf } from '../backend/routes.ts'
import { backendPage } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { inboxScreen } from './screens.tsx'

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
      return backendPage(ctx, req, {
        lang,
        title: _('mail_backend.inbox.title'),
        body: inboxScreen(_, rows, await frame(ctx, url, req, lang)),
      })
    },
}
