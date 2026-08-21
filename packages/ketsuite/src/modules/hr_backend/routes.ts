import { page, text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import { employeesScreen, leavesScreen, rosterScreen } from './screens.tsx'

type Req = Parameters<Route>[1]
const frame = async (ctx: ServeContext, url: URL, req: Req) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})
const document = async (ctx: ServeContext, url: URL, req: Req, title: string, body: unknown) =>
  page({
    body: ctx.document({
      lang: ctx.localeOf(url, req),
      title,
      head: await ctx.styles(req),
      body: body as never,
    }),
  })
const errors = (result: unknown, _: ReturnType<ServeContext['translate']>) =>
  ((result as { errors?: Array<{ code?: string }> } | null)?.errors ?? []).map((error) =>
    error.code ? _(error.code) : _('hr_backend.error.invalid'),
  )

export const routes: Record<string, RouteEntry> = {
  '/admin/hr':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
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
        const rows = (await ctx.call('hr.employee.manageList', {}, url, req)) as Array<
          Record<string, unknown>
        >
        return document(
          ctx,
          url,
          req,
          _('hr_backend.employees.title'),
          employeesScreen(_, await frame(ctx, url, req), rows, errors(result, _)),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('hr.employee.manageList', {}, url, req)) as Array<Record<string, unknown>>
      return document(
        ctx,
        url,
        req,
        _('hr_backend.employees.title'),
        employeesScreen(_, await frame(ctx, url, req), rows),
      )
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
          ? ((await ctx.call('hr.roster.manageList', { branchId, weekStart }, url, req)) as Array<
              Record<string, unknown>
            >)
          : []
      return document(
        ctx,
        url,
        req,
        _('hr_backend.roster.title'),
        rosterScreen(_, await frame(ctx, url, req), rows, branchId, weekStart, errors(result, _)),
      )
    },
  '/admin/hr/leaves':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
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
      const rows = (await ctx.call('hr.leave.manageList', {}, url, req)) as Array<Record<string, unknown>>
      return document(
        ctx,
        url,
        req,
        _('hr_backend.leaves.title'),
        leavesScreen(_, await frame(ctx, url, req), rows),
      )
    },
}
