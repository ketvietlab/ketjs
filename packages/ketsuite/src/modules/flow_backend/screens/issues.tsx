import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  emptyState,
  inline,
  LinkButton,
  linkButton,
  ListPage,
  listChrome,
  modalForm,
  Progress,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { FormField, Frame, TableGroup } from '../../../ui/index.ts'
import { FIELD_FILTER_MATCHES } from '../../flow/index.ts'
import { localized } from '../../backend/screen.ts'
import type { AnyRow } from './shared.tsx'
import { filterTruncatedNotice, priorityBadge, when } from './shared.tsx'

export type ProjectIssuesOptions = {
  projectName: string
  rows: AnyRow[]
  groups?: TableGroup<AnyRow>[]
  /** This project's custom fields, each becoming a column of its own. */
  fields?: AnyRow[]
  total: number
  createHref: string
  locale?: string
  /** Set when a custom-field filter stopped short — see filterTruncatedNotice. */
  filterTruncated?: boolean
  /**
   * Where to go to see archived issues, and whether they are already showing.
   * `Issue.active` was filterable long before anything could write it; now that
   * archiving exists, the list needs a door to what it hides.
   */
  archivedHref?: string
  showingArchived?: boolean
}

export type IssueCreateModalOptions = {
  projectName: string
  fields: FormField[]
  action: string
  cancelHref: string
  idempotencyKey: string
  errors?: readonly string[]
}

export const issueCreateModal = (_: Translator, options: IssueCreateModalOptions): TemplateResult =>
  modalForm({
    id: 'flow-issue-create',
    title: _('flow_backend.action.create'),
    description: options.projectName,
    closeHref: options.cancelHref,
    closeLabel: _('flow_backend.action.cancel'),
    form: {
      id: 'flow-issue-create-form',
      scope: 'flow-issue-create',
      action: options.action,
      submit: _('flow_backend.action.create'),
      submitVariant: 'primary',
      cancelHref: options.cancelHref,
      cancelLabel: _('flow_backend.action.cancel'),
      hidden: {
        returnTo: options.cancelHref,
        idempotencyKey: options.idempotencyKey,
      },
      fields: options.fields,
      errors: options.errors,
    },
  })

export const issuesScreen = (_: Translator, frame: Frame, options: ProjectIssuesOptions): TemplateResult => {
  const groups = options.groups ?? []
  const fields = options.fields ?? []
  const locale = options.locale ?? ''
  const hasActions = options.createHref || options.archivedHref || frame.extras?.['topbar.end'] !== undefined

  return shell(
    _,
    options.projectName,
    <ListPage
      variant="operational"
      frame={frame}
      title={options.projectName}
      description={_('flow_backend.issues.subtitle')}
      actions={
        hasActions
          ? inline([
              options.archivedHref ? (
                <LinkButton
                  label={_(
                    options.showingArchived
                      ? 'flow_backend.issue.hideArchived'
                      : 'flow_backend.issue.showArchived',
                  )}
                  href={options.archivedHref}
                  variant="secondary"
                />
              ) : (
                ''
              ),
              options.createHref ? (
                <LinkButton
                  label={_('flow_backend.action.create')}
                  href={options.createHref}
                  variant="primary"
                />
              ) : (
                ''
              ),
              frame.extras?.['topbar.end'] ?? '',
            ])
          : undefined
      }
      controls={
        frame.chrome
          ? listChrome(
              _,
              options.projectName,
              {
                ...frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={`${options.projectName}: ${String(options.total)}`}
      body={stack([
        options.filterTruncated ? filterTruncatedNotice(_, FIELD_FILTER_MATCHES) : null,
        options.rows.length || groups.length
          ? dataTable(_, {
              rows: options.rows,
              groups,
              id: (row) => String(row.id),
              rowHref: (row) => localized(`/admin/flow/issues/${encodeURIComponent(String(row.id))}`, locale),
              columns: [
                {
                  key: 'title',
                  label: _('flow_backend.field.title'),
                  priority: 'primary',
                  cell: (row) =>
                    linkButton({
                      href: localized(`/admin/flow/issues/${encodeURIComponent(String(row.id))}`, locale),
                      label: String(row.title),
                      variant: 'tertiary',
                      size: 'compact',
                    }),
                },
                {
                  key: 'column',
                  label: _('flow_backend.field.column'),
                  cell: (row) => String(row.columnName ?? '—'),
                },
                {
                  key: 'assignee',
                  label: _('flow_backend.field.assignee'),
                  cell: (row) => String(row.assigneeName ?? '—'),
                },
                {
                  key: 'priority',
                  label: _('flow_backend.field.priority'),
                  cell: (row) => priorityBadge(_, row.priority),
                },
                {
                  key: 'dueDate',
                  label: _('flow_backend.field.dueDate'),
                  kind: 'date',
                  cell: (row) => when(row.dueDate),
                },
                // One column per field the project defined, after everything Flow
                // itself asks about. A select shows the option's label rather
                // than its code — the code is what the filter speaks, not what
                // anybody named it.
                ...fields.map((field) => ({
                  key: `field:${String(field.code)}`,
                  label: String(field.name),
                  cell: (row: AnyRow) => {
                    const held = (row.fieldValues as Record<string, unknown> | undefined)?.[String(field.id)]
                    if (held == null || held === '') return '\u2014'
                    const choices = ((field.config as AnyRow | null)?.options as AnyRow[] | undefined) ?? []
                    const chosen = choices.find((choice) => String(choice.code) === String(held))
                    return String(chosen?.label ?? held)
                  },
                })),
                {
                  key: 'progress',
                  label: _('flow_backend.field.progress'),
                  cell: (row) => (
                    <Progress
                      value={row.progress == null ? null : Number(row.progress)}
                      label={_('flow_backend.field.progress')}
                      text={
                        row.progress == null
                          ? null
                          : `${String(row.subtaskDone ?? 0)}/${String(row.subtaskTotal ?? 0)}`
                      }
                    />
                  ),
                },
              ],
            })
          : emptyState(_('flow_backend.empty.title'), _('flow_backend.empty.hint')),
      ])}
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
