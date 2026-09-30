import { tr } from './i18n.mjs'
import { extensionCommands } from './extensions.mjs'
const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim()
export function commandResults(data, query, { workspaceId, recent = [] } = {}) {
  const needle = normalize(query),
    words = needle.split(/\s+/).filter(Boolean)
  const project = (id) => data.projects.find((p) => p.id === id)
  const workspace = (id) => data.workspaces?.find((w) => w.id === id)?.title ?? ''
  const result = (id, title, description, icon, route, params = {}, keywords = '') => ({
    id,
    title,
    description,
    icon,
    route,
    params,
    keywords,
  })
  const guest = data.members?.find((m) => m.id === data.user.id)?.role === 'guest'
  const navigation = [
    result('nav:mine', tr('flow.ui.my.tasks'), tr('flow.ui.personal'), 'inbox', 'my-work'),
    result('nav:inbox', tr('flow.ui.inbox'), tr('flow.ui.personal'), 'inbox', 'inbox'),
    ...extensionCommands(data).map((c) => result(c.id, c.title, c.description, c.icon, c.route)),
    ...(!guest
      ? [
          result(
            'nav:workspace',
            tr('flow.ui.manage.workspace'),
            workspace(workspaceId),
            'layers',
            'workspace-overview',
          ),
          result('nav:tasks', tr('flow.ui.all.tasks'), workspace(workspaceId), 'list', 'all-issues'),
          result('nav:pages', tr('flow.ui.document.library'), workspace(workspaceId), 'book', 'all-pages'),
          result('nav:organization', tr('flow.ui.organization'), data.company.name, 'grid', 'organization'),
        ]
      : []),
    result(
      'nav:settings',
      tr('flow.ui.personal.settings'),
      tr('flow.ui.your.preferences'),
      'settings',
      'personal-settings',
    ),
  ]
  const tasks = data.tasks
    .filter((t) => !t.archived)
    .map((t) =>
      result(
        'task:' + t.id,
        t.title,
        `${t.id} · ${project(t.projectId)?.title ?? ''}`,
        'list',
        'issue',
        { id: t.id, project: t.projectId },
        t.id,
      ),
    )
  const projects = data.projects
    .filter((p) => !p.archived)
    .map((p) =>
      result(
        'project:' + p.id,
        p.title,
        workspace(p.workspaceId),
        'folder',
        'board',
        { project: p.id, workspace: p.workspaceId },
        p.code,
      ),
    )
  const pages = data.pages
    .filter((p) => !p.archived)
    .map((p) =>
      result(
        'page:' + p.id,
        p.title,
        project(p.projectId)?.title || workspace(p.workspaceId) || tr('flow.ui.workspace.documents'),
        'book',
        'page',
        {
          id: p.id,
          project: p.projectId ?? '',
          workspace: project(p.projectId)?.workspaceId ?? p.workspaceId,
          scope: p.projectId ? 'project' : 'workspace',
        },
      ),
    )
  const rank = (item) =>
    normalize(item.keywords) === needle || normalize(item.title) === needle
      ? 0
      : normalize(item.title).startsWith(needle)
        ? 1
        : 2
  const select = (items, initialLimit) =>
    items
      .filter((item) =>
        words.every((word) => normalize(`${item.title} ${item.description} ${item.keywords}`).includes(word)),
      )
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, needle ? 6 : initialLimit)
  const groups = [
    { id: 'tasks', label: tr('flow.ui.tasks'), items: select(tasks, 4) },
    { id: 'projects', label: tr('flow.ui.projects'), items: select(projects, 3) },
    { id: 'pages', label: tr('flow.ui.documents'), items: select(pages, 3) },
    {
      id: 'navigation',
      label: needle ? tr('flow.ui.navigation') : tr('flow.ui.quick.access'),
      items: select(navigation, 3),
    },
  ]
  if (!needle) {
    groups.unshift(groups.pop())
    const all = [...tasks, ...projects, ...pages, ...navigation],
      items = recent
        .map((id) => all.find((x) => x.id === id))
        .filter(Boolean)
        .slice(0, 4)
    if (items.length) {
      for (const group of groups) group.items = group.items.filter((x) => !items.some((y) => y.id === x.id))
      groups.unshift({ id: 'recent', label: tr('flow.ui.recent'), items })
    }
  }
  return groups.filter((group) => group.items.length)
}
