import { tr } from './i18n.mjs'
export const workspaceRoutes = new Set([
  'my-work',
  'inbox',
  'all-issues',
  'issue-filter',
  'dashboard',
  'all-pages',
  'projects',
  'project-new',
  'all-epics',
  'cmdk',
  'organization',
  'organization-settings',
  'organization-members',
  'teams',
  'team',
  'team-new',
  'team-edit',
  'workspaces',
  'workspace-overview',
  'workspace-members',
  'workspace-new',
  'workspace-edit',
  'workspace-archive',
  'member-invite',
  'member-edit',
  'access-grant',
  'permissions',
  'workspace-settings',
  'personal-settings',
  'tags',
  'tag-edit',
  'timezone',
  'column-edit',
  'type-edit',
  'field-edit',
])
export const pageRoutes = new Set(['pages', 'page', 'page-new', 'page-child', 'page-move', 'page-archived'])
export const personalRoutes = new Set(['my-work', 'inbox', 'personal-settings'])
export function routeScope(key, scope = '') {
  if (personalRoutes.has(key)) return 'personal'
  if (workspaceRoutes.has(key) || (pageRoutes.has(key) && scope === 'workspace')) return 'workspace'
  return 'project'
}
export const documentOwner = (page) => page?.projectId ?? null
export function pagesInScope(pages, projectId) {
  return pages.filter((page) => documentOwner(page) === (projectId || null))
}
export function libraryReturn(value, base = '/flow/') {
  if (!value) return ''
  try {
    const url = new URL(value, 'http://flow.local')
    return url.origin === 'http://flow.local' && url.pathname === `${base}all-pages`
      ? url.pathname + url.search
      : ''
  } catch {
    return ''
  }
}

// Management destinations share a scoped page navigation, independent of project views.
export const managementTabs = {
  workspace: [
    {
      value: 'workspace-overview',
      get label() {
        return tr('flow.ui.overview')
      },
      icon: 'grid',
    },
    {
      value: 'all-issues',
      get label() {
        return tr('flow.ui.tasks')
      },
      icon: 'list',
    },
    {
      value: 'all-pages',
      get label() {
        return tr('flow.ui.documents')
      },
      icon: 'book',
    },
    {
      value: 'workspace-members',
      get label() {
        return tr('flow.ui.member')
      },
      icon: 'list',
    },
    {
      value: 'workspace-settings',
      get label() {
        return tr('flow.ui.settings')
      },
      icon: 'settings',
    },
  ],
  company: [
    {
      value: 'organization',
      get label() {
        return tr('flow.ui.overview')
      },
      icon: 'grid',
    },
    { value: 'workspaces', label: 'Workspace', icon: 'folder' },
    {
      value: 'organization-members',
      get label() {
        return tr('flow.ui.members.invitations')
      },
      icon: 'list',
    },
    { value: 'teams', label: 'Team', icon: 'layers' },
    {
      value: 'permissions',
      get label() {
        return tr('flow.ui.roles.permissions')
      },
      icon: 'flag',
    },
    {
      value: 'organization-settings',
      get label() {
        return tr('flow.ui.settings')
      },
      icon: 'settings',
    },
  ],
}
export function managementNavigation(route) {
  const active = { team: 'teams', tags: 'organization-settings' }[route] ?? route
  for (const [scope, options] of Object.entries(managementTabs)) {
    if (options.some((option) => option.value === active)) return { scope, active, options }
  }
  return null
}
