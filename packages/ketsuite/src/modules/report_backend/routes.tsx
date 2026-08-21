import { readFile } from 'node:fs/promises'
import { bytes, compileReportTemplate, interFontUrl, renderPdf, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  actionGroup,
  button,
  CardGrid,
  ContentCard,
  dataTable,
  emptyState,
  Framed,
  linkButton,
  RecordActions,
  RecordForm,
  stack,
  Surface,
} from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'

export const listReports =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    await ctx.call('report.manageTemplates', {}, url, req)
    const reports = (await ctx.call('report.listDefinitions', {}, url, req)) as AnyRow[]
    return adminPage(ctx, url, req, {
      title: 'report_backend.title',
      body: (_, frame) => (
        <Framed
          translator={_}
          title={_('report_backend.title')}
          frame={frame}
          body={
            reports.length === 0 ? (
              emptyState(_('report_backend.empty'), _('report_backend.emptyHint'))
            ) : (
              <CardGrid
                items={reports}
                id={(report) => String(report.id)}
                card={(report) => (
                  <ContentCard
                    title={_(String(report.title))}
                    summary={String(report.target)}
                    href={`/admin/reports/${encodeURIComponent(String(report.id))}${url.search}`}
                    actions={linkButton({
                      label: _('report_backend.action.manage'),
                      href: `/admin/reports/${encodeURIComponent(String(report.id))}${url.search}`,
                      variant: 'tertiary',
                    })}
                  />
                )}
              />
            )
          }
        />
      ),
    })
  }

/**
 * The version list, and the one control that acts on a row.
 *
 * Each rollback is its own POST, so each row carries its own form rather than a
 * checkbox column and a bulk action nobody asked for.
 */
const versionsTable = (_: Translator, versions: AnyRow[], path: string): TemplateResult =>
  dataTable(_, {
    rows: versions,
    id: (version) => String(version.id),
    columns: [
      {
        key: 'version',
        label: _('report_backend.col.version'),
        kind: 'identifier',
        priority: 'primary',
        cell: (version) => `v${String(version.version)}`,
      },
      {
        key: 'publishedAt',
        label: _('report_backend.col.publishedAt'),
        priority: 'secondary',
        cell: (version) => String(version.publishedAt),
      },
      {
        key: 'rollback',
        label: _('report_backend.col.rollback'),
        align: 'end',
        cell: (version) => (
          <RecordActions
            action={path}
            hidden={{ version: String(version.version) }}
            actions={[
              {
                value: 'rollback',
                label: _('report_backend.action.rollback'),
                variant: 'tertiary' as const,
              },
            ]}
          />
        ),
      },
    ],
  })

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
    const template = (await ctx.call('report.getTemplate', { reportId }, url, req)) as AnyRow
    const versions = (await ctx.call('report.listVersions', { reportId }, url, req)) as AnyRow[]
    // The three submits share one form through `form=`, which is why the form
    // declares an id and keeps its own submit out of the way: save and publish are
    // the same POST with a different `action`, and preview sends the same draft to
    // a different path so you can read the PDF beside the source you typed.
    const FORM = 'report-source'
    return adminPage(ctx, url, req, {
      title: report.title,
      body: (_, frame) => (
        <Framed
          translator={_}
          title={_(report.title)}
          frame={frame}
          body={stack([
            <Surface
              body={
                <RecordForm
                  id={FORM}
                  action={path}
                  submit={_('report_backend.action.save')}
                  submitVariant="primary"
                  submitPlacement="external"
                  hidden={{ revision: String(template.revision ?? 0) }}
                  fields={[
                    {
                      name: 'source',
                      label: _('report_backend.field.source'),
                      type: 'textarea',
                      span: 'full',
                      value: String(template.draft),
                    },
                    {
                      name: 'recordId',
                      label: _('report_backend.field.previewRecord'),
                      span: 'half',
                    },
                  ]}
                />
              }
            />,
            <Surface
              body={actionGroup({
                actions: [
                  button({
                    label: _('report_backend.action.save'),
                    type: 'submit',
                    form: FORM,
                    name: 'action',
                    value: 'save',
                  }),
                  button({
                    label: _('report_backend.action.publish'),
                    type: 'submit',
                    form: FORM,
                    name: 'action',
                    value: 'publish',
                    variant: 'primary',
                  }),
                  button({
                    label: _('report_backend.action.preview'),
                    type: 'submit',
                    form: FORM,
                    variant: 'tertiary',
                    formAction: `${path}/preview`,
                    formTarget: '_blank',
                  }),
                ],
              })}
            />,
            <ContentCard
              title={_('report_backend.versions')}
              body={
                versions.length
                  ? versionsTable(_, versions, path)
                  : emptyState(_('report_backend.emptyVersions'), _('report_backend.emptyVersionsHint'))
              }
            />,
          ])}
        />
      ),
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
