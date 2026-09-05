import { text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import { activitiesScreen } from './screens/index.ts'

const targetPath = (row: AnyRow): string | null => {
  const id = encodeURIComponent(String(row.resId))
  if (row.resModel === 'product.Template') return `/admin/product/templates/${id}`
  if (row.resModel === 'stock.Picking') return `/admin/stock/transfers/${id}`
  if (row.resModel === 'sale.Order') return `/admin/sales/quotations/${id}`
  return null
}

const todayOf = (url: URL): string => {
  const requested = url.searchParams.get('today')
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

export const routes = {
  '/admin/activities':
    (ctx: ServeContext): Route =>
    async (url, req) => {
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
        const next = new URL(inLocale(url, '/admin/activities'), url)
        next.searchParams.set('today', form.today ?? today)
        if (url.searchParams.get('done') === '1') next.searchParams.set('done', '1')
        return seeOther(`${next.pathname}${next.search}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const includeDone = url.searchParams.get('done') === '1'
      const result = (await ctx.call('activity.listMy', { today, includeDone }, url, req)) as {
        activities: AnyRow[]
      }
      return adminPage(ctx, url, req, {
        title: 'activity_backend.title',
        active: '/admin/activities',
        body: (_, frame) => {
          const toggle = new URL(inLocale(url, '/admin/activities'), url)
          toggle.searchParams.set('today', today)
          if (!includeDone) toggle.searchParams.set('done', '1')
          return activitiesScreen(_, frame, {
            rows: result.activities.map((row) => {
              const path = targetPath(row)
              return { ...row, targetHref: path ? inLocale(url, path) : null }
            }),
            action: inLocale(url, '/admin/activities'),
            toggleHref: `${toggle.pathname}${toggle.search}`,
            includeDone,
            today,
          })
        },
      })
    },
}
