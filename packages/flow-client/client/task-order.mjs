import { tr } from './i18n.mjs'
import { assigneeGroupKey, taskAssigneeIds, taskAssigneeNames } from './task-assignees.mjs'
import { taskColumns } from './project-catalogs.mjs'
// One canonical manual order, shared by list and board projections.
export const orderedTasks = (tasks) =>
  tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => (a.task.order ?? a.index) - (b.task.order ?? b.index) || a.index - b.index)
    .map((x) => x.task)
export const taskGroupValue = (task, field) =>
  field === 'none' ? '' : field === 'assignee' ? assigneeGroupKey(task) : (task[field] ?? '')
export function taskGroups(data, field, projectId) {
  if (field === 'priority')
    return [
      { id: 'urgent', label: tr('flow.ui.urgent') },
      { id: 'high', label: tr('flow.ui.high') },
      { id: 'normal', label: tr('flow.ui.normal') },
    ]
  if (field === 'assignee') {
    const groups = [
      { id: '', label: tr('flow.ui.unassigned.1f3799'), assigneeIds: [] },
      ...(data.members ?? [])
        .filter((m) => m.status === 'active')
        .map((m) => ({ id: 'user:' + m.id, label: m.name, assigneeIds: [m.id] })),
    ]
    for (const task of data.tasks.filter((t) => !t.archived && (!projectId || t.projectId === projectId))) {
      const id = assigneeGroupKey(task)
      if (!groups.some((g) => g.id === id))
        groups.push({ id, label: taskAssigneeNames(data, task), assigneeIds: taskAssigneeIds(data, task) })
    }
    return groups
  }
  if (field === 'sprint')
    return [
      'Backlog',
      ...data.sprints.filter((s) => !projectId || s.projectId === projectId).map((s) => s.title),
    ].map((title) => ({ id: title, label: title }))
  if (field === 'none') return [{ id: '', label: tr('flow.ui.tasks') }]
  return (projectId ? taskColumns(data, projectId) : data.columns).map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    color: c.color,
  }))
}

// Stable ties preserve the board's canonical manual order.
export function sortedListTasks(tasks, mode = 'due') {
  const ordered = orderedTasks(tasks),
    priority = { urgent: 0, high: 1, normal: 2 }
  if (mode === 'manual') return ordered
  const due = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
  const rank = (a, b) => (priority[a.priority] ?? 3) - (priority[b.priority] ?? 3)
  return ordered.sort((a, b) => (mode === 'priority' ? rank(a, b) || due(a, b) : due(a, b) || rank(a, b)))
}
export const taskPage = (tasks, limit = 10) => ({
  visible: tasks.slice(0, limit),
  remaining: Math.max(0, tasks.length - limit),
})
