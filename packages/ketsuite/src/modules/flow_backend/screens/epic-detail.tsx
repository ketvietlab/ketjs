import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  Breadcrumbs,
  FormPage,
  inline,
  linkButton,
  RecordList,
  Section,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

export type EpicDetailScreenOptions = {
  epic: AnyRow
  document: JSXChild
  issues: readonly AnyRow[]
  issueTotal: number
  issuesHref: string
  projectName: string
  locale?: string
}

/**
 * A public record shell around the epic's specialized collaborative brief.
 *
 * The FormPage owns identity and navigation only. Live Doc remains the joint-
 * provided operational island, while related issues are a bounded preview
 * with an honest total and a path to the complete filtered backlog.
 */
export const epicDetailScreen = (
  _: Translator,
  frame: Frame,
  options: EpicDetailScreenOptions,
): TemplateResult => {
  const epic = options.epic
  const locale = options.locale ?? ''
  const epicId = encodeURIComponent(String(epic.id))
  const projectId = encodeURIComponent(String(epic.projectId))
  const projectHref = localized(`/admin/flow/projects/${projectId}/epics`, locale)
  const mapHref = localized(`/admin/flow/projects/${projectId}/epics/${epicId}/map`, locale)
  const issuesHref = localized(options.issuesHref, locale)
  const title = String(epic.title ?? '')

  const page = (
    <FormPage
      variant="operational"
      frame={frame}
      scope="flow-epic-detail-form-page"
      title={title}
      description={options.projectName}
      actions={inline([
        linkButton({
          href: mapHref,
          label: _('flow_backend.epics.map'),
          variant: 'secondary',
        }),
        frame.extras?.['topbar.end'] ?? '',
      ])}
      navigation={
        <Breadcrumbs
          label={_('flow_backend.epics.trail')}
          items={[{ label: options.projectName, href: projectHref }, { label: title }]}
        />
      }
      body={stack([
        <Section title={_('flow_backend.epics.document')} body={options.document} />,
        <Section
          title={_('flow_backend.epics.issues')}
          description={_('flow_backend.epics.issueCount', { count: options.issueTotal })}
          actions={
            options.issueTotal > options.issues.length
              ? linkButton({
                  href: issuesHref,
                  label: _('flow_backend.epics.viewAllIssues'),
                  variant: 'tertiary',
                  size: 'compact',
                })
              : undefined
          }
          body={
            options.issues.length ? (
              <RecordList
                rows={options.issues}
                id={(row) => String(row.id)}
                title={(row) => String(row.title ?? '')}
                href={(row) => localized(`/admin/flow/issues/${encodeURIComponent(String(row.id))}`, locale)}
                summary={(row) => String(row.columnName ?? '')}
              />
            ) : (
              empty(_)
            )
          }
        />,
      ])}
      slots={{ header: 'flow.epic-header', body: 'flow.epic-body' }}
    />
  )

  return shell(_, title, page, { ...frame, topbar: false, titled: false })
}
