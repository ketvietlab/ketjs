import { readFile } from 'node:fs/promises'
import { bytes, compileReportTemplate, interFontUrl, renderPdf, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import { reportEditorScreen, reportsScreen } from './screens/index.tsx'

export const listReports =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    await ctx.call('report.manageTemplates', {}, url, req)
    const reports = (await ctx.call('report.listDefinitions', {}, url, req)) as AnyRow[]
    return adminPage(ctx, url, req, {
      title: 'report_backend.title',
      active: '/admin/reports',
      body: (_, frame) => reportsScreen(_, frame, reports, url.search),
    })
  }

export const reportEditor =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    await ctx.call('report.manageTemplates', {}, url, req)
    const reportId = params.report ?? ''
    const live = await ctx.live(req)
    const report = live.reports[reportId]
    if (!report) return text('Report not found', { status: 404 })
    const path = `/admin/reports/${encodeURIComponent(reportId)}`
    const action = inLocale(url, path)
    const destination = (state: string): string => {
      const next = new URL(action, url)
      next.searchParams.set(state, '1')
      return `${next.pathname}${next.search}`
    }
    if (req.method === 'POST') {
      const form = await readForm(req)
      const action = form.action ?? 'save'
      if (action === 'rollback') {
        await ctx.call('report.rollback', { reportId, version: Number(form.version ?? 0) }, url, req)
        return seeOther(destination('rolledBack'))
      }
      const saved = (await ctx.call(
        'report.saveDraft',
        { reportId, source: form.source ?? '', revision: Number(form.revision ?? 0), layout: {} },
        url,
        req,
      )) as { ok: boolean; revision?: number }
      if (!saved.ok) return seeOther(destination('invalid'))
      if (action === 'publish') {
        const published = (await ctx.call(
          'report.publish',
          { reportId, revision: saved.revision ?? 0 },
          url,
          req,
        )) as { ok: boolean }
        return seeOther(destination(published.ok ? 'published' : 'invalid'))
      }
      return seeOther(destination('saved'))
    }
    const template = (await ctx.call('report.getTemplate', { reportId }, url, req)) as AnyRow
    const versions = (await ctx.call('report.listVersions', { reportId }, url, req)) as AnyRow[]
    return adminPage(ctx, url, req, {
      title: report.title,
      active: '/admin/reports',
      body: (_, frame) =>
        reportEditorScreen(_, frame, {
          title: report.title,
          action,
          previewAction: inLocale(url, `${path}/preview`),
          template,
          versions,
        }),
    })
  }

export const previewReport =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    await ctx.call('report.manageTemplates', {}, url, req)
    if (req.method !== 'POST') return text('Method not allowed', { status: 405 })
    const reportId = params.report ?? ''
    const report = (await ctx.live(req)).reports[reportId]
    if (!report) return text('Report not found', { status: 404 })
    const form = await readForm(req)
    const data = await ctx.call(report.source, { id: form.recordId ?? '' }, url, req)
    if (!data) return text('Document not found', { status: 404 })
    const rendered = compileReportTemplate(form.source ?? '', {
      name: `${reportId}:preview`,
      translate: ctx.translate(ctx.localeOf(url, req)),
    }).render(data as AnyRow)
    const [font, semiboldFont, boldFont] = await Promise.all([
      readFile(interFontUrl()),
      readFile(interFontUrl('semibold')),
      readFile(interFontUrl('bold')),
    ])
    return bytes(renderPdf(rendered, { font, semiboldFont, boldFont }), { type: 'application/pdf' })
  }

export const routes = {
  '/admin/reports': listReports,
  '/admin/reports/{report}': reportEditor,
  '/admin/reports/{report}/preview': previewReport,
}
