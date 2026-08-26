import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  CardGrid,
  dataTable,
  Framed,
  Metric,
  Progress,
  RecordForm,
  RecordList,
  Section,
  stack,
  Surface,
  Tabs,
} from '../../../ui/index.ts'
import type { FormField, Frame, Tone } from '../../../ui/index.ts'
import type { AnyRow } from './shared.tsx'
import { empty } from './shared.tsx'

/** Column-template presets offered when creating a project — see routes.ts's COLUMN_TEMPLATES. */
export const TEMPLATE_OPTIONS = (_: Translator) => [
  { value: 'simple', label: _('flow_backend.template.simple') },
  { value: 'kanban', label: _('flow_backend.template.kanban') },
  { value: 'scrum', label: _('flow_backend.template.scrum') },
  { value: 'custom', label: _('flow_backend.template.custom') },
]

/**
 * What a project's state is called, and how it is coloured.
 *
 * Derived from its issues rather than stored — see `projectStateOf`. A project
 * carries no status column, so this reports something true about real rows
 * instead of putting a label on screen that nobody ever sets.
 */
const STATE_TONE: Record<string, Tone> = {
  done: 'positive',
  active: 'info',
  planned: 'neutral',
  empty: 'neutral',
}

export type ProjectsOverview = {
  /** Every project the reader can see, already narrowed by the active tab. */
  rows: AnyRow[]
  /** Counts for the whole set, so the cards do not describe one page of it. */
  projectCount: number
  issueCount: number
  issuesDone: number
  activeCount: number
  /** Recently touched issues, newest first — the only rail the design asks for. */
  activity: AnyRow[]
  /** Which tab is on, so the row it marks matches the rows below. */
  tab: string
  tabs: Array<{ id: string; label: string; href: string }>
}

const percent = (done: number, total: number): number | null =>
  total ? Math.round((done * 100) / total) : null

/**
 * The four figures the design puts across the top, from the data that exists.
 *
 * The mockup also shows a budget and an overdue count. Neither is here because
 * `flow.Project` stores no money and no dates, and a card reading "0 ₫" or
 * "0 overdue" would be answering a question the system cannot ask — see the
 * note in the pull request.
 */
const overviewCards = (_: Translator, o: ProjectsOverview): TemplateResult => {
  const done = percent(o.issuesDone, o.issueCount)
  const cards = [
    {
      id: 'projects',
      label: _('flow_backend.projects.totalProjects'),
      value: String(o.projectCount),
      detail: null as string | null,
      tone: 'neutral',
    },
    {
      id: 'active',
      label: _('flow_backend.projects.activeProjects'),
      value: String(o.activeCount),
      detail: _('flow_backend.projects.activeHint'),
      tone: 'info',
    },
    {
      id: 'issues',
      label: _('flow_backend.projects.totalIssues'),
      value: String(o.issueCount),
      detail: null,
      tone: 'neutral',
    },
    {
      id: 'done',
      label: _('flow_backend.projects.issuesDone'),
      value: done === null ? '—' : `${done}%`,
      detail: `${o.issuesDone}/${o.issueCount}`,
      tone: 'positive',
    },
  ]
  return (
    <CardGrid
      items={cards}
      id={(card) => card.id}
      card={(card) => (
        <Metric label={card.label} value={card.value} detail={card.detail} tone={card.tone} />
      )}
    />
  )
}

export const projectsScreen = (
  _: Translator,
  frame: Frame,
  overview: ProjectsOverview,
  fields: FormField[],
  errors: string[] = [],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('flow_backend.projects.title')}
    subtitle={_('flow_backend.projects.subtitle')}
    frame={frame}
    asideLabel={_('flow_backend.projects.activity')}
    aside={
      <Section
        title={_('flow_backend.projects.activity')}
        body={
          overview.activity.length ? (
            <RecordList
              rows={overview.activity}
              id={(row) => String(row.id)}
              title={(row) => String(row.title ?? '')}
              href={(row) => `/admin/flow/issues/${String(row.id)}`}
              summary={(row) =>
                [row.projectName, row.columnName].filter(Boolean).map(String).join(' · ')
              }
              value={(row) => String(row.assigneeName ?? '')}
            />
          ) : (
            empty(_)
          )
        }
      />
    }
    body={stack([
      overviewCards(_, overview),
      <Tabs
        label={_('flow_backend.projects.tabsLabel')}
        items={overview.tabs.map((tab) => ({
          id: tab.id,
          label: tab.label,
          href: tab.href,
          active: tab.id === overview.tab,
        }))}
      />,
      overview.rows.length
        ? dataTable(_, {
            rows: overview.rows,
            id: (row) => String(row.id),
            rowHref: (row) => `/admin/flow/projects/${String(row.id)}/board`,
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
      <Surface
        body={
          <RecordForm
            action="/admin/flow/projects"
            fields={fields}
            errors={errors}
            submit={_('flow_backend.projects.create')}
            submitVariant="primary"
          />
        }
      />,
    ])}
  />
)
