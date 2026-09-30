import { accessFor, canManageScope } from './access-model.mjs'
export function documentAccess(data, page, userId = data.user.id) {
  const member = data.members.find((m) => m.id === userId && m.status === 'active')
  if (!member || !page) return { read: false, write: false }
  const project = data.projects.find((p) => p.id === page.projectId),
    teams = data.teams.filter((t) => t.memberIds.includes(userId)).map((t) => t.id)
  const role = project
    ? accessFor(data, project, userId).role
    : canManageScope(data, 'workspace', page.workspaceId, userId)
      ? 'admin'
      : data.workspaces.some(
            (w) =>
              w.id === page.workspaceId &&
              (w.access === 'internal' ||
                data.grants.some(
                  (g) =>
                    g.scope === 'workspace' &&
                    g.targetId === w.id &&
                    (g.subjectType === 'user' ? g.subjectId === userId : teams.includes(g.subjectId)),
                )),
          )
        ? 'editor'
        : null
  const owner = (page.ownerId ?? 'mai') === userId,
    explicit = (page.readerIds ?? []).includes(userId)
  const read =
    !!role && (member.role === 'guest' ? explicit : page.visibility === 'private' ? owner || explicit : true)
  return {
    read,
    write: read && member.role !== 'guest' && role !== 'viewer' && (page.visibility !== 'private' || owner),
    manage: read && owner,
  }
}
