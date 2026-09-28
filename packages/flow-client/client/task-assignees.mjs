import { tr } from './i18n.mjs'
import { accessFor } from './access-model.mjs'
// IDs are authoritative; the legacy name is read only for old task payloads.
export const taskAssigneeIds = (data, task) =>
  Array.isArray(task?.assigneeIds)
    ? task.assigneeIds
    : [...(data.members ?? []).filter((m) => m.name === task?.assignee).map((m) => m.id)]
export const taskUsers = (data, task) =>
  taskAssigneeIds(data, task).map((id) => {
    const user = data.members?.find((m) => m.id === id) ?? task.assignees?.find((m) => m.id === id)
    return { id, name: user?.name ?? tr('flow.ui.user.no.longer.available'), avatarUrl: user?.avatarUrl }
  })
export const taskAssigneeNames = (data, task) =>
  taskUsers(data, task)
    .map((u) => u.name)
    .join(', ') || tr('flow.ui.unassigned.1f3799')
export const isAssignedTo = (data, task, id) => taskAssigneeIds(data, task).includes(id)
export function assignableUsers(data, projectId) {
  const project = data.projects.find((p) => p.id === projectId)
  if (!project) return []
  return (data.members ?? [])
    .filter((m) => m.status === 'active' && (!data.grants || accessFor(data, project, m.id).role))
    .map((m) => ({ id: m.id, name: m.name, email: m.email, avatarUrl: m.avatarUrl }))
}
export function taskUserOptions(data, task) {
  const options = assignableUsers(data, task.projectId)
  for (const user of taskUsers(data, task))
    if (!options.some((o) => o.id === user.id))
      options.push({ ...user, disabled: true, description: tr('flow.ui.project.access.removed.can.remove') })
  return options
}
// Group the exact set of assignees, once per task. No implicit primary assignee.
export const assigneeGroupKey = (task) =>
  task.assigneeIds?.length > 1
    ? 'users:' + JSON.stringify([...task.assigneeIds].sort())
    : task.assigneeIds?.length
      ? 'user:' + task.assigneeIds[0]
      : Array.isArray(task.assigneeIds)
        ? ''
        : (task.assignee ?? '')
