import { addDays, parseDay } from './timeline.mjs'

/** How a project plans its work. `null` is Kanban: no sprints. Otherwise every sprint lasts `weeks` and starts on `weekday` (0 = Sunday, 1 = Monday). */
export const SPRINT_WEEKS = [1, 2, 3, 4]
export const DEFAULT_CADENCE = Object.freeze({ weeks: 2, weekday: 1 })
const FINISHED = ['closed', 'completed']

/** Projects saved before cadences existed already use sprints; they keep the two-week Monday rhythm their sprints follow. */
export const sprintCadence = (project) =>
  !project ? null : project.sprintCadence === undefined ? DEFAULT_CADENCE : project.sprintCadence
export const usesSprints = (project) => sprintCadence(project) !== null

export const validCadence = (cadence) =>
  cadence === null ||
  (Boolean(cadence) &&
    typeof cadence === 'object' &&
    Object.keys(cadence).length === 2 &&
    SPRINT_WEEKS.includes(cadence.weeks) &&
    Number.isInteger(cadence.weekday) &&
    cadence.weekday >= 0 &&
    cadence.weekday <= 6)

/** The sprint the cadence proposes next: straight after the last one when it has not ended yet, otherwise on the first cadence weekday from today. Its name continues the last sprint's numbering. */
export function nextSprint(data, project, today) {
  const cadence = sprintCadence(project) ?? DEFAULT_CADENCE,
    own = (data.sprints ?? []).filter((s) => s.projectId === project?.id)
  const last = [...own].sort((a, b) => a.end.localeCompare(b.end)).at(-1)
  const continues = Boolean(last) && last.end >= today
  let start = continues ? addDays(last.end, 1) : today
  if (!continues) while (parseDay(start).getUTCDay() !== cadence.weekday) start = addDays(start, 1)
  const numbered = own.map((s) => /^(.*?)(\d+)\s*$/.exec(s.title)).filter(Boolean)
  const top = numbered.sort((a, b) => Number(b[2]) - Number(a[2]))[0]
  const title = top ? `${top[1]}${Number(top[2]) + 1}` : `Sprint ${own.length + 1}`
  return { title, start, end: addDays(start, cadence.weeks * 7 - 1) }
}

/** A sprint of the same project that is not finished and shares at least one day with start..end. */
export const overlappingSprint = (data, projectId, start, end, exceptId) =>
  (data.sprints ?? []).find(
    (s) =>
      s.projectId === projectId &&
      s.id !== exceptId &&
      !FINISHED.includes(s.state) &&
      s.start <= end &&
      start <= s.end,
  ) ?? null

export const activeSprint = (data, projectId) =>
  (data.sprints ?? []).find((s) => s.projectId === projectId && s.state === 'active') ?? null
