import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { dataTable, emptyState, Framed, linkButton, Progress } from '../../../ui/index.ts'
import type { Frame, TableGroup } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { priorityBadge, when } from './shared.tsx'

/**
 * Everything assigned to the reader, across projects.
 *
 * The same columns the backlog shows plus the project each issue came from,
 * and no create form: a new issue belongs to a board, and this screen is not
 * on one.
 */
export const myWorkScreen = (
  _: Translator,
  frame: Frame,
  rows: AnyRow[],
  groups: TableGroup<AnyRow>[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('flow_backend.mine.title')}
    frame={frame}
    body={
      rows.length || groups.length
        ? dataTable(_, {
            rows,
            groups,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'title',
                label: _('flow_backend.field.title'),
                priority: 'primary',
                cell: (row) =>
                  linkButton({
                    href: `/admin/flow/issues/${String(row.id)}`,
                    label: String(row.title),
                    variant: 'tertiary',
                    size: 'compact',
                  }),
              },
              {
                key: 'project',
                label: _('flow_backend.field.project'),
                cell: (row) =>
                  linkButton({
                    href: `/admin/flow/projects/${String(row.projectId)}/board`,
                    label: String(row.projectName ?? '\u2014'),
                    variant: 'tertiary',
                    size: 'compact',
                  }),
              },
              {
                key: 'column',
                label: _('flow_backend.field.column'),
                cell: (row) => String(row.columnName ?? '\u2014'),
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
        : emptyState(_('flow_backend.mine.emptyTitle'), _('flow_backend.mine.emptyHint'))
    }
  />
)
