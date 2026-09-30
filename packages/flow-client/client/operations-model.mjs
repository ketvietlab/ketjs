import { addDays, parseDay, shiftPeriod } from './timeline.mjs'
export const projectTasks = (data, workspaceId, projectId) =>
  data.tasks.filter(
    (t) =>
      !t.archived &&
      (projectId
        ? t.projectId === projectId
        : data.projects.some((p) => p.id === t.projectId && p.workspaceId === workspaceId)),
  )
export function calendarPeriod(date, scale = 'month') {
  const start =
    scale === 'week' ? addDays(date, -((parseDay(date).getUTCDay() + 6) % 7)) : date.slice(0, 7) + '-01'
  const end = scale === 'week' ? addDays(start, 6) : addDays(shiftPeriod(start, 'month', 1), -1)
  const gridStart = scale === 'week' ? start : addDays(start, -((parseDay(start).getUTCDay() + 6) % 7))
  const gridEnd = scale === 'week' ? end : addDays(end, 6 - ((parseDay(end).getUTCDay() + 6) % 7))
  const days = []
  for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) days.push(day)
  return { start, end, days }
}
