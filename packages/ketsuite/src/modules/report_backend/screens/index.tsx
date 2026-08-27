import type { Translator } from '@ketvietlab/ketjs'
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
  ListPage,
  RecordActions,
  RecordForm,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import type { AnyRow } from '../../backend/screen.ts'

export const reportsScreen = (
  _: Translator,
  frame: Frame,
  reports: AnyRow[],
  search: string,
): TemplateResult =>
  shell(
    _,
    _('report_backend.title'),
    <ListPage
      title={_('report_backend.title')}
      actions={frame.extras?.['topbar.end']}
      status={`${_('report_backend.title')}: ${String(reports.length)}`}
      body={
        reports.length === 0 ? (
          emptyState(_('report_backend.empty'), _('report_backend.emptyHint'))
        ) : (
          <CardGrid
            items={reports}
            id={(report) => String(report.id)}
            card={(report) => {
              const href = `/admin/reports/${encodeURIComponent(String(report.id))}${search}`
              return (
                <ContentCard
                  title={_(String(report.title))}
                  summary={String(report.target)}
                  href={href}
                  actions={linkButton({
                    label: _('report_backend.action.manage'),
                    href,
                    variant: 'tertiary',
                  })}
                />
              )
            }}
          />
        )
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )

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

export const reportEditorScreen = (
  _: Translator,
  frame: Frame,
  options: { title: string; action: string; previewAction: string; template: AnyRow; versions: AnyRow[] },
): TemplateResult => {
  const form = 'report-source'
  return (
    <Framed
      translator={_}
      title={_(options.title)}
      frame={frame}
      body={stack([
        <Surface
          body={
            <RecordForm
              id={form}
              action={options.action}
              submit={_('report_backend.action.save')}
              submitVariant="primary"
              submitPlacement="external"
              hidden={{ revision: String(options.template.revision ?? 0) }}
              fields={[
                {
                  name: 'source',
                  label: _('report_backend.field.source'),
                  type: 'textarea',
                  span: 'full',
                  value: String(options.template.draft),
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
                form,
                name: 'action',
                value: 'save',
              }),
              button({
                label: _('report_backend.action.publish'),
                type: 'submit',
                form,
                name: 'action',
                value: 'publish',
                variant: 'primary',
              }),
              button({
                label: _('report_backend.action.preview'),
                type: 'submit',
                form,
                variant: 'tertiary',
                formAction: options.previewAction,
                formTarget: '_blank',
              }),
            ],
          })}
        />,
        <ContentCard
          title={_('report_backend.versions')}
          body={
            options.versions.length
              ? versionsTable(_, options.versions, options.action)
              : emptyState(_('report_backend.emptyVersions'), _('report_backend.emptyVersionsHint'))
          }
        />,
      ])}
    />
  )
}
