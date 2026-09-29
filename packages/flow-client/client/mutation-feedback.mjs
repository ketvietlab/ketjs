import { routes as registeredRoutes } from './routes.mjs'
import { tr } from './i18n.mjs'
export function mutationFeedback(name, input, value, data) {
  const action = input.action ?? name.replace(/^flow\./, ''),
    kind = action.split('.')[0]
  const collection =
    action === 'form.submit'
      ? 'tasks'
      : (input.collection ??
        {
          goal: 'goals',
          view: 'views',
          automation: 'automations',
          form: 'forms',
          workspace: 'workspaces',
          team: 'teams',
          member: 'members',
          invitation: 'invitations',
          project: 'projects',
        }[kind] ??
        'tasks')
  const id = value.taskId ?? value.id ?? input.entityId ?? input.id
  const entity = data[collection]?.find((x) => x.id === id)
  const labels = {
    goals: 'goals',
    views: 'saved.views',
    automations: 'automations',
    forms: 'intake.forms',
    workspaces: 'workspace',
    teams: 'member',
    members: 'member',
    invitations: 'invitations',
    projects: 'projects',
    pages: 'documents',
    tasks: 'tasks',
    columns: 'status',
    fields: 'custom.fields',
    types: 'task.types',
    tags: 'labels',
  }
  const label =
    entity?.title ??
    entity?.name ??
    entity?.email ??
    input.title ??
    input.email ??
    (id && collection === 'tasks' ? id : tr('flow.ui.' + (labels[collection] ?? 'settings')))
  let key = 'updated',
    target = null
  const routes = {
    projects: 'board',
    pages: 'page',
    epics: 'epic',
    views: 'project-issues',
    sprints: 'sprints',
    goals: 'goal',
    automations: 'automations',
    forms: 'forms',
    workspaces: 'workspace-overview',
    teams: 'team',
  }
  const route = routes[collection]
  if (name === 'flow.issue.save') {
    key = input.id ? 'saved' : 'created'
    target = { route: 'issue', params: { id, project: entity?.projectId ?? input.projectId } }
  } else if (name === 'flow.entity.save' || action.endsWith('.save')) {
    key = input.entityId || input.id || ['company', 'preferences'].includes(kind) ? 'saved' : 'created'
    if (route)
      target = {
        route,
        params: {
          id,
          project: collection === 'projects' ? id : (entity?.projectId ?? input.projectId ?? ''),
          ...(collection === 'workspaces' ? { workspace: id } : {}),
          ...(collection === 'views' ? { view: id } : {}),
        },
      }
  } else if (action === 'form.submit') {
    key = 'created'
    target = { route: 'issue', params: { id, project: input.projectId } }
  } else if (action === 'inbox.read') key = 'read'
  else if (action === 'member.invite' || action === 'invitation.resend') key = 'invited'
  else if (action.includes('revoke')) key = 'revoked'
  else if (action === 'report') key = 'reportSent'
  else if (action === 'report.resolve') key = 'reportResult'
  else if (action === 'close') key = collection === 'sprints' ? 'sprintClosed' : 'closed'
  else if (action === 'archive' || action.endsWith('.archive')) key = 'archived'
  else if (action === 'restore' || action.endsWith('.restore')) key = 'restored'
  else if (action.includes('move')) key = 'moved'
  else if (name === 'flow.document.command') key = 'sharedSaved'
  return {
    message: tr('flow.review.' + key, [label]),
    target: target && registeredRoutes[target.route] ? target : null,
  }
}
