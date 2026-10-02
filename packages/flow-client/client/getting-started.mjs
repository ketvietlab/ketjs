import { routes } from './routes.mjs'
/** First steps in a new workspace. Each one is done as soon as the data shows it, so nothing has to be ticked by hand. */
export const gettingStartedSteps = ['project', 'task', 'invite', 'page', 'goal', 'github']
/** Only new workspaces get the checklist; one without a creation date predates it. */
export const GETTING_STARTED_DAYS = 30

export function gettingStarted(data, workspaceId, today) {
  const workspace = data.workspaces?.find((w) => w.id === workspaceId),
    created = workspace?.createdAt?.slice(0, 10)
  const age = created
    ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(created + 'T00:00:00Z')) / 864e5)
    : Infinity
  const projects = data.projects.filter((p) => p.workspaceId === workspaceId && !p.archived),
    ids = new Set(projects.map((p) => p.id))
  const done = {
    project: projects.length > 0,
    task: data.tasks.some((t) => ids.has(t.projectId)),
    invite:
      data.members.some((m) => m.id !== data.user.id && m.status === 'active') ||
      (data.invitations ?? []).length > 0,
    page: (data.pages ?? []).some(
      (p) => !p.archived && (ids.has(p.projectId) || (!p.projectId && p.workspaceId === workspaceId)),
    ),
    goal: (data.goals ?? []).some((g) => g.workspaceId === workspaceId && !g.archived),
    github: (data.github?.connections ?? []).some((c) => ids.has(c.projectId)),
  }
  const steps = gettingStartedSteps
    .filter((id) => (id !== 'goal' || routes['goal-new']) && (id !== 'github' || routes.github))
    .map((id) => ({ id, done: done[id] }))
  const complete = steps.every((s) => s.done)
  return {
    steps,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    complete,
    show: !complete && age <= GETTING_STARTED_DAYS,
    project: projects[0] ?? null,
  }
}
