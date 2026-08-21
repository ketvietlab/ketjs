import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, Translator } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, resultErrors } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import { employeesScreen, leavesScreen, rosterScreen } from './screens.tsx'

const errors = (result: unknown, _: Translator) => resultErrors(result, _, 'hr_backend.error.invalid')

export const routes: Record<string, RouteEntry> = {
  '/admin/hr':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      let result: unknown = { ok: true }
      if (req.method === 'POST') {
        const form = await readForm(req)
        result = await ctx.call(
          'hr.employee.create',
          {
            id: form.id || crypto.randomUUID(),
            code: form.code,
            name: form.name,
            userId: form.userId || null,
            homeBranchId: form.homeBranchId,
            timezone: form.timezone || 'Asia/Ho_Chi_Minh',
            startDate: form.startDate,
          },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok) return seeOther('/admin/hr')
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('hr.employee.manageList', {}, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: 'hr_backend.employees.title',
        body: (_, frame) => employeesScreen(_, frame, rows, errors(result, _)),
      })
    },
  '/admin/hr/roster':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      let branchId = url.searchParams.get('branch') ?? '',
        weekStart = url.searchParams.get('week') ?? ''
      let result: unknown = { ok: true }
      if (req.method === 'POST') {
        const form = await readForm(req)
        branchId = form.branchId || url.searchParams.get('branch') || ''
        weekStart = form.weekStart || url.searchParams.get('week') || ''
        result =
          form.action === 'publish'
            ? await ctx.call(
                'hr.roster.managePublish',
                { id: url.searchParams.get('id'), version: Number(url.searchParams.get('version')) },
                url,
                req,
              )
            : form.action === 'reopen'
              ? await ctx.call(
                  'hr.roster.manageReopen',
                  { id: url.searchParams.get('id'), reason: _('hr_backend.roster.reopenReason') },
                  url,
                  req,
                )
              : await ctx.call('hr.roster.generate', { branchId, weekStart }, url, req)
        if ((result as { ok?: boolean }).ok)
          return seeOther(
            `/admin/hr/roster?branch=${encodeURIComponent(branchId)}&week=${encodeURIComponent(weekStart)}`,
          )
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows =
        branchId && weekStart
          ? ((await ctx.call('hr.roster.manageList', { branchId, weekStart }, url, req)) as AnyRow[])
          : []
      return adminPage(ctx, url, req, {
        title: 'hr_backend.roster.title',
        body: (_, frame) => rosterScreen(_, frame, rows, branchId, weekStart, errors(result, _)),
      })
    },
  '/admin/hr/leaves':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        await ctx.call(
          'hr.leave.manageDecision',
          { id: url.searchParams.get('id'), decision: form.action },
          url,
          req,
        )
        return seeOther('/admin/hr/leaves')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('hr.leave.manageList', {}, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: 'hr_backend.leaves.title',
        body: (_, frame) => leavesScreen(_, frame, rows),
      })
    },
}
