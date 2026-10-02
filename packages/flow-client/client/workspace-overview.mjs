import { html, signal } from '@ketvietlab/ketjs-view'
import { tr, flowDateFormatter } from './i18n.mjs'
import { FlowButton, FlowTag, FlowProgress } from '@ketvietlab/flow-ui'
import {
  FlowSection,
  FlowStack,
  FlowInline,
  FlowHint,
  FlowStatGrid,
  FlowSegmentBar,
  FlowColumnChart,
  FlowMeterList,
  FlowEvidenceTable,
  FlowEvidenceTask,
  FlowEvidenceValue,
  FlowScopeMenu,
  FlowActivity,
  FlowChecklist,
} from '@ketvietlab/flow-ui/workspace'
import { FlowQualityColumns } from '@ketvietlab/flow-ui/workspace'
import { addDays, todayDate } from './timeline.mjs'
import { statusKind, statusKinds } from './project-catalogs.mjs'
import { taskAssigneeNames, taskAssigneeIds } from './task-assignees.mjs'
import { gettingStarted } from './getting-started.mjs'
import { routes } from './routes.mjs'

export const HORIZON_DAYS = 14
const days = (from, to) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5)

/** Everything the overview shows, derived from one bootstrap snapshot. Pure so tests can pin the numbers. */
export function workspaceOverviewModel(data, workspaceId, today) {
  const projects = data.projects.filter((p) => p.workspaceId === workspaceId),
    inScope = new Set(projects.map((p) => p.id))
  const tasks = data.tasks.filter((t) => !t.archived && inScope.has(t.projectId)),
    byId = new Map(data.tasks.map((t) => [t.id, t]))
  const kind = (t) => statusKind(data, t),
    open = tasks.filter((t) => kind(t) !== 'done')
  const count = (list) =>
    Object.fromEntries(statusKinds.map((k) => [k, list.filter((t) => kind(t) === k).length]))
  const isBlocked = (t) => t.blockedBy?.some((id) => byId.has(id) && kind(byId.get(id)) !== 'done')
  const overdue = open
      .filter((t) => t.dueDate && t.dueDate < today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    blocked = open.filter(isBlocked),
    review = tasks.filter((t) => kind(t) === 'review')
  const horizon = [
    { id: 'overdue', date: null, tasks: overdue },
    ...Array.from({ length: HORIZON_DAYS }, (_, i) => {
      const date = addDays(today, i)
      return { id: date, date, tasks: open.filter((t) => t.dueDate === date) }
    }),
  ]
  const activeSprints = (data.sprints ?? [])
    .filter((s) => s.state === 'active' && inScope.has(s.projectId))
    .map((s) => {
      const list = tasks.filter((t) => t.projectId === s.projectId && t.sprint === s.title)
      return {
        sprint: s,
        project: projects.find((p) => p.id === s.projectId),
        total: list.length,
        done: list.filter((t) => kind(t) === 'done').length,
        daysLeft: days(today, s.end),
      }
    })
    .sort((a, b) => a.daysLeft - b.daysLeft)
  const rows = projects.map((project) => {
    const list = tasks.filter((t) => t.projectId === project.id),
      own = open.filter((t) => t.projectId === project.id)
    return {
      project,
      counts: count(list),
      total: list.length,
      overdue: own.filter((t) => t.dueDate && t.dueDate < today).length,
      blocked: own.filter(isBlocked).length,
      sprint: activeSprints.find((s) => s.sprint.projectId === project.id) ?? null,
    }
  })
  const people = data.members
    .filter((m) => m.status === 'active')
    .map((member) => {
      const mine = open.filter((t) => taskAssigneeIds(data, t).includes(member.id))
      return { member, open: mine.length, overdue: mine.filter((t) => t.dueDate && t.dueDate < today).length }
    })
    .filter((x) => x.open)
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
  const ids = new Set(tasks.map((t) => t.id))
  const activity = (data.history ?? [])
    .filter((h) => ids.has(h.taskId))
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, 6)
  return {
    projects,
    tasks,
    open,
    counts: count(tasks),
    overdue,
    blocked,
    review,
    dueSoon: open.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate < addDays(today, 7)),
    horizon,
    rows,
    sprints: activeSprints,
    goals: (data.goals ?? []).filter((g) => g.workspaceId === workspaceId),
    people,
    activity,
  }
}

