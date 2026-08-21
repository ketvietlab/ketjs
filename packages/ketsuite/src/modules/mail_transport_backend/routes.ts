import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import { backendPage } from '../../ui/index.ts'
import { outboxScreen } from './screens.tsx'

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
      return backendPage(ctx, req, {
        lang,
        title: _('mail_transport_backend.title'),
        body: outboxScreen(_, result.deliveries, await frame(ctx, url, req, lang)),
      })
    },
}
