import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  avatar,
  deadline,
  dataTable,
  emptyState,
  Framed,
  linkButton,
  Progress,
  RecordList,
  Section,
  stack,
  Tabs,
} from '../../../ui/index.ts'
import type { Frame, TableGroup } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { priorityBadge, when } from './shared.tsx'

/** The four figures beside the list, and the tab counts, from `issueBuckets`. */
export type IssueOverview = {
  total: number
  done: number
  overdue: number
  waiting: number
  working: number
  /** Assigned to the reader, for the tab that says so. */
  mine: number
  /** The late ones, newest deadline first — the only rail this screen carries. */
  late: AnyRow[]
  tab: string
  tabs: Array<{ id: string; label: string; href: string; count: number }>
}

const share = (part: number, whole: number): string =>
  whole ? `${Math.round((part * 100) / whole)}%` : '—'

/**
 * The counts, as a definition list rather than four cards.
 *
 * They belong together — each is a share of the same total — and reading them
 * as a column of label/number pairs makes that relationship visible in a way
 * four separate cards do not.
 */
const overviewPanel = (_: Translator, o: IssueOverview): TemplateResult => {
  const lines = [
    { id: 'total', label: _('flow_backend.overview.total'), value: String(o.total), share: '' },
    {
      id: 'done',
      label: _('flow_backend.overview.done'),
      value: String(o.done),
      share: share(o.done, o.total),
    },
    {
      id: 'working',
      label: _('flow_backend.overview.working'),
      value: String(o.working),
      share: share(o.working, o.total),
    },
    {
      id: 'waiting',
      label: _('flow_backend.overview.waiting'),
      value: String(o.waiting),
      share: share(o.waiting, o.total),
    },
    {
      id: 'overdue',
      label: _('flow_backend.overview.overdue'),
      value: String(o.overdue),
      share: share(o.overdue, o.total),
    },
  ]
  return (
    <Section
      title={_('flow_backend.overview.title')}
      body={stack([
        <RecordList
          rows={lines}
          id={(line) => line.id}
          title={(line) => line.label}
          href={() => ''}
          value={(line) => `${line.value}${line.share ? `  ${line.share}` : ''}`}
        />,
        <Progress
          value={o.total ? Math.round((o.done * 100) / o.total) : null}
          label={_('flow_backend.overview.overall')}
        />,
      ])}
    />
  )
}

/**
 * Issues across projects: everything assigned to the reader, or everything
 * there is.
 *
 * The same columns the backlog shows plus the project each issue came from,
 * and no create form: a new issue belongs to a board, and this screen is not
 * on one. The two lists differ by one argument at the call site and by their
 * title, which is the whole reason they are one screen — anything else and
 * they drift.
 */
export const crossProjectScreen = (
  _: Translator,
  frame: Frame,
  title: string,
  rows: AnyRow[],
  groups: TableGroup<AnyRow>[] = [],
  overview?: IssueOverview,
): TemplateResult => (
  <Framed
    translator={_}
    title={title}
    subtitle={_('flow_backend.issues.subtitle')}
    frame={frame}
    asideLabel={overview ? _('flow_backend.overview.title') : null}
    aside={
      overview ? (
        stack([
          overviewPanel(_, overview),
          <Section
            title={_('flow_backend.overview.lateTitle')}
            body={
              overview.late.length ? (
                <RecordList
                  rows={overview.late}
                  id={(row) => String(row.id)}
                  title={(row) => String(row.title ?? '')}
                  href={(row) => `/admin/flow/issues/${String(row.id)}`}
                  summary={(row) => String(row.projectName ?? '')}
                  value={(row) => when(row.dueDate)}
                />
              ) : (
                emptyState(
                  _('flow_backend.overview.lateNone'),
                  _('flow_backend.overview.lateNoneHint'),
                )
              )
            }
          />,
        ])
      ) : undefined
    }
    body={stack([
      ...(overview
        ? [
            <Tabs
              label={_('flow_backend.issues.tabsLabel')}
              items={overview.tabs.map((tab) => ({
                id: tab.id,
                label: tab.label,
                href: tab.href,
                count: tab.count,
                active: tab.id === overview.tab,
              }))}
            />,
          ]
        : []),
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
                key: 'assignee',
                label: _('flow_backend.field.assignee'),
                cell: (row) =>
                  row.assigneeName ? (
                    <>
                      {avatar(String(row.assigneeName))}
                      {String(row.assigneeName)}
                    </>
                  ) : (
                    '\u2014'
                  ),
              },
              {
                key: 'priority',
                label: _('flow_backend.field.priority'),
                cell: (row) => priorityBadge(_, row.priority),
              },
              {
                key: 'column',
                label: _('flow_backend.field.column'),
                cell: (row) => String(row.columnName ?? '\u2014'),
              },
              {
                key: 'dueDate',
                label: _('flow_backend.field.dueDate'),
                kind: 'date',
                // A date that has passed is the one thing on this row somebody
                // has to act on, so it is marked rather than left to be noticed.
                cell: (row) => deadline({ date: when(row.dueDate), late: row.overdue === true }),
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
        : emptyState(_('flow_backend.mine.emptyTitle'), _('flow_backend.mine.emptyHint')),
    ])}
  />
)
