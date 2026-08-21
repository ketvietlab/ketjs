import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import { inboxScreen } from './screens.tsx'

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
      const rows = (await ctx.call('mail.listInbox', { limit: 100 }, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: 'mail_backend.inbox.title',
        body: (_, frame) => inboxScreen(_, rows, frame),
      })
    },
}
