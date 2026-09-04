import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  CardGrid,
  dataTable,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  Metric,
  Progress,
  RecordList,
  Section,
  shell,
  stack,
  Tabs,
} from '../../../ui/index.ts'
import type { Frame, Tone } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

const STATE_TONE: Record<string, Tone> = {
  done: 'positive',
  active: 'info',
  planned: 'neutral',
  empty: 'neutral',
}

export type ProjectsOverview = {
  rows: AnyRow[]
  projectCount: number
  issueCount: number
  issuesDone: number
  activeCount: number
  activity: AnyRow[]
  tab: string
  tabs: Array<{ id: string; label: string; href: string }>
  /** Omitted when the current reader may list but may not create projects. */
  createHref?: string
  locale?: string
}

const percent = (done: number, total: number): number | null =>
  total ? Math.round((done * 100) / total) : null

const overviewCards = (_: Translator, overview: ProjectsOverview): TemplateResult => {
  const done = percent(overview.issuesDone, overview.issueCount)
  const cards = [
    {
      id: 'projects',
      label: _('flow_backend.projects.totalProjects'),
      value: String(overview.projectCount),
      detail: null as string | null,
      tone: 'neutral',
    },
    {
      id: 'active',
      label: _('flow_backend.projects.activeProjects'),
      value: String(overview.activeCount),
      detail: _('flow_backend.projects.activeHint'),
      tone: 'info',
    },
    {
      id: 'issues',
      label: _('flow_backend.projects.totalIssues'),
      value: String(overview.issueCount),
      detail: null,
      tone: 'neutral',
    },
    {
      id: 'done',
      label: _('flow_backend.projects.issuesDone'),
      value: done === null ? '—' : `${done}%`,
      detail: `${overview.issuesDone}/${overview.issueCount}`,
      tone: 'positive',
    },
  ]

  return (
    <CardGrid
      items={cards}
      id={(card) => card.id}
      card={(card) => <Metric label={card.label} value={card.value} detail={card.detail} tone={card.tone} />}
    />
  )
}

export const projectsListScreen = (
  _: Translator,
  frame: Frame,
  overview: ProjectsOverview,
): TemplateResult => {
  const title = _('flow_backend.projects.title')
  const hasActions = overview.createHref || frame.extras?.['topbar.end'] !== undefined

  return shell(
    _,
    title,
    <ListPage
      variant="operational"
      frame={frame}
      title={title}
      description={_('flow_backend.projects.subtitle')}
      actions={
        hasActions
          ? inline([
              overview.createHref ? (
                <LinkButton
                  label={_('flow_backend.projects.create')}
                  href={overview.createHref}
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
              title,
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
      status={`${title}: ${String(overview.rows.length)}`}
      body={stack([
        overviewCards(_, overview),
        <Tabs
          label={_('flow_backend.projects.tabsLabel')}
          items={overview.tabs.map((tab) => ({
            id: tab.id,
            label: tab.label,
            href: localized(tab.href, overview.locale ?? ''),
            active: tab.id === overview.tab,
          }))}
        />,
        overview.rows.length
          ? dataTable(_, {
              rows: overview.rows,
              id: (row) => String(row.id),
              rowHref: (row) =>
                localized(
                  `/admin/flow/projects/${encodeURIComponent(String(row.id))}/board`,
                  overview.locale ?? '',
                ),
              columns: [
                {
                  key: 'name',
                  label: _('flow_backend.projects.column'),
                  priority: 'primary',
                  cell: (row) => String(row.name),
                },
                {
                  key: 'key',
                  label: _('flow_backend.field.key'),
                  kind: 'identifier',
                  cell: (row) => String(row.key),
                },
                {
                  key: 'state',
                  label: _('flow_backend.field.status'),
                  kind: 'status',
                  cell: (row) =>
                    badge(
                      _(`flow_backend.projects.state.${String(row.state ?? 'empty')}`),
                      STATE_TONE[String(row.state ?? 'empty')] ?? 'neutral',
                    ),
                },
                {
                  key: 'progress',
                  label: _('flow_backend.projects.progress'),
                  cell: (row) => (
                    <Progress
                      value={percent(Number(row.done ?? 0), Number(row.total ?? 0))}
                      label={String(row.name)}
                      text={`${Number(row.done ?? 0)}/${Number(row.total ?? 0)}`}
                    />
                  ),
                },
                {
                  key: 'description',
                  label: _('flow_backend.field.description'),
                  cell: (row) => String(row.description ?? ''),
                },
              ],
            })
          : empty(_),
        <Section
          title={_('flow_backend.projects.activity')}
          body={
            overview.activity.length ? (
              <RecordList
                rows={overview.activity}
                id={(row) => String(row.id)}
                title={(row) => String(row.title ?? '')}
                href={(row) =>
                  localized(`/admin/flow/issues/${encodeURIComponent(String(row.id))}`, overview.locale ?? '')
                }
                summary={(row) => [row.projectName, row.columnName].filter(Boolean).map(String).join(' · ')}
                value={(row) => String(row.assigneeName ?? '')}
              />
            ) : (
              empty(_)
            )
          }
        />,
      ])}
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
