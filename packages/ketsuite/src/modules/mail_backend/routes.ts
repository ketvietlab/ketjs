import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import { inboxScreen } from './screens/index.ts'

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

export const routes = {
  '/admin/inbox':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        if (form.action && form.action !== 'read') return text('unknown inbox action', { status: 400 })
        await ctx.call(
          'mail.markInboxRead',
          { id: form.id ?? '', readAt: new Date().toISOString() },
          url,
          req,
        )
        return seeOther(inLocale(url, '/admin/inbox'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('mail.listInbox', { limit: 100 }, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: 'mail_backend.inbox.title',
        active: '/admin/inbox',
        body: (_, frame) =>
          inboxScreen(_, frame, {
            rows,
            action: inLocale(url, '/admin/inbox'),
          }),
      })
    },
}
