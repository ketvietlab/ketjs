import { page, sha256, text, withHeaders } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import { credentialScreen, kioskScreen, myWorkScreen, periodScreen } from './screens.tsx'
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
const currentMonth = () => new Date().toISOString().slice(0, 7)
const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`]
}

export const routes: Record<string, RouteEntry> = {
  '/my/work':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      let message: string | undefined
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result =
          form.action === 'leave'
            ? await ctx.call(
                'hr.leave.request',
                {
                  leaveTypeId: form.leaveTypeId,
                  dateFrom: form.dateFrom,
                  dateTo: form.dateTo,
                  portion: form.portion,
                  reason: form.reason,
                },
                url,
                req,
              )
            : await ctx.call('attendance.punch.self', {}, url, req)
        message = (result as { ok?: boolean; kind?: string }).ok
          ? (result as { kind?: string }).kind
            ? _(`attendance_backend.punch.${(result as { kind?: string }).kind}`)
            : _('attendance_backend.result.success')
          : _('attendance_backend.result.failed')
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const month = currentMonth(),
        [dateFrom, dateTo] = monthRange(month)
      const [profile, sessions, shifts, leaves] = await Promise.all([
        ctx.call('hr.employee.myProfile', {}, url, req),
        ctx.call('attendance.session.mine', { month }, url, req),
        ctx.call('hr.schedule.mine', { dateFrom, dateTo }, url, req),
        ctx.call('hr.leave.mine', {}, url, req),
      ])
      return document(
        ctx,
        url,
        req,
        _('attendance_backend.my.title'),
        myWorkScreen(
          _,
          await frame(ctx, url, req),
          profile as never,
          sessions as never,
          shifts as never,
          leaves as never,
          message,
        ),
      )
    },
  '/attendance/kiosk/{secret}': {
    anonymous: true,
    handler:
      (ctx: ServeContext): Route =>
      async (url, req, params) => {
        const _ = ctx.translate(ctx.localeOf(url, req))
        let result: Record<string, unknown> | undefined
        if (req.method === 'POST') {
          const form = await readForm(req)
          result = (await ctx.call(
            'attendance.punch.kiosk',
            {
              kioskSecret: params.secret,
              employeeCode: form.employeeCode,
              pin: form.pin,
              qr: form.qr,
              networkFingerprint: sha256(
                `${req.socket.remoteAddress ?? 'unknown'}\n${String(req.headers['user-agent'] ?? '')}`,
              ),
              userAgent: String(req.headers['user-agent'] ?? ''),
            },
            url,
            req,
          )) as Record<string, unknown>
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        return document(
          ctx,
          url,
          req,
          _('attendance_backend.kiosk.title'),
          kioskScreen(_, params.secret, result),
        )
      },
  },
  '/admin/attendance':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      let month = url.searchParams.get('month') ?? currentMonth()
      if (req.method === 'POST') {
        const form = await readForm(req)
        month = form.month || month
        if (form.action === 'close') await ctx.call('attendance.period.manageClose', { month }, url, req)
        else if (form.action === 'reopen')
          await ctx.call(
            'attendance.period.manageReopen',
            { month, reason: _('attendance_backend.period.reopenReason') },
            url,
            req,
          )
        else return seeOther(`/admin/attendance?month=${encodeURIComponent(month)}`)
        return seeOther(`/admin/attendance?month=${encodeURIComponent(month)}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const period = await ctx.call('attendance.period.report', { month }, url, req)
      return document(
        ctx,
        url,
        req,
        _('attendance_backend.admin.title'),
        periodScreen(_, await frame(ctx, url, req), month, period as never),
      )
    },
  '/admin/attendance/credentials':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      let result: Record<string, unknown> | undefined
      if (req.method === 'POST') {
        const form = await readForm(req)
        result = (await ctx.call(
          form.action === 'kiosk'
            ? 'attendance.kiosk.manageIssue'
            : form.action === 'pin'
              ? 'attendance.credential.managePin'
              : 'attendance.credential.manageQr',
          form.action === 'kiosk'
            ? { name: form.name, branchId: form.branchId }
            : form.action === 'pin'
              ? { employeeId: form.employeeId, pin: form.pin }
              : { employeeId: form.employeeId },
          url,
          req,
        )) as Record<string, unknown>
        result = { ...result, credentialKind: form.action }
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return document(
        ctx,
        url,
        req,
        _('attendance_backend.credentials.title'),
        credentialScreen(_, await frame(ctx, url, req), result),
      )
    },
  '/admin/attendance/export/{month}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const result = (await ctx.call('attendance.period.export', { month: params.month }, url, req)) as {
        filename?: string
        csv?: string
      } | null
      if (!result) return text('not found', { status: 404 })
      return withHeaders(text(result.csv ?? ''), {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${result.filename}"`,
      })
    },
}
