import { randomUUID } from 'node:crypto'
import { dateTimeFormatter, page, sha256, text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { modalWorkspace } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, inLocale, resultErrors } from '../backend/screen.ts'
import type { Req } from '../backend/screen.ts'
import {
  credentialModal,
  credentialScreen,
  credentialSecretModal,
  leaveRequestModal,
  myWorkScreen,
  periodScreen,
} from './screens/index.ts'
import type { CredentialIssue, CredentialValues, LeaveRequestValues } from './screens/index.ts'
import { kioskScreen } from './screens.tsx'

/**
 * The kiosk is the one screen here that is not the backend: it is answered
 * anonymously on a shared tablet, so it gets no sidebar, no viewer and no menu —
 * building them would leak who was last signed in on that device.
 */
const kioskPage = async (ctx: ServeContext, url: URL, req: Req, title: string, body: unknown) =>
  page({
    body: ctx.document({
      lang: ctx.localeOf(url, req),
      title,
      head: await ctx.styles(req),
      body: body as never,
    }),
  })
const currentMonth = (timezone = 'UTC') => {
  try {
    const parts = dateTimeFormatter('en', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date())
    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    return year && month ? `${year}-${month}` : new Date().toISOString().slice(0, 7)
  } catch {
    return new Date().toISOString().slice(0, 7)
  }
}
const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`]
}

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const myWorkPath = (url: URL): string => inLocale(url, '/my/work')
const myWorkLeavePath = (url: URL): string => inLocale(url, '/my/work?leave=1')
const myWorkResultPath = (url: URL, result: string): string =>
  inLocale(url, `/my/work?result=${encodeURIComponent(result)}`)
const attendancePeriodPath = (url: URL, month?: string): string =>
  inLocale(url, month ? `/admin/attendance?month=${encodeURIComponent(month)}` : '/admin/attendance')
const CREDENTIAL_ISSUES = ['kiosk', 'pin', 'qr'] as const
const credentialIssue = (value: string | null): CredentialIssue | null =>
  (CREDENTIAL_ISSUES as readonly string[]).includes(value ?? '') ? (value as CredentialIssue) : null
const credentialsPath = (url: URL, issue?: CredentialIssue, result?: string): string =>
  inLocale(
    url,
    `/admin/attendance/credentials${
      issue || result
        ? `?${new URLSearchParams({
            ...(issue ? { issue } : {}),
            ...(result ? { result } : {}),
          }).toString()}`
        : ''
    }`,
  )
const credentialError = (field: string, code: string) => ({ ok: false, errors: [{ field, code }] })
const validRequestKey = (value: string | undefined): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(value)

export const routes: Record<string, RouteEntry> = {
  '/my/work':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      let message: { text: string; tone?: 'info' | 'positive' | 'warning' | 'danger' } | undefined
      let leaveValues: LeaveRequestValues | undefined
      let leaveErrors: readonly string[] = []
      let forceLeaveModal = false
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action === 'leave') {
          forceLeaveModal = true
          leaveValues = {
            leaveTypeId: form.leaveTypeId,
            dateFrom: form.dateFrom,
            dateTo: form.dateTo,
            portion: form.portion,
            reason: form.reason,
          }
          const result = await ctx.call('hr.leave.request', leaveValues, url, req)
          if ((result as { ok?: boolean }).ok) return seeOther(myWorkResultPath(url, 'success'))
          leaveErrors = resultErrors(result, _, 'attendance_backend.result.failed')
        } else {
          const result = await ctx.call(
            'attendance.punch.self',
            form.expect ? { expect: form.expect } : {},
            url,
            req,
          )
          if ((result as { ok?: boolean }).ok)
            return seeOther(myWorkResultPath(url, String((result as { kind?: string }).kind ?? 'success')))
          message = { text: _('attendance_backend.result.failed'), tone: 'danger' }
        }
      } else {
        const result = url.searchParams.get('result') ?? ''
        if (result === 'in' || result === 'out')
          message = { text: _(`attendance_backend.punch.${result}`), tone: 'positive' }
        else if (result === 'success')
          message = { text: _('attendance_backend.result.success'), tone: 'positive' }
      }
      const profile = (await ctx.call('hr.employee.myProfile', {}, url, req)) as Record<
        string,
        unknown
      > | null
      const scheduleMonth = currentMonth(String(profile?.timezone ?? ctx.config.defaultTimezone)),
        [dateFrom, dateTo] = monthRange(scheduleMonth)
      const [clock, sessions, shifts, leaves] = await Promise.all([
        ctx.call('attendance.clock.mine', {}, url, req),
        ctx.call('attendance.session.mine', { currentMonth: true }, url, req),
        ctx.call('hr.schedule.mine', { dateFrom, dateTo }, url, req),
        ctx.call('hr.leave.mine', {}, url, req),
      ])
      return adminPage(ctx, url, req, {
        title: 'attendance_backend.my.title',
        active: '/my/work',
        body: (_, frame) => {
          const workspace = myWorkScreen(
            _,
            {
              action: myWorkPath(url),
              clock: clock as Record<string, unknown>,
              leaveHref: myWorkLeavePath(url),
              leaves: leaves as Record<string, unknown>[],
              message,
              profile,
              sessions: sessions as Record<string, unknown>[],
              shifts: shifts as Record<string, unknown>[],
            },
            frame,
          )
          return url.searchParams.get('leave') === '1' || forceLeaveModal
            ? modalWorkspace(
                workspace,
                leaveRequestModal(_, {
                  action: myWorkLeavePath(url),
                  cancelHref: myWorkPath(url),
                  errors: leaveErrors,
                  values: leaveValues,
                }),
              )
            : workspace
        },
      })
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
        return kioskPage(
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
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      let month = url.searchParams.get('month') ?? ''
      let result: unknown = { ok: true }
      if (req.method === 'POST') {
        const form = await readForm(req)
        month = form.month || month
        const expectedVersion = /^\d+$/.test(form.expectedVersion ?? '')
          ? Number(form.expectedVersion)
          : undefined
        if (!form.action) return seeOther(attendancePeriodPath(url, month))
        if (form.action === 'close')
          result = await ctx.call(
            'attendance.period.manageClose',
            { month, ...(expectedVersion === undefined ? {} : { expectedVersion }) },
            url,
            req,
          )
        else if (form.action === 'reopen')
          result = await ctx.call(
            'attendance.period.manageReopen',
            {
              month,
              reason: _('attendance_backend.period.reopenReason'),
              ...(expectedVersion === undefined ? {} : { expectedVersion }),
            },
            url,
            req,
          )
        else return text('invalid action', { status: 400 })
        if ((result as { ok?: boolean }).ok) return seeOther(attendancePeriodPath(url, month))
      }
      const period = (await ctx.call('attendance.period.report', month ? { month } : {}, url, req)) as Record<
        string,
        unknown
      > | null
      if (period) month = String(period.month)
      const errors = resultErrors(result, _, 'attendance_backend.result.failed')
      if (!period && month && !errors.length) errors.push(_('attendance.error.periodMonth'))
      return adminPage(ctx, url, req, {
        title: 'attendance_backend.admin.title',
        active: '/admin/attendance',
        body: (_, frame) =>
          periodScreen(
            _,
            {
              action: attendancePeriodPath(url),
              errors,
              exportHref: period
                ? inLocale(url, `/admin/attendance/export/${encodeURIComponent(month)}`)
                : undefined,
              lang: url.searchParams.get('lang') ?? undefined,
              month,
              period,
              workflowAction: attendancePeriodPath(url, month),
            },
            frame,
          ),
      })
    },
  '/admin/attendance/credentials':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const asked = url.searchParams.get('issue')
      if (asked && !credentialIssue(asked)) return text('not found', { status: 404 })
      let issue = credentialIssue(asked)
      let result: unknown = { ok: true }
      let values: CredentialValues | undefined
      let secret: { issue: 'kiosk' | 'qr'; value: string } | undefined
      const scope = await ctx.scopeOf(url, req)
      const employees = (await ctx.call('attendance.credential.manageOptions', {}, url, req)) as Array<
        Record<string, unknown>
      >
      if (req.method === 'POST') {
        const form = await readForm(req)
        issue = credentialIssue(form.action ?? null)
        if (!issue) return text('invalid action', { status: 400 })
        if (asked && issue !== credentialIssue(asked)) return text('invalid action', { status: 400 })
        values = { employeeId: form.employeeId, name: form.name, requestKey: form.requestKey }
        if ((issue === 'kiosk' || issue === 'qr') && !validRequestKey(values.requestKey))
          result = credentialError('requestKey', 'attendance.error.invalid')
        else if (issue === 'kiosk' && !scope.branch)
          result = credentialError('branchId', 'attendance.error.branch')
        // manageOptions is the public permission boundary; the secret-bearing
        // mutations stay internal so they never acquire generic HTTP endpoints.
        else
          result = await ctx.callUnchecked(
            issue === 'kiosk'
              ? 'attendance.kiosk.manageIssue'
              : issue === 'pin'
                ? 'attendance.credential.managePin'
                : 'attendance.credential.manageQr',
            issue === 'kiosk'
              ? { id: values.requestKey, name: values.name, branchId: scope.branch }
              : issue === 'pin'
                ? { employeeId: values.employeeId, pin: form.pin }
                : { employeeId: values.employeeId, requestKey: values.requestKey },
            url,
            req,
          )
        if ((result as { ok?: boolean }).ok) {
          if (issue === 'pin') return seeOther(credentialsPath(url, undefined, 'pin-saved'))
          const issued = String((result as { secret?: unknown }).secret ?? '')
          if (issued) secret = { issue, value: issued }
          else result = credentialError('requestKey', 'attendance.error.invalid')
        }
      }
      const actions = {
        ...(scope.branch ? { kiosk: credentialsPath(url, 'kiosk') } : {}),
        pin: credentialsPath(url, 'pin'),
        qr: credentialsPath(url, 'qr'),
      }
      const employeeOptions = employees.map((employee) => ({
        value: String(employee.id),
        label: `${String(employee.code)} · ${String(employee.name)}`,
      }))
      const base = credentialsPath(url)
      return adminPage(ctx, url, req, {
        title: 'attendance_backend.credentials.title',
        active: '/admin/attendance/credentials',
        body: (_, frame) => {
          const workspace = credentialScreen(
            _,
            {
              actions,
              notice:
                url.searchParams.get('result') === 'pin-saved'
                  ? _('attendance_backend.credentials.pinSaved')
                  : undefined,
            },
            frame,
          )
          if (secret)
            return modalWorkspace(
              workspace,
              credentialSecretModal(_, {
                cancelHref: base,
                issue: secret.issue,
                secret: secret.value,
              }),
            )
          if (!issue) return workspace
          return modalWorkspace(
            workspace,
            credentialModal(_, {
              action: credentialsPath(url, issue),
              branchId: scope.branch ?? undefined,
              cancelHref: base,
              employeeOptions,
              errors: resultErrors(result, _, 'attendance_backend.result.failed'),
              issue,
              values: {
                ...values,
                ...(issue === 'kiosk' || issue === 'qr'
                  ? { requestKey: values?.requestKey || randomUUID() }
                  : {}),
              },
            }),
          )
        },
      })
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