export function createWorkspaceOverview(ctx) {
  const d = ctx.data,
    selected = signal(''),
    hiddenStart = signal(/** @type {string[]} */ ([]))
  const t = (key, values = []) => tr('flow.overview.' + key, values)
  const kindLabel = {
    todo: tr('flow.ui.to.do'),
    progress: tr('flow.ui.in.progress'),
    review: tr('flow.ui.awaiting.acceptance.9782f0'),
    done: tr('flow.ui.done'),
  }
  const kindTone = { todo: 'neutral', progress: 'blue', review: 'yellow', done: 'green' }
  const short = (date) =>
    flowDateFormatter({ day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(date + 'T00:00:00Z'),
    )
  const weekday = (date) =>
    flowDateFormatter({ weekday: 'short', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'))
  const button = (label, onClick, variant = 'secondary') =>
    FlowButton({ label, onClick, variant, size: 'sm' })
  const openTask = (task) => () => ctx.navigate('issue', { id: task.id, project: task.projectId })
  const statusBar = (label, counts, legend = false) =>
    FlowSegmentBar({
      label,
      legend,
      segments: ['done', 'review', 'progress', 'todo'].map((k) => ({
        id: k,
        label: kindLabel[k],
        value: counts[k],
        tone: kindTone[k],
      })),
    })
  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0)

  const stats = (m) =>
    FlowStatGrid({
      label: t('stats'),
      items: [
        {
          id: 'progress',
          label: t('progress'),
          value: `${m.counts.done} / ${m.tasks.length}`,
          visual: statusBar(t('progress'), m.counts),
          detail: t('progressDetail', [pct(m.counts.done, m.tasks.length)]),
          onClick: () => ctx.navigate('all-issues'),
        },
        {
          id: 'overdue',
          label: tr('flow.ui.overdue'),
          value: String(m.overdue.length),
          tone: m.overdue.length ? 'red' : 'neutral',
          detail: t('overdueDetail', [m.dueSoon.length]),
          onClick: () => ctx.navigate('dashboard', { risk: 'overdue' }),
        },
        {
          id: 'blocked',
          label: tr('flow.ui.blocked'),
          value: String(m.blocked.length),
          tone: m.blocked.length ? 'yellow' : 'neutral',
          detail: t('blockedDetail'),
          onClick: () => ctx.navigate('dashboard', { risk: 'blocked' }),
        },
        {
          id: 'review',
          label: tr('flow.ui.awaiting.acceptance.9782f0'),
          value: String(m.review.length),
          detail: t('reviewDetail'),
          onClick: () => ctx.navigate(routes['quality-inbox'] ? 'quality-inbox' : 'dashboard'),
        },
      ],
    })

  const horizon = (m) => {
    const current =
      selected() && m.horizon.some((x) => x.id === selected())
        ? selected()
        : (m.horizon.find((x) => x.tasks.length)?.id ?? 'overdue')
    const day = m.horizon.find((x) => x.id === current),
      shown = day.tasks.slice(0, 8)
    const title = day.date ? t('dueOn', [short(day.date)]) : t('overdueTasks')
    return FlowSection({
      inset: 'none',
      title: t('horizon'),
      description: t('horizonDetail'),
      children: FlowStack({
        children: html`
   ${FlowColumnChart({ label: t('horizon'), selected: current, onSelect: (id) => selected.set(id), items: m.horizon.map((x) => (x.date ? { id: x.id, label: short(x.date), sublabel: weekday(x.date), value: x.tasks.length, muted: [0, 6].includes(new Date(x.date + 'T00:00:00Z').getUTCDay()), current: x.date === m.today } : { id: x.id, label: t('overdueColumn'), value: x.tasks.length, tone: 'red', outlier: true })) })}
   ${
     day.tasks.length
       ? FlowEvidenceTable({
           label: title,
           columns: [
             { id: 'task', label: title, size: 'wide' },
             { id: 'project', label: t('project') },
             { id: 'assignee', label: t('assignee') },
             { id: 'status', label: t('status') },
           ],
           rows: shown.map((task) => ({
             id: task.id,
             cells: {
               task: FlowEvidenceTask({
                 id: task.id,
                 title: task.title,
                 meta: day.date ? null : t('dueShort', [short(task.dueDate)]),
                 onOpen: openTask(task),
               }),
               project: FlowEvidenceValue({
                 value: m.projects.find((p) => p.id === task.projectId)?.title ?? '',
               }),
               assignee: FlowEvidenceValue({ value: taskAssigneeNames(d(), task) }),
               status: FlowTag({
                 label: kindLabel[statusKind(d(), task)] ?? task.status,
                 tone: { review: 'yellow', done: 'green' }[statusKind(d(), task)] ?? 'neutral',
               }),
             },
           })),
           more:
             day.tasks.length > shown.length
               ? button(
                   t(day.date ? 'more' : 'moreOverdue', [day.tasks.length - shown.length]),
                   () =>
                     day.date ? ctx.navigate('all-issues') : ctx.navigate('dashboard', { risk: 'overdue' }),
                   'ghost',
                 )
               : null,
           total: t('taskCount', [day.tasks.length]),
         })
       : FlowHint({ children: t('noneDue') })
}
  `,
      }),
    })
  }

  const projects = (m, empty, canCreate) =>
    FlowSection({
      inset: 'none',
      title: tr('flow.ui.projects'),
      actions:
        canCreate && m.projects.length
          ? button(tr('flow.ui.create.project'), () => ctx.navigate('project-new'), 'primary')
          : null,
      children: m.projects.length
        ? FlowEvidenceTable({
            label: tr('flow.ui.projects'),
            actionsLabel: t('actions'),
            columns: [
              { id: 'project', label: t('project'), size: 'wide' },
              { id: 'status', label: t('statusMix') },
              { id: 'done', label: tr('flow.ui.done') },
              { id: 'risk', label: t('risk') },
              { id: 'sprint', label: t('sprint') },
            ],
            rows: m.rows.map((r) => ({
              id: r.project.id,
              actions: FlowScopeMenu({
                label: t('projectActions', [r.project.title]),
                icon: 'more',
                items: [
                  {
                    label: tr('flow.ui.open.project'),
                    onClick: () =>
                      ctx.navigate('board', { project: r.project.id, workspace: r.project.workspaceId }),
                  },
                  {
                    label: tr('flow.ui.access.1747ab'),
                    onClick: () =>
                      ctx.navigate('project-members', {
                        project: r.project.id,
                        workspace: r.project.workspaceId,
                      }),
                  },
                ],
              }),
              cells: {
                project: FlowEvidenceTask({
                  id: r.project.code,
                  title: r.project.title,
                  meta: d().members.find((x) => x.id === r.project.ownerId)?.name,
                  onOpen: () =>
                    ctx.navigate('board', { project: r.project.id, workspace: r.project.workspaceId }),
                }),
                status: statusBar(r.project.title, r.counts),
                done: FlowEvidenceValue({
                  value: pct(r.counts.done, r.total) + '%',
                  meta: t('ofTasks', [r.counts.done, r.total]),
                }),
                risk:
                  r.overdue || r.blocked
                    ? FlowInline({
                        children: html`${r.overdue ? FlowTag({ label: t('overdueCount', [r.overdue]), tone: 'red' }) : null}${r.blocked ? FlowTag({ label: t('blockedCount', [r.blocked]), tone: 'yellow' }) : null}`,
                      })
                    : FlowEvidenceValue({ value: '—', hint: t('noRisk') }),
                sprint: r.sprint
                  ? FlowEvidenceValue({
                      value: r.sprint.sprint.title,
                      meta: t('sprintLeft', [r.sprint.done, r.sprint.total, Math.max(0, r.sprint.daysLeft)]),
                    })
                  : FlowEvidenceValue({ value: '—', hint: t('noSprint') }),
              },
            })),
            total: t('projectTotals', [m.projects.length, m.tasks.length, m.open.length]),
          })
        : empty,
    })

  const aside = (m) => {
    const busiest = Math.max(1, ...m.people.map((x) => x.open))
    return FlowStack({
      gap: 'lg',
      children: html`
   ${routes.goals ? FlowSection({ inset: 'none', title: t('goals'), actions: button(t('viewAll'), () => ctx.navigate('goals'), 'ghost'), children: m.goals.length ? FlowMeterList({ label: t('goals'), items: m.goals.map((g) => ({ id: g.id, title: g.title, value: g.progress + '%', bar: FlowProgress({ label: g.title, value: g.progress, total: 100 }), meta: t('goalMeta', [g.current, g.target, g.unit ?? '', short(g.end)]), onClick: () => ctx.navigate('goals') })) }) : FlowHint({ children: t('noGoals') }) }) : null}
   ${FlowSection({ inset: 'none', title: t('sprints'), actions: m.sprints.length > 4 ? button(t('viewAllCount', [m.sprints.length]), () => ctx.navigate('sprints'), 'ghost') : null, children: m.sprints.length ? FlowMeterList({ label: t('sprints'), items: m.sprints.slice(0, 4).map((s) => ({ id: s.sprint.id, title: s.sprint.title, value: `${s.done}/${s.total}`, bar: FlowProgress({ label: s.sprint.title, value: s.done, total: s.total }), meta: s.project.title + ' · ' + (s.daysLeft > 0 ? t('daysLeft', [s.daysLeft, short(s.sprint.end)]) : t('endsToday')), onClick: () => ctx.navigate('sprints', { project: s.project.id, workspace: s.project.workspaceId }) })) }) : FlowHint({ children: t('noSprints') }) })}
   ${FlowSection({
     inset: 'none',
     title: t('people'),
     actions: routes.workload
       ? button(tr('flow.ui.balance.workload'), () => ctx.navigate('workload'), 'ghost')
       : null,
     children: m.people.length
       ? FlowMeterList({
           label: t('people'),
           items: m.people.slice(0, 6).map((x) => ({
             id: x.member.id,
             title: x.member.name,
             value: t('openCount', [x.open]),
             bar: FlowSegmentBar({
               label: x.member.name,
               segments: [
                 { id: 'overdue', label: tr('flow.ui.overdue'), value: x.overdue, tone: 'red' },
                 { id: 'open', label: t('onTrack'), value: x.open - x.overdue, tone: 'blue' },
                 { id: 'room', label: '', value: busiest - x.open, tone: 'neutral' },
               ],
             }),
             meta: x.overdue ? t('personOverdue', [x.overdue]) : null,
           })),
         })
       : FlowHint({ children: t('noOpenWork') }),
   })}
   ${m.activity.length ? FlowSection({ inset: 'none', title: t('activity'), children: FlowActivity({ items: m.activity.map((h) => ({ id: h.id, person: h.person, text: `${h.taskId} · ${h.text}`, time: short(h.time.slice(0, 10)) })) }) }) : null}
  `,
    })
  }

  // Hiding the checklist is a per-viewer convenience, so it lives in this browser only.
  const startKey = (id) => 'flow.gettingStarted.hidden.' + id
  const startHidden = (id) => {
    if (hiddenStart().includes(id)) return true
    try {
      return localStorage.getItem(startKey(id)) === '1'
    } catch {
      return false
    }
  }
  const hideStart = (id) => {
    try {
      localStorage.setItem(startKey(id), '1')
    } catch {}
    hiddenStart.set([...hiddenStart(), id])
  }
  const start = (workspace, today) => {
    const g = gettingStarted(d(), workspace.id, today)
    if (!g.show || startHidden(workspace.id)) return null
    const s = (key, values = []) => tr('flow.start.' + key, values),
      first = g.steps.find((x) => !x.done)?.id,
      project = g.project
    const targets = {
      project: ['project-new'],
      task: ['issue-new', { project: project?.id }],
      invite: ['member-invite'],
      page: ['page-new'],
      goal: ['goal-new'],
      github: ['github', { project: project?.id }],
    }
    return FlowChecklist({
      title: s('title'),
      description: s('description'),
      progressLabel: s('progress', [g.done, g.total]),
      done: g.done,
      total: g.total,
      doneLabel: s('done'),
      todoLabel: s('todo'),
      actions: FlowButton({
        label: s('hide'),
        variant: 'ghost',
        size: 'sm',
        onClick: () => hideStart(workspace.id),
      }),
      items: g.steps.map((x) => {
        const [route, params] = targets[x.id]
        return {
          id: x.id,
          title: s(x.id + '.title'),
          description: s(x.id + '.description'),
          done: x.done,
          action: FlowButton({
            label: s(x.id + '.action'),
            size: 'sm',
            variant: x.id === first ? 'primary' : 'secondary',
            disabled: Boolean(params) && !project,
            disabledReason: s('needsProject'),
            onClick: () => ctx.navigate(route, params ?? {}),
          }),
        }
      }),
    })
  }

  /** `today` is injectable so the view is testable without the wall clock. */
  const view = ({ workspace, empty, canCreate, today = todayDate(d().timezone) }) => {
    const m = { ...workspaceOverviewModel(d(), workspace.id, today), today }
    // Until the workspace has a task, counts and the due-date chart would only show zeros.
    const main = m.tasks.length
      ? html`${horizon(m)}${projects(m, empty, canCreate)}`
      : projects(m, empty, canCreate)
    return FlowStack({
      gap: 'lg',
      children: html`${canCreate ? start(workspace, today) : null}${m.tasks.length ? stats(m) : null}${FlowQualityColumns({ main: FlowStack({ gap: 'lg', children: main }), aside: aside(m) })}`,
    })
  }
  return { view, reset: () => selected.set('') }
}
