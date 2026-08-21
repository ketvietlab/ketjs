import { readFile } from 'node:fs/promises'
import { bytes, compileReportTemplate, interFontUrl, page, renderPdf, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { each } from '@ketvietlab/ketjs-view'
import { actionGroup, button, contentCard, linkButton, shell, stack, surface } from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'

type Row = Record<string, unknown>

const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]): Promise<Frame> => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})

const screen = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  title: string,
  body: ReturnType<typeof stack>,
) => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return page({
    body: ctx.document({
      lang,
      title,
      head: await ctx.styles(req),
      body: shell(_, title, body, await frame(ctx, url, req)),
    }),
  })
}

export const listReports =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    await ctx.call('report.manageTemplates', {}, url, req)
    const _ = ctx.translate(ctx.localeOf(url, req))
    const reports = (await ctx.call('report.listDefinitions', {}, url, req)) as Row[]
    return screen(
      ctx,
      url,
      req,
      _('report_backend.title'),
      stack([
        <div data-ui="card-grid">
          {each(
            reports,
            (report) => String(report.id),
            (report) =>
              contentCard({
                title: _(String(report.title)),
                body: (
                  <div>
                    <p>{String(report.id)}</p>
                    <p>{String(report.target)}</p>
                    {linkButton({
                      label: _('report_backend.action.manage'),
                      href: `/admin/reports/${encodeURIComponent(String(report.id))}${url.search}`,
                    })}
                  </div>
                ),
              }),
          )}
        </div>,
      ]),
    )
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
    if (req.method === 'POST') {
      const form = await readForm(req)
      const action = form.action ?? 'save'
      if (action === 'rollback') {
        await ctx.call('report.rollback', { reportId, version: Number(form.version ?? 0) }, url, req)
        return seeOther(`${path}?rolledBack=1`)
      }
      const saved = (await ctx.call(
        'report.saveDraft',
        { reportId, source: form.source ?? '', revision: Number(form.revision ?? 0), layout: {} },
        url,
        req,
      )) as { ok: boolean; revision?: number }
      if (!saved.ok) return seeOther(`${path}?invalid=1`)
      if (action === 'publish') {
        const published = (await ctx.call(
          'report.publish',
          { reportId, revision: saved.revision ?? 0 },
          url,
          req,
        )) as { ok: boolean }
        return seeOther(`${path}?${published.ok ? 'published=1' : 'invalid=1'}`)
      }
      return seeOther(`${path}?saved=1`)
    }
    const _ = ctx.translate(ctx.localeOf(url, req))
    const template = (await ctx.call('report.getTemplate', { reportId }, url, req)) as Row
    const versions = (await ctx.call('report.listVersions', { reportId }, url, req)) as Row[]
    return screen(
      ctx,
      url,
      req,
      _(report.title),
      stack([
        surface({
          body: (
            <form data-ui="record-form" method="post" action={path}>
              <input type="hidden" name="revision" value={String(template.revision ?? 0)} />
              <div data-ui="form-grid">
                <label data-ui="form-field" data-span="full" data-kind="textarea">
                  <span data-ui="form-label">{_('report_backend.field.source')}</span>
                  <textarea data-ui="form-control" name="source" rows="24" spellcheck="false">
                    {String(template.draft)}
                  </textarea>
                </label>
                <label data-ui="form-field" data-span="half" data-kind="text">
                  <span data-ui="form-label">{_('report_backend.field.previewRecord')}</span>
                  <input data-ui="form-control" name="recordId" type="text" />
                </label>
              </div>
              <div data-ui="form-actions">
                {actionGroup({
                  actions: [
                    button({
                      label: _('report_backend.action.save'),
                      type: 'submit',
                      name: 'action',
                      value: 'save',
                    }),
                    button({
                      label: _('report_backend.action.publish'),
                      type: 'submit',
                      name: 'action',
                      value: 'publish',
                      variant: 'primary',
                    }),
                    <button
                      data-ui="action"
                      data-variant="tertiary"
                      type="submit"
                      formaction={`${path}/preview`}
                      formtarget="_blank"
                    >
                      {_('report_backend.action.preview')}
                    </button>,
                  ],
                })}
              </div>
            </form>
          ),
        }),
        contentCard({
          title: _('report_backend.versions'),
          body: versions.length ? (
            <div>
              {each(
                versions,
                (version) => String(version.id),
                (version) => (
                  <form method="post" action={path}>
                    <input type="hidden" name="action" value="rollback" />
                    <input type="hidden" name="version" value={String(version.version)} />
                    <span>
                      v{String(version.version)} · {String(version.publishedAt)}
                    </span>
                    {button({
                      label: _('report_backend.action.rollback'),
                      type: 'submit',
                      variant: 'tertiary',
                    })}
                  </form>
                ),
              )}
            </div>
          ) : (
            <p>{_('report_backend.emptyVersions')}</p>
          ),
        }),
      ]),
    )
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
    const document = compileReportTemplate(form.source ?? '', {
      name: `${reportId}:preview`,
      translate: ctx.translate(ctx.localeOf(url, req)),
    }).render(data as Row)
    const [font, semiboldFont, boldFont] = await Promise.all([
      readFile(interFontUrl()),
      readFile(interFontUrl('semibold')),
      readFile(interFontUrl('bold')),
    ])
    return bytes(renderPdf(document, { font, semiboldFont, boldFont }), { type: 'application/pdf' })
  }

export const routes = {
  '/admin/reports': listReports,
  '/admin/reports/{report}': reportEditor,
  '/admin/reports/{report}/preview': previewReport,
}
